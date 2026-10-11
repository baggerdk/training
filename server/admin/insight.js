// Trainer insight on the user page: activity per week, records, max tests, 1RM and the workout history.
// Read-only – the data comes from the user's own logging in the app (GET /users/:id/insight and /sessions).
'use strict';

const TEST_NAMES = {
  pullup: ['Maks pull-ups', 'reps'], chinup: ['Maks chin-ups', 'reps'], pushup: ['Maks push-ups', 'reps'],
  dip: ['Maks dips', 'reps'], muscleup: ['Maks muscle-ups', 'reps'], hspu: ['Maks HSPU', 'reps'],
  plank: ['Planke', 's'], lsit: ['L-sit', 's'], hang: ['Dead hang', 's'],
  rm_squat: ['1RM Squat', 'kg'], rm_bench: ['1RM Bænkpres', 'kg'], rm_deadlift: ['1RM Dødløft', 'kg'], rm_ohp: ['1RM Militærpres', 'kg'],
};
const BLOCK_NAMES = { ladder: 'Ladder', emom: 'EMOM', amrap: 'AMRAP', tabata: 'Tabata' };

// State of the history list on the open user page (for "Vis flere")
const INSIGHT = { userId: null, sessions: [], more: false, custom: {}, open: new Set() };

const insName = id => INSIGHT.custom[id] || exName(id);
const toNum = v => (v == null ? null : Number(v));

function insSetText(s) {
  if (!s) return '';
  let t = s.t ? `${esc(s.t)} s` : `${esc(s.r || 0)}${s.kg ? ' × ' + fmt(Number(s.kg) || 0) + ' kg' : ''}`;
  if (s.rpe) t += ` <span class="dim">@${esc(s.rpe)}</span>`;
  return t;
}

function itemText(it) {
  if (it.block) {
    const r = it.result || {};
    const res = r.rounds != null ? `${esc(r.rounds)} runder` : r.reps != null ? `${esc(r.reps)} reps` : r.done ? 'udført' : 'ikke udført';
    return `${BLOCK_NAMES[it.block.kind] || 'Blok'}: ${res}`;
  }
  const done = (it.sets || []).filter(s => s && (s.r || s.t || s.kg));
  return done.length ? done.map(insSetText).join(' · ') : '<span class="dim">ingen sæt logget</span>';
}

function sessionRow(s) {
  const d = s.data || {}, items = d.items || [], open = INSIGHT.open.has(s.id);
  const mins = d.dur > 0 ? Math.round(d.dur / 60000) + ' min' : '';
  const sets = items.reduce((n, it) => n + (it.sets || []).filter(x => x && (x.r || x.t)).length, 0);
  let h = `<tr class="tap" data-a="toggleSession" data-id="${esc(s.id)}"><td style="width:110px">${dkDate(s.started_at)}</td>
    <td><b>${esc(s.name || 'Træning')}</b><div class="xs muted">${s.program_name ? esc(s.program_name) + ' · ' : ''}${s.week_index != null ? 'uge ' + (s.week_index + 1) + ' · ' : ''}${items.length} øvelser · ${sets} sæt</div></td>
    <td class="small muted" style="text-align:right">${mins} ${open ? '▴' : '▾'}</td></tr>`;
  if (open) {
    h += `<tr><td></td><td colspan="2"><table class="list">${items.map(it => `<tr><td class="small" style="width:40%">${esc(insName(it.ex))}${it.circuit ? ` <span class="xs dim">+ ${it.circuit.map(c => esc(insName(c.ex))).join(', ')}</span>` : ''}</td>
      <td class="small">${itemText(it)}</td></tr>`).join('')}</table></td></tr>`;
  }
  return h;
}

function weeksChart(weeks) {
  // The last 12 weeks, also those without workouts (monday = start of the week, as date_trunc on the server)
  const counts = Object.fromEntries(weeks.map(w => [w.week, w.workouts]));
  const monday = new Date(); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const cols = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(monday); d.setDate(d.getDate() - 7 * i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    cols.push({ key, n: counts[key] || 0, label: d.toLocaleDateString('da-DK', { day: 'numeric', month: 'numeric' }) });
  }
  const max = Math.max(1, ...cols.map(c => c.n));
  return `<div class="weeks">${cols.map(c => `<div class="wk" title="Uge fra ${c.label}: ${c.n} træninger">
    <span class="xs">${c.n || ''}</span><i style="height:${Math.round(c.n / max * 100)}%"></i><span class="xs dim">${c.label}</span></div>`).join('')}</div>`;
}

