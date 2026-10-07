// Programskabeloner. Hver skabelon har dagtyper og et skema for 2–6 dage/uge.
// Slots: { t: træ, s: skema } eller { e: øvelse, s: skema } – niveau vælges ved oprettelse.

const TEMPLATES = [
  {
    id: 'mil', track: 'Military', name: 'Military Calisthenics – Styrke',
    desc: 'Inspireret af militær calisthenics med fokus på styrke: høj frekvens på pull-ups, dips og push-ups, ladders, EMOM og maks-sæt. Tip: “greasing the groove” – læg 3–5 lette sæt pull-ups (ca. 50 % af max) ind i løbet af hverdagen.',
    days: {
      A: { n: 'Styrke – Træk & Pres', slots: [{ t: 'pull', s: 'str' }, { t: 'dip', s: 'str' }, { t: 'push', s: 'vol' }, { t: 'core', s: 'core' }] },
      B: { n: 'Ladder-dag', slots: [{ t: 'pull', s: 'ladder' }, { t: 'dip', s: 'ladder' }, { t: 'legs', s: 'str' }, { t: 'lsit', s: 'hold' }] },
      C: { n: 'EMOM & Maks-sæt', slots: [{ t: 'pull', s: 'emom' }, { t: 'push', s: 'max' }, { t: 'row', s: 'str' }, { t: 'legs', s: 'vol' }] },
      D: { n: 'Muscle-up & Overhead', slots: [{ t: 'muscleup', s: 'skillr' }, { t: 'hspu', s: 'str' }, { t: 'pull', s: 'vol', off: -1 }, { t: 'core', s: 'core' }] },
      E: { n: 'AMRAP Military', slots: [{ s: 'amrap', circuit: [{ t: 'pull', r: [3, 5, 7] }, { t: 'push', r: [6, 10, 15] }, { e: 'squat', r: [10, 15, 20] }] }, { t: 'dip', s: 'vol' }, { e: 'hanging-leg-raise', s: 'core' }] },
      F: { n: 'Pyramide & Core', slots: [{ t: 'push', s: 'pyramid' }, { t: 'row', s: 'vol' }, { t: 'fl', s: 'hold' }, { e: 'hollow-hold', s: 'hold' }] },
    },
    sched: { 2: ['A', 'B'], 3: ['A', 'B', 'C'], 4: ['A', 'B', 'C', 'D'], 5: ['A', 'B', 'C', 'D', 'E'], 6: ['A', 'B', 'C', 'D', 'E', 'F'] },
  },
  {
    id: 'cal', track: 'Calisthenics', name: 'Calisthenics Styrke',
    desc: 'Klassisk progressiv calisthenics-styrke med dobbelt progression (reps → vægt/sværere variant). Bygger pull-ups, dips, push-ups, håndstand og ben – med skill-arbejde mod muscle-up, planche og front lever.',
    days: {
      FA: { n: 'Helkrop A', slots: [{ t: 'pull', s: 'str' }, { t: 'dip', s: 'str' }, { t: 'legs', s: 'str' }, { t: 'core', s: 'core' }] },
      FB: { n: 'Helkrop B', slots: [{ t: 'row', s: 'str' }, { t: 'push', s: 'str' }, { t: 'hspu', s: 'vol' }, { t: 'legs', s: 'vol' }, { t: 'lsit', s: 'hold' }] },
      FC: { n: 'Helkrop C – Skills', slots: [{ t: 'muscleup', s: 'skillr' }, { t: 'planche', s: 'hold' }, { t: 'fl', s: 'hold' }, { t: 'pull', s: 'vol', off: -1 }, { t: 'push', s: 'vol' }] },
      PULL: { n: 'Træk', slots: [{ t: 'pull', s: 'str' }, { t: 'row', s: 'str' }, { t: 'fl', s: 'hold' }, { t: 'pull', s: 'vol', off: -1 }, { t: 'core', s: 'core' }] },
      PUSH: { n: 'Pres', slots: [{ t: 'dip', s: 'str' }, { t: 'hspu', s: 'str' }, { t: 'push', s: 'vol' }, { t: 'planche', s: 'hold' }, { t: 'lsit', s: 'hold' }] },
      LEGS: { n: 'Ben & Core', slots: [{ t: 'legs', s: 'str' }, { e: 'bulgarian', s: 'vol' }, { e: 'nordic-curl', s: 'vol' }, { t: 'core', s: 'core' }, { e: 'hollow-hold', s: 'hold' }] },
      SKILL: { n: 'Skills – Muscle-up & Håndstand', slots: [{ t: 'muscleup', s: 'skillr' }, { t: 'handstand', s: 'hold' }, { t: 'pull', s: 'vol' }, { t: 'dip', s: 'vol' }] },
    },
    sched: { 2: ['FA', 'FB'], 3: ['FA', 'FB', 'FC'], 4: ['PULL', 'PUSH', 'LEGS', 'SKILL'], 5: ['PULL', 'PUSH', 'LEGS', 'SKILL', 'FA'], 6: ['PULL', 'PUSH', 'LEGS', 'SKILL', 'FA', 'FB'] },
  },
  {
    id: 'skill', track: 'Calisthenics', name: 'Skills: Muscle-up, Planche & Front lever',
    desc: 'Fokus på statiske holds og muscle-up. Kort, tungt skill-arbejde først i passet, efterfulgt af styrke-assistance. Kræver basisstyrke (ca. 5+ pull-ups og 10+ dips).',
    days: {
      MU: { n: 'Muscle-up', slots: [{ t: 'muscleup', s: 'skillr' }, { t: 'pull', s: 'str' }, { e: 'straight-bar-dip', s: 'vol' }, { t: 'core', s: 'core' }] },
      PL: { n: 'Planche & Pres', slots: [{ t: 'planche', s: 'hold' }, { e: 'pseudo-planche-pushup', s: 'str' }, { t: 'dip', s: 'str' }, { t: 'lsit', s: 'hold' }] },
      FL: { n: 'Front lever & Træk', slots: [{ t: 'fl', s: 'hold' }, { e: 'fl-raise', s: 'skillr' }, { t: 'row', s: 'str' }, { e: 'hanging-leg-raise', s: 'core' }] },
      HS: { n: 'Håndstand & Overhead', slots: [{ t: 'handstand', s: 'hold' }, { t: 'hspu', s: 'str' }, { t: 'push', s: 'vol' }, { e: 'hollow-hold', s: 'hold' }] },
      LG: { n: 'Ben & Core', slots: [{ t: 'legs', s: 'str' }, { e: 'nordic-curl', s: 'vol' }, { t: 'core', s: 'core' }] },
      MIX: { n: 'Skill-mix', slots: [{ t: 'muscleup', s: 'skillr' }, { t: 'planche', s: 'hold' }, { t: 'fl', s: 'hold' }] },
    },
    sched: { 2: ['MU', 'PL'], 3: ['MU', 'PL', 'FL'], 4: ['MU', 'PL', 'FL', 'HS'], 5: ['MU', 'PL', 'FL', 'HS', 'LG'], 6: ['MU', 'PL', 'FL', 'HS', 'LG', 'MIX'] },
  },
  {
    id: 'pl', track: 'Powerløft', name: 'Powerløft',
    desc: 'Squat, bænk og dødløft med %-baseret progression ud fra din træningsmax (TM = 90 % af 1RM). Begynder: lineær progression. Øvet: 5/3/1-bølge med “first set last”. Avanceret: 6-ugers blokperiodisering mod peak.',
    pl: true,
    days: {
      F1: { n: 'Helkrop 1 – Squat & Bænk', slots: [{ e: 'back-squat', s: 'pl_main' }, { e: 'bench', s: 'pl_main' }, { e: 'barbell-row', s: 'pl_assist' }, { e: 'plank', s: 'hold' }] },
      F2: { n: 'Helkrop 2 – Dødløft & OHP', slots: [{ e: 'deadlift', s: 'pl_main' }, { e: 'ohp', s: 'pl_main' }, { e: 'front-squat', s: 'pl_assist' }, { t: 'pull', s: 'vol' }] },
      SQ: { n: 'Squat', slots: [{ e: 'back-squat', s: 'pl_main' }, { e: 'bench', s: 'pl_light' }, { e: 'barbell-row', s: 'pl_assist' }, { e: 'plank', s: 'hold' }] },
      BE: { n: 'Bænkpres', slots: [{ e: 'bench', s: 'pl_main' }, { e: 'close-grip-bench', s: 'pl_assist' }, { t: 'pull', s: 'str' }, { e: 'hanging-leg-raise', s: 'core' }] },
      DL: { n: 'Dødløft', slots: [{ e: 'deadlift', s: 'pl_main' }, { e: 'pause-squat', s: 'pl_assist' }, { e: 'good-morning', s: 'pl_assist' }, { e: 'ab-wheel', s: 'core' }] },
      OH: { n: 'Militærpres & Overkrop', slots: [{ e: 'ohp', s: 'pl_main' }, { e: 'incline-bench', s: 'pl_assist' }, { t: 'dip', s: 'vol' }, { t: 'row', s: 'vol' }] },
      SQ2: { n: 'Squat (volumen) & Bænk', slots: [{ e: 'back-squat', s: 'pl_light' }, { e: 'bench', s: 'pl_light' }, { e: 'rdl', s: 'pl_assist' }, { e: 'band-pull-apart', s: 'vol' }] },
      ACC: { n: 'Assistance & Prehab', slots: [{ e: 'hip-thrust', s: 'pl_assist' }, { e: 'barbell-row', s: 'pl_assist' }, { e: 'farmers-walk', s: 'hold' }, { e: 'band-pull-apart', s: 'vol' }, { e: 'side-plank', s: 'hold' }] },
    },
    sched: { 2: ['F1', 'F2'], 3: ['SQ', 'BE', 'DL'], 4: ['SQ', 'BE', 'DL', 'OH'], 5: ['SQ', 'BE', 'DL', 'OH', 'SQ2'], 6: ['SQ', 'BE', 'DL', 'OH', 'SQ2', 'ACC'] },
  },
  {
    id: 'hyb', track: 'Hybrid', name: 'Hybrid: Powerløft + Calisthenics',
    desc: 'De tre store løft kombineret med tung calisthenics (pull-ups med vægt, dips, muscle-up) og military ladders. God hvis du vil være både stærk med stang og med kropsvægt.',
    pl: true,
    days: {
      A: { n: 'Squat + Træk', slots: [{ e: 'back-squat', s: 'pl_main' }, { t: 'pull', s: 'str' }, { t: 'dip', s: 'str' }, { t: 'core', s: 'core' }] },
      B: { n: 'Bænk + Rows', slots: [{ e: 'bench', s: 'pl_main' }, { t: 'row', s: 'str' }, { t: 'push', s: 'vol' }, { t: 'lsit', s: 'hold' }] },
      C: { n: 'Dødløft + Muscle-up', slots: [{ e: 'deadlift', s: 'pl_main' }, { t: 'muscleup', s: 'skillr' }, { t: 'hspu', s: 'vol' }, { e: 'hanging-leg-raise', s: 'core' }] },
      D: { n: 'Military Ladders', slots: [{ t: 'pull', s: 'ladder' }, { t: 'dip', s: 'ladder' }, { t: 'legs', s: 'vol' }, { t: 'fl', s: 'hold' }] },
      E: { n: 'OHP + Skills', slots: [{ e: 'ohp', s: 'pl_main' }, { t: 'planche', s: 'hold' }, { t: 'pull', s: 'vol' }, { e: 'hollow-hold', s: 'hold' }] },
      F: { n: 'AMRAP + Squat let', slots: [{ e: 'back-squat', s: 'pl_light' }, { s: 'amrap', circuit: [{ t: 'pull', r: [3, 5, 7] }, { t: 'push', r: [6, 10, 15] }, { e: 'jump-squat', r: [8, 10, 12] }] }] },
    },
    sched: { 2: ['A', 'C'], 3: ['A', 'B', 'C'], 4: ['A', 'B', 'C', 'D'], 5: ['A', 'B', 'C', 'D', 'E'], 6: ['A', 'B', 'C', 'D', 'E', 'F'] },
  },
];

