// Local storage in IndexedDB (Dexie) behind a small repository API. One database per user.
//
// The app keeps working on the in-memory state object S (synchronous UI). persist(S) writes only what changed
// since the last load/persist: every program, workout log, max test and custom exercise is its own row, and the
// remaining fields (settings, rm, videos, active workout, …) are key/value rows. Row order is kept in `i`.
(function (root, factory) {
  const Dexie = typeof module === 'object' && module.exports ? require('dexie') : root.Dexie;
  const m = factory(Dexie);
  if (typeof module === 'object' && module.exports) module.exports = m; else Object.assign(root, m);
})(this, function (Dexie) {
  'use strict';

  // Arrays in S whose elements have an id → one table each
  const ENTITY_TABLES = ['programs', 'logs', 'tests', 'customEx'];
  // Workout logs and max tests are never changed in place (a change replaces the object), so their JSON is cached
  // per object instead of re-serialising the whole training history on every save
  const IMMUTABLE = new Set(['logs', 'tests']);
  // = JSON.stringify({ id, i, data }) with the data's JSON already made
  const rowJson = (id, i, dj) => '{"id":' + JSON.stringify(id) + ',"i":' + i + ',"data":' + dj + '}';

  function createStore(dexieOptions) {
    let db = null, generation = 0;
    const snap = new Map();        // 'table|id' → JSON as last written, 'kv|key' → JSON
    let queue = Promise.resolve(); // persist() calls run one at a time
    let synced = null;             // in-memory copy of the sync snapshot, loaded once per open
    let jsonCache = new WeakMap();

    function dataJson(t, data) {
      if (!IMMUTABLE.has(t)) return JSON.stringify(data);
      let j = jsonCache.get(data);
      if (j === undefined) { j = JSON.stringify(data); jsonCache.set(data, j); }
      return j;
    }

    async function open(name) {
      close();
      db = new Dexie(name, dexieOptions);
      db.version(1).stores({ programs: 'id', logs: 'id', tests: 'id', customEx: 'id', kv: 'key' });
      // v2: what the server has acknowledged (sync snapshot, 'table|key' → JSON) and sync metadata (cursor)
      db.version(2).stores({ synced: 'key', meta: 'key' });
      await db.open();
    }

    // Every open/close is a new generation: work started for one database never lands in another
    function close() {
      if (db) db.close();
      db = null;
      generation++;
      snap.clear();
      synced = null;
      jsonCache = new WeakMap();
    }

    // Reads everything into a state object. Fields missing in the database keep their value from `defaults`.
    async function load(defaults) {
      const state = Object.assign({}, defaults);
      snap.clear();
      for (const t of ENTITY_TABLES) {
        const rows = (await db.table(t).toArray()).sort((a, b) => a.i - b.i);
        state[t] = rows.map(r => r.data);
        rows.forEach(r => snap.set(t + '|' + r.id, rowJson(r.id, r.i, dataJson(t, r.data))));
      }
      for (const r of await db.table('kv').toArray()) {
        state[r.key] = r.value;
        snap.set('kv|' + r.key, JSON.stringify(r.value));
      }
      return state;
    }

    // What has to be written to make the database equal to `state`
    function diff(state) {
      const changes = { puts: {}, dels: {}, kv: [], kvDel: [], next: new Map() };
      const seen = new Set();
      for (const t of ENTITY_TABLES) {
        changes.puts[t] = []; changes.dels[t] = [];
        (state[t] || []).forEach((data, i) => {
          if (!data || data.id == null) return;
          const key = t + '|' + data.id, json = rowJson(data.id, i, dataJson(t, data));
          seen.add(key);
          if (snap.get(key) !== json) { changes.puts[t].push({ id: data.id, i, data }); changes.next.set(key, json); }
        });
      }
      for (const k of Object.keys(state)) {
        if (ENTITY_TABLES.includes(k)) continue;
        const key = 'kv|' + k, json = JSON.stringify(state[k] === undefined ? null : state[k]);
        seen.add(key);
        if (snap.get(key) !== json) { changes.kv.push({ key: k, value: JSON.parse(json) }); changes.next.set(key, json); }
      }
      for (const key of snap.keys()) {
        if (seen.has(key)) continue;
        const [t, id] = [key.slice(0, key.indexOf('|')), key.slice(key.indexOf('|') + 1)];
        if (t === 'kv') changes.kvDel.push(id); else changes.dels[t].push(id);
      }
      return changes;
    }

    // Writes the changes in one transaction. Resolves with the number of rows written/deleted.
    // Bound to the database that is open when persist() is called: a save still queued when another user's
    // database is opened must never write into it.
    function persist(state) {
      const target = db, gen = generation;
      // A failed write must not block later ones, so the queue continues after errors
      queue = queue.catch(() => {}).then(async () => {
        if (!db || db !== target || gen !== generation) throw new Error('Databasen er ikke åben');
        const c = diff(state);
        const count = c.next.size + c.kvDel.length + ENTITY_TABLES.reduce((n, t) => n + c.dels[t].length, 0);
        if (!count) return 0;
        await db.transaction('rw', [...ENTITY_TABLES, 'kv'], async () => {
          for (const t of ENTITY_TABLES) {
            if (c.puts[t].length) await db.table(t).bulkPut(c.puts[t]);
            if (c.dels[t].length) await db.table(t).bulkDelete(c.dels[t]);
          }
          if (c.kv.length) await db.table('kv').bulkPut(c.kv);
          if (c.kvDel.length) await db.table('kv').bulkDelete(c.kvDel);
        });
        c.next.forEach((json, key) => snap.set(key, json));
        ENTITY_TABLES.forEach(t => c.dels[t].forEach(id => snap.delete(t + '|' + id)));
        c.kvDel.forEach(k => snap.delete('kv|' + k));
        return count;
      });
      return queue;
    }

    async function isEmpty() {
      for (const t of ENTITY_TABLES) if (await db.table(t).count()) return false;
      return true;
    }

    // ---- Sync bookkeeping (used by js/sync.js; never part of S)
    // The returned Map is shared and must be treated as read-only; updateSynced() keeps it in step
    async function getSynced() {
      if (synced) return synced;
      const gen = generation, rows = await db.table('synced').toArray();
      const m = new Map(rows.map(r => [r.key, r.json]));
      if (gen === generation) synced = m;
      return m;
    }
    async function updateSynced(puts, dels) {
      const target = db, gen = generation;
      if (!target) throw new Error('Databasen er ikke åben');
      await target.transaction('rw', 'synced', async () => {
        if (puts.length) await target.table('synced').bulkPut(puts.map(([key, json]) => ({ key, json })));
        if (dels.length) await target.table('synced').bulkDelete(dels);
      });
      if (synced && gen === generation) { puts.forEach(([k, j]) => synced.set(k, j)); dels.forEach(k => synced.delete(k)); }
    }
    async function getMeta(key) { const r = await db.table('meta').get(key); return r ? r.value : null; }
    async function setMeta(key, value) { await db.table('meta').put({ key, value }); }

    return {
      open, close, load, persist, isEmpty, getSynced, updateSynced, getMeta, setMeta,
      get isOpen() { return !!db; }, get generation() { return generation; },
    };
  }

  return { createStore, ENTITY_TABLES };
});
