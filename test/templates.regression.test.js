// Regression tests of program generation: every template × 2–6 days × three levels.
// The snapshot (test/__snapshots__/) is the agreed behaviour; an unintended change in templates.js makes the
// test fail. An intended change: check the diff carefully, then update with `npx vitest run -u`.
import { describe, expect, it } from 'vitest';
import { loadAppLogic } from './helpers/app-logic.js';

const app = loadAppLogic();
const exIds = new Set(app.EXERCISES.map(e => e.id));

// Tree levels as the user picks them at setup: a fixed, middle-of-the-road step in every tree
const treeLevels = tpl => Object.fromEntries(app.templateTrees(tpl).map(k => [k, Math.min(2, app.TREES[k].steps.length - 1)]));

// A compact, readable description of what the user is asked to do each week
function describeSet(s) {
  if (s.pct) return `${s.pct}%×${s.r}${s.amrap ? '+' : ''}`;
  if (s.t) return `${s.t}${s.tMax ? '-' + s.tMax : ''}s`;
  if (s.amrap) return 'max';
  return `${s.r}${s.rMax ? '-' + s.rMax : ''}${s.rpe ? '@' + s.rpe : ''}`;
}
function describe_(p) {
  return p.days.map(d => `${d.name}: ` + d.items.map(it => {
    if (it.block) return `${it.ex} [${it.block.kind}${it.circuit ? ' ' + it.circuit.map(c => c.r + ' ' + c.ex).join('/') : ''}]`;
    const weeks = Array.from({ length: p.weeks }, (_, w) => app.targetsFor(it, w, p).map(describeSet).join(' ')).join(' | ');
    return `${it.ex}${it.lift ? '(' + it.lift + ')' : ''} {${weeks}}`;
  }).join('; '));
}

describe('programgenerering (regression)', () => {
  for (const tpl of app.TEMPLATES) for (let days = 2; days <= 6; days++) for (let L = 0; L <= 2; L++) {
    it(`${tpl.id} · ${days} dage · ${app.LEVELS[L]}`, () => {
      app.resetIds();
      const p = app.buildProgram(tpl.id, days, L, treeLevels(tpl.id));
      // Invariants that must always hold
      expect(p.days).toHaveLength(days);
      expect(p.weeks).toBeGreaterThan(0);
      for (const d of p.days) for (const it of d.items) {
        expect(exIds.has(it.ex), it.ex).toBe(true);
        for (const c of it.circuit || []) expect(exIds.has(c.ex), c.ex).toBe(true);
        for (const a of it.alts) expect(exIds.has(a), a).toBe(true);
        if (!it.block) for (let w = 0; w < p.weeks; w++) expect(app.targetsFor(it, w, p).length).toBeGreaterThan(0);
      }
      expect(describe_(p)).toMatchSnapshot();
    });
  }

  it('powerløft på øvet bruger 5/3/1: uge 3 er 75/85/95 % med AMRAP på sidste sæt', () => {
    const p = app.buildProgram('pl', 3, 1, treeLevels('pl'));
    const squat = p.days[0].items.find(it => it.ex === 'back-squat');
    expect(app.targetsFor(squat, 2, p).map(describeSet)).toEqual(['75%×5', '85%×3', '95%×1+', '75%×5', '75%×5', '75%×5']);
  });

  it('calisthenics på øvet/avanceret har deload i sidste uge (færre sæt)', () => {
    const p = app.buildProgram('cal', 3, 1, treeLevels('cal'));
    const it0 = p.days[0].items[0];
    expect(app.targetsFor(it0, p.weeks - 1, p).length).toBeLessThan(app.targetsFor(it0, 0, p).length);
    expect(app.targetsFor(it0, p.weeks - 1, p).every(s => s.deload)).toBe(true);
  });

  it('træernes trin styrer, hvilken variant brugeren får', () => {
    const easy = app.buildProgram('cal', 3, 0, { ...treeLevels('cal'), pull: 0 });
    const hard = app.buildProgram('cal', 3, 0, { ...treeLevels('cal'), pull: 5 });
    expect(easy.days[0].items[0].ex).toBe(app.TREES.pull.steps[0]);
    expect(hard.days[0].items[0].ex).toBe(app.TREES.pull.steps[5]);
  });
});