// ---------- Skemaer ----------
// Set: { r, rMax, t, tMax, kg, pct, rpe, amrap, rest }
function rep(n, r, rMax, rest, extra) { return Array.from({ length: n }, () => Object.assign({ r, rMax, rest }, extra || {})); }
function hold(n, t, tMax, rest) { return Array.from({ length: n }, () => ({ t, tMax, rest })); }

const SCHEMES = {
  str:    [() => rep(3, 5, 8, 120), () => rep(4, 4, 6, 150), () => rep(5, 3, 5, 180)],
  vol:    [() => rep(3, 8, 12, 90), () => rep(3, 8, 12, 90), () => rep(4, 8, 12, 75)],
  core:   [() => rep(3, 8, 12, 60), () => rep(3, 10, 15, 60), () => rep(4, 10, 15, 60)],
  skillr: [() => rep(5, 2, 3, 120), () => rep(6, 2, 4, 150), () => rep(6, 3, 5, 180)],
  hold:   [() => hold(3, 15, 30, 90), () => hold(4, 10, 20, 120), () => hold(5, 8, 15, 150)],
  max:    [() => [{ r: 1, amrap: true, rest: 180 }], () => [{ r: 1, amrap: true, rest: 180 }, { r: 1, amrap: true, rest: 180 }], () => [{ r: 1, amrap: true, rest: 180 }, { r: 1, amrap: true, rest: 180 }]],
  pl_assist: [() => rep(3, 8, 10, 120, { rpe: 7 }), () => rep(3, 6, 10, 120, { rpe: 8 }), () => rep(4, 5, 8, 150, { rpe: 8 })],
};

