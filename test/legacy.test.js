import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { migrateLegacyState, mergeImport, FORMAT_VERSION } = require('../js/legacy.js');
const { isUuid } = require('../js/ids.js');
const legacy = JSON.parse(readFileSync(new URL('./fixtures/legacy-v1.json', import.meta.url), 'utf8'));

describe('migrateLegacyState (gamle data → format v2 med UUID\'er)', () => {
  const s = migrateLegacyState(legacy);

  it('giver programmer, træninger og maks-tests UUID\'er', () => {
    expect(s.v).toBe(FORMAT_VERSION);
    for (const x of [...s.programs, ...s.logs, ...s.tests]) expect(isUuid(x.id), x.id).toBe(true);
  });

  it('referencer følger med deres program', () => {
    const map = Object.fromEntries(legacy.programs.map((p, i) => [p.id, s.programs[i].id]));
    expect(s.activeProg).toBe(map[legacy.activeProg]);
    expect(s.active.progId).toBe(map[legacy.active.progId]);
    legacy.logs.forEach((l, i) => expect(s.logs[i].progId).toBe(l.progId ? (map[l.progId] ?? null) : null));
  });

  it('en log fra et slettet program mister kun referencen, ikke dataene', () => {
    const orphan = s.logs[3];
    expect(orphan.progId).toBeNull();
    expect(orphan.items).toEqual(legacy.logs[3].items);
  });

  it('ændrer intet andet: øvelser, sæt, egne øvelser, videoer, 1RM og indstillinger', () => {
    const strip = x => JSON.parse(JSON.stringify(x, (k, v) => (k === 'id' || k === 'progId' || k === 'activeProg' || k === 'v' ? undefined : v)));
    expect(strip(s)).toEqual(strip(legacy));
    expect(s.customEx[0].id).toBe('my-k3j9x2ab');   // custom ids keep their 'my-' form (the server expects it)
  });

  it('ændrer ikke input og er idempotent', () => {
    const before = JSON.stringify(legacy);
    const again = migrateLegacyState(s);
    expect(JSON.stringify(legacy)).toBe(before);
    expect(again).toEqual(s);
  });

  it('bruger den angivne id-generator (deterministisk)', () => {
    let n = 0;
    const t = migrateLegacyState(legacy, () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`);
    expect(t.programs[0].id).toBe('00000000-0000-4000-8000-000000000001');
    expect(t.logs[0].progId).toBe(t.programs[0].id);
  });

  it('afviser noget, der ikke er en backup', () => {
    expect(() => migrateLegacyState({ foo: 1 })).toThrow('backup');
    expect(() => migrateLegacyState(null)).toThrow();
  });
});

describe('mergeImport (import med konto fletter ind i stedet for at erstatte)', () => {
  const empty = () => ({ v: 2, programs: [], activeProg: null, logs: [], tests: [], customEx: [], videos: {}, rm: { squat: 0, bench: 0, deadlift: 0, ohp: 0 }, settings: { tmPct: 85 }, active: null });

  it('lægger alt ind i en tom konto', () => {
    const { state, added } = mergeImport(empty(), migrateLegacyState(legacy));
    expect(added).toEqual({ programs: 2, logs: 5, tests: 3, customEx: 1 });
    expect(state.rm.squat).toBe(140);
    expect(state.settings.tmPct).toBe(85);                   // the account's settings win
    expect(state.programs.some(p => p.id === state.activeProg)).toBe(true);
  });

  it('samme gamle backup importeret to gange tilføjer intet anden gang (selv med nye UUID\'er)', () => {
    const first = mergeImport(empty(), migrateLegacyState(legacy)).state;
    const second = mergeImport(first, migrateLegacyState(legacy));
    expect(second.added).toEqual({ programs: 0, logs: 0, tests: 0, customEx: 0 });
    expect(second.state).toEqual(first);
  });

  it('sletter aldrig noget, der kun findes på kontoen', () => {
    const account = mergeImport(empty(), migrateLegacyState(legacy)).state;
    account.logs.push({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', date: 1790000000000, name: 'Kun på kontoen', items: [] });
    const small = migrateLegacyState(Object.assign({}, legacy, { programs: [], logs: [legacy.logs[0]], tests: [] }));
    const { state } = mergeImport(account, small);
    expect(state.logs.map(l => l.name)).toContain('Kun på kontoen');
    expect(state.logs).toHaveLength(account.logs.length);    // the one log in the file was already there
  });

  it('en træning peger på det program, der allerede fandtes, når programmet springes over', () => {
    const account = mergeImport(empty(), migrateLegacyState(legacy)).state;
    const again = migrateLegacyState(legacy);
    again.logs[0].date += 1;                                 // a new workout of an existing program
    const { state, added } = mergeImport(account, again);
    expect(added.logs).toBe(1);
    const newLog = state.logs.find(l => l.date === again.logs[0].date);
    expect(state.programs.map(p => p.id)).toContain(newLog.progId);
  });

  it('ændrer ikke sine input', () => {
    const a = empty(), b = migrateLegacyState(legacy), sa = JSON.stringify(a), sb = JSON.stringify(b);
    mergeImport(a, b);
    expect(JSON.stringify(a)).toBe(sa);
    expect(JSON.stringify(b)).toBe(sb);
  });
});
