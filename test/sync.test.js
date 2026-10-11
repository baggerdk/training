// Sync: the mapping (lossless round trip) and the engine against an in-memory server with the real API's rules.
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { stateToRows, applyRows, ensureIds, stableStringify } = require('../js/sync-map.js');
const { createSync } = require('../js/sync.js');
const { createStore } = require('../js/store.js');
const { migrateLegacyState } = require('../js/legacy.js');
const { newId } = require('../js/ids.js');

const ME = '11111111-1111-4111-8111-111111111111';
const TRAINER = '22222222-2222-4222-8222-222222222222';
const empty = () => ({ v: 2, programs: [], activeProg: null, logs: [], tests: [], customEx: [], videos: {}, rm: {}, settings: {}, active: null });
const fixture = () => {
  const s = Object.assign(empty(), migrateLegacyState(JSON.parse(readFileSync(new URL('./fixtures/legacy-v1.json', import.meta.url), 'utf8'))));
  ensureIds(s);
  return s;
};
const rowsJson = s => [...stateToRows(s, ME)].map(([k, v]) => [k, stableStringify(v.row)]).sort();

// ---------------------------------------------------------------- an in-memory server
const PK = { programs: ['id'], program_progress: ['program_id'], workout_sessions: ['id'], set_logs: ['id'], training_maxes: ['lift_key'],
  user_exercise_videos: ['exercise_id'], max_tests: ['id'], user_settings: [], custom_exercises: ['exercise_id'] };
function fakeServer() {
  let clock = 0;
  const tables = Object.fromEntries(Object.keys(PK).map(t => [t, new Map()]));
  const ts = () => new Date(Date.UTC(2026, 0, 1) + ++clock * 1000).toISOString();
  const key = (t, r) => PK[t].map(k => r[k]).join('|') || 'me';
  const server = {
    tables, pushes: 0, offline: false,
    seed(t, row) { tables[t].set(key(t, row), Object.assign({ deleted_at: null, updated_at: ts() }, row)); },
    async api(path, opts = {}) {
      if (server.offline) { const e = new Error('offline'); e.status = 0; throw e; }
      if (path === '/sync/push') {
        server.pushes++;
        const rejected = [];
        opts.body.changes.forEach((c, index) => {
          const t = tables[c.table], k = key(c.table, c.row), cur = t.get(k);
          if (c.table === 'programs') {
            const ownerOk = (c.row.owner_id || (cur && cur.owner_id)) === ME;
            if (!ownerOk || (cur && cur.created_by && cur.created_by !== ME)) { rejected.push({ index, reason: 'forbidden', message: 'nej' }); return; }
          }
          if (c.op === 'delete') {
            if (!cur) { rejected.push({ index, reason: 'not_found', message: 'findes ikke' }); return; }
            cur.deleted_at = ts(); cur.updated_at = ts(); return;
          }
          const extra = c.table === 'programs' ? { created_by: cur ? cur.created_by : ME } : {};
          t.set(k, Object.assign({}, cur, c.row, extra, { user_id: ME, deleted_at: null, updated_at: ts() }));
        });
        return { applied: opts.body.changes.length - rejected.length, rejected };
      }
      if (path.startsWith('/sync/pull')) {
        const since = new URL('http://x' + path).searchParams.get('since');
        const changes = {};
        for (const [t, m] of Object.entries(tables)) changes[t] = [...m.values()].filter(r => !since || r.updated_at > since).map(r => JSON.parse(JSON.stringify(r)));
        return { cursor: new Date(Date.UTC(2026, 0, 1) + clock * 1000).toISOString(), changes };
      }
      throw new Error('ukendt sti ' + path);
    },
  };
  return server;
}

// One "device": its own IndexedDB, its own S, the real engine
async function device(server, name, initial) {
  const store = createStore();
  const dbName = 'dev-' + name + '-' + newId();
  await store.open(dbName);
  let S = initial || empty();
  await store.persist(S);
  const saves = [];
  const sync = createSync({
    store, api: async (p, o) => { if (server.hook) await server.hook(p, o, () => S); return server.api(p, o); }, getState: () => S, userId: () => ME,
    generation: () => store.generation,
    onStateChanged: async info => { saves.push(info); await store.persist(S); },
  });
  return { store, sync, dbName, get S() { return S; }, set S(v) { S = v; }, saves };
}

