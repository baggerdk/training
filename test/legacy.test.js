import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { migrateLegacyState, FORMAT_VERSION } = require('../js/legacy.js');
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
