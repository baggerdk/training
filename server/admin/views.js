// The admin website's screens. Admin: all users, can create trainers and change roles.
// Trainer: own users only. The server enforces the same rules (API + RLS).
'use strict';

let USERS_Q = '';

// ---------------------------------------------------------------- login
VIEWS.login = () => {
  if (API.loggedIn()) { go('#/'); return; }
  return `<div class="login"><div class="card"><h1>Log ind</h1><p class="muted small">Administration for admin og trænere.</p>
    <form data-submit="login" novalidate>
      <label class="f"><span>E-mail</span><input class="in" id="li-email" type="email" autocomplete="username" required></label>
      <label class="f"><span>Password</span><input class="in" id="li-pw" type="password" autocomplete="current-password" required></label>
      <div id="li-err"></div>
      <button class="btn pri block" type="submit" id="li-btn">Log ind</button>
    </form></div></div>`;
};
SUBMITS.login = async () => {
  const btn = $('#li-btn'), err = $('#li-err');
  btn.disabled = true; btn.textContent = 'Logger ind…'; err.innerHTML = '';
  try { await API.login($('#li-email').value, $('#li-pw').value); go('#/'); }
  catch (e) { err.innerHTML = `<div class="hint err" style="margin-bottom:12px">${esc(e.message)}</div>`; btn.disabled = false; btn.textContent = 'Log ind'; }
};