// ---------------------------------------------------------------- mapping
describe('sync-mapping', () => {
  it('er tabsfri: rækker → tom app → rækker giver præcis de samme rækker', () => {
    const s = fixture();
    const rows = stateToRows(s, ME);
    const changes = {};
    for (const { table, row } of rows.values()) (changes[table] ||= []).push(Object.assign({ owner_id: ME, created_by: ME, deleted_at: null }, row));
    const t = empty();
    applyRows(t, changes, ME);
    expect(rowsJson(t)).toEqual(rowsJson(s));
    expect(t.programs.map(p => p.pos)).toEqual(s.programs.map(p => p.pos));
    expect(t.logs).toEqual(s.logs);
  });

  it('laver gyldige rækker til serverens regler', () => {
    const s = fixture();
    const rows = [...stateToRows(s, ME).values()];
    const by = t => rows.filter(r => r.table === t).map(r => r.row);
    expect(by('workout_sessions')).toHaveLength(5);
    expect(by('set_logs').length).toBeGreaterThan(5);
    for (const r of by('set_logs')) {
      expect(r.exercise_id.length).toBeGreaterThan(0);
      expect(r.rpe === null || (r.rpe > 0 && r.rpe <= 10)).toBe(true);
    }
    expect(by('max_tests').map(r => [r.test_key, r.unit])).toEqual([['pullup', 'reps'], ['hang', 's'], ['rm_squat', 'kg']]);
    expect(by('workout_sessions').find(r => r.name === 'Fri træning').program_id).toBeNull();
    expect(by('user_settings')[0].data.activeProgramId).toBe(s.activeProg);
  });

  it('en log, der peger på et program, serveren ikke kender, sendes uden reference', () => {
    const s = fixture();
    s.logs[0].progId = newId();
    expect(stateToRows(s, ME).get('workout_sessions|' + s.logs[0].id).row.program_id).toBeNull();
  });
});

