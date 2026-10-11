// Synchronisation with the server: push local changes, then pull the server's changes.
//
// There is no separate outbox to keep in step. What has to be pushed is computed every time: the rows the app
// would send (stateToRows(S)) compared with a snapshot of what the server has acknowledged (store.getSynced()).
// Pending changes therefore survive restarts and long offline periods automatically, and pending() is just the
// size of that difference. Pulled rows are written into S and into the snapshot, so they are never echoed back.
//
// Rules that keep data safe:
//  - a device that has never synced pulls first, so its defaults never overwrite the account
//  - a row the user changed locally and that isn't pushed yet is never overwritten by a pull (it is pushed next time)
//  - S is saved before the snapshot says "the server has this"; if saving fails, the snapshot is not touched
//  - if the user or the database changes while a request is in flight, the cycle stops without touching anything
(function (root, factory) {
  const map = typeof module === 'object' && module.exports ? require('./sync-map.js') : root;
  const m = factory(map);
  if (typeof module === 'object' && module.exports) module.exports = m; else Object.assign(root, m);
})(this, function (map) {
  'use strict';
  const { TABLE_ORDER, stableStringify, ensureIds, stateToRows, applyRows, keyOf } = map;
  const BATCH = 400;   // the server accepts at most 500 changes per push

  class Aborted extends Error {}

  // deps: { store, api(path, opts) → Promise, getState() → S, onStateChanged() → Promise (must reject if S
  //         could not be saved), userId(), generation() → changes whenever another user/database is opened }
  function createSync(deps) {
    let running = null, again = false;
    const status = { state: 'idle', pending: 0, lastSync: null, error: null, rejected: [] };
    const listeners = [];
    const emit = () => listeners.forEach(fn => fn(Object.assign({}, status)));
    const generation = () => (deps.generation ? deps.generation() : 0);

    // Rows as JSON, keyed 'table|key'
    function desiredJson(S, me) {
      const out = new Map();
      for (const [key, d] of stateToRows(S, me)) out.set(key, { table: d.table, row: d.row, json: stableStringify(d.row) });
      return out;
    }

    // The changes the server doesn't have yet, in dependency order
    function outbox(desired, synced) {
      const changes = [];
      for (const [key, d] of desired) if (synced.get(key) !== d.json) changes.push({ key, json: d.json, table: d.table, op: 'upsert', row: d.row });
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
      if (!S || !deps.store.isOpen || !deps.userId()) return 0;
      return outbox(desiredJson(S, deps.userId()), await deps.store.getSynced()).length;
    }

    // Fetches the server's changes since the cursor (or everything) and merges them into S.
    // Returns the number of changes still pending afterwards.
    async function pull(full, firstSync, check) {
      const store = deps.store, me = deps.userId();
      const cursor = full ? null : await store.getMeta('cursor');
      const res = await deps.api('/sync/pull' + (cursor ? '?since=' + encodeURIComponent(cursor) : ''));
      check();
      const S = deps.getState(), synced = await store.getSynced();
      const changes = res.changes || {};

      // Rows changed locally after the push (or deleted locally) win over what the server sends now: they are
      // pushed in the next cycle. Not on the very first sync, where the account's data must win over defaults.
      if (!firstSync) {
        const before = desiredJson(S, me), localPending = new Set();
        for (const [key, d] of before) if (synced.get(key) !== d.json) localPending.add(key);
        for (const key of synced.keys()) if (!before.has(key)) localPending.add(key);
        for (const t of Object.keys(changes)) changes[t] = (changes[t] || []).filter(r => !localPending.has(keyOf(t, r)));
      }

      const applied = applyRows(S, changes, me);
      if (applied.length) {
        // S must be saved before the snapshot says "the server has this" – otherwise a crash (or a failed save)
        // would look like local deletions and be pushed as such. onStateChanged rejects if saving failed.
        await deps.onStateChanged({ pulled: applied.length });
        check();
        const after = desiredJson(S, me), puts = [], dels = [];
        for (const key of new Set(applied)) {
          const d = after.get(key);
          if (d) puts.push([key, d.json]); else dels.push(key);
        }
        await store.updateSynced(puts, dels);
      }
      check();
      await store.setMeta('cursor', res.cursor);
      return outbox(desiredJson(deps.getState(), me), await store.getSynced()).length;
    }

    async function cycle() {
      const store = deps.store, me = deps.userId(), gen = generation();
      // Stop as soon as another user or database is active – never write A's data into B's database
      const check = () => { if (generation() !== gen || deps.userId() !== me || !store.isOpen) throw new Aborted(); };
      let S = deps.getState();
      if (ensureIds(S)) { await deps.onStateChanged(); check(); }

      // A device that has never synced pulls first, so its defaults (empty settings, 1RM 0) never overwrite
      // the account's real data. Rows it has locally (e.g. moved from before login) are pushed afterwards.
      const firstSync = !(await store.getMeta('cursor'));
      if (firstSync) await pull(true, true, check);

      // 1. Push
      S = deps.getState();
      const changes = outbox(desiredJson(S, me), await store.getSynced());
      status.pending = changes.length; emit();
      let fullPull = false;
      for (let i = 0; i < changes.length; i += BATCH) {
        const batch = changes.slice(i, i + BATCH);
        const res = await deps.api('/sync/push', { body: { changes: batch.map(c => ({ table: c.table, op: c.op, row: c.row })) } });
        check();
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
          else dels.push(c.key);   // a refused delete: forget it locally, the full pull brings the row back
          fullPull = true;
        }
        await store.updateSynced(puts, dels);
      }

      // 2. Pull (everything after a rejection, so the server's version wins)
      return pull(fullPull, false, check);
    }

    // Runs one push+pull. Calls while a sync is running are folded into one extra run afterwards.
    function run() {
      if (!deps.store.isOpen || !deps.userId()) return Promise.resolve(status);
      if (running) { again = true; return running; }
      status.state = 'syncing'; emit();
      running = (async () => {
        try {
          status.pending = await cycle();
          status.state = 'ok'; status.error = null; status.lastSync = Date.now();
        } catch (e) {
          if (e instanceof Aborted) { status.state = 'idle'; again = false; }
          else {
            status.state = e && e.status === 0 ? 'offline' : 'error';
            status.error = (e && e.message) || String(e);
            status.pending = await pending().catch(() => status.pending);
          }
        }
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