const BLOCKS = {
  ladder:  [{ kind: 'ladder', top: 3, rounds: 3, rest: 45 }, { kind: 'ladder', top: 5, rounds: 3, rest: 45 }, { kind: 'ladder', top: 5, rounds: 5, rest: 45 }],
  pyramid: [{ kind: 'ladder', top: 5, rounds: 1, down: true, rest: 30 }, { kind: 'ladder', top: 8, rounds: 1, down: true, rest: 30 }, { kind: 'ladder', top: 10, rounds: 1, down: true, rest: 30 }],
  emom:    [{ kind: 'emom', min: 10, reps: 2 }, { kind: 'emom', min: 10, reps: 3 }, { kind: 'emom', min: 12, reps: 4 }],
  amrap:   [{ kind: 'amrap', min: 10 }, { kind: 'amrap', min: 15 }, { kind: 'amrap', min: 20 }],
};

const WAVES = {
  none: 'Ingen (samme hver uge)',
  cal: 'Deload sidste uge',
  plLin: 'Lineær (+2,5 % pr. uge)',
  pl531: '5/3/1-bølge (4 uger)',
  plBlock: 'Blokperiodisering (6 uger)',
};

// Ugetabeller for %-baserede løft (procent af træningsmax)
const WAVE_TABLES = {
  pl531: [
    [[65, 5], [75, 5], [85, 5, 1], [65, 5], [65, 5], [65, 5]],
    [[70, 3], [80, 3], [90, 3, 1], [70, 5], [70, 5], [70, 5]],
    [[75, 5], [85, 3], [95, 1, 1], [75, 5], [75, 5], [75, 5]],
    [[40, 5], [50, 5], [60, 5]],
  ],
  plBlock: [
    [[72, 6], [72, 6], [72, 6], [72, 6]],
    [[77, 5], [77, 5], [77, 5], [77, 5]],
    [[85, 3], [85, 3], [85, 3], [85, 3], [85, 3]],
    [[90, 3], [90, 3], [90, 3], [90, 3]],
    [[95, 1], [100, 1], [105, 1, 1]],
    [[60, 3], [65, 3], [65, 3]],
  ],
};