// ---------------------------------------------------------------- engine
describe('sync-motoren', () => {
  let server;
  beforeEach(() => { server = fakeServer(); });

  it('sender alt første gang og intet anden gang', async () => {
    const a = await device(server, 'a', fixture());
    expect(await a.sync.pending()).toBeGreaterThan(10);
    expect((await a.sync.run()).state).toBe('ok');
    expect(await a.sync.pending()).toBe(0);
    const pushes = server.pushes;
    await a.sync.run();
    expect(server.pushes).toBe(pushes);       // nothing to push → no push request
    expect(server.tables.workout_sessions.size).toBe(5);
  });

  it('to enheder ender med de samme data', async () => {
    const a = await device(server, 'a', fixture());
    const b = await device(server, 'b');
    await a.sync.run(); await b.sync.run();
    expect(rowsJson(b.S)).toEqual(rowsJson(a.S));
    expect(await b.sync.pending()).toBe(0);
    // b logs a test; a gets it
    b.S.tests.push({ id: newId(), k: 'dip', v: 20, date: Date.UTC(2026, 1, 1) });
    await b.sync.run(); await a.sync.run();
    expect(a.S.tests.some(t => t.k === 'dip' && t.v === 20)).toBe(true);
    expect(rowsJson(a.S)).toEqual(rowsJson(b.S));
  });

  it('en ny enhed overskriver ikke kontoens indstillinger og 1RM med sine tomme standardværdier', async () => {
    const a = await device(server, 'a', fixture());
    await a.sync.run();
    const b = await device(server, 'b', Object.assign(empty(), { rm: { squat: 0, bench: 0, deadlift: 0, ohp: 0 }, settings: { tmPct: 90 } }));
    await b.sync.run();
    expect(server.tables.training_maxes.get('squat').one_rm_kg).toBe(140);
    expect(b.S.rm.squat).toBe(140);
    expect(b.S.activeProg).toBe(a.S.activeProg);
  });

  it('sletninger følger med (soft delete)', async () => {
    const a = await device(server, 'a', fixture());
    const b = await device(server, 'b');
    await a.sync.run(); await b.sync.run();
    const gone = a.S.logs.splice(0, 1)[0];
    delete a.S.videos.pullup;
    await a.sync.run(); await b.sync.run();
    expect(server.tables.workout_sessions.get(gone.id).deleted_at).toBeTruthy();
    expect(b.S.logs.map(l => l.id)).not.toContain(gone.id);
    expect(b.S.videos.pullup).toBeUndefined();
    expect(await a.sync.pending()).toBe(0);
    expect(await b.sync.pending()).toBe(0);
  });

  it('offline: ændringer venter og sendes, når der er net igen', async () => {
    const a = await device(server, 'a', fixture());
    await a.sync.run();
    server.offline = true;
    a.S.rm.squat = 150;
    a.S.tests.push({ id: newId(), k: 'pullup', v: 15, date: Date.UTC(2026, 2, 1) });
    const st = await a.sync.run();
    expect(st.state).toBe('offline');
    expect(st.pending).toBe(2);
    // …the app restarts while offline: the pending changes are derived again from S + snapshot
    const again = createSync({ store: a.store, api: server.api, getState: () => a.S, userId: () => ME, onStateChanged: () => a.store.persist(a.S) });
    expect(await again.pending()).toBe(2);
    server.offline = false;
    expect((await again.run()).state).toBe('ok');
    expect(server.tables.training_maxes.get('squat').one_rm_kg).toBe(150);
  });

  it('en afvist ændring (trænerens program) erstattes af serverens version og prøves ikke igen', async () => {
    const pid = newId();
    server.seed('programs', { id: pid, owner_id: ME, created_by: TRAINER, name: 'Fra træner', template_key: null, level: null, days_per_week: 1, data: { days: [{ id: 'd1', name: 'Dag 1', items: [] }], weeks: 4 } });
    const a = await device(server, 'a');
    await a.sync.run();
    const p = a.S.programs.find(x => x.id === pid);
    expect(p).toMatchObject({ name: 'Fra træner', author: TRAINER });
    p.name = 'Mit nu';
    const st = await a.sync.run();
    expect(st.rejected).toHaveLength(1);
    expect(a.S.programs.find(x => x.id === pid).name).toBe('Fra træner');   // the server's version won
    expect(await a.sync.pending()).toBe(0);
    const pushes = server.pushes;
    await a.sync.run();
    expect(server.pushes).toBe(pushes);
  });

  it('gemmer appens data, før snapshottet opdateres efter en pull', async () => {
    const a = await device(server, 'a', fixture());
    await a.sync.run();
    const b = await device(server, 'b');
    await b.sync.run();
    expect(b.saves.some(s => s && s.pulled > 0)).toBe(true);
    // b's database (not just memory) has the pulled data, and nothing is pending after a restart
    b.store.close();
    await b.store.open(b.dbName);
    const loaded = await b.store.load(empty());
    expect(loaded.logs).toHaveLength(5);
    b.S = loaded;
    expect(await b.sync.pending()).toBe(0);
  });

  it('samler kald, der kommer, mens en sync kører, til én ekstra kørsel', async () => {
    const a = await device(server, 'a', fixture());
    const p1 = a.sync.run(), p2 = a.sync.run(), p3 = a.sync.run();
    await Promise.all([p1, p2, p3]);
    await new Promise(r => setTimeout(r, 50));
    expect(server.pushes).toBe(1);
  });
});

describe('programmer fra en træner', () => {
  it('får ejer og forfatter med og sendes tilbage uændret, hvis brugeren ikke rører dem', () => {
    const { programToRow, rowToProgram } = require('../js/sync-map.js');
    const row = { id: newId(), owner_id: ME, created_by: TRAINER, name: 'Fra træner', template_key: 'cal', level: 'øvet', days_per_week: 1,
      data: { tpl: 'cal', level: 1, weeks: 4, auto: true, days: [{ id: 'd1', name: 'Dag 1', items: [] }] } };
    const p = rowToProgram(row, ME);
    expect(p).toMatchObject({ owner: ME, author: TRAINER, name: 'Fra træner' });
    const back = programToRow(p, ME);
    expect(back).toEqual({ id: row.id, owner_id: ME, name: row.name, template_key: 'cal', level: 'øvet', days_per_week: 1, data: row.data });
  });
});


