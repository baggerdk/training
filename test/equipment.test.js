// Equipment (js/equipment.js): which exercises can be done, and adapting programs to what the user has.
import { describe, expect, it } from 'vitest';
import { loadAppLogic } from './helpers/app-logic.js';

const { EQUIPMENT, EXERCISES, TREES, TEMPLATES, GUIDE, buildProgram, templateTrees } = loadAppLogic();
const preset = id => EQUIPMENT.PRESETS.find(p => p.id === id).eq;
const ex = id => EXERCISES.find(e => e.id === id);
const lv = (tpl, L) => Object.fromEntries(templateTrees(tpl).map(k => [k, TREES[k].lvl[L]]));
const allEx = p => p.days.flatMap(d => d.items.flatMap(it => [it.ex, ...(it.alts || []), ...(it.circuit || []).map(c => c.ex)]));

describe('udstyr', () => {
  it('forudindstillinger: hjemme < park < fitnesscenter < CrossFit-box, og alle findes i EQUIP', () => {
    const sizes = ['home', 'park', 'gym', 'box'].map(k => preset(k).length);
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    for (const p of EQUIPMENT.PRESETS) expect(p.eq).toContain('none');
    expect(EQUIPMENT.presetOf([...preset('gym')].reverse()).id).toBe('gym');
    expect(EQUIPMENT.presetOf(['none', 'bar'])).toBeNull();
  });

  it('kan-laves-reglerne: alt kræves, "none" gør resten valgfrit, bar eller ringe til front lever', () => {
    expect(EQUIPMENT.canDo('bench', ['none', 'barbell'])).toBe(false);          // also needs a bench
    expect(EQUIPMENT.canDo('bench', ['none', 'barbell', 'bench'])).toBe(true);
    expect(EQUIPMENT.canDo('tuck-planche', ['none'])).toBe(true);               // parallettes are optional
    expect(EQUIPMENT.canDo('tuck-fl', ['none', 'rings'])).toBe(true);
    expect(EQUIPMENT.canDo('tuck-fl', ['none', 'bar'])).toBe(true);
    expect(EQUIPMENT.canDo('tuck-fl', ['none'])).toBe(false);
    expect(EQUIPMENT.canDo('my-abc', ['none'])).toBe(true);                     // own exercises are left alone
  });

  it('erstatninger træner det samme: stangøvelser bliver til kropsvægt med samme hovedmuskel', () => {
    const home = preset('home');
    for (const [from, mainMuscle] of [['back-squat', 'Quads'], ['bench', 'Bryst'], ['dip', 'Triceps']]) {
      const r = EQUIPMENT.replacement(from, home);
      expect(r, from).toBeTruthy();
      expect(EQUIPMENT.canDo(r, home)).toBe(true);
      expect(ex(r).m.slice(0, 2)).toContain(mainMuscle);
    }
    expect(EQUIPMENT.replacement('pullup', home)).toBeNull();                   // nothing sensible without a bar
    expect(EQUIPMENT.replacement('pullup', ['none', 'rings'])).toMatch(/ring/); // the row tree on rings
  });

  it('alle skabeloner × forudindstillinger: kun øvelser, der kan laves, og ingen tomme dage med park eller mere', () => {
    for (const t of TEMPLATES) for (const pr of EQUIPMENT.PRESETS) for (const L of [0, 1, 2]) {
      const p = buildProgram(t.id, 3, L, lv(t.id, L));
      EQUIPMENT.adaptProgram(p, pr.eq);
      for (const id of allEx(p)) expect(EQUIPMENT.canDo(id, pr.eq), `${t.id}/${pr.id}: ${id}`).toBe(true);
      if (pr.id !== 'home') for (const d of p.days) expect(d.items.length, `${t.id}/${pr.id}`).toBeGreaterThan(0);
    }
  });

  it('en stangøvelse med %1RM får nye sæt uden procent og uden løft, når den skiftes til kropsvægt', () => {
    const p = buildProgram('pl', 3, 0, lv('pl', 0));
    const res = EQUIPMENT.adaptProgram(p, preset('home'));
    expect(res.swapped.length).toBeGreaterThan(0);
    for (const it of p.days.flatMap(d => d.items)) {
      if (ex(it.ex).type === 'weight') continue;
      expect(it.lift).toBeUndefined();
      expect(it.wave).not.toMatch(/^pl/);
      expect(it.sets.every(s => !s.pct)).toBe(true);
    }
  });

  it('med alt udstyr ændres intet', () => {
    for (const t of TEMPLATES) {
      const p = buildProgram(t.id, 4, 1, lv(t.id, 1)), before = JSON.stringify(p);
      expect(EQUIPMENT.adaptProgram(p, EQUIPMENT.ALL)).toEqual({ swapped: [], removed: [] });
      expect(JSON.stringify(p)).toBe(before);
    }
  });

  it('programguiden skifter øvelser ud efter det valgte udstyr', () => {
    const r = GUIDE.build(Object.assign(GUIDE.defaults(null), { goal: 'strength', experience: '1', pullups: 8, dips: 10, pushups: 25, equipment: [], days: '3' }));
    for (const id of allEx(r.program)) expect(EQUIPMENT.canDo(id, ['none', 'wall', 'box', 'bench']), id).toBe(true);
    expect(r.adjustments.join(' ')).toMatch(/udstyr/);
  });
});
