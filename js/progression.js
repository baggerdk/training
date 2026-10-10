// Progression and records: pure calculations on the state S (passed in, never read globally).
// Uses EXERCISES/TREES (js/data.js) and exById/treeOf (js/templates.js). Tested in test/progression.test.js.
'use strict';

const PROG = (() => {
  const fmt = n => (Math.round(n * 10) / 10).toString().replace('.', ',');
  const exName = (S, id) => { const e = findEx(S, id); return e ? e.n : id; };
  const findEx = (S, id) => EXERCISES.find(e => e.id === id) || (S.customEx || []).find(e => e.id === id);

  // Epley estimate of 1RM
  const e1 = (kg, r) => (kg > 0 && r > 0 ? (r === 1 ? kg : kg * (1 + r / 30)) : 0);
  const tmFor = (S, lift) => (S.rm[lift] || 0) * S.settings.tmPct / 100;
  const roundInc = (S, x) => { const inc = S.settings.inc || 2.5; return Math.round(x / inc) * inc; };
  const kgFor = (S, lift, pct) => { const tm = tmFor(S, lift); return tm ? roundInc(S, tm * pct / 100) : null; };

  // The latest logged performance of an exercise
  function lastPerf(S, exId) {
    for (let i = S.logs.length - 1; i >= 0; i--) {
      for (const it of S.logs[i].items) if (it.ex === exId && it.sets && it.sets.length) return it;
    }
    return null;
  }

  // Double progression: more reps up to the top of the range, then more weight – or the next step in the tree
  function suggest(S, exId, tgts, lift, noAuto) {
    const ex = findEx(S, exId) || {};
    const vals = tgts.map(s => ({
      r: (s.amrap && s.r <= 1) ? '' : (s.r || ''), t: s.t || '',
      kg: s.pct ? (lift ? (kgFor(S, lift, s.pct) || '') : '') : (s.kg || '')
    }));
    if (!S.settings.auto || noAuto) return { vals, hint: null };
    const last = lastPerf(S, exId);
    if (!last) return { vals, hint: null };
    const done = last.sets, inc = S.settings.inc || 2.5;
    const rpeOk = done.every(s => !s.rpe || s.rpe <= 8.5);
    let hint = null;
    const tr = treeOf(exId);
    const next = tr && TREES[tr.key].steps[tr.i + 1];
    if (ex.type === 'time') {
      const minT = Math.min(...done.map(s => s.t || 0));
      const hit = done.every(s => (s.t || 0) >= ((s.tgt && s.tgt.t) || 0));
      const tMax = tgts[0] && tgts[0].tMax;
      let nt = minT + (hit && rpeOk ? 2 : 0);
      if (tMax && nt > tMax) nt = tMax;
      vals.forEach(v => v.t = nt || v.t);
      if (tMax && minT >= tMax && rpeOk && next) hint = { up: next, text: `Du holdt ${minT}s på alle sæt – klar til næste trin: ${exName(S, next)}` };
      else if (hit) hint = { text: `Sidst: ${minT}s. Forslag: ${nt}s` };
      return { vals, hint };
    }
    const repSets = tgts.filter(s => !s.pct && !s.amrap);
    if (!repSets.length) return { vals, hint: null };
    const minR = Math.min(...done.filter(s => !s.tgt || !s.tgt.amrap).map(s => s.r || 0));
    const maxKg = Math.max(0, ...done.map(s => s.kg || 0));
    const hit = done.every(s => !s.tgt || s.tgt.amrap || (s.r || 0) >= (s.tgt.r || 0));
    const t0 = repSets[0];
    let nr = minR, nkg = maxKg;
    if (hit && rpeOk && isFinite(minR)) {
      if (t0.rMax && minR < t0.rMax) { nr = minR + 1; hint = { text: `Sidst ${minR} reps${maxKg ? ' · ' + fmt(maxKg) + ' kg' : ''} → prøv ${nr} reps` }; }
      else if (ex.w || ex.type === 'weight') {
        nkg = maxKg + inc; nr = t0.r;
        hint = { text: `Toppen af rep-intervallet nået → +${fmt(inc)} kg (${fmt(nkg)} kg × ${nr})` };
        if (next && !maxKg && ex.type !== 'weight') hint = { up: next, text: `Toppen af rep-intervallet nået. Læg vægt på – eller skift til ${exName(S, next)}`, kg: nkg };
      } else if (next) { hint = { up: next, text: `Toppen af rep-intervallet nået – klar til næste trin: ${exName(S, next)}` }; }
    } else if (isFinite(minR)) {
      hint = { text: `Sidst ${minR} reps${maxKg ? ' · ' + fmt(maxKg) + ' kg' : ''} – gentag og slå det` };
    }
    if (!isFinite(nr) || !nr) nr = t0.r;
    vals.forEach((v, i) => {
      const s = tgts[i]; if (s.pct || s.amrap) return;
      v.r = Math.max(s.r || 0, Math.min(nr, s.rMax || nr)) || nr;
      if (nkg) v.kg = nkg;
    });
    return { vals, hint };
  }

  // Personal bests per exercise from the logs
  function bests(logs) {
    const B = {};
    for (const L of logs) for (const it of L.items) for (const s of it.sets || []) {
      const b = B[it.ex] || (B[it.ex] = { reps: 0, kg: 0, e1: 0, t: 0 });
      if (!s.kg && s.r > b.reps) b.reps = s.r;
      if (s.kg > b.kg) b.kg = s.kg;
      const x = e1(s.kg, s.r); if (x > b.e1) b.e1 = x;
      if (s.t > b.t) b.t = s.t;
    }
    return B;
  }

  return { e1, tmFor, roundInc, kgFor, lastPerf, suggest, bests };
})();
