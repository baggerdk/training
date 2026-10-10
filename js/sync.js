// Synchronisation with the server: push local changes, then pull the server's changes.
//
// There is no separate outbox to keep in step. What has to be pushed is computed every time: the rows the app
// would send (stateToRows(S)) compared with a snapshot of what the server has acknowledged (store.getSynced()).
// Pending changes therefore survive restarts and long offline periods automatically, and pending() is just the
// size of that difference. Pulled rows are written into S and into the snapshot, so they are never echoed back.
(function (root, factory) {
  const map = typeof module === 'object' && module.exports ? require('./sync-map.js') : root;
  const m = factory(map);
  if (typeof module === 'object' && module.exports) module.exports = m; else Object.assign(root, m);
})(this, function (map) {
  'use strict';
  const { TABLE_ORDER, stableStringify, ensureIds, stateToRows, applyRows } = map;
  const BATCH = 400;   // the server accepts at most 500 changes per push

  // deps: { store, api(path, opts) → Promise, getState() → S, onStateChanged(), userId() }
  function createSync(deps) {
    let running = null, again = false;
    const status = { state: 'idle', pending: 0, lastSync: null, error: null, rejected: [] };
    const listeners = [];
    const emit = () => listeners.forEach(fn => fn(Object.assign({}, status)));

    // The changes the server doesn't have yet, in dependency order
    function outbox(desired, synced) {
      const changes = [];
      for (const [key, { table, row }] of desired) {
        const json = stableStringify(row);
        if (synced.get(key) !== json) changes.push({ key, json, table, op: 'upsert', row });
      }
      for (const key of synced.keys()) {
        if (desired.has(key)) continue;
        const table = key.slice(0, key.indexOf('|')), id = key.slice(key.indexOf('|') + 1);
        if (table === 'user_settings') continue;              // never deleted
        changes.push({ key, json: null, table, op: 'delete', row: deleteRow(table, id) });
      }
      const rank = t => TABLE_ORDER.indexOf(t);
      // Deletes go last, children before parents, so a set is never orphaned mid-push
      return changes.sort((a, b) => (a.op === b.op ? (a.op === 'delete' ? rank(b.table) - rank(a.table) : rank(a.table) - rank(b.table)) : a.op === 'delete' ? 1 : -1));
    }

    function deleteRow(table, id) {
      const pk = { program_progress: 'program_id', training_maxes: 'lift_key', user_exercise_videos: 'exercise_id', custom_exercises: 'exercise_id' }[table] || 'id';
      return { [pk]: id };
    }

    async function pending() {
      const S = deps.getState();
      if (!S || !deps.store.isOpen) return 0;
      return outbox(stateToRows(S, deps.userId()), await deps.store.getSynced()).length;
    }

    // Fetches the server's changes since the cursor (or everything) and merges them into S
    async function pull(full) {
      const store = deps.store, me = deps.userId();
      const cursor = full ? null : await store.getMeta('cursor');
      const res = await deps.api('/sync/pull' + (cursor ? '?since=' + encodeURIComponent(cursor) : ''));
      const S = deps.getState();
      const applied = applyRows(S, res.changes || {}, me);
      if (applied.length) {
        // S must be saved before the snapshot says "the server has this" – otherwise a crash in between would
        // look like local deletions and be pushed as such
        await deps.onStateChanged({ pulled: applied.length });
        const desired = stateToRows(S, me), puts = [], dels = [];
        for (const key of new Set(applied)) {
          const d = desired.get(key);
          if (d) puts.push([key, stableStringify(d.row)]); else dels.push(key);
        }
        await store.updateSynced(puts, dels);
      }
      await store.setMeta('cursor', res.cursor);
    }

    async function cycle() {
      const store = deps.store, me = deps.userId();
      let S = deps.getState();
      if (ensureIds(S)) await deps.onStateChanged();

      // A device that has never synced pulls first, so its defaults (empty settings, 1RM 0) never overwrite
      // the account's real data. Rows it has locally (e.g. moved from before login) are pushed afterwards.
      if (!(await store.getMeta('cursor'))) await pull(true);

      // 1. Push
      const synced = await store.getSynced();
      const changes = outbox(stateToRows(S, me), synced);
      let fullPull = false;
      for (let i = 0; i < changes.length; i += BATCH) {
        const batch = changes.slice(i, i + BATCH);
        const res = await deps.api('/sync/push', { body: { changes: batch.map(c => ({ table: c.table, op: c.op, row: c.row })) } });
        const rejectedIdx = new Set((res.rejected || []).map(r => r.index));
        const puts = [], dels = [];
        batch.forEach((c, j) => {
          if (rejectedIdx.has(j)) return;
          if (c.op === 'delete') dels.push(c.key); else puts.push([c.key, c.json]);
        });
        for (const r of res.rejected || []) {
          const c = batch[r.index];
          if (!c) continue;
          status.rejected.push({ table: c.table, reason: r.reason, message: r.message, at: Date.now() });
          if (r.reason === 'not_found' && c.op === 'delete') { dels.push(c.key); continue; }   // the server never had it
          // Anything else: remember this exact content so it isn't retried forever, and fetch the server's version,
          // which replaces the local change that was not allowed (e.g. editing a trainer's program)
          if (c.op === 'upsert') puts.push([c.key, c.json]);
          fullPull = true;
        }
        await store.updateSynced(puts, dels);
      }

      // 2. Pull (everything after a rejection, so the server's version wins)
      await pull(fullPull);
      return changes.length;
    }

    // Runs one push+pull. Calls while a sync is running are folded into one extra run afterwards.
    function run() {
      if (!deps.store.isOpen || !deps.userId()) return Promise.resolve(status);
      if (running) { again = true; return running; }
      status.state = 'syncing'; emit();
      running = (async () => {
        try { status.pending = await pending(); emit(); } catch (e) { }
        try {
          await cycle();
          status.state = 'ok'; status.error = null; status.lastSync = Date.now();
        } catch (e) {
          status.state = e && e.status === 0 ? 'offline' : 'error';
          status.error = (e && e.message) || String(e);
        }
        status.pending = await pending().catch(() => status.pending);
        emit();
        return Object.assign({}, status);
      })().finally(() => {
        running = null;
        if (again) { again = false; run(); }
      });
      return running;
    }

    async function refreshPending() { status.pending = await pending(); emit(); return status.pending; }
    function reset() { Object.assign(status, { state: 'idle', pending: 0, lastSync: null, error: null, rejected: [] }); emit(); }

    return { run, pending, refreshPending, reset, onStatus: fn => listeners.push(fn), get status() { return Object.assign({}, status); } };
  }

  return { createSync };
});
