// Program builder for the admin website. Works on the app's own program format (js/templates.js):
// { id, name, tpl, level, treeLvls, desc, weeks, auto, created, days: [{ id, name, items: [Item] }] }
// so a program built here behaves exactly like one built in the app.
'use strict';

const BUILD = { mode: 'program', userId: null, programId: null, templateId: null, p: null, athlete: null, custom: [], user: null, gen: null };
const FORMATS = { sets: 'Almindelige sæt', ladder: 'Ladder', emom: 'EMOM', amrap: 'AMRAP', tabata: 'Tabata' };
const BLOCK_DEFAULTS = {
  ladder: { kind: 'ladder', top: 5, rounds: 3, rest: 45 }, emom: { kind: 'emom', min: 10, reps: 3 },
  amrap: { kind: 'amrap', min: 10 }, tabata: { kind: 'tabata', rounds: 8, work: 20, rest: 10 },
};

function blankProgram() {
  return { id: newId(), name: 'Nyt program', tpl: null, level: 0, treeLvls: {}, desc: '', weeks: 4, auto: true, created: Date.now(),
    days: [{ id: uid(), name: 'Dag 1', items: [] }] };
}

// Which built-in templates fit the athlete: level and the progression steps they have reached
function templateFit(tplId, athlete) {
  const tl = (athlete && athlete.tree_levels) || {}, level = athlete ? athlete.level : 0;
  const step = (tree, ex) => TREES[tree].steps.indexOf(ex);
  if (tplId === 'skill') {
    const ok = (tl.pull ?? -1) >= step('pull', 'pullup') && (tl.dip ?? -1) >= step('dip', 'dip');
    return ok ? { rec: level >= 1, why: 'Har basisstyrken til skills (pull-ups og dips)' } : { rec: false, why: 'Kræver ca. 5+ pull-ups og 10+ dips – byg basis først' };
  }
  if (tplId === 'pl' || tplId === 'hyb') return { rec: level >= 1, why: 'Kræver vægtstang og registreret 1RM i appen' };
  return { rec: true, why: level === 0 ? 'God start for begyndere' : 'Passer til alle niveauer' };
}

// Default tree steps for a generated program: the athlete's own steps, else the template's suggestion for the level
function defaultTreeLevels(trees, level, athlete) {
  const tl = (athlete && athlete.tree_levels) || {};
  return Object.fromEntries(trees.map(k => [k, Math.min(TREES[k].steps.length - 1, tl[k] ?? TREES[k].lvl[level] ?? 0)]));
}

function startGenerator() {
  const level = BUILD.athlete ? BUILD.athlete.level : 0;
  const rec = TEMPLATES.find(t => templateFit(t.id, BUILD.athlete).rec) || TEMPLATES[0];
  BUILD.gen = { source: 'builtin:' + rec.id, days: 3, level, trees: defaultTreeLevels(templateTrees(rec.id), level, BUILD.athlete) };
}

// ---- rendering
function setText(s, lift) {
  if (s.pct) return `${fmt(s.pct)} % × ${s.r}${s.amrap ? '+' : ''}`;
  if (s.t) return `${s.t}${s.tMax ? '–' + s.tMax : ''} s`;
  if (s.amrap && s.r <= 1) return 'maks reps';
  return `${s.r || '?'}${s.rMax ? '–' + s.rMax : ''}${s.amrap ? '+' : ''} reps${s.kg ? ' · ' + fmt(s.kg) + ' kg' : ''}${s.rpe ? ' @' + s.rpe : ''}`;
}
function itemSummary(it) {
  const b = it.block;
  if (b) {
    if (b.kind === 'ladder') return `Ladder 1→${b.top}${b.down ? '→1' : ''} × ${b.rounds} · pause ${b.rest}s`;
    if (b.kind === 'emom') return `EMOM ${b.min} min · ${b.reps} reps hvert minut`;
    if (b.kind === 'amrap') return `AMRAP ${b.min} min${it.circuit ? ': ' + it.circuit.map(c => c.r + ' ' + exName(c.ex)).join(' / ') : ''}`;
    if (b.kind === 'tabata') return `Tabata ${b.rounds} × ${b.work}s/${b.rest}s`;
  }
  const t = targetsFor(it, 0, BUILD.p);
  if (!t.length) return 'Ingen sæt';
  const txt = t.map(s => setText(s, it.lift));
  return 'Uge 1: ' + (txt.every(x => x === txt[0]) ? `${t.length} × ${txt[0]}` : txt.join(', '));
}