describe('fejl fundet i kodereviewet (regression)', () => {
  let server;
  beforeEach(() => { server = fakeServer(); });

  it('en ændring lavet, mens push er i gang, går ikke tabt', async () => {
    const a = await device(server, 'a', fixture());
    await a.sync.run();
    a.S.programs[0].name = 'A';
    // The user renames the program again while the push request is on its way
    server.hook = (path, opts, getS) => { if (path === '/sync/push') { getS().programs[0].name = 'B'; server.hook = null; } };
    await a.sync.run();
    expect(a.S.programs[0].name).toBe('B');
    expect(await a.sync.pending()).toBe(1);                   // B is still waiting to be sent …
    await a.sync.run();
    expect(server.tables.programs.get(a.S.programs[0].id).name).toBe('B');   // … and arrives next time
    expect(await a.sync.pending()).toBe(0);
  });

  it('en træning slettet, mens sync kører, kommer ikke tilbage', async () => {
    const a = await device(server, 'a', fixture());
    await a.sync.run();
    a.S.tests.push({ id: newId(), k: 'dip', v: 30, date: Date.UTC(2026, 3, 1) });
    const gone = a.S.logs[0].id;
    server.hook = (path, opts, getS) => { if (path === '/sync/push') { getS().logs.splice(0, 1); server.hook = null; } };
    await a.sync.run(); await a.sync.run();
    expect(a.S.logs.map(l => l.id)).not.toContain(gone);
    expect(server.tables.workout_sessions.get(gone).deleted_at).toBeTruthy();
  });

  it('skifter brugeren under en sync, skrives der intet i den nye brugers database', async () => {
    const a = await device(server, 'a', fixture());
    const otherName = 'dev-b-' + newId();
    server.hook = async (path) => { if (path === '/sync/pull') { server.hook = null; a.store.close(); await a.store.open(otherName); a.S = { v: 2, programs: [], activeProg: null, logs: [], tests: [], customEx: [], videos: {}, rm: {}, settings: {}, active: null }; } };
    await a.sync.run();
    expect(await a.store.getMeta('cursor')).toBeNull();     // B's first sync is not skipped
    expect((await a.store.getSynced()).size).toBe(0);
    expect(a.S.logs).toEqual([]);
  });

  it('kan appens data ikke gemmes, opdateres snapshottet ikke (ellers bliver det til sletninger)', async () => {
    const a = await device(server, 'a', fixture());
    await a.sync.run();
    const b = await device(server, 'b');
    const failing = createSync({ store: b.store, api: server.api, getState: () => b.S, userId: () => ME, generation: () => b.store.generation,
      onStateChanged: async () => { throw new Error('lageret er fuldt'); } });
    const st = await failing.run();
    expect(st.state).toBe('error');
    expect((await b.store.getSynced()).size).toBe(0);
  });

  it('markup i et programs felter når aldrig appen', () => {
    const { rowToProgram } = require('../js/sync-map.js');
    const p = rowToProgram({ id: newId(), owner_id: ME, created_by: TRAINER, name: 'X', data: {
      weeks: '<img src=x onerror=alert(1)>', days: [{ id: 'd1', name: 'Dag', items: [{ id: 'i1', ex: 'pullup', sets: [{ r: '<b>5</b>', rest: '90' }],
        block: { kind: 'emom', min: '<svg/onload=x>', reps: 3 }, circuit: [{ ex: 'pullup', r: '<i>' }] }] }] } }, ME);
    expect(p.weeks).toBe(4);                                 // invalid → the default
    expect(p.days[0].items[0].sets[0]).toEqual({ rest: 90 });
    expect(p.days[0].items[0].block).toEqual({ kind: 'emom', reps: 3 });
    expect(p.days[0].items[0].circuit[0].r).toBe(1);
  });
});
