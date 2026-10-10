// Program guide: 9 questions about the athlete → a program built from the app's own templates.
// Rule-based on purpose (no AI service): the same answers always give the same program, every choice comes
// with a reason in Danish, and nothing leaves the server. Uses TREES/EXERCISES (data.js) and buildProgram
// (templates.js). Tested in test/guide.test.js.
'use strict';

const GUIDE = (() => {
  const QUESTIONS = [
    { id: 'goal', text: 'Hvad er det vigtigste mål?', type: 'choice', options: [
      ['start', 'Komme i gang / i bedre form'], ['strength', 'Blive stærkere med kropsvægt'], ['skills', 'Lære skills (muscle-up, planche, front lever)'],
      ['military', 'Military/udholdenhed – mange reps'], ['powerlifting', 'Powerløft (squat, bænk, dødløft)'], ['hybrid', 'Både stang og kropsvægt']] },
    { id: 'experience', text: 'Hvor længe har brugeren trænet styrke regelmæssigt?', type: 'choice', options: [
      ['0', 'Aldrig eller under 6 måneder'], ['1', '6 måneder til 2 år'], ['2', 'Mere end 2 år']] },
    { id: 'pullups', text: 'Hvor mange strikte pull-ups i træk?', type: 'number', min: 0, max: 60 },
    { id: 'dips', text: 'Hvor mange dips i træk (på barre)?', type: 'number', min: 0, max: 80 },
    { id: 'pushups', text: 'Hvor mange push-ups i træk?', type: 'number', min: 0, max: 150 },
    { id: 'legs', text: 'Kan brugeren lave en pistol squat (ét ben)?', type: 'choice', options: [
      ['no', 'Nej'], ['assisted', 'Med støtte'], ['yes', 'Ja']] },
    { id: 'equipment', text: 'Hvilket udstyr er der adgang til?', type: 'multi', options: [
      ['bar', 'Pull-up-bar'], ['pbars', 'Dipbarre / paralletter'], ['rings', 'Ringe'], ['bands', 'Elastikker'], ['barbell', 'Vægtstang og rack']] },
    { id: 'days', text: 'Hvor mange dage om ugen?', type: 'choice', options: [['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6']] },
    { id: 'session', text: 'Hvor lang tid pr. træning?', type: 'choice', options: [['30', '30 min'], ['45', '45 min'], ['60', '60 min'], ['90', '90 min eller mere']] },
    { id: 'limits', text: 'Skader eller begrænsninger, der skal tages hensyn til?', type: 'multi', options: [
      ['shoulders', 'Skuldre'], ['wrists', 'Albuer eller håndled'], ['knees', 'Knæ'], ['back', 'Lænd']] },
  ];

  // Exercises left out when the athlete has a limitation (the trainer can add them again in the builder)
  const AVOID = {
    shoulders: ['hspu', 'wall-hspu-negative', 'elevated-pike-pushup', 'wall-handstand', 'freestanding-handstand', 'weighted-dip', 'ring-dip', 'straight-bar-dip', 'muscle-up', 'ring-muscleup', 'band-muscleup', 'negative-muscleup', 'ohp', 'push-press'],
    wrists: ['planche-lean', 'frog-stand', 'tuck-planche', 'adv-tuck-planche', 'straddle-planche', 'full-planche', 'pseudo-planche-pushup', 'wall-handstand', 'freestanding-handstand', 'plyo-pushup'],
    knees: ['jump-squat', 'box-jump', 'pistol', 'assisted-pistol', 'bulgarian', 'lunge', 'burpee', 'jump-rope'],
    back: ['deadlift', 'sumo-deadlift', 'deficit-deadlift', 'rack-pull', 'good-morning', 'rdl', 'barbell-row', 'superman', 'dragon-flag'],
  };
  const LIMIT_TEXT = { shoulders: 'skuldrene', wrists: 'albuer og håndled', knees: 'knæene', back: 'lænden' };

  const n = v => Math.max(0, Math.floor(Number(v) || 0));
  const has = (list, x) => Array.isArray(list) && list.includes(x);
  const clampTree = (k, i) => Math.max(0, Math.min(TREES[k].steps.length - 1, i));
  const stepName = (k, i) => { const id = TREES[k].steps[i], e = EXERCISES.find(x => x.id === id); return e ? e.n : id; };

  // Where in each progression tree the athlete starts, from what they can do today
  function treeLevels(a) {
    const pu = n(a.pullups), dp = n(a.dips), ps = n(a.pushups), eq = a.equipment || [], exp = +a.experience || 0;
    const t = {};
    t.pull = pu === 0 ? (has(eq, 'bands') ? 2 : 3) : pu < 5 ? 3 : pu < 10 ? 4 : pu < 15 ? 5 : 6;
    t.row = pu < 3 ? (has(eq, 'rings') ? 0 : 1) : pu < 5 ? 1 : pu < 10 ? 2 : 3;
    t.dip = dp === 0 ? (has(eq, 'pbars') ? 1 : 0) : dp < 5 ? 2 : dp < 15 ? 3 : dp < 25 ? (has(eq, 'rings') ? 4 : 5) : 5;
    t.push = ps < 5 ? 0 : ps < 15 ? 1 : ps < 30 ? 2 : ps < 45 ? 3 : 4;
    t.muscleup = pu < 8 ? 0 : pu < 12 ? 1 : pu < 15 ? (has(eq, 'bands') ? 2 : 1) : 3;
    t.hspu = ps < 15 ? 0 : ps < 30 ? 1 : dp >= 15 ? 2 : 1;
    t.handstand = exp >= 1 ? 1 : 0;
    t.planche = ps >= 30 && exp >= 1 ? 2 : 0;
    t.fl = pu >= 12 ? 1 : 0;
    t.core = pu >= 10 ? 4 : pu >= 5 ? 3 : exp >= 1 ? 2 : 1;
    t.lsit = dp >= 10 ? 1 : 0;
    t.legs = a.legs === 'yes' ? 4 : a.legs === 'assisted' ? 3 : exp >= 1 ? 2 : 1;
    for (const k of Object.keys(t)) t[k] = clampTree(k, t[k]);
    return t;
  }

  // The plan: template, level, days and tree steps – with the reasons for each choice
  function plan(a) {
    const reasons = [], warnings = [];
    const pu = n(a.pullups), dp = n(a.dips), ps = n(a.pushups), eq = a.equipment || [];
    let level = Math.max(0, Math.min(2, +a.experience || 0));
    if (level > 0 && pu < 3 && ps < 15) { level = 0; reasons.push('Niveau sat til begynder: under 3 pull-ups og 15 push-ups, trods erfaringen'); }
    else if (level === 2 && pu < 8) { level = 1; reasons.push('Niveau sat til øvet: avanceret kræver omkring 8+ pull-ups'); }
    else reasons.push(`Niveau ${['begynder', 'øvet', 'avanceret'][level]} ud fra træningserfaringen`);

    let tpl;
    switch (a.goal) {
      case 'skills':
        if (pu >= 5 && dp >= 10) { tpl = 'skill'; reasons.push('Skills: basisstyrken er der (5+ pull-ups og 10+ dips)'); }
        else { tpl = level === 0 ? 'beg' : 'cal'; warnings.push(`Skills kræver ca. 5+ pull-ups og 10+ dips – brugeren har ${pu} og ${dp}. Basis bygges først med ${tpl === 'beg' ? 'Begynder' : 'Calisthenics Styrke'}`); }
        break;
      case 'powerlifting':
        if (has(eq, 'barbell')) { tpl = 'pl'; reasons.push('Powerløft med vægtstang'); }
        else { tpl = level === 0 ? 'beg' : 'cal'; warnings.push('Powerløft kræver vægtstang og rack – valgt kropsvægtsprogram i stedet'); }
        break;
      case 'hybrid':
        if (has(eq, 'barbell')) { tpl = 'hyb'; reasons.push('Hybrid: stang og kropsvægt'); }
        else { tpl = 'mil'; warnings.push('Hybrid kræver vægtstang – valgt Military Calisthenics i stedet'); }
        break;
      case 'military': tpl = 'mil'; reasons.push('Military: høj frekvens, ladders og maks-sæt'); break;
      case 'strength': tpl = level === 0 ? 'beg' : 'cal'; reasons.push(level === 0 ? 'Styrke for en begynder: Begynder – Helkrop først' : 'Klassisk calisthenics-styrke med dobbelt progression'); break;
      default: tpl = 'beg'; reasons.push('Komme i gang: Begynder – Helkrop');
    }
    if (tpl === 'beg' && level > 0) { level = 0; reasons.push('Begynder-skabelonen køres på begynderniveau'); }

    const days = Math.max(2, Math.min(6, +a.days || 3));
    reasons.push(`${days} dage om ugen`);
    if (!has(eq, 'bar') && !has(eq, 'rings')) warnings.push('Uden pull-up-bar eller ringe kan træk-øvelserne ikke laves – skaf en dørkarmsbar, eller skift dem til elastik-rows');
    if (!has(eq, 'pbars') && !has(eq, 'rings')) warnings.push('Uden dipbarre bruges bench dips og push-up-varianter som erstatning');

    const trees = treeLevels(a);
    const used = templateTrees(tpl);
    for (const k of used) reasons.push(`${TREES[k].n}: starter på ${stepName(k, trees[k])}`);
    return { tpl, level, days, trees, reasons, warnings, limits: (a.limits || []).filter(l => AVOID[l]) };
  }

  // Builds the program from the plan and adjusts it for session length and limitations
  function build(a) {
    const p = plan(a);
    const program = buildProgram(p.tpl, p.days, p.level, p.trees);
    const adjustments = [];
    const avoid = new Set(p.limits.flatMap(l => AVOID[l]));
    if (avoid.size) {
      let removed = 0;
      for (const d of program.days) {
        const before = d.items.length;
        d.items = d.items.filter(it => !avoid.has(it.ex) && !(it.circuit || []).some(c => avoid.has(c.ex)));
        removed += before - d.items.length;
        for (const it of d.items) it.alts = (it.alts || []).filter(x => !avoid.has(x));
      }
      if (removed) adjustments.push(`${removed} øvelse${removed === 1 ? '' : 'r'} fjernet af hensyn til ${p.limits.map(l => LIMIT_TEXT[l]).join(' og ')} – erstat dem gerne med noget skånsomt`);
    }
    const minutes = +a.session || 60;
    if (minutes <= 30) {
      for (const d of program.days) if (d.items.length > 3) d.items = d.items.slice(0, 3);
      for (const d of program.days) for (const it of d.items) if (it.sets && it.sets.length > 3) it.sets = it.sets.slice(0, 3);
      adjustments.push('Korte træninger (30 min): højst 3 øvelser og 3 sæt pr. øvelse');
    } else if (minutes <= 45) {
      for (const d of program.days) if (d.items.length > 4) d.items = d.items.slice(0, 4);
      adjustments.push('45 minutter: højst 4 øvelser pr. dag');
    }
    program.desc = [program.desc, 'Lavet med programguiden: ' + p.reasons.slice(0, 2).join('. ').toLowerCase() + '.'].filter(Boolean).join('\n\n');
    return Object.assign(p, { program, adjustments });
  }

  // Defaults for the questionnaire, from an athlete profile if there is one
  function defaults(athlete) {
    return { goal: 'start', experience: athlete ? String(athlete.level) : '0', pullups: 0, dips: 0, pushups: 0, legs: 'no',
      equipment: ['bar', 'pbars'], days: '3', session: '60', limits: [] };
  }

  return { QUESTIONS, AVOID, treeLevels, plan, build, defaults };
})();