function renderGenerator() {
  const g = BUILD.gen;
  if (!g) return '';
  const [kind, id] = g.source.split(':');
  const builtin = kind === 'builtin' ? TEMPLATES.find(t => t.id === id) : null;
  const fit = builtin ? templateFit(builtin.id, BUILD.athlete) : null;
  const opts = TEMPLATES.map(t => { const f = templateFit(t.id, BUILD.athlete);
    return `<option value="builtin:${t.id}" ${g.source === 'builtin:' + t.id ? 'selected' : ''}>${esc(t.name)}${f.rec ? ' ★' : ''}</option>`; }).join('');
  const custom = BUILD.custom.map(t => `<option value="custom:${t.id}" ${g.source === 'custom:' + t.id ? 'selected' : ''}>${esc(t.name)}${t.shared && t.created_by !== API.profile.id ? ' (delt)' : ''}</option>`).join('');
  let h = `<div class="card"><h3>Start fra skabelon</h3>
    <label class="f"><span>Skabelon</span><select class="in" data-c="genSource"><optgroup label="Indbyggede (★ = anbefalet til brugeren)">${opts}</optgroup>
      ${custom ? `<optgroup label="Trænernes skabeloner">${custom}</optgroup>` : ''}</select></label>`;
  if (builtin) {
    h += `<p class="small muted" style="margin-top:0">${esc(builtin.desc)}</p>
      ${fit ? `<div class="hint ${fit.rec ? 'ok' : ''} small" style="margin-bottom:12px">${esc(fit.why)}</div>` : ''}
      <div class="grid2" style="gap:10px"><label class="f"><span>Dage pr. uge</span><select class="in" data-c="genDays">${[2, 3, 4, 5, 6].map(n => `<option ${g.days === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="f"><span>Niveau</span><select class="in" data-c="genLevel">${LEVELS.map((n, i) => `<option value="${i}" ${g.level === i ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
      <span class="small muted">Trin i progressionstræerne${BUILD.athlete ? ' (fra brugerens profil)' : ''}</span>
      <div class="tree mt">${templateTrees(builtin.id).map(k => `<span class="small">${esc(TREES[k].n)}</span>
        <select class="in" data-c="genTree" data-k="${k}">${TREES[k].steps.map((s, i) => `<option value="${i}" ${g.trees[k] === i ? 'selected' : ''}>${i + 1}. ${esc(exName(s))}</option>`).join('')}</select>`).join('')}</div>`;
  } else {
    const t = BUILD.custom.find(x => x.id === id);
    if (t) h += `<p class="small muted">${esc(t.description || '')}</p><p class="xs dim">${t.days_per_week || '?'} dage · ${t.level != null ? LEVELS[t.level] : 'alle niveauer'}${t.tags.length ? ' · ' + t.tags.map(esc).join(', ') : ''}</p>`;
  }
  h += `<button class="btn pri block mt" data-a="generate">Generér program</button>
    <p class="xs dim" style="margin-bottom:0">Erstatter dagene i programmet herunder.</p></div>`;
  return h;
}

function renderBuilder() {
  const p = BUILD.p, isTpl = BUILD.mode === 'template';
  const title = isTpl ? 'Skabelon' : (BUILD.programId ? 'Ret program' : 'Nyt program');
  let h = `<div class="row between wrap"><div><h1>${title}</h1><div class="muted small">${isTpl ? 'Trænerskabelon' : 'Til ' + esc(BUILD.user ? BUILD.user.display_name : '')}</div></div>
    <div class="row">${!isTpl ? `<button class="btn" data-a="saveAsTemplate">Gem som skabelon</button>` : ''}
    <a class="btn ghost" href="${isTpl ? '#/templates' : '#/user/' + BUILD.userId}">Annullér</a>
    <button class="btn pri" data-a="saveProgram">${isTpl ? 'Gem skabelon' : 'Gem program'}</button></div></div>`;
  h += `<div class="builder mt2"><div class="side">
    <div class="card"><h3>Program</h3>
      <label class="f"><span>Navn</span><input class="in" data-c="pf" data-k="name" value="${esc(p.name)}"></label>
      <div class="grid2" style="gap:10px"><label class="f"><span>Uger pr. cyklus</span><input class="in" type="number" min="1" max="16" data-c="pf" data-k="weeks" value="${p.weeks}"></label>
      <label class="f"><span>Niveau</span><select class="in" data-c="pf" data-k="level">${LEVELS.map((n, i) => `<option value="${i}" ${p.level === i ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
      <label class="f"><span>Beskrivelse</span><textarea class="in" data-c="pf" data-k="desc">${esc(p.desc || '')}</textarea></label>
      <label class="row small"><input type="checkbox" data-c="pf" data-k="auto" ${p.auto !== false ? 'checked' : ''}> Automatisk progression i appen</label>
    </div>${renderGenerator()}</div><div>`;
  p.days.forEach((d, di) => {
    h += `<div class="day"><div class="head"><input class="in grow" data-c="dayName" data-d="${di}" value="${esc(d.name)}">
      <button class="btn sm ghost" data-a="dayUp" data-d="${di}" ${di ? '' : 'disabled'} title="Flyt op">↑</button>
      <button class="btn sm ghost" data-a="dayDup" data-d="${di}">Kopiér</button>
      <button class="btn sm ghost danger" data-a="dayDel" data-d="${di}">Slet dag</button></div>`;
    d.items.forEach((it, ii) => { h += renderItem(it, di, ii); });
    h += `<div class="item"><button class="btn sm" data-a="addItem" data-d="${di}">＋ Tilføj øvelse</button></div></div>`;
  });
  h += `<button class="btn" data-a="addDay">＋ Tilføj dag</button></div></div>`;
  return h;
}

function renderItem(it, di, ii) {
  const ex = exById(it.ex) || { n: it.ex, type: 'reps' };
  const fmtKey = it.block ? it.block.kind : 'sets';
  const at = `data-d="${di}" data-i="${ii}"`;
  let h = `<div class="item"><div class="ex">${exThumb(ex)}<div class="grow"><b>${esc(ex.n)}</b><div class="sum">${esc(itemSummary(it))}</div></div>
    <select class="in" style="width:auto" data-c="itFormat" ${at}>${Object.entries(FORMATS).map(([k, n]) => `<option value="${k}" ${fmtKey === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
    <button class="btn sm ghost" data-a="itChange" ${at}>Skift øvelse</button>
    <button class="btn sm ghost" data-a="itUp" ${at} ${ii ? '' : 'disabled'}>↑</button>
    <button class="btn sm ghost danger" data-a="itDel" ${at}>✕</button></div>`;
  if (it.block) {
    const b = it.block, f = (k, label) => `<label class="small">${label} <input class="in num" type="number" data-c="itBlock" data-k="${k}" ${at} value="${b[k] ?? ''}"></label>`;
    h += `<div class="row wrap mt">`;
    if (b.kind === 'ladder') h += f('top', 'Top') + f('rounds', 'Runder') + f('rest', 'Pause (s)') + `<label class="small"><input type="checkbox" data-c="itBlockDown" ${at} ${b.down ? 'checked' : ''}> og ned igen (pyramide)</label>`;
    if (b.kind === 'emom') h += f('min', 'Minutter') + f('reps', 'Reps pr. minut');
    if (b.kind === 'amrap') h += f('min', 'Minutter');
    if (b.kind === 'tabata') h += f('rounds', 'Runder') + f('work', 'Arbejde (s)') + f('rest', 'Hvile (s)');
    h += `</div>`;
    if (b.kind === 'amrap') {
      h += `<div class="small muted mt">Runde:</div>` + (it.circuit || []).map((c, ci) => `<div class="row mt"><span class="grow">${esc(exName(c.ex))}</span>
        <input class="in num" type="number" min="1" data-c="itCirc" data-ci="${ci}" ${at} value="${c.r}"> reps
        <button class="btn sm ghost danger" data-a="circDel" data-ci="${ci}" ${at}>✕</button></div>`).join('') +
        `<button class="btn sm mt" data-a="circAdd" ${at}>＋ Øvelse i runden</button>`;
    }
  } else {
    const lifts = Object.entries(LIFTS);
    h += `<div class="row wrap mt small"><label>Progression <select class="in" style="width:auto" data-c="itWave" ${at}>${Object.entries(WAVES).map(([k, n]) => `<option value="${k}" ${(it.wave || 'none') === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      ${ex.type === 'weight' ? `<label>%-løft <select class="in" style="width:auto" data-c="itLift" ${at}><option value="">Ingen (kg)</option>${lifts.map(([k, n]) => `<option value="${k}" ${it.lift === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>` : ''}</div>`;
    const cols = it.lift ? [['pct', '%TM'], ['r', 'Reps']] : ex.type === 'time' ? [['t', 'Sek'], ['tMax', 'Til'], ['kg', 'Kg']] : [['r', 'Reps'], ['rMax', 'Til'], ['kg', 'Kg'], ['rpe', 'RPE']];
    h += `<table class="sets"><tr><th></th>${cols.map(c => `<th>${c[1]}</th>`).join('')}<th>Pause</th><th>AMRAP</th><th></th></tr>` +
      it.sets.map((s, j) => `<tr><td class="i">${j + 1}</td>${cols.map(([k]) => `<td><input class="in num" inputmode="decimal" data-c="itSet" data-k="${k}" data-j="${j}" ${at} value="${s[k] ?? ''}"></td>`).join('')}
        <td><input class="in num" inputmode="numeric" data-c="itSet" data-k="rest" data-j="${j}" ${at} value="${s.rest ?? ''}"></td>
        <td style="text-align:center"><input type="checkbox" data-c="itAmrap" data-j="${j}" ${at} ${s.amrap ? 'checked' : ''}></td>
        <td><button class="btn sm ghost danger" data-a="setDel" data-j="${j}" ${at}>✕</button></td></tr>`).join('') + `</table>
      <button class="btn sm mt" data-a="setAdd" ${at}>＋ Sæt</button>`;
  }
  h += `<input class="in mt small" placeholder="Note til brugeren (valgfri)" data-c="itNote" ${at} value="${esc(it.note || '')}"></div>`;
  return h;
}

// ---- exercise picker
let PICK = { q: '', cat: 'all', cb: null };
function openPicker(title, cb) { PICK = { q: '', cat: 'all', cb }; openModal(title, pickerHtml()); setTimeout(() => { const i = $('#pick-q'); if (i) i.focus(); }, 0); }
function pickerList() {
  const q = PICK.q.trim().toLowerCase();
  const list = EXERCISES.filter(e => !e.deprecated && (PICK.cat === 'all' || e.c === PICK.cat) && (!q || e.n.toLowerCase().includes(q) || e.id.includes(q)));
  return list.map(e => `<div class="pick" data-a="pickEx" data-id="${e.id}">${exThumb(e)}<div><b class="small">${esc(e.n)}</b><div class="xs muted">${esc(CATS[e.c])}</div></div></div>`).join('') || '<p class="muted">Ingen øvelser matcher.</p>';
}
function pickerHtml() {
  return `<input class="in" id="pick-q" placeholder="Søg øvelse…" data-in="pickQ" value="${esc(PICK.q)}">
    <div class="chips"><button class="chip ${PICK.cat === 'all' ? 'on' : ''}" data-a="pickCat" data-v="all">Alle</button>${Object.entries(CATS).map(([k, n]) => `<button class="chip ${PICK.cat === k ? 'on' : ''}" data-a="pickCat" data-v="${k}">${n}</button>`).join('')}</div>
    <div class="picklist" id="picklist">${pickerList()}</div>`;
}
INPUTS.pickQ = el => { PICK.q = el.value; $('#picklist').innerHTML = pickerList(); };
ACTIONS.pickCat = el => { PICK.cat = el.dataset.v; $('#modal .body').innerHTML = pickerHtml(); };
ACTIONS.pickEx = el => { const cb = PICK.cb; closeModal(); if (cb) cb(el.dataset.id); };

// ---- editing
const P = () => BUILD.p, item = el => P().days[+el.dataset.d].items[+el.dataset.i];
function rerender() { const y = window.scrollY; $('#app').innerHTML = renderBuilder(); window.scrollTo(0, y); }
function newItemFor(exId) {
  const ex = exById(exId) || {};
  const sets = ex.type === 'time' ? hold(3, 20, 40, 90) : ex.type === 'weight' ? rep(3, 5, 8, 150, { rpe: 8 }) : rep(3, 8, 12, 90);
  return { id: uid(), ex: exId, alts: defaultAlts(exId), sets, wave: ex.type === 'weight' ? 'none' : 'cal', note: '', lift: null };
}

CHANGES.pf = el => {
  const k = el.dataset.k, p = P();
  if (k === 'auto') p.auto = el.checked;
  else if (k === 'weeks') p.weeks = Math.max(1, Math.min(16, num(el.value) || 4));
  else if (k === 'level') p.level = +el.value;
  else p[k] = el.value;
  if (k === 'weeks') rerender();
};
CHANGES.dayName = el => { P().days[+el.dataset.d].name = el.value.trim() || 'Dag'; };
CHANGES.itSet = el => {
  const s = item(el).sets[+el.dataset.j], v = num(el.value);
  if (v == null) delete s[el.dataset.k]; else s[el.dataset.k] = v;
  rerender();
};
CHANGES.itAmrap = el => { item(el).sets[+el.dataset.j].amrap = el.checked; rerender(); };
CHANGES.itWave = el => { item(el).wave = el.value; rerender(); };
CHANGES.itLift = el => {
  const it = item(el); it.lift = el.value || null;
  it.sets.forEach(s => { if (it.lift) { s.pct = s.pct || 70; delete s.kg; delete s.rMax; } else delete s.pct; });
  rerender();
};
CHANGES.itNote = el => { item(el).note = el.value; };
CHANGES.itBlock = el => { item(el).block[el.dataset.k] = num(el.value) || 0; rerender(); };
CHANGES.itBlockDown = el => { item(el).block.down = el.checked; rerender(); };
CHANGES.itCirc = el => { item(el).circuit[+el.dataset.ci].r = num(el.value) || 1; rerender(); };
CHANGES.itFormat = el => {
  const it = item(el), k = el.value;
  if (k === 'sets') { delete it.block; delete it.circuit; it.sets = newItemFor(it.ex).sets; it.wave = newItemFor(it.ex).wave; }
  else { it.block = clone(BLOCK_DEFAULTS[k]); it.sets = []; it.wave = 'none'; if (k === 'amrap') it.circuit = it.circuit || [{ ex: it.ex, r: 5 }]; else delete it.circuit; }
  rerender();
};

ACTIONS.addDay = () => { P().days.push({ id: uid(), name: 'Dag ' + (P().days.length + 1), items: [] }); rerender(); };
ACTIONS.dayDel = el => { if (P().days.length > 1 && confirm('Slet dagen og dens øvelser?')) { P().days.splice(+el.dataset.d, 1); rerender(); } };
ACTIONS.dayUp = el => { const d = P().days, i = +el.dataset.d; [d[i - 1], d[i]] = [d[i], d[i - 1]]; rerender(); };
ACTIONS.dayDup = el => { const d = clone(P().days[+el.dataset.d]); d.id = uid(); d.name += ' (kopi)'; d.items.forEach(x => x.id = uid()); P().days.splice(+el.dataset.d + 1, 0, d); rerender(); };
ACTIONS.addItem = el => openPicker('Tilføj øvelse', id => { P().days[+el.dataset.d].items.push(newItemFor(id)); rerender(); });
ACTIONS.itChange = el => openPicker('Skift øvelse', id => { const it = item(el); it.ex = id; it.alts = defaultAlts(id); rerender(); });
ACTIONS.itDel = el => { P().days[+el.dataset.d].items.splice(+el.dataset.i, 1); rerender(); };
ACTIONS.itUp = el => { const a = P().days[+el.dataset.d].items, i = +el.dataset.i; [a[i - 1], a[i]] = [a[i], a[i - 1]]; rerender(); };
ACTIONS.setAdd = el => { const it = item(el), last = it.sets[it.sets.length - 1]; it.sets.push(last ? clone(last) : newItemFor(it.ex).sets[0]); rerender(); };
ACTIONS.setDel = el => { item(el).sets.splice(+el.dataset.j, 1); rerender(); };
ACTIONS.circAdd = el => openPicker('Øvelse i runden', id => { const it = item(el); (it.circuit = it.circuit || []).push({ ex: id, r: 5 }); rerender(); });
ACTIONS.circDel = el => { item(el).circuit.splice(+el.dataset.ci, 1); rerender(); };

// ---- generator
CHANGES.genSource = el => {
  const g = BUILD.gen; g.source = el.value;
  const [kind, id] = el.value.split(':');
  if (kind === 'builtin') g.trees = defaultTreeLevels(templateTrees(id), g.level, BUILD.athlete);
  rerender();
};
CHANGES.genDays = el => { BUILD.gen.days = +el.value; };
CHANGES.genLevel = el => {
  const g = BUILD.gen; g.level = +el.value;
  const [kind, id] = g.source.split(':');
  if (kind === 'builtin' && !BUILD.athlete) g.trees = defaultTreeLevels(templateTrees(id), g.level, null);
  rerender();
};
CHANGES.genTree = el => { BUILD.gen.trees[el.dataset.k] = +el.value; };
ACTIONS.generate = () => {
  const g = BUILD.gen, [kind, id] = g.source.split(':'), p = P();
  const hasItems = p.days.some(d => d.items.length);
  if (hasItems && !confirm('Erstat programmets dage med den genererede skabelon?')) return;
  let gen;
  if (kind === 'builtin') gen = buildProgram(id, g.days, g.level, g.trees);
  else {
    const t = BUILD.custom.find(x => x.id === id);
    gen = Object.assign(clone(t.data), { name: t.name, level: t.level ?? (t.data.level || 0) });
    gen.days.forEach(d => { d.id = uid(); d.items.forEach(x => x.id = uid()); });
  }
  // Keep this program's identity; take the content from the template
  BUILD.p = Object.assign(gen, { id: p.id, created: p.created, name: p.name === 'Nyt program' || !p.name ? gen.name : p.name });
  rerender(); toast('Programmet er genereret – tilpas det, og gem');
};
