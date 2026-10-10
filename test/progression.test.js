// Unit tests of the progression rules (js/progression.js): double progression, tree steps, %TM and records.
import { describe, expect, it } from 'vitest';
import { loadAppLogic } from './helpers/app-logic.js';

const { PROG, TREES } = loadAppLogic();

const state = (logs, extra) => Object.assign({
  logs: logs || [], customEx: [], rm: { squat: 100, bench: 80, deadlift: 140, ohp: 50 },
  settings: { tmPct: 90, inc: 2.5, auto: true },
}, extra);
const log = (ex, sets) => ({ items: [{ ex, sets }] });
const set = (r, tgt, more) => Object.assign({ r, kg: 0, t: 0, rpe: 8, tgt }, more);
const reps = (n, r, rMax) => Array.from({ length: n }, () => ({ r, rMax, rest: 120 }));

describe('beregninger', () => {
  it('e1RM (Epley) og 1 rep = vægten selv', () => {
    expect(PROG.e1(100, 1)).toBe(100);
    expect(PROG.e1(100, 5)).toBeCloseTo(116.67, 1);
    expect(PROG.e1(0, 5)).toBe(0);
  });

  it('%-baserede kg ud fra træningsmax (90 % af 1RM) afrundet til vægtspring', () => {
    const S = state();
    expect(PROG.tmFor(S, 'squat')).toBe(90);
    expect(PROG.kgFor(S, 'squat', 70)).toBe(62.5);            // 63 → nearest 2,5
    expect(PROG.kgFor(state([], { rm: { squat: 0 } }), 'squat', 70)).toBeNull();
  });
});

describe('dobbelt progression', () => {
  it('uden historik bruges målene som de er', () => {
    const r = PROG.suggest(state(), 'pullup', reps(3, 5, 8));
    expect(r.hint).toBeNull();
    expect(r.vals.map(v => v.r)).toEqual([5, 5, 5]);
  });

  it('alle sæt klaret under rep-loftet → +1 rep', () => {
    const tgt = { r: 5, rMax: 8 };
    const S = state([log('pullup', [set(6, tgt), set(6, tgt), set(6, tgt)])]);
    const r = PROG.suggest(S, 'pullup', reps(3, 5, 8));
    expect(r.vals.map(v => v.r)).toEqual([7, 7, 7]);
    expect(r.hint.text).toContain('prøv 7 reps');
  });

  it('rep-loftet nået på en øvelse, der kan belastes → +vægtspring og tilbage til bunden af intervallet', () => {
    const tgt = { r: 5, rMax: 8 };
    const S = state([log('dip', [set(8, tgt, { kg: 10 }), set(8, tgt, { kg: 10 })])]);
    const r = PROG.suggest(S, 'dip', reps(2, 5, 8));
    expect(r.vals.map(v => [v.r, v.kg])).toEqual([[5, 12.5], [5, 12.5]]);
  });

  it('rep-loftet nået uden ekstra vægt → forslag om næste trin i træet', () => {
    const tgt = { r: 5, rMax: 8 };
    const S = state([log('negative-pullup', [set(8, tgt), set(8, tgt)])]);
    const r = PROG.suggest(S, 'negative-pullup', reps(2, 5, 8));
    const steps = TREES.pull.steps;
    expect(r.hint.up).toBe(steps[steps.indexOf('negative-pullup') + 1]);
  });

  it('missede reps → gentag (ingen progression)', () => {
    const tgt = { r: 5, rMax: 8 };
    const S = state([log('pullup', [set(5, tgt), set(4, tgt)])]);
    const r = PROG.suggest(S, 'pullup', reps(2, 5, 8));
    expect(r.hint.text).toContain('gentag');
    expect(r.vals.map(v => v.r)).toEqual([5, 5]);
  });

  it('for høj RPE (over 8,5) → ingen progression, selvom reps blev klaret', () => {
    const tgt = { r: 5, rMax: 8 };
    const S = state([log('pullup', [set(6, tgt, { rpe: 9.5 }), set(6, tgt, { rpe: 9 })])]);
    const r = PROG.suggest(S, 'pullup', reps(2, 5, 8));
    expect(r.vals.map(v => v.r)).toEqual([6, 6]);
    expect(r.hint.text).toContain('gentag');
  });

  it('hold-øvelser: +2 s, og ved loftet foreslås næste trin', () => {
    const tgt = { t: 15, tMax: 30 };
    const holds = [{ t: 15, tMax: 30 }, { t: 15, tMax: 30 }];
    const r1 = PROG.suggest(state([log('tuck-planche', [set(0, tgt, { t: 20 }), set(0, tgt, { t: 22 })])]), 'tuck-planche', holds);
    expect(r1.vals.map(v => v.t)).toEqual([22, 22]);
    const r2 = PROG.suggest(state([log('tuck-planche', [set(0, tgt, { t: 30 }), set(0, tgt, { t: 31 })])]), 'tuck-planche', holds);
    expect(r2.hint.up).toBe('adv-tuck-planche');
  });

  it('automatisk progression slået fra → ingen forslag', () => {
    const tgt = { r: 5, rMax: 8 };
    const S = state([log('pullup', [set(6, tgt)])], { settings: { tmPct: 90, inc: 2.5, auto: false } });
    expect(PROG.suggest(S, 'pullup', reps(1, 5, 8)).hint).toBeNull();
  });

  it('bruger den seneste træning med øvelsen', () => {
    const tgt = { r: 5, rMax: 8 };
    const S = state([log('pullup', [set(5, tgt)]), log('dip', [set(9, tgt)]), log('pullup', [set(7, tgt)])]);
    expect(PROG.lastPerf(S, 'pullup').sets[0].r).toBe(7);
  });

  it('%-sæt beholder den beregnede vægt fra træningsmax', () => {
    const r = PROG.suggest(state(), 'back-squat', [{ pct: 70, r: 5, rest: 180 }], 'squat');
    expect(r.vals[0].kg).toBe(62.5);
  });
});

describe('rekorder', () => {
  it('finder max reps (uden vægt), max kg, bedste e1RM og længste hold pr. øvelse', () => {
    const B = PROG.bests([
      log('pullup', [set(8), set(10)]),
      log('back-squat', [set(5, null, { kg: 100 }), set(1, null, { kg: 115 })]),
      log('plank', [set(0, null, { t: 60 }), set(0, null, { t: 75 })]),
    ]);
    expect(B.pullup.reps).toBe(10);
    expect(B['back-squat'].kg).toBe(115);
    expect(B['back-squat'].e1).toBeCloseTo(116.67, 1);   // 100×5 beats 115×1
    expect(B.plank.t).toBe(75);
  });
});
