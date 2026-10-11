// Interval timers (EMOM, AMRAP, Tabata, Ladder) in the background: the phase changes still to come, as alarms.
// While the app is hidden the JS timers can't beep, so app.js hands these to system notifications (PLATFORM).
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m; else Object.assign(root, m);
})(this, function () {
  'use strict';
  const MAX_ALARMS = 60;   // Android keeps at most a few hundred alarms per app; a workout never needs more

  // it = the running timer { kind, b, t0, pre, running, done, mode, restStart } (as IT in app.js).
  // Returns [{ at (ms), title, body }] after `now`, in time order.
  function intervalAlarms(it, now) {
    if (!it || it.done) return [];
    const b = it.b || {}, out = [];
    const add = (at, title, body) => { if (at > now) out.push({ at, title, body: body || '' }); };

    if (it.kind === 'ladder') {
      if (it.mode === 'rest' && it.restStart) add(it.restStart + (Number(b.rest) || 0) * 1000, 'Pausen er slut', 'Næste trin på stigen');
      return out;
    }
    if (!it.running) return out;
    const base = it.t0 + (it.pre || 0) * 1000;   // the moment the work starts
    const min = Number(b.min) || 0;
    if (it.kind === 'emom') {
      add(base, 'Start!', `Minut 1 / ${min}`);
      for (let m = 1; m < min; m++) add(base + m * 60000, `Minut ${m + 1} / ${min}`, b.reps ? `${b.reps} reps` : '');
      add(base + min * 60000, 'Færdig!', 'EMOM er slut');
    } else if (it.kind === 'amrap') {
      add(base, 'Start!', `AMRAP ${min} min`);
      add(base + min * 60000, 'Tiden er gået!', 'Husk at taste dine runder');
    } else if (it.kind === 'tabata') {
      const work = (Number(b.work) || 0) * 1000, rest = (Number(b.rest) || 0) * 1000, rounds = Number(b.rounds) || 0;
      for (let k = 0; k < rounds; k++) {
        add(base + k * (work + rest), `Arbejd · ${k + 1}/${rounds}`, '');
        if (rest) add(base + k * (work + rest) + work, `Hvil · ${k + 1}/${rounds}`, '');
      }
      add(base + rounds * (work + rest), 'Færdig!', 'Tabata er slut');
    }
    return out.sort((x, y) => x.at - y.at).slice(0, MAX_ALARMS);
  }

  return { intervalAlarms };
});