function uid() { return Math.random().toString(36).slice(2, 10); }

function exById(id) { return EXERCISES.find(e => e.id === id) || (typeof S !== 'undefined' && S.customEx.find(e => e.id === id)); }

function treeOf(exId) {
  for (const k in TREES) { const i = TREES[k].steps.indexOf(exId); if (i >= 0) return { key: k, i }; }
  return null;
}

// Alternativer: naboerne i træet (lettere/sværere)
function defaultAlts(exId) {
  const tr = treeOf(exId); if (!tr) return [];
  const st = TREES[tr.key].steps, out = [];
  if (tr.i > 0) out.push(st[tr.i - 1]);
  if (tr.i < st.length - 1) out.push(st[tr.i + 1]);
  return out;
}

function resolveSlotEx(slot, treeLvls) {
  if (slot.e) return slot.e;
  const tr = TREES[slot.t];
  const i = Math.max(0, Math.min(tr.steps.length - 1, treeLvls[slot.t] + (slot.off || 0)));
  return tr.steps[i];
}

function buildItem(slot, L, treeLvls, liftLevel) {
  const s = slot.s;
  if (s === 'amrap') {
    return {
      id: uid(), ex: resolveSlotEx(slot.circuit[0], treeLvls), alts: [], sets: [],
      block: Object.assign({}, BLOCKS.amrap[L]),
      circuit: slot.circuit.map(c => ({ ex: resolveSlotEx(c, treeLvls), r: c.r[L] })),
      wave: 'none', note: 'Så mange runder som muligt. Registrér antal runder.'
    };
  }
  const ex = resolveSlotEx(slot, treeLvls), exo = exById(ex);
  const item = { id: uid(), ex, alts: defaultAlts(ex), sets: [], wave: 'cal', note: '' };
  if (BLOCKS[s]) { item.block = Object.assign({}, BLOCKS[s][L]); item.wave = 'none'; return item; }
  if (s === 'pl_main') {
    item.lift = exo.lift;
    item.wave = ['plLin', 'pl531', 'plBlock'][liftLevel];
    item.sets = [{ pct: 70, r: 5, rest: 180 }, { pct: 70, r: 5, rest: 180 }, { pct: 70, r: 5, rest: 180, amrap: liftLevel === 0 }];
    return item;
  }
  if (s === 'pl_light') {
    item.lift = exo.lift; item.wave = 'none';
    item.sets = rep(3, 5, null, 150, { pct: 70 });
    return item;
  }
  let key = s;
  if (exo.type === 'time' && key !== 'hold') key = 'hold';
  item.sets = SCHEMES[key][L]();
  if (exo.type === 'weight' && key !== 'pl_assist') item.sets.forEach(x => x.rpe = 8);
  if (['plank', 'side-plank', 'hollow-hold'].includes(ex)) item.sets.forEach(x => { x.t = 30; x.tMax = 60; x.rest = 60; });
  return item;
}