function recordText(r) {
  const parts = [];
  if (toNum(r.kg)) parts.push(`${fmt(toNum(r.kg))} kg` + (toNum(r.e1rm) ? ` <span class="dim">(e1RM ${fmt(toNum(r.e1rm))})</span>` : ''));
  if (toNum(r.reps)) parts.push(`${r.reps} reps`);
  if (toNum(r.seconds)) parts.push(`${r.seconds} s`);
  return parts.join(' · ') || '–';
}

function testsCard(tests, maxes) {
  const byKey = {};
  for (const t of tests) (byKey[t.test_key] = byKey[t.test_key] || []).push(t);
  const rows = Object.entries(byKey).map(([k, list]) => {
    const last = list[list.length - 1], prev = list[list.length - 2];
    const [name, unit] = TEST_NAMES[k] || [k, last.unit];
    const diff = prev ? toNum(last.value) - toNum(prev.value) : 0;
    return `<tr><td>${esc(name)}</td><td><b>${fmt(toNum(last.value))} ${esc(unit)}</b>${diff ? ` <span class="badge ${diff > 0 ? 'rec' : 'off'}">${diff > 0 ? '+' : ''}${fmt(diff)}</span>` : ''}</td>
      <td class="small muted" style="text-align:right">${dkDate(last.tested_at)}${list.length > 1 ? ` · ${list.length} tests` : ''}</td></tr>`;
  }).join('');
  const rm = maxes.map(m => `<span class="badge">${esc(LIFTS[m.lift_key] || m.lift_key)} ${fmt(toNum(m.one_rm_kg))} kg</span>`).join(' ');
  return `<div class="card"><h3>Maks-tests og 1RM</h3>
    ${rows ? `<table class="list">${rows}</table>` : '<p class="muted small">Ingen maks-tests endnu.</p>'}
    ${rm ? `<div class="row wrap mt">${rm}</div>` : ''}</div>`;
}

// The whole section; called from VIEWS.user
async function insightSection(userId) {
  const [ins, page] = await Promise.all([API.get(`/users/${userId}/insight`), API.get(`/users/${userId}/sessions?limit=20`)]);
  Object.assign(INSIGHT, { userId, sessions: page.sessions, more: page.more, open: new Set(),
    custom: Object.fromEntries(ins.custom.filter(c => c.name).map(c => [c.exercise_id, c.name])) });
  const records = ins.records.filter(r => toNum(r.kg) || toNum(r.reps) || toNum(r.seconds));
  return `<h2 class="mt2">Træning</h2>
    <div class="grid2"><div class="card"><h3>Træninger pr. uge</h3>${weeksChart(ins.weeks)}</div>${testsCard(ins.tests, ins.maxes)}</div>
    <div class="card"><h3>Rekorder</h3>${records.length ? `<table class="list"><tr><th>Øvelse</th><th>Bedste</th><th style="text-align:right">Sæt · senest</th></tr>
      ${records.map(r => `<tr><td>${esc(insName(r.exercise_id))}</td><td>${recordText(r)}</td>
        <td class="small muted" style="text-align:right">${r.sets} · ${dkDate(r.last_at)}</td></tr>`).join('')}</table>`
      : '<p class="muted small">Ingen loggede sæt endnu. Rekorder vises, når brugeren har trænet med appen.</p>'}</div>
    <div class="card"><h3>Historik</h3><div id="ins-history">${historyHtml()}</div></div>`;
}

function historyHtml() {
  if (!INSIGHT.sessions.length) return '<p class="muted small">Ingen træninger endnu.</p>';
  return `<table class="list">${INSIGHT.sessions.map(sessionRow).join('')}</table>
    ${INSIGHT.more ? '<button class="btn mt" data-a="moreSessions">Vis flere</button>' : ''}`;
}
const redrawHistory = () => { const el = $('#ins-history'); if (el) el.innerHTML = historyHtml(); };

ACTIONS.toggleSession = el => {
  const id = el.dataset.id;
  if (INSIGHT.open.has(id)) INSIGHT.open.delete(id); else INSIGHT.open.add(id);
  redrawHistory();
};
ACTIONS.moreSessions = async () => {
  const last = INSIGHT.sessions[INSIGHT.sessions.length - 1];
  try {
    const page = await API.get(`/users/${INSIGHT.userId}/sessions?limit=20&before=${encodeURIComponent(last.started_at)}`);
    INSIGHT.sessions.push(...page.sessions); INSIGHT.more = page.more;
    redrawHistory();
  } catch (e) { toast(e.message, 5000); }
};
