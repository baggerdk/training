// The program guide (js/guide.js): answers → template, level, tree steps and adjustments.
import { describe, expect, it } from 'vitest';
import { loadAppLogic } from './helpers/app-logic.js';

const { GUIDE, TREES, EXERCISES } = loadAppLogic();
const exIds = new Set(EXERCISES.map(e => e.id));
const answers = over => Object.assign(GUIDE.defaults(null), over);
const step = (tree, i) => TREES[tree].steps[i];
const allEx = p => p.days.flatMap(d => d.items.flatMap(it => [it.ex, ...(it.alts || []), ...(it.circuit || []).map(c => c.ex)]));

describe('programguiden', () => {
  it('har 5–10 spørgsmål med danske tekster', () => {
    expect(GUIDE.QUESTIONS.length).toBeGreaterThanOrEqual(5);
    expect(GUIDE.QUESTIONS.length).toBeLessThanOrEqual(10);
    for (const q of GUIDE.QUESTIONS) expect(q.text).toMatch(/\?$/);
  });

  it('en helt ny bruger får Begynder på begynderniveau, med elastik-pull-ups når der er elastikker', () => {
    const r = GUIDE.build(answers({ goal: 'start', experience: '0', pullups: 0, dips: 0, pushups: 3, equipment: ['bar', 'pbars', 'bands'], days: '3' }));
    expect(r).toMatchObject({ tpl: 'beg', level: 0, days: 3 });
    expect(step('pull', r.trees.pull)).toBe('band-pullup');
    expect(step('push', r.trees.push)).toBe('incline-pushup');
    expect(r.program.days).toHaveLength(3);
  });

  it('en stærk bruger med skills-mål får Skills-skabelonen og trin, der passer', () => {
    const r = GUIDE.build(answers({ goal: 'skills', experience: '2', pullups: 14, dips: 22, pushups: 40, equipment: ['bar', 'pbars', 'rings'], days: '4' }));
    expect(r).toMatchObject({ tpl: 'skill', level: 2, days: 4 });
    expect(step('pull', r.trees.pull)).toBe('chest-to-bar');
    expect(step('dip', r.trees.dip)).toBe('ring-dip');
    expect(r.warnings).toEqual([]);
  });

  it('skills-mål uden basisstyrke: bygger basis først og forklarer hvorfor', () => {
    const r = GUIDE.plan(answers({ goal: 'skills', experience: '1', pullups: 3, dips: 4, pushups: 20 }));
    expect(r.tpl).toBe('cal');
    expect(r.warnings.join(' ')).toContain('5+ pull-ups og 10+ dips');
  });

  it('powerløft uden vægtstang giver et kropsvægtsprogram med advarsel', () => {
    const r = GUIDE.plan(answers({ goal: 'powerlifting', experience: '1', pullups: 6, pushups: 25, equipment: ['bar'] }));
    expect(r.tpl).toBe('cal');
    expect(r.warnings.join(' ')).toContain('vægtstang');
    expect(GUIDE.plan(answers({ goal: 'powerlifting', experience: '1', pullups: 6, pushups: 25, equipment: ['bar', 'barbell'] })).tpl).toBe('pl');
  });

  it('erfaring uden styrke sætter niveauet ned', () => {
    expect(GUIDE.plan(answers({ goal: 'strength', experience: '2', pullups: 1, pushups: 8 })).level).toBe(0);
    expect(GUIDE.plan(answers({ goal: 'military', experience: '2', pullups: 6, pushups: 30 })).level).toBe(1);
  });

  it('skader: ingen af de frarådede øvelser er med – heller ikke som varianter eller i runder', () => {
    for (const limit of Object.keys(GUIDE.AVOID)) {
      const r = GUIDE.build(answers({ goal: 'hybrid', experience: '2', pullups: 15, dips: 25, pushups: 50, equipment: ['bar', 'pbars', 'rings', 'barbell'], days: '6', limits: [limit] }));
      const bad = allEx(r.program).filter(x => GUIDE.AVOID[limit].includes(x));
      expect(bad, limit).toEqual([]);
    }
  });

  it('30 minutter giver højst 3 øvelser og 3 sæt', () => {
    const r = GUIDE.build(answers({ goal: 'strength', experience: '1', pullups: 8, dips: 12, pushups: 30, session: '30', days: '3' }));
    for (const d of r.program.days) {
      expect(d.items.length).toBeLessThanOrEqual(3);
      for (const it of d.items) expect((it.sets || []).length).toBeLessThanOrEqual(3);
    }
    expect(r.adjustments.join(' ')).toContain('30 min');
  });

  it('ekstreme svar giver altid gyldige trin og øvelser, der findes', () => {
    for (const v of [0, 1, 4, 5, 9, 10, 14, 15, 24, 25, 60]) {
      const r = GUIDE.build(answers({ goal: 'hybrid', experience: '2', pullups: v, dips: v, pushups: v * 2, legs: 'yes', equipment: ['bar', 'pbars', 'rings', 'bands', 'barbell'], days: '6' }));
      for (const [k, i] of Object.entries(r.trees)) expect(i).toBeLessThan(TREES[k].steps.length);
      for (const x of allEx(r.program)) expect(exIds.has(x), x).toBe(true);
    }
  });

  it('samme svar giver samme plan (forudsigeligt)', () => {
    const a = answers({ goal: 'military', experience: '1', pullups: 7, dips: 12, pushups: 28, days: '5' });
    expect(GUIDE.plan(a)).toEqual(GUIDE.plan(a));
  });
});
