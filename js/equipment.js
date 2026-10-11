// Equipment: which exercises can be done with what the user has, and adapting a program to it.
// Classic script (globals) like progression.js; uses EXERCISES/TREES (data.js) and SCHEMES/defaultAlts (templates.js).
'use strict';

const EQUIPMENT = (() => {
  // Ready-made lists. 'none' (floor/body weight) is always there.
  const PRESETS = [
    { id: 'home', n: 'Hjemme', d: 'Gulv, væg og en stol/trappe', eq: ['none', 'wall', 'box', 'bench'] },
    { id: 'park', n: 'Calisthenics-park', d: 'Stænger, barrer og bænke', eq: ['none', 'wall', 'box', 'bench', 'bar', 'pbars'] },
    { id: 'gym', n: 'Fitnesscenter', d: 'Vægtstang, bænk, pull-up-bar, dipbarre og elastikker', eq: ['none', 'wall', 'box', 'bench', 'bar', 'pbars', 'barbell', 'bands', 'vest'] },
    { id: 'box', n: 'CrossFit-box', d: 'Alt – også ringe', eq: ['none', 'wall', 'box', 'bench', 'bar', 'pbars', 'barbell', 'bands', 'vest', 'rings'] },
  ];
  const ALL = PRESETS[PRESETS.length - 1].eq;

  // What an exercise needs, as alternatives: the exercise can be done if every item of one alternative is there.
  // In the data, eq lists everything used; two shapes mean something else:
  //  - 'none' in the list: the rest is optional (planche on the floor or on parallettes)
  //  - bar + rings: either one (front lever)
  function needs(e) {
    const eq = (e && e.eq) || [];
    if (!eq.length || eq.includes('none')) return [[]];
    if (eq.length === 2 && eq.includes('bar') && eq.includes('rings')) return [['bar'], ['rings']];
    return [eq];
  }
  const has = (equip, e) => needs(e).some(alt => alt.every(q => equip.includes(q)));
  const exOf = id => EXERCISES.find(x => x.id === id);
  // Exercises the app doesn't know (own exercises 'my-…', or a removed id) are left alone
  const canDo = (id, equip) => { const e = exOf(id); return !e || has(equip, e); };

  // Categories a replacement may come from (CATS in data.js)
  const COMPATIBLE = { power: ['power', 'push', 'pull', 'legs'], push: ['push', 'power'], pull: ['pull', 'power'], legs: ['legs', 'power'] };

  const treeKeysOf = id => Object.keys(TREES).filter(k => TREES[k].steps.includes(id));

  // The best replacement for an exercise that can't be done: the nearest doable step in its progression tree
  // (easier first), otherwise the most similar exercise in the same category (shared muscles, same type).
  // `reps` = the replacement must be counted in reps (blocks and circuits).
  function replacement(id, equip, reps) {
    const e = exOf(id);
    if (!e) return null;
    const ok = x => x && x.id !== id && has(equip, x) && !x.deprecated && (!reps || x.type !== 'time');
    for (const k of treeKeysOf(id)) {
      const steps = TREES[k].steps, i = steps.indexOf(id);
      for (let d = 1; d < steps.length; d++) {
        for (const j of [i - d, i + d]) { const x = exOf(steps[j]); if (ok(x)) return x.id; }
      }
    }
    // It must train the same thing: a compatible category (a barbell lift may become push/pull/leg work and
    // back; skills and core stay in their own category), the same main muscle (first in m, or second in the
    // candidate) and at least two shared muscles. Nothing sensible → null, and the item is removed.
    const muscles = new Set(e.m || []), main = (e.m || [])[0], need = Math.min(2, muscles.size || 1);
    const cats = COMPATIBLE[e.c] || [e.c];
    let best = null, score = -1;
    for (const x of EXERCISES) {
      if (!ok(x) || !cats.includes(x.c)) continue;
      const m = x.m || [], shared = m.filter(q => muscles.has(q)).length;
      const mainRank = m[0] === main ? 2 : m[1] === main ? 1 : 0;
      if (shared < need || !mainRank) continue;
      const s = mainRank * 10 + shared * 3 + (x.c === e.c ? 2 : 0) + (x.type === e.type ? 1 : 0);
      if (s > score) { best = x; score = s; }
    }
    return best ? best.id : null;
  }

  // New sets when the replacement is measured differently (a barbell squat with %1RM → air squats in reps)
  function setsFor(item, newEx, level) {
    const o = exOf(item.ex), n = exOf(newEx), L = Math.max(0, Math.min(2, level || 0));
    if (!n || item.block) return item.sets;
    const wasPct = (item.sets || []).some(s => s.pct);
    if (o && o.type === n.type && !wasPct) return item.sets;
    const sets = SCHEMES[n.type === 'time' ? 'hold' : 'vol'][L]();
    if (n.type === 'weight') sets.forEach(s => s.rpe = 8);
    return sets;
  }

  // Changes the program in place so every exercise can be done with `equip`. Returns what happened, in Danish:
  // { swapped: [{ from, to }], removed: [id] }
  function adaptProgram(p, equip) {
    const out = { swapped: [], removed: [] };
    if (!p || !Array.isArray(equip)) return out;
    for (const d of p.days || []) {
      d.items = (d.items || []).filter(it => {
        const reps = !!it.block;
        if (it.circuit) {
          it.circuit = it.circuit.filter(c => {
            if (canDo(c.ex, equip)) return true;
            const r = replacement(c.ex, equip, true);
            if (r) { out.swapped.push({ from: c.ex, to: r }); c.ex = r; return true; }
            out.removed.push(c.ex); return false;
          });
          if (!it.circuit.length) return false;
          if (!canDo(it.ex, equip)) it.ex = it.circuit[0].ex;
        } else if (!canDo(it.ex, equip)) {
          const r = replacement(it.ex, equip, reps);
          if (!r) { out.removed.push(it.ex); return false; }
          out.swapped.push({ from: it.ex, to: r });
          it.sets = setsFor(it, r, p.level);
          const n = exOf(r);
          if (!n || n.type !== 'weight' || !n.lift) { delete it.lift; if (/^pl/.test(it.wave || '')) it.wave = 'cal'; }
          it.ex = r;
          it.alts = defaultAlts(r);
        }
        it.alts = (it.alts || []).filter(x => x !== it.ex && canDo(x, equip));
        return true;
      });
    }
    return out;
  }

  // Short Danish summary for the UI, e.g. "Back squat → Air squat"
  function describe(res) {
    const name = id => { const e = exOf(id); return e ? e.n : id; };
    const lines = res.swapped.map(s => `${name(s.from)} → ${name(s.to)}`);
    const removed = [...new Set(res.removed)].map(name);
    return { lines, removed };
  }

  // The preset that matches a list exactly, if any
  const presetOf = equip => PRESETS.find(p => p.eq.length === equip.length && p.eq.every(q => equip.includes(q))) || null;

  return { PRESETS, ALL, needs, canDo, replacement, adaptProgram, describe, presetOf };
})();
