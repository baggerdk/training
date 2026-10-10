// Exercise ids are a contract: the server stores them in programs and logs. An id may never disappear or be
// renamed – an exercise that is retired is marked `deprecated: true` in js/data.js instead.
// New exercises: add their id to test/fixtures/exercise-ids.json.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const ctx = {};
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../js/data.js', import.meta.url), 'utf8') + ';this.EX = EXERCISES; this.TREES = TREES;', ctx);
const known = JSON.parse(readFileSync(new URL('./fixtures/exercise-ids.json', import.meta.url), 'utf8'));
const ids = ctx.EX.map(e => e.id);

describe('øvelses-id-kontrakten', () => {
  it('ingen kendte id\'er er forsvundet eller omdøbt', () => {
    const missing = known.filter(id => !ids.includes(id));
    expect(missing, `Forsvundne id'er (markér dem deprecated i stedet): ${missing.join(', ')}`).toEqual([]);
  });

  it('alle id\'er er unikke og har det aftalte format (kebab-case, max 64 tegn)', () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    for (const id of ids) expect(id.length).toBeLessThanOrEqual(64);
  });

  it('nye øvelser er registreret i fixture-listen', () => {
    const added = ids.filter(id => !known.includes(id));
    expect(added, `Tilføj til test/fixtures/exercise-ids.json: ${added.join(', ')}`).toEqual([]);
  });

  it('progressionstræerne peger kun på øvelser, der findes', () => {
    for (const [key, tree] of Object.entries(ctx.TREES)) for (const step of tree.steps) expect(ids, `${key}: ${step}`).toContain(step);
  });
});