function buildProgram(tplId, nDays, L, treeLvls) {
  const tpl = TEMPLATES.find(t => t.id === tplId);
  const order = tpl.sched[nDays];
  const days = order.map(k => ({ id: uid(), name: tpl.days[k].n, items: tpl.days[k].slots.map(sl => buildItem(sl, L, treeLvls, L)) }));
  const weeks = tpl.pl ? [4, 4, 6][L] : 4;
  return {
    id: uid(), name: tpl.name + ' · ' + LEVELS[L], tpl: tplId, level: L, treeLvls: Object.assign({}, treeLvls),
    desc: tpl.desc, weeks, days, auto: true, pos: { week: 0, day: 0 }, created: Date.now()
  };
}

function templateTrees(tplId) {
  const tpl = TEMPLATES.find(t => t.id === tplId), set = new Set();
  for (const k in tpl.days) for (const sl of tpl.days[k].slots) {
    if (sl.t) set.add(sl.t);
    if (sl.circuit) sl.circuit.forEach(c => c.t && set.add(c.t));
  }
  return [...set];
}

// Konkrete mål for et item i en given uge (0-indekseret)
function targetsFor(item, week, prog) {
  const sets = item.sets.map(s => Object.assign({}, s));
  const w = item.wave || 'none';
  if ((w === 'pl531' || w === 'plBlock') && item.lift) {
    const tbl = WAVE_TABLES[w], row = tbl[week % tbl.length];
    const rest = (item.sets[0] && item.sets[0].rest) || 180;
    return row.map(([pct, r, am]) => ({ pct, r, amrap: !!am, rest }));
  }
  if (w === 'plLin') sets.forEach(s => { if (s.pct) s.pct = s.pct + 2.5 * (week % 4); });
  if (w === 'cal' && prog && week === prog.weeks - 1 && prog.level > 0 && sets.length > 2) {
    return sets.slice(0, Math.max(2, Math.ceil(sets.length * 0.6))).map(s => Object.assign(s, { deload: true }));
  }
  return sets;
}