// ---------------------------------------------------------------- users
VIEWS.users = async () => {
  const users = await API.get('/users');
  const q = USERS_Q.trim().toLowerCase();
  const trainers = Object.fromEntries(users.filter(u => u.role === 'trainer').map(u => [u.id, u.display_name]));
  const shown = users.filter(u => !q || u.display_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  const admin = API.isAdmin();
  return `<div class="row between wrap"><div><h1>${admin ? 'Brugere' : 'Mine brugere'}</h1>
      <div class="muted small">${users.length} ${users.length === 1 ? 'person' : 'personer'}</div></div>
    <div class="row"><input class="in" style="width:240px" placeholder="Søg navn eller e-mail" data-in="usersQ" value="${esc(USERS_Q)}">
      ${admin ? '<button class="btn" data-a="newUser" data-role="trainer">＋ Ny træner</button>' : ''}
      <button class="btn pri" data-a="newUser" data-role="user">＋ Ny bruger</button></div></div>
    <div class="card mt2" style="padding:0"><table class="list"><tr><th>Navn</th><th>E-mail</th><th>Rolle</th>${admin ? '<th>Træner</th>' : ''}<th>Oprettet</th></tr>
    ${shown.map(u => `<tr class="tap" data-a="openUser" data-id="${u.id}"><td><b>${esc(u.display_name)}</b>${u.disabled_at ? ' <span class="badge off">Deaktiveret</span>' : ''}</td>
      <td class="muted">${esc(u.email)}</td><td><span class="badge ${u.role}">${ROLE_NAMES[u.role]}</span></td>
      ${admin ? `<td class="muted small">${esc(trainers[u.trainer_id] || '–')}</td>` : ''}<td class="muted small">${dkDate(u.created_at)}</td></tr>`).join('')}
    </table>${shown.length ? '' : '<p class="muted" style="padding:16px">Ingen brugere endnu. Opret den første, og send invitationslinket.</p>'}</div>`;
};
INPUTS.usersQ = el => { USERS_Q = el.value; clearTimeout(INPUTS.usersQ.t); INPUTS.usersQ.t = setTimeout(async () => { await render(); const i = document.querySelector('[data-in=usersQ]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); };
ACTIONS.openUser = el => go('#/user/' + el.dataset.id);

function inviteBox(url, intro) {
  return `<p class="small">${intro}</p><div class="copy"><input class="in" id="invite-url" readonly value="${esc(url)}">
    <button class="btn" data-a="copy" data-target="invite-url">Kopiér</button></div>
    <p class="xs muted">Send linket til personen (SMS, Messenger, …). Det kan bruges én gang og gælder i 7 dage. Åbnes det på en telefon med appen, åbner det direkte i appen.</p>`;
}

ACTIONS.newUser = el => {
  const role = el.dataset.role;
  openModal(role === 'trainer' ? 'Ny træner' : 'Ny bruger', `<form data-submit="createUser" data-role="${role}" novalidate>
    <label class="f"><span>Navn</span><input class="in" id="nu-name" required></label>
    <label class="f"><span>E-mail</span><input class="in" id="nu-email" type="email" required></label>
    <div id="nu-err"></div><button class="btn pri" type="submit">Opret og lav invitationslink</button></form>`);
  setTimeout(() => $('#nu-name').focus(), 0);
};
SUBMITS.createUser = async f => {
  const name = $('#nu-name').value.trim(), email = $('#nu-email').value.trim();
  if (!name || !email) { $('#nu-err').innerHTML = '<div class="hint err" style="margin-bottom:12px">Udfyld navn og e-mail</div>'; return; }
  try {
    const r = await API.post('/users', { display_name: name, email, role: f.dataset.role });
    $('#modal .body').innerHTML = inviteBox(r.inviteUrl, `<b>${esc(r.profile.display_name)}</b> er oprettet som ${ROLE_NAMES[r.profile.role].toLowerCase()}.`) +
      `<div class="row mt"><button class="btn pri" data-a="openUser" data-id="${r.profile.id}">Åbn ${esc(r.profile.display_name)}</button><button class="btn ghost" data-a="closeModal">Luk</button></div>`;
    if ((ROUTE[0] || 'users') === 'users') render();
  } catch (e) { $('#nu-err').innerHTML = `<div class="hint err" style="margin-bottom:12px">${esc(e.message)}</div>`; }
};

// ---------------------------------------------------------------- one user
VIEWS.user = async () => {
  const id = ROUTE[1];
  const [{ profile: u, athlete, stats }, programs, all] = await Promise.all([
    API.get('/users/' + id), API.get('/users/' + id + '/programs'), API.isAdmin() ? API.get('/users') : Promise.resolve([]),
  ]);
  const admin = API.isAdmin(), trainers = all.filter(x => x.role === 'trainer');
  const a = athlete || { level: 0, tree_levels: {}, goals: '', notes: '' };
  const authorName = pid => (pid === API.profile.id ? 'dig' : (all.find(x => x.id === pid) || {}).display_name || 'træneren');
  let h = `<a class="small" href="#/">← ${admin ? 'Brugere' : 'Mine brugere'}</a>
    <div class="row between wrap mt"><div><h1>${esc(u.display_name)}</h1><div class="muted">${esc(u.email)} · <span class="badge ${u.role}">${ROLE_NAMES[u.role]}</span>
      ${u.disabled_at ? '<span class="badge off">Deaktiveret</span>' : ''}</div></div>
      <div class="row">${u.id !== API.profile.id ? `<button class="btn" data-a="newInvite" data-id="${u.id}">Nyt login-link</button>` : ''}
      ${admin && u.id !== API.profile.id ? `<button class="btn ghost" data-a="toggleDisabled" data-id="${u.id}" data-on="${u.disabled_at ? 0 : 1}">${u.disabled_at ? 'Aktivér' : 'Deaktivér'}</button>
        <button class="btn ghost danger" data-a="deleteUser" data-id="${u.id}" data-name="${esc(u.display_name)}">Slet</button>` : ''}</div></div>
    <div class="grid3 mt2"><div class="card"><div class="muted small">Træninger</div><h1>${stats.workouts}</h1></div>
      <div class="card"><div class="muted small">Seneste træning</div><h1 style="font-size:1.2rem">${stats.last_workout ? dkDate(stats.last_workout) : '–'}</h1></div>
      <div class="card"><div class="muted small">Programmer</div><h1>${stats.programs}</h1></div></div>`;

  if (admin && u.id !== API.profile.id) {
    h += `<div class="card"><h3>Rolle og træner</h3><div class="row wrap">
      <label class="f" style="margin:0"><span>Rolle</span><select class="in" data-c="setRole" data-id="${u.id}">${Object.entries(ROLE_NAMES).map(([k, n]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      ${u.role === 'user' ? `<label class="f" style="margin:0"><span>Træner</span><select class="in" data-c="setTrainer" data-id="${u.id}"><option value="">Ingen</option>
        ${trainers.map(t => `<option value="${t.id}" ${u.trainer_id === t.id ? 'selected' : ''}>${esc(t.display_name)}</option>`).join('')}</select></label>` : ''}</div></div>`;
  }

  h += `<div class="grid2"><div class="card"><h3>Atletprofil</h3><p class="small muted" style="margin-top:0">Bruges som udgangspunkt, når der bygges programmer fra skabeloner.</p>
    <form data-submit="saveAthlete" data-id="${u.id}">
      <label class="f"><span>Niveau</span><select class="in" id="ap-level">${LEVELS.map((n, i) => `<option value="${i}" ${a.level === i ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <span class="small muted">Nuværende trin i progressionstræerne</span>
      <div class="tree mt">${Object.entries(TREES).map(([k, t]) => `<span class="small">${esc(t.n)}</span><select class="in" data-tree="${k}">
        <option value="">Ikke vurderet</option>${t.steps.map((s, i) => `<option value="${i}" ${a.tree_levels[k] === i ? 'selected' : ''}>${i + 1}. ${esc(exName(s))}</option>`).join('')}</select>`).join('')}</div>
      <label class="f mt"><span>Mål</span><textarea class="in" id="ap-goals" placeholder="Fx første muscle-up, 100 kg bænk">${esc(a.goals || '')}</textarea></label>
      <label class="f"><span>Noter (kun for trænere)</span><textarea class="in" id="ap-notes" placeholder="Skader, udstyr, tidspunkter …">${esc(a.notes || '')}</textarea></label>
      <button class="btn pri" type="submit">Gem profil</button>${athlete ? `<span class="xs dim" style="margin-left:10px">Senest ændret ${dkDate(athlete.updated_at)}</span>` : ''}
    </form></div>
    <div class="card"><div class="row between"><h3 style="margin:0">Programmer</h3><div class="row"><button class="btn sm" data-a="openGuideUser" data-id="${u.id}">Programguide</button><a class="btn pri sm" href="#/program/new?user=${u.id}">＋ Nyt program</a></div></div>
    ${programs.length ? `<table class="list mt">${programs.map(p => `<tr class="tap" data-a="openProgram" data-id="${p.id}" data-user="${u.id}">
      <td><b>${esc(p.name)}</b><div class="xs muted">${p.days_per_week || '?'} dage · ${esc(p.level || '')} · lavet af ${esc(authorName(p.created_by))}</div></td>
      <td class="small muted" style="text-align:right">${dkDate(p.updated_at)}</td></tr>`).join('')}</table>`
      : '<p class="muted small">Ingen programmer endnu. Byg et ud fra brugerens profil.</p>'}
    <p class="xs dim">Programmer, du laver her, vises i brugerens app under deres programmer. Brugeren kan bruge dem, men ikke ændre dem.</p></div></div>`;
  return h;
};
ACTIONS.openProgram = el => go(`#/program/${el.dataset.id}?user=${el.dataset.user}`);
SUBMITS.saveAthlete = async f => {
  const tree_levels = {};
  f.querySelectorAll('[data-tree]').forEach(s => { if (s.value !== '') tree_levels[s.dataset.tree] = +s.value; });
  try {
    await API.put(`/users/${f.dataset.id}/athlete`, { level: +$('#ap-level').value, tree_levels, goals: $('#ap-goals').value || null, notes: $('#ap-notes').value || null });
    toast('Profilen er gemt');
  } catch (e) { toast(e.message, 5000); }
};
ACTIONS.newInvite = async el => {
  try { const r = await API.post(`/users/${el.dataset.id}/invite`); openModal('Nyt login-link', inviteBox(r.inviteUrl, 'Brugeren vælger et nyt password via linket. Gamle links holder op med at virke.')); }
  catch (e) { toast(e.message, 5000); }
};
ACTIONS.toggleDisabled = async el => {
  const on = el.dataset.on === '1';
  if (on && !confirm('Deaktivér brugeren? Personen logges ud på alle enheder og kan ikke logge ind igen, før du aktiverer.')) return;
  try { await API.patch('/users/' + el.dataset.id, { disabled: on }); toast(on ? 'Brugeren er deaktiveret' : 'Brugeren er aktiveret'); render(); } catch (e) { toast(e.message, 5000); }
};
ACTIONS.deleteUser = async el => {
  if (!confirm(`Slet ${el.dataset.name} og ALLE personens træningsdata? Det kan ikke fortrydes.`)) return;
  try { await API.del('/users/' + el.dataset.id); toast('Brugeren er slettet'); go('#/'); } catch (e) { toast(e.message, 5000); }
};
CHANGES.setRole = async el => { try { await API.patch('/users/' + el.dataset.id, { role: el.value }); toast('Rollen er ændret'); render(); } catch (e) { toast(e.message, 5000); render(); } };
CHANGES.setTrainer = async el => { try { await API.patch('/users/' + el.dataset.id, { trainer_id: el.value || null }); toast('Træneren er ændret'); } catch (e) { toast(e.message, 5000); render(); } };

// ---------------------------------------------------------------- program builder
VIEWS.program = async () => {
  const userId = QUERY.get('user'), pid = ROUTE[1];
  const [detail, custom, programs] = await Promise.all([API.get('/users/' + userId), API.get('/templates'), pid !== 'new' ? API.get(`/users/${userId}/programs`) : Promise.resolve([])]);
  Object.assign(BUILD, { mode: 'program', userId, user: detail.profile, athlete: detail.athlete, custom, templateId: null });
  if (pid === 'new') {
    BUILD.programId = null; BUILD.p = blankProgram(); BUILD.p.level = detail.athlete ? detail.athlete.level : 0;
    if (QUERY.get('guide') && GUIDE_PENDING) { BUILD.p = GUIDE_PENDING.result.program; GUIDE_PENDING = null; }
  }
  else {
    const row = programs.find(p => p.id === pid);
    if (!row) throw new Error('Programmet findes ikke');
    BUILD.programId = pid; BUILD.p = rowToProgram(row, API.profile.id);
    delete BUILD.p.owner; delete BUILD.p.author;
  }
  startGenerator();
  return renderBuilder();
};

VIEWS.template = async () => {
  const custom = await API.get('/templates');
  if (ROUTE[1] === 'new') {
    Object.assign(BUILD, { mode: 'template', templateId: null, programId: null, userId: null, user: null, athlete: null, custom, tpl: null });
    BUILD.p = QUERY.get('guide') && GUIDE_PENDING ? GUIDE_PENDING.result.program : blankProgram();
    if (BUILD.p.name === 'Nyt program') BUILD.p.name = 'Ny skabelon';
    GUIDE_PENDING = null;
    startGenerator();
    return renderBuilder();
  }
  const t = custom.find(x => x.id === ROUTE[1]);
  if (!t) throw new Error('Skabelonen findes ikke');
  Object.assign(BUILD, { mode: 'template', templateId: t.id, programId: null, userId: null, user: null, athlete: null, custom, tpl: t });
  BUILD.p = Object.assign(clone(t.data), { id: newId(), name: t.name, level: t.level ?? (t.data.level || 0) });
  startGenerator();
  return renderBuilder();
};

function programPayload() {
  const row = programToRow(BUILD.p, BUILD.userId);
  delete row.owner_id;
  return row;
}
function validProgram() {
  const p = BUILD.p;
  if (!p.name.trim()) return 'Giv programmet et navn';
  if (!p.days.length || p.days.every(d => !d.items.length)) return 'Programmet har ingen øvelser endnu';
  return null;
}
ACTIONS.saveProgram = async () => {
  const err = validProgram();
  if (err) return toast(err, 4000);
  try {
    if (BUILD.mode === 'template' && !BUILD.tpl) { ACTIONS.saveAsTemplate(); return; }
    if (BUILD.mode === 'template') {
      const t = BUILD.tpl, data = Object.assign(clone(BUILD.p), { id: undefined });
      await API.put('/templates/' + t.id, { name: BUILD.p.name, description: BUILD.p.desc || t.description || null, level: BUILD.p.level,
        days_per_week: Math.min(7, BUILD.p.days.length), tags: t.tags, data, shared: t.shared });
      toast('Skabelonen er gemt'); go('#/templates'); return;
    }
    if (BUILD.programId) await API.put('/programs/' + BUILD.programId, programPayload());
    else await API.post(`/users/${BUILD.userId}/programs`, programPayload());
    toast('Programmet er gemt – brugeren får det i appen ved næste synkronisering');
    go('#/user/' + BUILD.userId);
  } catch (e) { toast(e.message, 5000); }
};
ACTIONS.saveAsTemplate = () => {
  const err = validProgram();
  if (err) return toast(err, 4000);
  openModal('Gem som skabelon', `<form data-submit="createTemplate" novalidate>
    <label class="f"><span>Navn</span><input class="in" id="tp-name" value="${esc(BUILD.p.name)}" required></label>
    <label class="f"><span>Beskrivelse</span><textarea class="in" id="tp-desc" placeholder="Hvem er skabelonen til?">${esc(BUILD.p.desc || '')}</textarea></label>
    <label class="f"><span>Mærker (kommasepareret)</span><input class="in" id="tp-tags" placeholder="fx pull-up, begynder, 3 dage"></label>
    <label class="row small"><input type="checkbox" id="tp-shared"> Del med alle trænere</label>
    <button class="btn pri mt" type="submit">Gem skabelon</button></form>`);
};
SUBMITS.createTemplate = async () => {
  const name = $('#tp-name').value.trim();
  if (!name) return toast('Giv skabelonen et navn');
  const tags = $('#tp-tags').value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 20);
  const data = clone(BUILD.p); delete data.id; delete data.pos;
  try {
    await API.post('/templates', { name, description: $('#tp-desc').value || null, level: BUILD.p.level, days_per_week: Math.min(7, BUILD.p.days.length), tags, data, shared: $('#tp-shared').checked });
    closeModal(); toast('Skabelonen er gemt');
    if (BUILD.mode === 'template') { go('#/templates'); return; }
    BUILD.custom = await API.get('/templates');
    rerender();   // the new template appears in "Start fra skabelon" right away
  } catch (e) { toast(e.message, 5000); }
};

// ---------------------------------------------------------------- templates
VIEWS.templates = async () => {
  const list = await API.get('/templates'), me = API.profile.id;
  const card = t => `<div class="card"><div class="row between"><b>${esc(t.name)}</b>${t.shared ? '<span class="badge trainer">Delt</span>' : ''}</div>
    <p class="small muted">${esc(t.description || '')}</p>
    <div class="xs dim">${t.days_per_week || '?'} dage · ${t.level != null ? LEVELS[t.level] : 'alle niveauer'} · af ${esc(t.created_by === me ? 'dig' : t.created_by_name || 'en træner')}</div>
    ${t.tags.length ? `<div class="chips">${t.tags.map(x => `<span class="badge">${esc(x)}</span>`).join('')}</div>` : ''}
    ${t.created_by === me || API.isAdmin() ? `<div class="row mt"><a class="btn sm" href="#/template/${t.id}">Ret</a>
      <button class="btn sm ghost" data-a="toggleShared" data-id="${t.id}">${t.shared ? 'Stop deling' : 'Del med alle trænere'}</button>
      <button class="btn sm ghost danger" data-a="deleteTemplate" data-id="${t.id}" data-name="${esc(t.name)}">Slet</button></div>` : ''}</div>`;
  return `<div class="row between wrap"><h1>Skabeloner</h1><div class="row"><button class="btn" data-a="openGuideTemplate">Programguide</button><a class="btn pri" href="#/template/new">＋ Ny skabelon</a></div></div><p class="muted">Ud over appens ${TEMPLATES.length} indbyggede skabeloner kan du gemme dine egne programmer som skabeloner og bruge dem til flere brugere.
    Gem et program som skabelon fra programbyggeren.</p>
    <h2>Indbyggede</h2><div class="grid3">${TEMPLATES.map(t => `<div class="card"><b>${esc(t.name)}</b><p class="small muted">${esc(t.desc)}</p>
      <div class="xs dim">2–6 dage · begynder, øvet og avanceret · ${templateTrees(t.id).length} progressionstræer</div></div>`).join('')}</div>
    <h2>Trænernes egne</h2>${list.length ? `<div class="grid3">${list.map(card).join('')}</div>` : '<p class="muted">Ingen endnu.</p>'}`;
};
ACTIONS.toggleShared = async el => {
  const t = (await API.get('/templates')).find(x => x.id === el.dataset.id);
  try { await API.put('/templates/' + t.id, { name: t.name, description: t.description, level: t.level, days_per_week: t.days_per_week, tags: t.tags, data: t.data, shared: !t.shared }); render(); }
  catch (e) { toast(e.message, 5000); }
};
ACTIONS.deleteTemplate = async el => {
  if (!confirm(`Slet skabelonen "${el.dataset.name}"? Programmer, der er lavet ud fra den, påvirkes ikke.`)) return;
  try { await API.del('/templates/' + el.dataset.id); toast('Skabelonen er slettet'); render(); } catch (e) { toast(e.message, 5000); }
};

render();

// ---------------------------------------------------------------- program guide (rule-based, js/guide.js)
// Opened from a user (the result can update their athlete profile) or from Skabeloner (the result becomes a template)
let GUIDE_CTX = null;   // { userId, athlete } or { template: true }
let GUIDE_PENDING = null;   // the built program waiting for the builder to open

function guideForm(a) {
  return `<form data-submit="runGuide" novalidate><p class="small muted" style="margin-top:0">Svarene omsættes efter faste regler til skabelon, niveau, dage og trin i progressionstræerne. Du kan tilpasse alt bagefter.</p>
    ${GUIDE.QUESTIONS.map(q => {
      const v = a[q.id];
      if (q.type === 'number') return `<label class="f"><span>${esc(q.text)}</span><input class="in" type="number" inputmode="numeric" min="${q.min}" max="${q.max}" data-q="${q.id}" value="${v}"></label>`;
      if (q.type === 'multi') return `<div class="f"><span class="small muted" style="font-weight:700">${esc(q.text)}</span><div class="chips">${q.options.map(([k, t]) =>
        `<label class="chip ${v.includes(k) ? 'on' : ''}"><input type="checkbox" data-q="${q.id}" value="${k}" ${v.includes(k) ? 'checked' : ''} hidden>${esc(t)}</label>`).join('')}</div></div>`;
      return `<label class="f"><span>${esc(q.text)}</span><select class="in" data-q="${q.id}">${q.options.map(([k, t]) => `<option value="${k}" ${String(v) === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
    }).join('')}
    ${GUIDE_CTX.userId ? '<label class="row small"><input type="checkbox" id="g-save-profile" checked> Gem niveau og trin i brugerens atletprofil</label>' : ''}
    <button class="btn pri mt" type="submit">Lav forslag</button></form>`;
}
function readGuideForm() {
  const a = {};
  for (const q of GUIDE.QUESTIONS) {
    const els = [...document.querySelectorAll(`#modal [data-q="${q.id}"]`)];
    a[q.id] = q.type === 'multi' ? els.filter(e => e.checked).map(e => e.value) : q.type === 'number' ? (num(els[0].value) || 0) : els[0].value;
  }
  return a;
}
function openGuide(ctx) {
  GUIDE_CTX = ctx;
  openModal('Programguide', guideForm(GUIDE.defaults(ctx.athlete)));
}
// Chips toggle visually together with their hidden checkbox
document.addEventListener('change', e => { if (e.target.matches('#modal .chip input')) e.target.parentElement.classList.toggle('on', e.target.checked); });

SUBMITS.runGuide = () => {
  const answers = readGuideForm(), r = GUIDE.build(answers);
  const saveProfile = !!(document.getElementById('g-save-profile') || {}).checked;
  GUIDE_PENDING = { result: r, answers, saveProfile };
  const tpl = TEMPLATES.find(t => t.id === r.tpl);
  $('#modal .body').innerHTML = `<h3 style="margin-top:0">Forslag: ${esc(tpl.name)} · ${LEVELS[r.level]} · ${r.days} dage</h3>
    ${r.warnings.map(w => `<div class="hint err small" style="margin-bottom:8px">${esc(w)}</div>`).join('')}
    <ul class="small">${r.reasons.map(x => `<li>${esc(x)}</li>`).join('')}${r.adjustments.map(x => `<li><b>${esc(x)}</b></li>`).join('')}</ul>
    <div class="small muted">${r.program.days.map(d => `<div><b>${esc(d.name)}:</b> ${d.items.map(it => esc(exName(it.ex))).join(', ') || '–'}</div>`).join('')}</div>
    <div class="row mt2"><button class="btn pri" data-a="useGuide">${GUIDE_CTX.userId ? 'Byg programmet' : 'Byg skabelonen'}</button>
      <button class="btn ghost" data-a="guideBack">Ret svarene</button></div>`;
};
ACTIONS.guideBack = () => { $('#modal .body').innerHTML = guideForm(GUIDE_PENDING.answers); };
ACTIONS.useGuide = async () => {
  const { result, saveProfile } = GUIDE_PENDING;
  if (GUIDE_CTX.userId && saveProfile) {
    try {
      const old = GUIDE_CTX.athlete || {};
      await API.put(`/users/${GUIDE_CTX.userId}/athlete`, { level: result.level, tree_levels: result.trees, goals: old.goals || null, notes: old.notes || null });
    } catch (e) { toast('Profilen blev ikke gemt: ' + e.message, 5000); }
  }
  closeModal();
  go(GUIDE_CTX.userId ? `#/program/new?user=${GUIDE_CTX.userId}&guide=1` : '#/template/new?guide=1');
};
ACTIONS.openGuideUser = async el => {
  const d = await API.get('/users/' + el.dataset.id);
  openGuide({ userId: el.dataset.id, athlete: d.athlete });
};
ACTIONS.openGuideTemplate = () => openGuide({ template: true });
