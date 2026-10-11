// power-krop – træningsapp (Android-app og PWA). Data gemmes lokalt i IndexedDB (js/store.js), én database pr. bruger.
'use strict';

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };
const fmt = n => (Math.round(n * 10) / 10).toString().replace('.', ',');
const mmss = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const dk = ts => new Date(ts).toLocaleDateString('da-DK', { day: 'numeric', month: 'short' });
const dkFull = ts => new Date(ts).toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const clone = o => JSON.parse(JSON.stringify(o));

function defaults() {
  return {
    v: FORMAT_VERSION, programs: [], activeProg: null, logs: [], tests: [], customEx: [], videos: {},
    rm: { squat: 0, bench: 0, deadlift: 0, ohp: 0 },
    settings: { tmPct: 90, inc: 2.5, rest: 120, sound: true, vibrate: true, wake: true, auto: true },
    active: null
  };
}
function withDefaults(s) {
  const d = defaults(), out = Object.assign(d, s);
  out.settings = Object.assign(defaults().settings, s && s.settings);
  out.rm = Object.assign(defaults().rm, s && s.rm);
  return out;
}

// ---------- Lagring ----------
// S is the in-memory working copy. save() writes the changes to IndexedDB shortly after (debounced),
// and right away when the app is hidden or closed, so a logged set is not lost if Android kills the app.
let S = defaults();
const STORE = createStore();
let STORE_KEY = null;      // the user whose database is open ('local' = no account, the PWA on GitHub Pages)
let saveTimer = null, saveChain = Promise.resolve();
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 150);
  // During a workout every logged set saves; syncing that often costs battery and CPU for nothing.
  // The finished workout is sent right away (finishWorkout).
  scheduleSync(S.active ? 60000 : 3000);
}

// ---------- Synkronisering ----------
// Never blocks the UI or training: it runs in the background and the app keeps working offline.
const SYNC = createSync({
  store: STORE,
  api: (path, opts) => AUTH.api(path, opts),
  getState: () => S,
  userId: () => (STORE_KEY && STORE_KEY !== 'local' ? STORE_KEY : null),
  generation: () => STORE.generation,
  // Must reject if S could not be saved – the engine then leaves its snapshot alone
  onStateChanged: async info => { clearTimeout(saveTimer); await STORE.persist(S); if (info && info.pulled) softRender(); },
});
let syncTimer = null;
function scheduleSync(delay) {
  if (!STORE_KEY || STORE_KEY === 'local' || updateRequired()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => SYNC.run(), delay || 0);
}
// ---------- Opdateringstjek ----------
// GET /app/version (no login), at most once an hour. A newer APK shows a card with a download link. Below
// minSupportedVersionCode the server may no longer understand this app's data, so sync pauses – training never does.
const UPDATE = { info: null, latest: null, checked: 0 };
async function checkUpdate() {
  if (!PLATFORM.native || Date.now() - UPDATE.checked < 3600e3) return;
  UPDATE.checked = Date.now();
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    if (!UPDATE.info) UPDATE.info = await PLATFORM.appInfo();
    const r = await fetch(API_BASE_URL + '/app/version', { cache: 'no-store', signal: ctrl.signal });
    if (!r.ok) throw new Error('http ' + r.status);
    const v = await r.json();
    if (typeof v.versionCode !== 'number') return;
    const wasRequired = updateRequired();
    UPDATE.latest = v;
    if (wasRequired && !updateRequired()) scheduleSync(0);
    softRender();
  } catch (e) {
    UPDATE.checked = Date.now() - 3300e3;   // offline: try again in 5 minutes
  } finally { clearTimeout(timer); }
}
function updateAvailable() { return !!(UPDATE.info && UPDATE.latest && UPDATE.latest.versionCode > UPDATE.info.versionCode); }
function updateRequired() { return !!(UPDATE.info && UPDATE.latest && UPDATE.info.versionCode < (UPDATE.latest.minSupportedVersionCode || 0)); }
function updateCard() {
  if (!updateAvailable()) return '';
  const req = updateRequired();
  return `<div class="card hero"><b>Ny version tilgængelig: ${esc(UPDATE.latest.versionName)}</b>
    <p class="small muted">${req ? 'Din version er for gammel til at synkronisere. Du kan stadig træne, og dine data gemmes på telefonen, indtil du har opdateret.'
      : 'Du har version ' + esc(UPDATE.info.versionName) + '. Dine data bevares, når du installerer den nye version oven på den gamle.'}</p>
    <button class="btn pri block" data-a="getUpdate">Hent opdateringen</button></div>`;
}

// Re-render after pulled changes, unless the user is typing or has a sheet open
function softRender() {
  if (SHEET || (document.activeElement && document.activeElement.matches('input,select,textarea'))) return;
  render();
}
let lastRejected = 0;
SYNC.onStatus(st => {
  if (st.rejected.length > lastRejected) {
    toast('En ændring blev afvist af serveren: ' + st.rejected[st.rejected.length - 1].message, 5000);
    lastRejected = st.rejected.length;
  }
  if (st.state === 'ok' && st.pending === 0) forgetSyncedLegacyData();
  if ((ROUTE[0] || '') === 'settings') softRender();
});
PLATFORM.onNetworkChange(online => { if (online) scheduleSync(1000); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSync(500); });
setInterval(() => { if (document.visibilityState === 'visible') scheduleSync(0); }, 5 * 60 * 1000);

// The old localStorage copy is deleted once the data it was moved into is safely on the server
function forgetSyncedLegacyData() {
  try {
    if (localStorage.getItem('powerkrop-legacy-moved') === STORE_KEY && localStorage.getItem(LEGACY_KEY)) {
      localStorage.removeItem(LEGACY_KEY);
    }
  } catch (e) { }
}

function syncStatusText(st) {
  const time = st.lastSync ? new Date(st.lastSync).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' }) : '';
  if (st.state === 'syncing') return '🔄 Synkroniserer…';
  const n = st.pending + (st.pending === 1 ? ' ændring venter og sendes' : ' ændringer venter og sendes');
  if (st.state === 'offline') return `📴 Offline – ${st.pending ? n : 'prøver igen'}, når du er online`;
  if (st.state === 'error') return '⚠️ Kunne ikke synkronisere: ' + esc(st.error || 'ukendt fejl');
  if (st.pending) return `⏳ Venter: ${st.pending} ændring${st.pending === 1 ? '' : 'er'}`;
  if (st.lastSync) return '✅ Synkroniseret kl. ' + time;
  return '⏳ Ikke synkroniseret endnu';
}
function flushSave() {
  clearTimeout(saveTimer); saveTimer = null;
  if (!STORE.isOpen) return saveChain;
  saveChain = STORE.persist(S).catch(e => { console.error('Gem fejlede', e); toast('Kunne ikke gemme – prøv igen'); });
  return saveChain;
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
window.addEventListener('pagehide', flushSave);

// Opens the current user's database and loads it into S. Called at start-up and when the user changes.
async function boot() {
  const key = AUTH.profile ? AUTH.profile.id : (AUTH.required ? null : 'local');
  if (key === STORE_KEY && STORE.isOpen) return;
  if (STORE.isOpen) await flushSave();
  STORE.close(); STORE_KEY = null; S = defaults();
  if (key) {
    try {
      await STORE.open('powerkrop-' + key);
      S = withDefaults(await STORE.load(defaults()));
      STORE_KEY = key;
      await adoptLegacyData();
    } catch (e) {
      console.error('Kunne ikke åbne databasen', e);
      toast('Kunne ikke indlæse dine data – genstart appen', 5000);
    }
  }
  SYNC.reset(); lastRejected = 0;
  scheduleSync(0);
  if (S.active) wake();
  render(true);
}

// Data from before login/IndexedDB (localStorage 'stalkrop-v1') is moved once to the first account that wants it.
// The localStorage copy is left untouched as a safety net until synchronisation is confirmed (phase 8/9).
async function adoptLegacyData() {
  const FLAG = 'powerkrop-legacy-moved';
  let raw = null, moved = null;
  try { raw = localStorage.getItem(LEGACY_KEY); moved = localStorage.getItem(FLAG); } catch (e) { return; }
  if (!raw || moved || !(await STORE.isEmpty())) return;
  let legacy;
  try { legacy = migrateLegacyState(JSON.parse(raw)); legacy.programs = legacy.programs.map(sanitizeProgram); } catch (e) { return; }
  if (!legacy.programs.length && !legacy.logs.length && !legacy.tests.length) return;
  const who = AUTH.profile ? ' (' + AUTH.profile.display_name + ')' : '';
  const ask = STORE_KEY !== 'local';
  const yes = !ask || confirm(`Der ligger ${legacy.programs.length} programmer og ${legacy.logs.length} træninger på telefonen fra før du loggede ind.\n\nVil du flytte dem til din konto${who}?`);
  try { localStorage.setItem(FLAG, yes ? STORE_KEY : 'declined'); } catch (e) { }
  if (!yes) return;
  S = withDefaults(Object.assign(legacy, { active: legacy.active || null }));
  await flushSave();
  toast('Dine data er flyttet til din konto');
}

// ---------- Fælles UI ----------
function toast(msg, ms) {
  let el = $('#toast'); if (el) el.remove();
  el = document.createElement('div'); el.id = 'toast'; el.textContent = msg; document.body.appendChild(el);
  setTimeout(() => el.remove(), ms || 2600);
}
function thumb(ex, cls) {
  if (ex && ex.img) return `<img class="thumb ${cls || ''}" loading="lazy" src="img/ex/${ex.img}/0.jpg" alt="">`;
  const ini = ex ? ex.n.replace(/[^A-Za-zÆØÅæøå ]/g, '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() : '?';
  return `<div class="thumb ph ${cls || ''}">${esc(ini)}</div>`;
}
function exName(id) { const e = exById(id); return e ? e.n : id; }
function allEx() { return EXERCISES.concat(S.customEx); }

let SHEET = null;
function openSheet(fn) { SHEET = fn; renderSheet(); }
function renderSheet() {
  let bg = $('#sheet-bg'), sh = $('#sheet');
  if (!SHEET) { bg && bg.remove(); sh && sh.remove(); return; }
  if (!bg) {
    bg = document.createElement('div'); bg.id = 'sheet-bg'; bg.dataset.a = 'closeSheet'; document.body.appendChild(bg);
    sh = document.createElement('div'); sh.id = 'sheet'; document.body.appendChild(sh);
  }
  const st = sh.scrollTop;
  sh.innerHTML = '<div class="grab"></div>' + SHEET();
  sh.scrollTop = st;
}
function closeSheet() { SHEET = null; renderSheet(); }

// ---------- Lyd, vibration, skærmlås ----------
let AC = null;
function beep(f, d, n) {
  if (!S.settings.sound) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
    for (let i = 0; i < (n || 1); i++) {
      const o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime + i * ((d || .15) + .09);
      o.frequency.value = f || 880; o.connect(g); g.connect(AC.destination);
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.45, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + (d || .15));
      o.start(t); o.stop(t + (d || .15) + .02);
    }
  } catch (e) { }
}
function buzz(p) { if (S.settings.vibrate) PLATFORM.vibrate(p); }
function wake() { if (S.settings.wake && S.active) PLATFORM.keepAwake(true); }
function unwake() { PLATFORM.keepAwake(false); }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { PLATFORM.cancelRestAlarm(); PLATFORM.cancelIntervalAlarms(); if (S.active) wake(); return; }
  // In the background the JS timers stop beeping, so the app hands the end of the rest – and an interval timer's
  // phase changes – over to system notifications
  if (REST && !REST.fired && REST.end > Date.now()) PLATFORM.scheduleRestAlarm(REST.end, 'Pausen er slut', 'Klar til næste sæt 💪');
  if (IT) PLATFORM.scheduleIntervalAlarms(intervalAlarms(IT, Date.now()));
});

// ---------- Beregninger ----------
// Calculations live in js/progression.js (pure, tested); these wrappers pass the current state
function tmFor(lift) { return PROG.tmFor(S, lift); }
function roundInc(x) { return PROG.roundInc(S, x); }
function kgFor(lift, pct) { return PROG.kgFor(S, lift, pct); }
const e1 = PROG.e1;

function tgtText(s, lift) {
  if (s.pct) {
    const kg = lift ? kgFor(lift, s.pct) : null;
    return `${fmt(s.pct)} %${kg ? ' · ' + fmt(kg) + ' kg' : ''} × ${s.r}${s.amrap ? '+' : ''}`;
  }
  if (s.t) return `${s.t}${s.tMax ? '–' + s.tMax : ''} s${s.kg ? ' · +' + fmt(s.kg) + ' kg' : ''}`;
  if (s.amrap && s.r <= 1) return 'Maks reps';
  return `${s.r || '?'}${s.rMax ? '–' + s.rMax : ''}${s.amrap ? '+' : ''} reps${s.kg ? ' · ' + fmt(s.kg) + ' kg' : ''}${s.rpe ? ' @' + s.rpe : ''}`;
}
function blockText(b, it) {
  if (!b) return '';
  if (b.kind === 'ladder') return `Ladder 1→${b.top}${b.down ? '→1' : ''} × ${b.rounds} · pause ${b.rest}s`;
  if (b.kind === 'emom') return `EMOM ${b.min} min · ${b.reps} reps hvert minut`;
  if (b.kind === 'amrap') return `AMRAP ${b.min} min` + (it && it.circuit ? ': ' + it.circuit.map(c => c.r + ' ' + exName(c.ex)).join(' / ') : '');
  if (b.kind === 'tabata') return `Tabata ${b.rounds} × ${b.work}s/${b.rest}s`;
  return '';
}
function itemSummary(it, week, prog) {
  if (it.block) return blockText(it.block, it);
  const t = targetsFor(it, week || 0, prog);
  if (!t.length) return 'Ingen sæt';
  const txt = t.map(s => tgtText(s, it.lift));
  const same = txt.every(x => x === txt[0]);
  return same ? `${t.length} × ${txt[0]}` : txt.join(', ');
}

// Sidste præstation og automatisk progression (dobbelt progression): se js/progression.js
function lastPerf(exId) { return PROG.lastPerf(S, exId); }
function suggest(exId, tgts, lift, noAuto) { return PROG.suggest(S, exId, tgts, lift, noAuto); }

// ---------- Træning ----------
function mkActiveItem(it, week, prog) {
  const a = { id: uid(), src: it.id, auto: !prog || prog.auto !== false, opts: [it.ex].concat((it.alts || []).filter(x => x !== it.ex)), ex: it.ex, alts: (it.alts || []).slice(), block: it.block ? clone(it.block) : null, circuit: it.circuit ? clone(it.circuit) : null, note: it.note || '', lift: it.lift || null, sets: [], result: null };
  if (!a.block) fillSets(a, targetsFor(it, week, prog));
  return a;
}
function fillSets(a, tgts) {
  const sug = suggest(a.ex, tgts, a.lift, a.auto === false);
  a.sets = tgts.map((t, i) => ({ tgt: t, r: sug.vals[i].r, kg: sug.vals[i].kg, t: sug.vals[i].t, rpe: '', done: false }));
  a.hint = sug.hint;
}
function startWorkout(pid, week, day) {
  const p = S.programs.find(x => x.id === pid);
  if (!p) { S.active = { progId: null, name: 'Fri træning', start: Date.now(), items: [] }; }
  else {
    const d = p.days[day];
    S.active = { progId: p.id, week, day, name: d.name, start: Date.now(), items: d.items.map(it => mkActiveItem(it, week, p)) };
  }
  save(); wake(); PLATFORM.ensureChannel(); go('#/workout');
}

let REST = null;
function startRest(sec) {
  if (!sec) return;
  REST = { end: Date.now() + sec * 1000, total: sec, last: null, fired: false };
  const el = $('#rest');
  el.innerHTML = `<div class="grow"><div class="xs muted">PAUSE</div><div class="t">0:00</div></div>
    <button class="btn sm" data-a="restAdd" data-v="-15">−15</button><button class="btn sm" data-a="restAdd" data-v="15">+15</button>
    <button class="btn sm pri" data-a="restSkip">Videre</button><div class="bar"></div>`;
  el.classList.remove('hidden', 'ready');
  tickRest();
}
function tickRest() {
  const el = $('#rest');
  if (!REST) { el.classList.add('hidden'); return; }
  const left = Math.ceil((REST.end - Date.now()) / 1000);
  if (left !== REST.last) {
    REST.last = left;
    if (left > 0 && left <= 3) beep(660, .08);
    if (left <= 0 && !REST.fired) { REST.fired = true; beep(990, .2, 3); buzz([300, 120, 300]); el.classList.add('ready'); }
    if (left < -30) { REST = null; el.classList.add('hidden'); return; }
  }
  el.querySelector('.t').textContent = left > 0 ? mmss(left) : 'Klar!';
  el.querySelector('.bar').style.width = Math.max(0, Math.min(100, 100 * (1 - (REST.end - Date.now()) / 1000 / REST.total))) + '%';
}
setInterval(tickRest, 250);

// ---------- Intervaltimer (EMOM / AMRAP / Tabata / Ladder) ----------
let IT = null;
function openIT(idx) {
  const a = S.active.items[idx], b = a.block;
  IT = { idx, b, kind: b.kind, el: 0, running: false, t0: 0, rounds: 0, lastSec: null, pre: 10, done: false };
  if (b.kind === 'ladder') {
    const seq = [];
    for (let r = 0; r < b.rounds; r++) {
      for (let i = 1; i <= b.top; i++) seq.push(i);
      if (b.down) for (let i = b.top - 1; i >= 1; i--) seq.push(i);
    }
    Object.assign(IT, { seq, pos: 0, mode: 'work', restStart: 0, pre: 0 });
  }
  const ov = document.createElement('div'); ov.id = 'itimer';
  ov.innerHTML = `<div class="phase" id="it-ph"></div><div class="big" id="it-big"></div><div class="sub" id="it-sub"></div><div id="it-extra"></div>
    <div class="ctl" id="it-ctl"></div><button class="btn ghost mt2" data-a="itClose">Luk timer</button>`;
  document.body.appendChild(ov);
  itControls(); itTick();
  IT.iv = setInterval(itTick, 200);
}
function itControls() {
  const c = $('#it-ctl'); if (!c) return;
  if (IT.done) { c.innerHTML = `<button class="btn ok" data-a="itSave">Gem resultat</button>`; return; }
  if (IT.kind === 'ladder') {
    c.innerHTML = IT.mode === 'work'
      ? `<button class="btn ok" data-a="itRung">✓ Færdig</button>`
      : `<button class="btn" data-a="itSkipRest">Spring pause over</button>`;
    return;
  }
  const play = `<button class="btn ${IT.running ? '' : 'pri'}" data-a="itPlay">${IT.running ? 'Pause' : (IT.el > 0 ? 'Fortsæt' : 'Start')}</button>`;
  const extra = IT.kind === 'amrap' && IT.running && IT.el >= IT.pre ? `<button class="btn ok" data-a="itRound">+1 runde</button>` : '';
  c.innerHTML = play + extra + (IT.el > 0 ? `<button class="btn" data-a="itStop">Afslut</button>` : '');
}
function itElapsed() { return IT.running ? (Date.now() - IT.t0) / 1000 : IT.el; }
function itSetText(ph, big, sub, cls) {
  const ov = $('#itimer'); if (!ov) return;
  $('#it-ph').textContent = ph; $('#it-big').textContent = big; $('#it-sub').innerHTML = sub || '';
  ov.className = cls || '';
}
function itFinish() {
  IT.done = true; IT.running = false; beep(1200, .4, 2); buzz([500, 150, 500]);
  itControls();
}
function itTick() {
  if (!IT || IT.done) return;
  const b = IT.b, a = S.active.items[IT.idx], el = itElapsed();
  if (IT.running) IT.el = el;
  const exn = esc(exName(a.ex));
  const secBeep = (s, longAt) => { if (s !== IT.lastSec) { IT.lastSec = s; if (s > 0 && s <= 3) beep(660, .08); if (s === longAt) { beep(990, .3); buzz(200); } } };
  if (IT.kind === 'ladder') {
    const total = IT.seq.reduce((x, y) => x + y, 0), doneReps = IT.seq.slice(0, IT.pos).reduce((x, y) => x + y, 0);
    const rung = IT.seq.map((n, i) => `<span class="${i < IT.pos ? 'd' : i === IT.pos ? 'c' : ''}">${n}</span>`).join('');
    $('#it-extra').innerHTML = `<div class="rung">${rung}</div>`;
    if (IT.mode === 'work') itSetText('Ladder – lav', IT.seq[IT.pos] + ' reps', `${exn}<br><span class="small">${doneReps}/${total} reps i alt</span>`, 'work');
    else {
      const left = b.rest - (Date.now() - IT.restStart) / 1000;
      secBeep(Math.ceil(left));
      if (left <= 0) { IT.mode = 'work'; beep(990, .25); buzz(250); itControls(); return itTick(); }
      itSetText('Pause', mmss(left), `Næste: ${IT.seq[IT.pos]} reps`, 'rest');
    }
    return;
  }
  if (el < IT.pre) {
    const s = Math.ceil(IT.pre - el); secBeep(s);
    itSetText(IT.running ? 'Gør klar' : 'Klar?', String(s), esc(blockText(b, a)), 'rest');   // #it-sub is innerHTML
    return;
  }
  const t = el - IT.pre;
  if (IT.kind === 'emom') {
    const m = Math.floor(t / 60);
    if (m >= b.min) return itFinish(itSetText('Færdig!', b.min + ' runder', `${b.min * b.reps} reps i alt`, 'work'));
    const left = 60 - (t % 60);
    if (IT.lastMin !== m) { IT.lastMin = m; beep(990, .35); buzz(250); }
    secBeep(Math.ceil(left));
    itSetText(`Minut ${m + 1} / ${esc(b.min)}`, mmss(left), `${esc(b.reps)} × ${exn}`, 'work');
  } else if (IT.kind === 'amrap') {
    const left = b.min * 60 - t;
    if (left <= 0) return itFinish(itSetText('Tiden er gået!', IT.rounds + ' runder', 'Godt kæmpet', 'work'));
    if (!IT.started) { IT.started = true; beep(990, .35); itControls(); }
    secBeep(Math.ceil(left));
    const circ = a.circuit ? a.circuit.map(c => `${esc(c.r)} × ${esc(exName(c.ex))}`).join('<br>') : exn;
    itSetText(`Runder: ${IT.rounds}`, mmss(left), circ, 'work');
  } else if (IT.kind === 'tabata') {
    const cyc = b.work + b.rest, k = Math.floor(t / cyc);
    if (k >= b.rounds) return itFinish(itSetText('Færdig!', b.rounds + ' runder', '', 'work'));
    const inC = t % cyc, work = inC < b.work;
    const left = work ? b.work - inC : cyc - inC;
    const ph = (work ? 'Arbejd' : 'Hvil') + ` · ${k + 1}/${b.rounds}`;
    if (IT.lastPh !== ph) { IT.lastPh = ph; beep(work ? 990 : 550, .3); buzz(work ? 300 : 120); }
    secBeep(Math.ceil(left));
    itSetText(ph, mmss(left), exn, work ? 'work' : 'rest');
  }
}
function itCloseUI() { if (IT) clearInterval(IT.iv); IT = null; const o = $('#itimer'); o && o.remove(); }

// ---------- Router ----------
let ROUTE = [];
function go(h) { if (location.hash === h) render(); else location.hash = h; }
let KEEPSHEET = false;
window.addEventListener('hashchange', () => { if (KEEPSHEET) KEEPSHEET = false; else closeSheet(); render(true); });
const PUBLIC_VIEWS = ['login', 'invite'];
function render(top) {
  const h = (location.hash || '#/').slice(2);
  ROUTE = h.split('/').filter(Boolean).map(decodeURIComponent);
  let v = ROUTE[0] || 'home';
  // Login gate: without a session only the login and invite screens are shown (offline a saved session is enough)
  if (AUTH.required && !AUTH.loggedIn() && !PUBLIC_VIEWS.includes(v)) v = 'login';
  if (AUTH.loggedIn() && v === 'login') v = 'home';
  document.body.classList.toggle('noauth', PUBLIC_VIEWS.includes(v));
  const y = window.scrollY;
  const fn = VIEWS[v] || VIEWS.home;
  $('#app').innerHTML = fn();
  const tab = { home: 'home', workout: 'home', library: 'library', ex: 'library', programs: 'programs', prog: 'programs', stats: 'stats', settings: 'settings' }[v] || 'home';
  document.querySelectorAll('nav.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  if (top) window.scrollTo(0, 0); else window.scrollTo(0, y);
  if (v === 'ex') startAnim();
}
function topbar(title, back) {
  return `<div class="top">${back ? `<button class="back" data-a="back">‹</button>` : ''}<h1 class="grow">${esc(title)}</h1></div>`;
}

const VIEWS = {};

// ---------- HJEM ----------
VIEWS.home = () => {
  const p = S.programs.find(x => x.id === S.activeProg);
  let h = `<div class="top"><div class="grow"><div class="muted small">${esc(new Date().toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long' }))}</div><h1>power-krop</h1></div></div>` + updateCard();
  if (S.active) {
    h += `<div class="card hero"><div class="badge acc">I gang</div><h2 style="margin:8px 0 4px">${esc(S.active.name)}</h2>
      <div class="muted small">Startet ${new Date(S.active.start).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })}</div>
      <a class="btn pri block mt" href="#/workout">Fortsæt træning</a></div>`;
  }
  if (p) {
    const pos = clampPos(p), d = p.days[pos.day];
    h += `<div class="card ${S.active ? '' : 'hero'}">
      <div class="row between"><span class="badge">${esc(p.name)}</span><span class="small muted">Uge ${pos.week + 1}/${esc(p.weeks)}</span></div>
      <h2 style="margin:10px 0 2px">${esc(d.name)}</h2><div class="muted small">Dag ${pos.day + 1} af ${p.days.length}</div>
      <div class="list mt">${d.items.map(it => { const e = exById(it.ex); return `<div class="it" data-a="exInfo" data-id="${it.ex}">${thumb(e)}<div class="grow"><b>${esc(e ? e.n : it.ex)}</b><div class="small muted">${esc(itemSummary(it, pos.week, p))}</div></div></div>`; }).join('')}</div>
      ${S.active ? '' : `<button class="btn pri block mt" data-a="startNext">▶ Start træning</button>`}
      <button class="btn ghost block mt" data-a="pickDay">Vælg en anden dag/uge</button></div>`;
  } else {
    h += `<div class="card hero"><h2 style="margin-top:0">Kom i gang</h2><p class="muted">Vælg en skabelon – Military Calisthenics, Calisthenics Styrke, Skills, Powerløft eller Hybrid – og tilpas den til 2–6 dage om ugen.</p>
      <a class="btn pri block" href="#/programs">Vælg program</a></div>`;
  }
  const wk = weekStart(), thisWeek = S.logs.filter(l => l.date >= wk).length, last = S.logs[S.logs.length - 1];
  h += `<div class="kpis mt"><div class="kpi"><b>${thisWeek}</b><span>Denne uge</span></div><div class="kpi"><b>${S.logs.length}</b><span>Træninger i alt</span></div><div class="kpi"><b>${streak()}</b><span>Uger i træk</span></div></div>`;
  if (last) h += `<div class="card mt tap" data-a="go" data-h="#/stats/history"><div class="small muted">Seneste træning</div><b>${esc(last.name)}</b> <span class="muted small">· ${dkFull(last.date)} · ${Math.round(last.dur / 60000)} min</span></div>`;
  if (!S.active) h += `<div class="row mt"><button class="btn grow" data-a="freeWorkout">＋ Fri træning</button><button class="btn grow" data-a="newTest">Maks-test</button></div>`;
  return h;
};
function clampPos(p) {
  p.pos = p.pos || { week: 0, day: 0 };
  if (p.pos.day >= p.days.length) p.pos.day = 0;
  if (p.pos.week >= p.weeks) p.pos.week = 0;
  return p.pos;
}
function weekStart(ts) { const d = new Date(ts || Date.now()); const wd = (d.getDay() + 6) % 7; d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - wd); return d.getTime(); }
function streak() {
  if (!S.logs.length) return 0;
  const weeks = new Set(S.logs.map(l => weekStart(l.date)));
  let w = weekStart(), n = 0;
  if (!weeks.has(w)) w -= 7 * 864e5;
  while (weeks.has(w)) { n++; w = weekStart(w - 3 * 864e5); }
  return n;
}

// ---------- TRÆNING ----------
VIEWS.workout = () => {
  const A = S.active;
  if (!A) return topbar('Træning') + `<div class="empty">Ingen aktiv træning.<br><br><a class="btn pri" href="#/">Til forsiden</a></div>`;
  const mins = Math.floor((Date.now() - A.start) / 60000);
  let h = `<div class="top"><div class="grow"><div class="small muted">${A.progId ? 'Uge ' + (A.week + 1) + ' · ' : ''}${mins} min</div><h1>${esc(A.name)}</h1></div>
    <button class="btn ok sm" data-a="finish">Afslut</button></div>`;
  A.items.forEach((a, i) => { h += workoutItem(a, i); });
  h += `<button class="btn block" data-a="addExWorkout">＋ Tilføj øvelse</button>
    <button class="btn danger ghost block mt" data-a="discard">Kassér træning</button>`;
  return h;
};
function workoutItem(a, i) {
  const e = exById(a.ex) || { n: a.ex, type: 'reps' };
  const allDone = a.block ? (a.result && a.result.done) : (a.sets.length && a.sets.every(s => s.done));
  const isTime = e.type === 'time', showKg = e.type === 'weight' || e.w || a.sets.some(s => s.kg);
  let h = `<div class="ex-card ${allDone ? 'done' : ''}"><div class="ex-head">${thumb(e)}<div class="grow">
    <h3 data-a="exInfo" data-id="${e.id}">${esc(e.n)} <span class="dim small">ⓘ</span></h3>`;
  if (a.alts && a.alts.length) {
    const opts = a.opts || [a.ex].concat(a.alts.filter(x => x !== a.ex));
    h += `<select class="in mt" style="min-height:38px;padding:4px 8px" data-c="variant" data-i="${i}">${opts.map(id => `<option value="${id}" ${id === a.ex ? 'selected' : ''}>${esc(exName(id))}</option>`).join('')}</select>`;
  }
  h += `</div><button class="ib" data-a="wMove" data-i="${i}" data-d="-1">↑</button></div>`;
  if (a.note) h += `<div class="hint">${esc(a.note)}</div>`;
  if (a.hint) h += `<div class="hint ${a.hint.up ? 'up' : ''}">${a.hint.up ? '⬆ ' : '↗ '}${esc(a.hint.text)}${a.hint.up ? ` <button class="btn sm" data-a="stepUp" data-i="${i}">Skift nu</button>` : ''}</div>`;
  if (a.lift && !S.rm[a.lift]) h += `<div class="hint up">Angiv din 1RM i ${esc(LIFTS[a.lift])} under “Mere” for at beregne vægten. <a href="#/settings">Åbn</a></div>`;
  if (a.block) {
    const r = a.result || {};
    h += `<div class="hint">${esc(blockText(a.block, a))}</div>
      <div class="ex-foot"><button class="btn pri grow" data-a="openIT" data-i="${i}">⏱ Start ${a.block.kind.toUpperCase()}-timer</button></div>
      <div class="ex-foot"><label class="grow small muted">${a.block.kind === 'amrap' ? 'Runder' : 'Reps i alt'}<input class="in" inputmode="numeric" data-c="blockRes" data-i="${i}" value="${esc(a.block.kind === 'amrap' ? (r.rounds || '') : (r.reps || ''))}"></label>
      <button class="btn ${r.done ? 'ok' : ''}" style="align-self:end" data-a="blockDone" data-i="${i}">${r.done ? '✓ Udført' : 'Markér udført'}</button></div>`;
  } else {
    h += `<table class="sets"><tr><th style="text-align:left;padding-left:12px">Mål</th><th>${isTime ? 'Sek' : 'Reps'}</th>${showKg ? '<th>Kg</th>' : ''}<th>RPE</th><th></th></tr>`;
    a.sets.forEach((s, j) => {
      h += `<tr class="${s.done ? 'ok' : ''}"><td class="tg">${j + 1}. ${esc(tgtText(s.tgt, a.lift))}${s.tgt.deload ? ' <span class="badge info">deload</span>' : ''}</td>
        <td><input inputmode="numeric" data-c="setv" data-i="${i}" data-j="${j}" data-f="${isTime ? 't' : 'r'}" value="${esc(isTime ? s.t : s.r)}"></td>
        ${showKg ? `<td><input inputmode="decimal" data-c="setv" data-i="${i}" data-j="${j}" data-f="kg" value="${esc(s.kg)}"></td>` : ''}
        <td><input inputmode="decimal" data-c="setv" data-i="${i}" data-j="${j}" data-f="rpe" value="${esc(s.rpe)}" placeholder="–" style="max-width:52px"></td>
        <td><button class="chk" data-a="setDone" data-i="${i}" data-j="${j}">✓</button></td></tr>`;
    });
    h += `</table><div class="ex-foot"><button class="btn sm" data-a="addSet" data-i="${i}">＋ Sæt</button>${a.sets.length ? `<button class="btn sm" data-a="delSet" data-i="${i}">− Sæt</button>` : ''}
      ${isTime ? `<button class="btn sm" data-a="holdTimer" data-i="${i}">⏱ Hold-timer</button>` : ''}<span class="grow"></span><button class="btn sm ghost danger" data-a="wDel" data-i="${i}">Fjern</button></div>`;
  }
  return h + '</div>';
}

function finishWorkout() {
  const A = S.active;
  const items = A.items.map(a => ({
    ex: a.ex, lift: a.lift, block: a.block, circuit: a.circuit, result: a.result,
    sets: a.sets.filter(s => s.done).map(s => ({ tgt: s.tgt, r: num(s.r), kg: num(s.kg), t: num(s.t), rpe: num(s.rpe) }))
  })).filter(it => it.sets.length || (it.result && it.result.done));
  if (!items.length) { if (!confirm('Ingen sæt er markeret som udført. Afslut uden at gemme?')) return; S.active = null; save(); unwake(); go('#/'); return; }
  const prevBest = bests();
  const log = { id: newId(), date: Date.now(), start: A.start, dur: Date.now() - A.start, progId: A.progId, week: A.week, day: A.day, name: A.name, items };
  const prs = [], e1s = {};
  for (const it of items) {
    const b = prevBest[it.ex] || { reps: 0, kg: 0, e1: 0, t: 0 };
    let pr = null;
    for (const s of it.sets) {
      if (s.kg && e1(s.kg, s.r) > b.e1 && b.e1) pr = `${fmt(s.kg)} kg × ${s.r} (e1RM ${fmt(e1(s.kg, s.r))})`;
      else if (!s.kg && s.r > b.reps && b.reps) pr = `${s.r} reps`;
      else if (s.t > b.t && b.t) pr = `${s.t} s`;
      const lift = it.lift || (exById(it.ex) || {}).lift;
      if (lift && it.ex === liftMain(lift) && s.kg && s.r <= 10) e1s[lift] = Math.max(e1s[lift] || 0, e1(s.kg, s.r));
    }
    if (pr) prs.push(exName(it.ex) + ': ' + pr);
  }
  S.logs.push(log);
  let cycleMsg = '';
  const p = S.programs.find(x => x.id === A.progId);
  if (p && A.week === p.pos.week && A.day === p.pos.day) {
    p.pos.day++;
    if (p.pos.day >= p.days.length) { p.pos.day = 0; p.pos.week++; }
    if (p.pos.week >= p.weeks) {
      p.pos.week = 0;
      if (p.auto && S.settings.auto) {
        const lifts = new Set(); p.days.forEach(d => d.items.forEach(it => it.lift && it.wave && it.wave !== 'none' && lifts.add(it.lift)));
        lifts.forEach(l => { if (S.rm[l]) S.rm[l] += (l === 'squat' || l === 'deadlift') ? 5 : 2.5; });
        if (lifts.size) cycleMsg = 'Cyklus gennemført! 1RM er hævet automatisk (+5 kg ben, +2,5 kg overkrop).';
        else cycleMsg = 'Cyklus gennemført! God tid til en maks-test.';
      }
    }
  }
  S.active = null; REST = null; save(); unwake(); scheduleSync(500);   // send the workout right away
  const ups = Object.keys(e1s).filter(l => e1s[l] > (S.rm[l] || 0));
  openSheet(() => `<h2 style="margin-top:0">Træning gemt 💪</h2>
    <div class="kpis"><div class="kpi"><b>${Math.round(log.dur / 60000)}</b><span>Minutter</span></div><div class="kpi"><b>${items.reduce((n, it) => n + it.sets.length, 0)}</b><span>Sæt</span></div>
    <div class="kpi"><b>${fmt(items.reduce((n, it) => n + it.sets.reduce((m, s) => m + (s.kg || 0) * (s.r || 0), 0), 0))}</b><span>Kg løftet</span></div></div>
    ${prs.length ? `<h3 class="mt2">🏆 Nye rekorder</h3><ul class="cues">${prs.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${ups.length ? `<h3 class="mt2">Ny estimeret 1RM</h3>${ups.map(l => `<div class="row between mt"><span>${LIFTS[l]}: <b>${fmt(roundInc(e1s[l]))} kg</b> <span class="muted small">(nu ${fmt(S.rm[l] || 0)})</span></span><button class="btn sm pri" data-a="setRm" data-k="${l}" data-v="${roundInc(e1s[l])}">Opdatér</button></div>`).join('')}` : ''}
    ${cycleMsg ? `<div class="hint up mt2" style="margin:16px 0 0">${esc(cycleMsg)}</div>` : ''}
    <button class="btn pri block mt2" data-a="closeSheet">Færdig</button>`);
  KEEPSHEET = location.hash !== '#/'; go('#/');
}
function liftMain(l) { return { squat: 'back-squat', bench: 'bench', deadlift: 'deadlift', ohp: 'ohp' }[l]; }

// ---------- ØVELSER ----------
const LIB = { q: '', cat: 'all', tab: 'ex', eqOnly: true };
VIEWS.library = () => {
  let h = topbar('Øvelser');
  h += `<div class="chips mb"><button class="chip ${LIB.tab === 'ex' ? 'on' : ''}" data-a="libTab" data-v="ex">Alle øvelser</button><button class="chip ${LIB.tab === 'trees' ? 'on' : ''}" data-a="libTab" data-v="trees">Progressioner</button></div>`;
  if (LIB.tab === 'trees') {
    for (const k in TREES) {
      h += `<div class="card"><h3>${esc(TREES[k].n)}</h3><div class="tree mt">${TREES[k].steps.map((id, i) => `<a href="#/ex/${id}"><span class="dot">${i + 1}</span>${esc(exName(id))}</a>`).join('')}</div></div>`;
    }
    return h;
  }
  h += `<div class="search"><input class="in" type="search" placeholder="Søg øvelse, muskel…" data-in="libQ" value="${esc(LIB.q)}">
    <div class="chips mt">${[['all', 'Alle']].concat(Object.entries(CATS)).concat([['mine', 'Mine']]).map(([k, n]) => `<button class="chip ${LIB.cat === k ? 'on' : ''}" data-a="libCat" data-v="${k}">${n}</button>`).join('')}</div>
    ${myEquip() ? `<div class="toggle" style="border:0;padding-bottom:0"><span class="small">Kun øvelser med mit udstyr<div class="xs muted">${esc(equipName(myEquip()))} · <a href="#/settings">skift</a></div></span><div class="sw ${LIB.eqOnly ? 'on' : ''}" data-a="libEqOnly"></div></div>` : ''}</div>
    <div class="card list" id="liblist">${libList()}</div>
    <button class="btn block" data-a="newEx">＋ Opret egen øvelse</button>`;
  return h;
};
// ---------- Udstyr ----------
// S.settings.equip = the equipment the user has (keys of EQUIP); not set = everything (no filtering)
function myEquip() { const e = S.settings.equip; return Array.isArray(e) && e.length ? e : null; }
function equipName(eq) { const p = EQUIPMENT.presetOf(eq); return p ? p.n : 'Eget udstyr'; }
function toggleEquip(eq, k) { const s = new Set(eq); s.has(k) ? s.delete(k) : s.add(k); s.add('none'); return [...s]; }
// Presets as chips plus a checkbox per piece of equipment. prefix 'setupEq' (template sheet) or 'eq' (settings).
function equipPicker(eq, prefix) {
  const cur = EQUIPMENT.presetOf(eq);
  return `<div class="chips wrap">${EQUIPMENT.PRESETS.map(p => `<button class="chip ${cur && cur.id === p.id ? 'on' : ''}" data-a="${prefix}Preset" data-v="${p.id}">${esc(p.n)}</button>`).join('')}</div>
    <div class="small muted mt">${cur ? esc(cur.d) : 'Eget valg'}</div>
    <div class="chips wrap mt">${Object.entries(EQUIP).filter(([k]) => k !== 'none').map(([k, n]) => `<button class="chip ${eq.includes(k) ? 'on' : ''}" data-a="${prefix}Toggle" data-v="${k}">${eq.includes(k) ? '✓ ' : ''}${esc(n)}</button>`).join('')}</div>`;
}
// What the chosen equipment changes in the template, shown before the program is created
function setupEquipPreview() {
  const p = buildProgram(SETUP.tpl, SETUP.days, SETUP.L, SETUP.lv);
  const d = EQUIPMENT.describe(EQUIPMENT.adaptProgram(p, SETUP.eq));
  if (!d.lines.length && !d.removed.length) return '<div class="hint up mt">Alle øvelser kan laves med dit udstyr.</div>';
  const lines = [...new Set(d.lines)];
  let h = '<div class="hint mt">';
  if (lines.length) h += `<b>Skiftes ud:</b><br>${lines.map(esc).join('<br>')}`;
  if (d.removed.length) h += `${lines.length ? '<br><br>' : ''}<b>Fjernes</b> (kræver udstyr, du ikke har):<br>${d.removed.map(esc).join(', ')}`;
  const empty = p.days.filter(x => !x.items.length).length;
  if (empty) h += `<br><br>${empty} dag${empty === 1 ? '' : 'e'} bliver tom${empty === 1 ? '' : 'me'} – vælg en anden skabelon eller mere udstyr.`;
  return h + '</div>';
}
function libFilter(q, cat) {
  q = (q || '').toLowerCase();
  const eq = LIB.eqOnly ? myEquip() : null;
  return allEx().filter(e => (cat === 'all' || (cat === 'mine' ? e.custom : e.c === cat)) && (!eq || EQUIPMENT.canDo(e.id, eq)) &&
    (!q || (e.n + ' ' + (e.m || []).join(' ') + ' ' + CATS[e.c]).toLowerCase().includes(q)));
}
function libList() {
  const L = libFilter(LIB.q, LIB.cat);
  if (!L.length) return '<div class="empty">Ingen øvelser fundet</div>';
  return L.map(e => `<div class="it" data-a="go" data-h="#/ex/${e.id}">${thumb(e)}<div class="grow"><b>${esc(e.n)}</b><div class="small muted">${esc(CATS[e.c] || '')} · ${esc((e.eq || []).map(q => EQUIP[q]).join(', '))}</div></div><span class="dim">›</span></div>`).join('');
}

let ANIM = null;
function startAnim() { clearInterval(ANIM); ANIM = setInterval(() => { document.querySelectorAll('.anim:not(.ph)').forEach(a => a.classList.toggle('flip')); }, 1100); }
function animBlock(e) {
  if (e.img) return `<div class="anim"><img class="a" src="img/ex/${e.img}/0.jpg" alt="Startposition"><img class="b" src="img/ex/${e.img}/1.jpg" alt="Slutposition"></div>`;
  return `<div class="anim ph"><div class="center"><div style="font-size:3rem">🤸</div><div class="muted small">Intet billede – se videoen nedenfor</div></div></div>`;
}
function ytId(u) { const m = String(u || '').match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/); return m ? m[1] : null; }

VIEWS.ex = () => {
  const e = exById(ROUTE[1]);
  if (!e) return topbar('Ukendt øvelse', true);
  let h = topbar(e.n, true) + animBlock(e);
  h += `<div class="row wrap mt"><span class="badge acc">${esc(CATS[e.c])}</span>${(e.eq || []).map(q => `<span class="badge">${esc(EQUIP[q])}</span>`).join('')}<span class="badge">${e.type === 'time' ? 'Hold (tid)' : e.type === 'weight' ? 'Vægt' : 'Reps'}</span>${e.w ? '<span class="badge">Kan belastes</span>' : ''}</div>`;
  if (e.m && e.m.length) h += `<p class="muted small">Muskler: ${esc(e.m.join(', '))}</p>`;
  if (e.cues && e.cues.length) h += `<h2>Teknik</h2><ul class="cues">${e.cues.map(c => `<li>${esc(c)}</li>`).join('')}</ul>`;
  const tr = treeOf(e.id);
  if (tr) h += `<h2>Progression: ${esc(TREES[tr.key].n)}</h2><div class="card tree">${TREES[tr.key].steps.map((id, i) => `<a href="#/ex/${id}" class="${id === e.id ? 'cur' : ''}"><span class="dot">${i + 1}</span>${esc(exName(id))}</a>`).join('')}</div>`;
  const vid = ytId(S.videos[e.id] || e.video);
  h += `<h2>Video</h2>`;
  if (vid) h += `<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${vid}" allow="encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`;
  h += `<a class="btn block mt" target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=${encodeURIComponent(e.n + ' tutorial calisthenics')}">▶ Søg videoer på YouTube</a>
    <label class="f"><span>Gem din foretrukne video (indsæt YouTube-link)</span><input class="in" data-c="video" data-id="${e.id}" placeholder="https://youtu.be/…" value="${esc(S.videos[e.id] || '')}"></label>`;
  const b = bests()[e.id];
  if (b) {
    h += `<h2>Dine rekorder</h2><div class="kpis">${b.reps ? `<div class="kpi"><b>${b.reps}</b><span>Max reps</span></div>` : ''}${b.kg ? `<div class="kpi"><b>${fmt(b.kg)}</b><span>Max kg</span></div>` : ''}${b.e1 ? `<div class="kpi"><b>${fmt(b.e1)}</b><span>e1RM</span></div>` : ''}${b.t ? `<div class="kpi"><b>${b.t}s</b><span>Længste hold</span></div>` : ''}</div>`;
    h += `<div class="card mt">${lineChart(series(e.id, defaultMetric(e)), metricUnit(defaultMetric(e)))}</div>`;
  }
  h += `<button class="btn pri block mt2" data-a="addToProg" data-id="${e.id}">＋ Tilføj til program</button>`;
  if (e.custom) h += `<button class="btn danger ghost block mt" data-a="delEx" data-id="${e.id}">Slet egen øvelse</button>`;
  if (e.img) h += `<p class="xs dim mt2">Billeder: free-exercise-db (public domain).</p>`;
  return h;
};

// ---------- PROGRAMMER ----------
// A program a trainer/admin wrote for this user: usable, but only the author may change it (the server enforces it)
const fromTrainer = p => !!(p && p.author && AUTH.profile && p.author !== AUTH.profile.id);

VIEWS.programs = () => {
  let h = topbar('Programmer');
  const card = p => `<div class="card tap" data-a="go" data-h="#/prog/${p.id}"><div class="row between"><b>${esc(p.name)}</b>${p.id === S.activeProg ? '<span class="badge ok">Aktivt</span>' : ''}</div>
      <div class="small muted mt">${p.days.length} dage/uge · ${esc(p.weeks)} uger · ${p.auto ? 'auto-progression' : 'manuel'}</div></div>`;
  const shared = S.programs.filter(fromTrainer), own = S.programs.filter(p => !fromTrainer(p));
  if (shared.length) h += `<h2>Fra din træner</h2>` + shared.map(card).join('');
  h += `<h2>Mine programmer</h2>`;
  if (!own.length) h += `<div class="card empty">${shared.length ? 'Du har ingen egne programmer. Kopiér et fra din træner, eller vælg en skabelon nedenfor.' : 'Du har ingen programmer endnu. Vælg en skabelon nedenfor eller byg dit eget.'}</div>`;
  own.forEach(p => { h += card(p); });
  h += `<button class="btn block" data-a="newBlank">＋ Byg nyt program fra bunden</button>`;
  h += `<h2>Skabeloner</h2><p class="muted small" style="margin-top:-6px">Alle skabeloner kan køres 2–6 dage om ugen og tilpasses dit niveau.</p>`;
  TEMPLATES.forEach(t => {
    h += `<div class="card tap" data-a="tplSetup" data-id="${t.id}"><span class="badge acc">${esc(t.track)}</span><h3 class="mt">${esc(t.name)}</h3><p class="small muted" style="margin:6px 0 0">${esc(t.desc)}</p></div>`;
  });
  return h;
};

let SETUP = null;
function tplSetupSheet() {
  const t = TEMPLATES.find(x => x.id === SETUP.tpl), trees = templateTrees(t.id);
  let h = `<h2 style="margin-top:0">${esc(t.name)}</h2><p class="small muted">${esc(t.desc)}</p>
    <label class="f"><span>Dage om ugen</span></label><div class="chips">${[2, 3, 4, 5, 6].map(n => `<button class="chip ${SETUP.days === n ? 'on' : ''}" data-a="setupDays" data-v="${n}">${n} dage</button>`).join('')}</div>
    <div class="small muted mt">${t.sched[SETUP.days].map(k => esc(t.days[k].n)).join(' · ')}</div>
    <label class="f mt2"><span>Niveau</span></label><div class="chips">${LEVELS.map((n, i) => `<button class="chip ${SETUP.L === i ? 'on' : ''}" data-a="setupLvl" data-v="${i}">${n}</button>`).join('')}</div>
    <h3 class="mt2">Hvor træner du?</h3><p class="small muted" style="margin:4px 0">Øvelser, der kræver udstyr, du ikke har, skiftes ud eller fjernes.</p>${equipPicker(SETUP.eq, 'setupEq')}${setupEquipPreview()}`;
  if (trees.length) {
    h += `<h3 class="mt2">Startpunkt i progressionerne</h3><p class="small muted" style="margin:4px 0">Justér, så det passer til hvad du kan i dag.</p>`;
    trees.forEach(k => {
      h += `<label class="f"><span>${esc(TREES[k].n)}</span><select class="in" data-c="setupTree" data-k="${k}">${TREES[k].steps.map((id, i) => `<option value="${i}" ${SETUP.lv[k] === i ? 'selected' : ''}>${i + 1}. ${esc(exName(id))}</option>`).join('')}</select></label>`;
    });
  }
  if (t.pl) {
    h += `<h3 class="mt2">Dine 1RM (kg)</h3><p class="small muted" style="margin:4px 0">Bruges til at beregne vægte. Gæt konservativt hvis du er i tvivl.</p><div class="kpis" style="grid-template-columns:1fr 1fr">`;
    for (const l in LIFTS) h += `<label class="f" style="margin:4px 0"><span>${LIFTS[l]}</span><input class="in" inputmode="decimal" data-c="rm" data-k="${l}" value="${esc(S.rm[l] || '')}"></label>`;
    h += `</div>`;
  }
  h += `<button class="btn pri block mt2" data-a="tplCreate">Opret program</button><button class="btn ghost block mt" data-a="closeSheet">Annullér</button>`;
  return h;
}

VIEWS.prog = () => {
  const p = S.programs.find(x => x.id === ROUTE[1]);
  if (!p) return topbar('Program', true) + '<div class="empty">Programmet findes ikke.</div>';
  const pos = clampPos(p);
  if (fromTrainer(p)) return trainerProgramView(p, pos);
  let h = topbar('Rediger program', true);
  h += `<label class="f"><span>Navn</span><input class="in" data-c="progName" value="${esc(p.name)}"></label>`;
  if (p.desc) h += `<details class="small muted mb"><summary>Om programmet</summary><p>${esc(p.desc)}</p></details>`;
  h += `<div class="card">
    <div class="toggle"><span>Aktivt program</span><div class="sw ${S.activeProg === p.id ? 'on' : ''}" data-a="progActive"></div></div>
    <div class="toggle"><span>Automatisk progression<div class="xs muted">Foreslår reps/vægt ud fra dine logs</div></span><div class="sw ${p.auto ? 'on' : ''}" data-a="progAuto"></div></div>
    <div class="toggle"><span>Uger i cyklus</span><div class="row"><button class="ib" data-a="progWeeks" data-v="-1">−</button><b>${esc(p.weeks)}</b><button class="ib" data-a="progWeeks" data-v="1">＋</button></div></div>
    <div class="toggle" style="border:0"><span>Næste træning</span><span class="muted small">Uge ${pos.week + 1} · ${esc(p.days[pos.day] ? p.days[pos.day].name : '')}</span></div>`;
  if (p.tpl) {
    h += `<div class="mt"><div class="small muted mb">Dage om ugen (genererer dagene på ny fra skabelonen)</div><div class="chips">${[2, 3, 4, 5, 6].map(n => `<button class="chip ${p.days.length === n ? 'on' : ''}" data-a="progRegen" data-v="${n}">${n}</button>`).join('')}</div></div>`;
  }
  h += `</div>`;
  p.days.forEach((d, di) => {
    h += `<div class="day"><div class="day-h"><span class="badge">${di + 1}</span><input value="${esc(d.name)}" data-c="dayName" data-d="${di}">
      <button class="ib" data-a="dayStart" data-d="${di}" title="Start">▶</button><button class="ib" data-a="dayMenu" data-d="${di}">⋯</button></div>`;
    d.items.forEach((it, ii) => {
      const e = exById(it.ex);
      h += `<div class="item">${thumb(e)}<div class="grow" data-a="editItem" data-d="${di}" data-ii="${ii}"><b>${esc(e ? e.n : it.ex)}</b><div class="small muted">${esc(itemSummary(it, pos.week, p))}</div>
        ${it.alts && it.alts.length ? `<div class="xs dim">Varianter: ${esc(it.alts.map(exName).join(', '))}</div>` : ''}</div>
        <div style="display:flex;flex-direction:column;gap:4px"><button class="ib" data-a="itemMove" data-d="${di}" data-ii="${ii}" data-v="-1">↑</button><button class="ib" data-a="itemMove" data-d="${di}" data-ii="${ii}" data-v="1">↓</button></div></div>`;
    });
    h += `<div style="padding:10px 12px"><button class="btn sm block" data-a="addItem" data-d="${di}">＋ Tilføj øvelse</button></div></div>`;
  });
  h += `<button class="btn block" data-a="addDay">＋ Tilføj dag</button>
    <div class="row mt2"><button class="btn grow" data-a="progDup">Duplikér</button><button class="btn grow danger" data-a="progDel">Slet program</button></div>`;
  return h;
};
function curProg() { return S.programs.find(x => x.id === ROUTE[1]); }

// Read-only view of a trainer's program: the user can follow and train it, and copy it to edit their own version
function trainerProgramView(p, pos) {
  let h = topbar(p.name, true);
  h += `<div class="hint up" style="margin:0 0 12px">Dette program er lavet til dig af din træner. Du kan træne efter det, men kun træneren kan ændre det. Vil du tilpasse det selv, så kopiér det til dine egne programmer.</div>`;
  if (p.desc) h += `<p class="small muted">${esc(p.desc)}</p>`;
  h += `<div class="card">
    <div class="toggle"><span>Aktivt program</span><div class="sw ${S.activeProg === p.id ? 'on' : ''}" data-a="progActive"></div></div>
    <div class="toggle" style="border:0"><span>Næste træning</span><span class="muted small">Uge ${pos.week + 1} af ${esc(p.weeks)} · ${esc(p.days[pos.day] ? p.days[pos.day].name : '')}</span></div></div>`;
  p.days.forEach((d, di) => {
    h += `<div class="day"><div class="day-h"><span class="badge">${di + 1}</span><b class="grow">${esc(d.name)}</b><button class="ib" data-a="dayStart" data-d="${di}" title="Start">▶</button></div>`;
    d.items.forEach(it => {
      const e = exById(it.ex);
      h += `<div class="item">${thumb(e)}<div class="grow"><b>${esc(e ? e.n : it.ex)}</b><div class="small muted">${esc(itemSummary(it, pos.week, p))}</div>
        ${it.note ? `<div class="xs dim">${esc(it.note)}</div>` : ''}</div></div>`;
    });
    h += `</div>`;
  });
  h += `<button class="btn block" data-a="progDup">Kopiér til mine programmer</button>`;
  return h;
}

function newItem(exId) {
  const ex = exById(exId), rest = S.settings.rest;
  let sets;
  if (ex.type === 'time') sets = hold(3, 20, 40, rest);
  else if (ex.type === 'weight') sets = rep(3, 5, 8, rest, { rpe: 8 });
  else sets = rep(3, 8, 12, rest);
  return { id: uid(), ex: exId, alts: defaultAlts(exId), sets, wave: 'none', note: '', lift: null };
}

// Øvelsesvælger
let PICK = null;
function pickSheet() {
  const L = libFilter(PICK.q, PICK.cat);
  return `<h2 style="margin-top:0">${esc(PICK.title || 'Vælg øvelse')}</h2><input class="in" type="search" placeholder="Søg…" data-in="pickQ" value="${esc(PICK.q)}">
    <div class="chips mt">${[['all', 'Alle']].concat(Object.entries(CATS)).map(([k, n]) => `<button class="chip ${PICK.cat === k ? 'on' : ''}" data-a="pickCat" data-v="${k}">${n}</button>`).join('')}</div>
    <div class="list mt" id="picklist">${pickList(L)}</div>`;
}
function pickList(L) { return L.map(e => `<div class="it" data-a="pick" data-id="${e.id}">${thumb(e)}<div class="grow"><b>${esc(e.n)}</b><div class="small muted">${esc(CATS[e.c])}</div></div></div>`).join('') || '<div class="empty">Ingen fundet</div>'; }
function pickEx(title, cb) { PICK = { q: '', cat: 'all', title, cb }; openSheet(pickSheet); }

// Item-editor
let EDIT = null;
function editSheet() {
  const it = EDIT.item, e = exById(it.ex) || { n: it.ex, type: 'reps' };
  const kind = it.block ? it.block.kind : 'sets';
  let h = `<div class="row"><h2 class="grow" style="margin:0">Rediger øvelse</h2><button class="btn sm" data-a="closeSheet">Luk</button></div>
    <div class="row mt">${thumb(e)}<div class="grow"><b>${esc(e.n)}</b><div class="small muted">${esc(CATS[e.c] || '')}</div></div><button class="btn sm" data-a="edChangeEx">Skift</button></div>
    <label class="f"><span>Varianter at vælge imellem under træning</span></label><div class="chips wrap">${(it.alts || []).map((id, i) => `<button class="chip" data-a="edDelAlt" data-v="${i}">${esc(exName(id))} ✕</button>`).join('')}<button class="chip on" data-a="edAddAlt">＋ Variant</button></div>
    <label class="f mt"><span>Format</span></label><div class="chips wrap">${[['sets', 'Sæt'], ['ladder', 'Ladder'], ['emom', 'EMOM'], ['amrap', 'AMRAP'], ['tabata', 'Tabata']].map(([k, n]) => `<button class="chip ${kind === k ? 'on' : ''}" data-a="edKind" data-v="${k}">${n}</button>`).join('')}</div>`;
  if (kind === 'sets') {
    const isT = e.type === 'time', usePct = !!it.lift;
    h += `<label class="f"><span>Ugeprogression</span><select class="in" data-c="edWave">${Object.entries(WAVES).map(([k, n]) => `<option value="${k}" ${(it.wave || 'none') === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`;
    if (e.type === 'weight') h += `<label class="f"><span>Vægt angives som</span><select class="in" data-c="edLift"><option value="">Kg</option>${Object.entries(LIFTS).map(([k, n]) => `<option value="${k}" ${it.lift === k ? 'selected' : ''}>% af træningsmax – ${n}</option>`).join('')}</select></label>`;
    if (it.wave === 'pl531' || it.wave === 'plBlock') h += `<div class="hint" style="margin:8px 0">Sæt og procenter styres af bølgen hver uge. Kun pausen nedenfor bruges.</div>`;
    h += `<div class="setrow" style="margin-top:12px"><span></span><small>${isT ? 'Sek' : 'Reps'}</small><small>Til</small><small>${usePct ? '% TM' : (e.type === 'weight' ? 'Kg' : '+Kg')}</small><small>RPE/Max</small><small>Pause</small><span></span></div>`;
    it.sets.forEach((s, j) => {
      const f1 = isT ? 't' : 'r', f2 = isT ? 'tMax' : 'rMax', f3 = usePct ? 'pct' : 'kg';
      h += `<div class="setrow"><b class="small">${j + 1}</b>
        <input inputmode="numeric" data-c="edSet" data-j="${j}" data-f="${f1}" value="${esc(s[f1] || '')}">
        <input inputmode="numeric" data-c="edSet" data-j="${j}" data-f="${f2}" value="${esc(s[f2] || '')}" placeholder="–">
        <input inputmode="decimal" data-c="edSet" data-j="${j}" data-f="${f3}" value="${esc(s[f3] || '')}" placeholder="–">
        <select data-c="edSet" data-j="${j}" data-f="rpe"><option value="">–</option>${[6, 7, 8, 9, 10].map(n => `<option ${s.rpe == n && !s.amrap ? 'selected' : ''}>${n}</option>`).join('')}<option value="max" ${s.amrap ? 'selected' : ''}>Max</option></select>
        <input inputmode="numeric" data-c="edSet" data-j="${j}" data-f="rest" value="${esc(s.rest || '')}">
        <button class="ib" style="width:30px" data-a="edDelSet" data-j="${j}">✕</button></div>`;
    });
    h += `<button class="btn sm block" data-a="edAddSet">＋ Tilføj sæt</button>`;
  } else {
    const b = it.block, field = (k, n) => `<label class="f"><span>${n}</span><input class="in" inputmode="numeric" data-c="edBlock" data-k="${k}" value="${b[k] == null ? '' : esc(b[k])}"></label>`;
    h += `<div class="kpis" style="grid-template-columns:1fr 1fr">`;
    if (kind === 'ladder') h += field('top', 'Top (reps)') + field('rounds', 'Runder') + field('rest', 'Pause mellem trin (s)') + `<label class="f"><span>Op og ned (pyramide)</span><select class="in" data-c="edBlock" data-k="down"><option value="">Nej</option><option value="1" ${b.down ? 'selected' : ''}>Ja</option></select></label>`;
    if (kind === 'emom') h += field('min', 'Minutter') + field('reps', 'Reps pr. minut');
    if (kind === 'amrap') h += field('min', 'Minutter');
    if (kind === 'tabata') h += field('rounds', 'Runder') + field('work', 'Arbejde (s)') + field('rest', 'Hvile (s)');
    h += `</div>`;
    if (kind === 'amrap') {
      h += `<label class="f"><span>Runde (kredsløb)</span></label>`;
      (it.circuit || []).forEach((c, i) => { h += `<div class="row mb"><input class="in" style="width:72px" inputmode="numeric" data-c="edCirc" data-v="${i}" value="${esc(c.r)}"><span class="grow">${esc(exName(c.ex))}</span><button class="ib" data-a="edDelCirc" data-v="${i}">✕</button></div>`; });
      h += `<button class="btn sm block" data-a="edAddCirc">＋ Øvelse i runden</button>`;
    }
  }
  h += `<label class="f mt"><span>Note</span><textarea class="in" data-c="edNote" placeholder="F.eks. tempo, greb, fokuspunkt">${esc(it.note || '')}</textarea></label>
    <button class="btn pri block mt" data-a="edSave">Gem</button><button class="btn danger ghost block mt" data-a="edDelete">Fjern fra dagen</button>`;
  return h;
}

// ---------- STATISTIK ----------
const ST = { ex: null, metric: null };
const TESTS = [
  { k: 'pullup', n: 'Maks pull-ups', u: 'reps' }, { k: 'chinup', n: 'Maks chin-ups', u: 'reps' }, { k: 'pushup', n: 'Maks push-ups', u: 'reps' },
  { k: 'dip', n: 'Maks dips', u: 'reps' }, { k: 'muscleup', n: 'Maks muscle-ups', u: 'reps' }, { k: 'hspu', n: 'Maks HSPU', u: 'reps' },
  { k: 'plank', n: 'Planke', u: 's' }, { k: 'lsit', n: 'L-sit', u: 's' }, { k: 'hang', n: 'Dead hang', u: 's' },
  { k: 'rm_squat', n: '1RM Squat', u: 'kg', lift: 'squat' }, { k: 'rm_bench', n: '1RM Bænkpres', u: 'kg', lift: 'bench' },
  { k: 'rm_deadlift', n: '1RM Dødløft', u: 'kg', lift: 'deadlift' }, { k: 'rm_ohp', n: '1RM Militærpres', u: 'kg', lift: 'ohp' },
];
function bests(logs) { return PROG.bests(logs || S.logs); }
const METRICS = { e1: 'e1RM (kg)', kg: 'Max kg', reps: 'Max reps', t: 'Længste hold (s)', vol: 'Volumen (kg)', total: 'Reps i alt' };
function defaultMetric(e) { return e.type === 'weight' ? 'e1' : e.type === 'time' ? 't' : 'reps'; }
function metricUnit(m) { return { e1: 'kg', kg: 'kg', reps: 'reps', t: 's', vol: 'kg', total: 'reps' }[m]; }
function series(exId, m) {
  const out = [];
  for (const L of S.logs) for (const it of L.items) {
    if (it.ex !== exId || !it.sets || !it.sets.length) continue;
    const ss = it.sets;
    const v = m === 'e1' ? Math.max(...ss.map(s => e1(s.kg, s.r))) : m === 'kg' ? Math.max(...ss.map(s => s.kg || 0)) : m === 'reps' ? Math.max(...ss.map(s => s.r || 0))
      : m === 't' ? Math.max(...ss.map(s => s.t || 0)) : m === 'vol' ? ss.reduce((a, s) => a + (s.kg || 0) * (s.r || 0), 0) : ss.reduce((a, s) => a + (s.r || 0), 0);
    if (v > 0) out.push({ x: L.date, y: Math.round(v * 10) / 10 });
  }
  return out;
}
function lineChart(pts, unit) {
  if (pts.length < 2) return `<p class="muted small center">${pts.length ? 'Seneste: <b>' + fmt(pts[0].y) + ' ' + unit + '</b>. ' : ''}Grafen vises når der er mindst 2 registreringer.</p>`;
  const W = 340, H = 170, pl = 34, pr = 10, pt = 12, pb = 24;
  const ys = pts.map(p => p.y), mn = Math.min(...ys), mx = Math.max(...ys), lo = mn - (mx - mn) * .15 || mn * .9, hi = mx + (mx - mn) * .15 || mx * 1.1 + 1;
  const X = i => pl + i * (W - pl - pr) / (pts.length - 1), Y = v => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo));
  const d = pts.map((p, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p.y).toFixed(1)).join(' ');
  const grid = [0, .5, 1].map(f => { const v = lo + (hi - lo) * f; return `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${pl - 4}" y="${Y(v) + 4}" text-anchor="end">${fmt(v)}</text>`; }).join('');
  const lab = [0, pts.length - 1].map(i => `<text x="${X(i)}" y="${H - 6}" text-anchor="${i ? 'end' : 'start'}">${dk(pts[i].x)}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">${grid}<path class="ar" d="${d} L${X(pts.length - 1)} ${H - pb} L${pl} ${H - pb} Z"/><path class="ln" d="${d}"/>${pts.map((p, i) => `<circle class="pt" cx="${X(i)}" cy="${Y(p.y)}" r="3.5"/>`).join('')}${lab}</svg>
    <div class="row between small"><span class="muted">Start: <b>${fmt(pts[0].y)}</b></span><span class="muted">Nu: <b style="color:var(--acc2)">${fmt(pts[pts.length - 1].y)} ${unit}</b></span></div>`;
}
function barChart(vals, labels) {
  const W = 340, H = 130, pb = 20, mx = Math.max(1, ...vals), bw = (W - 10) / vals.length;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">${vals.map((v, i) => { const h = (H - pb - 14) * v / mx; return `<rect class="bar" rx="4" x="${5 + i * bw + 4}" y="${H - pb - h}" width="${bw - 8}" height="${Math.max(h, 1)}" opacity="${v ? 1 : .25}"/><text x="${5 + i * bw + bw / 2}" y="${H - pb - h - 4}" text-anchor="middle">${v || ''}</text><text x="${5 + i * bw + bw / 2}" y="${H - 5}" text-anchor="middle">${labels[i]}</text>`; }).join('')}</svg>`;
}

VIEWS.stats = () => {
  const tab = ROUTE[1] || 'overview';
  let h = topbar('Statistik') + `<div class="chips mb">${[['overview', 'Oversigt'], ['records', 'Rekorder'], ['charts', 'Grafer'], ['tests', 'Tests'], ['history', 'Historik']].map(([k, n]) => `<a class="chip ${tab === k ? 'on' : ''}" href="#/stats/${k}" style="text-decoration:none">${n}</a>`).join('')}</div>`;
  if (tab === 'overview') {
    const now = Date.now(), d30 = S.logs.filter(l => l.date > now - 30 * 864e5);
    const sets = S.logs.reduce((n, l) => n + l.items.reduce((m, it) => m + (it.sets || []).length, 0), 0);
    const vol = S.logs.reduce((n, l) => n + l.items.reduce((m, it) => m + (it.sets || []).reduce((k, s) => k + (s.kg || 0) * (s.r || 0), 0), 0), 0);
    const reps = S.logs.reduce((n, l) => n + l.items.reduce((m, it) => m + (it.sets || []).reduce((k, s) => k + (s.r || 0), 0) + ((it.result && it.result.reps) || 0), 0), 0);
    h += `<div class="kpis"><div class="kpi"><b>${S.logs.length}</b><span>Træninger</span></div><div class="kpi"><b>${d30.length}</b><span>Sidste 30 dage</span></div><div class="kpi"><b>${streak()}</b><span>Uger i træk</span></div>
      <div class="kpi"><b>${sets}</b><span>Sæt i alt</span></div><div class="kpi"><b>${reps}</b><span>Reps i alt</span></div><div class="kpi"><b>${vol > 9999 ? fmt(vol / 1000) + 't' : fmt(vol)}</b><span>Kg løftet</span></div></div>`;
    const ws = [], lb = []; let w0 = weekStart();
    for (let i = 7; i >= 0; i--) { const w = w0 - i * 7 * 864e5; ws.push(S.logs.filter(l => weekStart(l.date) === weekStart(w + 864e5)).length); lb.push('u' + isoWeek(w + 864e5)); }
    h += `<h2>Træninger pr. uge</h2><div class="card">${barChart(ws, lb)}</div>`;
    const cnt = {}; S.logs.forEach(l => l.items.forEach(it => cnt[it.ex] = (cnt[it.ex] || 0) + 1));
    const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (top.length) h += `<h2>Mest trænede øvelser</h2><div class="card list">${top.map(([id, n]) => `<div class="it" data-a="go" data-h="#/ex/${id}">${thumb(exById(id))}<div class="grow"><b>${esc(exName(id))}</b></div><span class="badge">${n}×</span></div>`).join('')}</div>`;
    if (!S.logs.length) h += `<div class="empty">Ingen træninger endnu – statistikken fyldes op, når du træner.</div>`;
  }
  if (tab === 'records') {
    const B = bests(), ids = Object.keys(B);
    if (!ids.length) h += `<div class="empty">Ingen rekorder endnu.</div>`;
    h += `<div class="card list">${ids.map(id => { const b = B[id], parts = []; if (b.reps) parts.push(b.reps + ' reps'); if (b.kg) parts.push(fmt(b.kg) + ' kg'); if (b.e1 && b.kg) parts.push('e1RM ' + fmt(b.e1)); if (b.t) parts.push(b.t + ' s');
      return `<div class="it" data-a="go" data-h="#/ex/${id}">${thumb(exById(id))}<div class="grow"><b>${esc(exName(id))}</b><div class="small muted">${parts.join(' · ')}</div></div></div>`; }).join('')}</div>`;
    if (S.rm.squat || S.rm.bench || S.rm.deadlift || S.rm.ohp) {
      h += `<h2>Aktuelle 1RM</h2><div class="kpis" style="grid-template-columns:1fr 1fr">${Object.entries(LIFTS).map(([k, n]) => `<div class="kpi"><b>${fmt(S.rm[k] || 0)}</b><span>${n}</span></div>`).join('')}</div>`;
      const tot = (S.rm.squat || 0) + (S.rm.bench || 0) + (S.rm.deadlift || 0); if (tot) h += `<p class="muted center">Powerlifting-total: <b>${fmt(tot)} kg</b></p>`;
    }
  }
  if (tab === 'charts') {
    const used = [...new Set(S.logs.flatMap(l => l.items.filter(it => it.sets && it.sets.length).map(it => it.ex)))];
    if (!used.length) return h + `<div class="empty">Træn et par gange, så kommer graferne her.</div>`;
    if (!ST.ex || !used.includes(ST.ex)) { ST.ex = used[0]; ST.metric = null; }
    const e = exById(ST.ex) || { type: 'reps' };
    const ms = e.type === 'weight' ? ['e1', 'kg', 'vol'] : e.type === 'time' ? ['t'] : ['reps', 'total', 'kg'];
    if (!ST.metric || !ms.includes(ST.metric)) ST.metric = ms[0];
    h += `<select class="in" data-c="stEx">${used.map(id => `<option value="${id}" ${id === ST.ex ? 'selected' : ''}>${esc(exName(id))}</option>`).join('')}</select>
      <div class="chips mt">${ms.map(m => `<button class="chip ${ST.metric === m ? 'on' : ''}" data-a="stMetric" data-v="${m}">${METRICS[m]}</button>`).join('')}</div>
      <div class="card mt">${lineChart(series(ST.ex, ST.metric), metricUnit(ST.metric))}</div>`;
  }
  if (tab === 'tests') {
    h += `<button class="btn pri block mb" data-a="newTest">＋ Registrér maks-test</button>`;
    const any = TESTS.filter(t => S.tests.some(x => x.k === t.k));
    if (!any.length) h += `<div class="empty">Ingen tests endnu. Test f.eks. maks pull-ups hver 4. uge for at følge din udvikling.</div>`;
    any.forEach(t => {
      const pts = S.tests.filter(x => x.k === t.k).sort((a, b) => a.date - b.date).map(x => ({ x: x.date, y: x.v }));
      h += `<div class="card"><div class="row between"><b>${t.n}</b><span class="badge acc">${fmt(pts[pts.length - 1].y)} ${t.u}</span></div><div class="mt">${lineChart(pts, t.u)}</div></div>`;
    });
  }
  if (tab === 'history') {
    if (!S.logs.length) h += `<div class="empty">Ingen træninger endnu.</div>`;
    S.logs.slice().reverse().forEach(l => {
      h += `<details class="card"><summary class="row between" style="list-style:none;cursor:pointer"><span><b>${esc(l.name)}</b><div class="small muted">${dkFull(l.date)} · ${Math.round(l.dur / 60000)} min</div></span><span class="dim">▾</span></summary>
        <div class="mt">${l.items.map(it => `<div class="mb"><b class="small">${esc(exName(it.ex))}</b><div class="small muted">${it.sets && it.sets.length ? it.sets.map(s => s.t ? s.t + 's' : (s.r + (s.kg ? '×' + fmt(s.kg) + 'kg' : '') + (s.rpe ? ' @' + s.rpe : ''))).join(' · ') : (it.result ? (it.result.rounds ? it.result.rounds + ' runder' : (it.result.reps || 0) + ' reps') + ' · ' + esc(blockText(it.block, it)) : '')}</div></div>`).join('')}
        <button class="btn sm danger ghost" data-a="delLog" data-id="${l.id}">Slet træning</button></div></details>`;
    });
  }
  return h;
};
function isoWeek(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7); const w1 = new Date(d.getFullYear(), 0, 4); return 1 + Math.round(((d - w1) / 864e5 - 3 + (w1.getDay() + 6) % 7) / 7); }

let TEST = null;
function testSheet() {
  const t = TESTS.find(x => x.k === TEST.k);
  return `<h2 style="margin-top:0">Maks-test</h2><label class="f"><span>Test</span><select class="in" data-c="testK">${TESTS.map(x => `<option value="${x.k}" ${x.k === TEST.k ? 'selected' : ''}>${x.n}</option>`).join('')}</select></label>
    <label class="f"><span>Resultat (${t.u})</span><input class="in" inputmode="decimal" data-c="testV" value="${esc(TEST.v)}"></label>
    ${t.lift ? `<p class="small muted">Opdaterer også din 1RM i ${LIFTS[t.lift]} (bruges til %-beregning).</p>` : ''}
    <button class="btn pri block mt" data-a="testSave">Gem</button>`;
}

// ---------- MERE / INDSTILLINGER ----------
let DEFER = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); DEFER = e; if ((ROUTE[0] || '') === 'settings') render(); });
// ---------- LOGIN ----------
const ROLE_NAMES = { admin: 'Admin', trainer: 'Træner', user: 'Bruger' };
let AUTHFORM = { busy: false, error: '' };

function authShell(inner) {
  return `<div class="auth"><div class="brand"><div class="logo">💪</div><h1>power-krop</h1>
    <p class="muted small">Calisthenics, powerløft og military styrke</p></div>${inner}</div>`;
}
function authError() { return AUTHFORM.error ? `<div class="hint err" role="alert">${esc(AUTHFORM.error)}</div>` : ''; }

VIEWS.login = () => authShell(updateCard() + `<form class="card" data-submit="doLogin" novalidate>
    <h2 style="margin-top:0">Log ind</h2>
    <label class="f"><span>E-mail</span><input class="in" id="li-email" type="email" autocomplete="username" inputmode="email" autocapitalize="off" required></label>
    <label class="f"><span>Password</span><input class="in" id="li-pw" type="password" autocomplete="current-password" required></label>
    ${authError()}
    <button class="btn pri block" type="submit" ${AUTHFORM.busy ? 'disabled' : ''}>${AUTHFORM.busy ? 'Logger ind…' : 'Log ind'}</button>
  </form>
  <div class="card small muted">Du får en konto ved at blive inviteret af din træner.
    <button class="btn ghost block mt" data-a="toInvite">Har du en invitationskode?</button></div>`);

// Token from a pasted invite link or the bare code
function inviteTokenFrom(s) {
  const m = String(s || '').trim().match(/(?:\/invite\/)?([A-Za-z0-9_-]{20,})\s*$/);
  return m ? m[1] : '';
}
VIEWS.invite = () => {
  const fromLink = inviteTokenFrom(ROUTE[1]);
  return authShell(`<form class="card" data-submit="doInvite" novalidate>
    <h2 style="margin-top:0">Aktivér din konto</h2>
    <p class="small muted" style="margin-top:0">Vælg det password, du vil logge ind med. Det skal være mindst 10 tegn.</p>
    ${fromLink ? `<input type="hidden" id="iv-token" value="${esc(fromLink)}">`
      : `<label class="f"><span>Invitationskode (eller hele linket)</span><input class="in" id="iv-token" autocapitalize="off" autocomplete="off" spellcheck="false" required></label>`}
    <label class="f"><span>Nyt password</span><input class="in" id="iv-pw" type="password" autocomplete="new-password" minlength="10" required></label>
    <label class="f"><span>Gentag password</span><input class="in" id="iv-pw2" type="password" autocomplete="new-password" minlength="10" required></label>
    ${authError()}
    <button class="btn pri block" type="submit" ${AUTHFORM.busy ? 'disabled' : ''}>${AUTHFORM.busy ? 'Aktiverer…' : 'Aktivér konto'}</button>
  </form>
  <button class="btn ghost block" data-a="toLogin">Jeg har allerede en konto</button>`);
};

// The old PWA (GitHub Pages, no account): the way over to the Android app. The app can't read this browser's
// data (another origin), so the data travels as a backup file.
const APK_PAGE_URL = API_BASE_URL + '/app';   // our own server: the repo is private, so no GitHub Releases
function moveToAppCard() {
  if (AUTH.required) return '';
  return `<div class="card hero"><b>Flyt til Android-appen</b>
    <p class="small muted">power-krop findes nu som Android-app med login, så dine data gemmes på din konto og følger dig mellem telefoner.</p>
    <ol class="small" style="padding-left:20px;margin:8px 0">
      <li>Tryk <b>Eksportér mine data</b>, og gem filen (fx i Drev).</li>
      <li>Hent og installér appen, og log ind med den invitation, du har fået af din træner.</li>
      <li>I appen: <b>Mere → Importér</b>, og vælg filen. Dine programmer og træninger lægges ind på din konto.</li>
    </ol>
    <button class="btn pri block" data-a="export">Eksportér mine data</button>
    <a class="btn block mt" href="${APK_PAGE_URL}" target="_blank" rel="noopener">Hent appen</a>
    <p class="xs muted" style="margin-bottom:0">Dine data her i browseren bliver liggende, så du kan fortsætte, til du er flyttet.</p></div>`;
}

function accountCard() {
  const p = AUTH.profile;
  if (!p) return '';
  const st = SYNC.status;
  return `<h2>Konto</h2><div class="card"><div class="row"><div class="grow"><b>${esc(p.display_name)}</b>
    <div class="small muted">${esc(p.email)} · ${ROLE_NAMES[p.role] || esc(p.role)}</div></div></div>
    <div class="sync-line small mt">${syncStatusText(st)}</div>
    <div class="row mt"><button class="btn grow" data-a="syncNow" ${st.state === 'syncing' ? 'disabled' : ''}>Synkronisér nu</button>
    <button class="btn ghost grow" data-a="logout">Log ud</button></div></div>`;
}

VIEWS.settings = () => {
  const st = S.settings, sw = (k, n, d) => `<div class="toggle"><span>${n}${d ? `<div class="xs muted">${d}</div>` : ''}</span><div class="sw ${st[k] ? 'on' : ''}" data-a="setToggle" data-k="${k}"></div></div>`;
  let h = topbar('Mere') + updateCard() + accountCard() + moveToAppCard();
  const standalone = matchMedia('(display-mode: standalone)').matches;
  if (!standalone && !PLATFORM.native) h += `<div class="card hero"><b>Installer som app</b><p class="small muted">Få power-krop på startskærmen i fuld skærm – virker også offline.</p>
    ${DEFER ? `<button class="btn pri block" data-a="install">Installer app</button>` : `<p class="small">Chrome: menu <b>⋮</b> → <b>Installer app</b> / <b>Føj til startskærm</b>.<br>Samsung Internet: menu <b>≡</b> → <b>Tilføj side til</b> → <b>Startskærm</b>.</p>`}</div>`;
  h += `<h2>1RM & træningsmax</h2><div class="card"><div class="kpis" style="grid-template-columns:1fr 1fr">${Object.entries(LIFTS).map(([k, n]) => `<label class="f" style="margin:0"><span>${n} (kg)</span><input class="in" inputmode="decimal" data-c="rm" data-k="${k}" value="${esc(S.rm[k] || '')}"></label>`).join('')}</div>
    <label class="f"><span>Træningsmax (% af 1RM)</span><input class="in" inputmode="numeric" data-c="setNum" data-k="tmPct" value="${esc(st.tmPct)}"></label>
    <label class="f"><span>Vægtspring / afrunding (kg)</span><input class="in" inputmode="decimal" data-c="setNum" data-k="inc" value="${esc(st.inc)}"></label></div>`;
  h += `<h2>Træning</h2><div class="card">${sw('auto', 'Automatisk progression', 'Forslag til reps/vægt ud fra seneste træning')}${sw('sound', 'Lyd ved timer')}${sw('vibrate', 'Vibration ved timer')}${sw('wake', 'Hold skærmen tændt under træning')}
    <label class="f"><span>Standardpause for nye øvelser (sek)</span><input class="in" inputmode="numeric" data-c="setNum" data-k="rest" value="${esc(st.rest)}"></label>
    <button class="btn sm" data-a="testSound">Test lyd & vibration</button></div>`;
  h += `<h2>Mit udstyr</h2><div class="card"><p class="small muted" style="margin-top:0">Bruges, når du opretter programmer fra skabeloner, og til at filtrere øvelsesbiblioteket.</p>${equipPicker(myEquip() || EQUIPMENT.ALL, 'eq')}</div>`;
  h += `<h2>Backup</h2><div class="card"><p class="small muted" style="margin-top:0">${AUTH.loggedIn() ? "Dine data synkroniseres med din konto. En backup-fil er stadig en god ekstra sikkerhed." : "Dine data ligger kun på denne telefon. Tag en backup jævnligt."}</p>
    <div class="row"><button class="btn grow" data-a="export">Eksportér</button><label class="btn grow">Importér<input type="file" accept="application/json,.json" data-c="import" hidden></label></div>
    <button class="btn danger ghost block mt" data-a="reset">Slet alle data</button></div>`;
  h += `<h2>Om</h2><div class="card small muted">power-krop${UPDATE.info ? ' v' + esc(UPDATE.info.versionName) : ''} · ${EXERCISES.length} øvelser · ${TEMPLATES.length} skabeloner.<br>Øvelsesbilleder fra <a href="https://github.com/yuhonas/free-exercise-db" target="_blank" rel="noopener">free-exercise-db</a> (public domain). Videoer via YouTube.</div>`;
  return h;
};

// ---------- Handlinger ----------
const A = {
  back() { history.length > 1 ? history.back() : go('#/'); },
  go(el) { go(el.dataset.h); },
  closeSheet() { closeSheet(); },
  exInfo(el) {
    const e = exById(el.dataset.id); if (!e) return;
    openSheet(() => `<h2 style="margin-top:0">${esc(e.n)}</h2>${animBlock(e)}${e.cues ? `<ul class="cues mt">${e.cues.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
      <div class="row mt"><a class="btn grow" href="#/ex/${e.id}">Se detaljer & video</a><button class="btn grow" data-a="closeSheet">Luk</button></div>`);
    startAnim();
  },
  startNext() { const p = S.programs.find(x => x.id === S.activeProg); const pos = clampPos(p); startWorkout(p.id, pos.week, pos.day); },
  pickDay() {
    const p = S.programs.find(x => x.id === S.activeProg); let wk = p.pos.week;
    const f = () => `<h2 style="margin-top:0">Vælg træning</h2><div class="chips">${Array.from({ length: p.weeks }, (_, i) => `<button class="chip ${wk === i ? 'on' : ''}" data-a="pdWeek" data-v="${i}">Uge ${i + 1}</button>`).join('')}</div>
      <div class="list mt">${p.days.map((d, i) => `<div class="it" data-a="pdStart" data-v="${i}"><span class="badge">${i + 1}</span><div class="grow"><b>${esc(d.name)}</b><div class="small muted">${d.items.length} øvelser</div></div><span class="dim">▶</span></div>`).join('')}</div>
      <p class="small muted">Tip: Vælger du en anden dag, flyttes programmets position ikke frem.</p>`;
    A.pdWeek = el => { wk = +el.dataset.v; renderSheet(); };
    A.pdStart = el => { closeSheet(); startWorkout(p.id, wk, +el.dataset.v); };
    openSheet(f);
  },
  freeWorkout() { startWorkout(null); },
  finish() { finishWorkout(); },
  discard() { if (confirm('Kassér træningen? Intet gemmes.')) { S.active = null; REST = null; save(); unwake(); go('#/'); } },
  setDone(el) {
    const a = S.active.items[+el.dataset.i], s = a.sets[+el.dataset.j];
    s.done = !s.done; save(); render();
    if (s.done) { buzz(40); startRest(s.tgt.rest || S.settings.rest); }
  },
  addSet(el) { const a = S.active.items[+el.dataset.i]; const last = a.sets[a.sets.length - 1]; a.sets.push(last ? Object.assign(clone(last), { done: false, rpe: '' }) : { tgt: { r: 8, rest: S.settings.rest }, r: 8, kg: '', t: '', rpe: '', done: false }); save(); render(); },
  delSet(el) { const a = S.active.items[+el.dataset.i]; a.sets.pop(); save(); render(); },
  wDel(el) { if (confirm('Fjern øvelsen fra denne træning?')) { S.active.items.splice(+el.dataset.i, 1); save(); render(); } },
  wMove(el) { const i = +el.dataset.i, L = S.active.items; if (i > 0) { [L[i - 1], L[i]] = [L[i], L[i - 1]]; save(); render(); } },
  stepUp(el) {
    const a = S.active.items[+el.dataset.i], nx = a.hint.up;
    a.opts = a.opts || [a.ex];
    if (!a.opts.includes(nx)) a.opts.push(nx);
    a.ex = nx;
    fillSets(a, a.sets.map(s => s.tgt)); a.hint = { text: 'Nyt trin! Start konservativt og fokusér på teknik.' };
    if (S.active.progId) {
      const p = S.programs.find(x => x.id === S.active.progId), d = p && p.days[S.active.day];
      const src = d && d.items.find(it => it.id === a.src);
      // A trainer's program can't be changed here (only for this workout); the trainer adjusts it
      if (src && !fromTrainer(p) && confirm('Gem det nye trin permanent i programmet?')) { src.alts = [...new Set([src.ex].concat(src.alts || [], defaultAlts(nx)))].filter(x => x !== nx); src.ex = nx; }
    }
    save(); render();
  },
  holdTimer(el) {
    const a = S.active.items[+el.dataset.i], j = a.sets.findIndex(s => !s.done), s = a.sets[j < 0 ? 0 : j];
    let t0 = 0, iv = null;
    const f = () => `<h2 style="margin-top:0">Hold-timer</h2><p class="muted">${esc(exName(a.ex))} · mål ${esc(tgtText(s.tgt))}</p><div class="center" style="font-size:4.5rem;font-weight:800" id="ht">0</div>
      <div class="row mt"><button class="btn pri grow" data-a="htGo">Start</button><button class="btn ok grow" data-a="htStop">Stop & gem</button></div>`;
    A.htGo = () => { beep(990, .2); t0 = Date.now(); clearInterval(iv); iv = setInterval(() => { const x = Math.floor((Date.now() - t0) / 1000); const e = $('#ht'); if (!e) return clearInterval(iv); if (e.textContent !== String(x) && x === (s.tgt.t || 0)) { beep(1200, .3, 2); buzz(300); } e.textContent = x; }, 100); };
    A.htStop = () => { clearInterval(iv); if (t0) { s.t = Math.floor((Date.now() - t0) / 1000); s.done = true; save(); closeSheet(); render(); startRest(s.tgt.rest || S.settings.rest); } else closeSheet(); };
    openSheet(f);
  },
  addExWorkout() { pickEx('Tilføj øvelse', id => { const it = newItem(id); S.active.items.push(mkActiveItem(it, 0, null)); save(); closeSheet(); render(); }); },
  openIT(el) { openIT(+el.dataset.i); },
  itPlay() { if (IT.running) { IT.el = itElapsed(); IT.running = false; } else { IT.t0 = Date.now() - IT.el * 1000; IT.running = true; beep(880, .1); } itControls(); },
  itStop() { if (IT.running) { IT.el = itElapsed(); IT.running = false; } itFinish(); itSetText('Afsluttet', IT.kind === 'amrap' ? IT.rounds + ' runder' : '', '', ''); },
  itRound() { IT.rounds++; beep(1100, .08); buzz(60); itTick(); },
  itRung() {
    IT.pos++; buzz(60);
    if (IT.pos >= IT.seq.length) { itFinish(); itSetText('Ladder færdig!', IT.seq.reduce((x, y) => x + y, 0) + ' reps', 'Stærkt!', 'work'); return; }
    IT.mode = 'rest'; IT.restStart = Date.now(); itControls(); itTick();
  },
  itSkipRest() { IT.mode = 'work'; itControls(); itTick(); },
  itSave() {
    const a = S.active.items[IT.idx], b = IT.b;
    if (IT.kind === 'ladder') a.result = { reps: IT.seq.slice(0, IT.pos).reduce((x, y) => x + y, 0), done: true };
    else if (IT.kind === 'amrap') a.result = { rounds: IT.rounds, done: true };
    else if (IT.kind === 'emom') a.result = { reps: Math.min(b.min, Math.floor(Math.max(0, IT.el - IT.pre) / 60)) * b.reps, done: true };
    else a.result = { rounds: b.rounds, done: true };
    save(); itCloseUI(); render();
  },
  itClose() { if (!IT.done && IT.el > 0 && !confirm('Luk timeren uden at gemme?')) return; itCloseUI(); },
  blockDone(el) { const a = S.active.items[+el.dataset.i]; a.result = a.result || {}; a.result.done = !a.result.done; save(); render(); },
  restAdd(el) { if (REST) { REST.end += +el.dataset.v * 1000; REST.total = Math.max(1, REST.total + +el.dataset.v); REST.fired = false; $('#rest').classList.remove('ready'); tickRest(); } },
  restSkip() { REST = null; tickRest(); },

  // Bibliotek
  libTab(el) { LIB.tab = el.dataset.v; render(); },
  libCat(el) { LIB.cat = el.dataset.v; render(); },
  eqPreset(el) { S.settings.equip = EQUIPMENT.PRESETS.find(x => x.id === el.dataset.v).eq.slice(); save(); render(); },
  eqToggle(el) { S.settings.equip = toggleEquip(myEquip() || EQUIPMENT.ALL, el.dataset.v); save(); render(); },
  libEqOnly() { LIB.eqOnly = !LIB.eqOnly; render(); },
  newEx() {
    const d = { n: '', c: 'pull', type: 'reps', cues: '', video: '' };
    A.nxSave = () => {
      const f = id => $('#sheet [name=' + id + ']').value;
      const n = f('n').trim(); if (!n) return toast('Giv øvelsen et navn');
      const ex = { id: 'my-' + uid(), n, c: f('c'), type: f('type'), eq: [], m: [], img: null, cues: f('cues').split('\n').map(x => x.trim()).filter(Boolean), custom: true, w: true };
      S.customEx.push(ex); if (f('video')) S.videos[ex.id] = f('video');
      save(); closeSheet(); go('#/ex/' + ex.id);
    };
    openSheet(() => `<h2 style="margin-top:0">Ny øvelse</h2>
      <label class="f"><span>Navn</span><input class="in" name="n"></label>
      <label class="f"><span>Kategori</span><select class="in" name="c">${Object.entries(CATS).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label>
      <label class="f"><span>Type</span><select class="in" name="type"><option value="reps">Reps</option><option value="time">Hold (tid)</option><option value="weight">Vægt (vægtstang)</option></select></label>
      <label class="f"><span>Teknikpunkter (én pr. linje)</span><textarea class="in" name="cues"></textarea></label>
      <label class="f"><span>YouTube-link (valgfrit)</span><input class="in" name="video"></label>
      <button class="btn pri block" data-a="nxSave">Opret</button>`);
  },
  delEx(el) { if (confirm('Slet øvelsen?')) { S.customEx = S.customEx.filter(e => e.id !== el.dataset.id); save(); go('#/library'); } },
  addToProg(el) {
    const id = el.dataset.id;
    if (!S.programs.length) return toast('Opret først et program');
    openSheet(() => `<h2 style="margin-top:0">Tilføj ${esc(exName(id))} til…</h2>${S.programs.map(p => `<div class="card"><b>${esc(p.name)}</b><div class="list mt">${p.days.map((d, di) => `<div class="it" data-a="atpDo" data-p="${p.id}" data-d="${di}"><span class="badge">${di + 1}</span><span class="grow">${esc(d.name)}</span><span class="dim">＋</span></div>`).join('')}</div></div>`).join('')}`);
    A.atpDo = b => { const p = S.programs.find(x => x.id === b.dataset.p); p.days[+b.dataset.d].items.push(newItem(id)); save(); closeSheet(); toast('Tilføjet til ' + p.days[+b.dataset.d].name); };
  },

  // Programmer
  tplSetup(el) {
    const t = TEMPLATES.find(x => x.id === el.dataset.id), L = 1, lv = {};
    templateTrees(t.id).forEach(k => lv[k] = TREES[k].lvl[L]);
    SETUP = { tpl: t.id, days: 3, L, lv, eq: (myEquip() || EQUIPMENT.ALL).slice() };
    openSheet(tplSetupSheet);
  },
  setupDays(el) { SETUP.days = +el.dataset.v; renderSheet(); },
  setupLvl(el) { SETUP.L = +el.dataset.v; for (const k in SETUP.lv) SETUP.lv[k] = TREES[k].lvl[SETUP.L]; renderSheet(); },
  setupEqPreset(el) { SETUP.eq = EQUIPMENT.PRESETS.find(x => x.id === el.dataset.v).eq.slice(); renderSheet(); },
  setupEqToggle(el) { SETUP.eq = toggleEquip(SETUP.eq, el.dataset.v); renderSheet(); },
  tplCreate() {
    const p = buildProgram(SETUP.tpl, SETUP.days, SETUP.L, SETUP.lv);
    const adapted = EQUIPMENT.adaptProgram(p, SETUP.eq);
    S.settings.equip = SETUP.eq.slice();
    if (adapted.swapped.length || adapted.removed.length) p.desc = [p.desc, 'Tilpasset udstyr: ' + equipName(SETUP.eq) + '.'].filter(Boolean).join('\n\n');
    S.programs.push(p); if (!S.activeProg || confirm('Gør “' + p.name + '” til dit aktive program?')) S.activeProg = p.id;
    save(); closeSheet(); toast('Program oprettet'); go('#/prog/' + p.id);
  },
  newBlank() {
    let n = 3;
    A.nbDays = el => { n = +el.dataset.v; renderSheet(); };
    A.nbCreate = () => {
      const name = $('#sheet [name=n]').value.trim() || 'Mit program';
      const p = { id: newId(), name, desc: '', weeks: 4, level: 1, auto: true, pos: { week: 0, day: 0 }, created: Date.now(), days: Array.from({ length: n }, (_, i) => ({ id: uid(), name: 'Dag ' + (i + 1), items: [] })) };
      S.programs.push(p); if (!S.activeProg) S.activeProg = p.id; save(); closeSheet(); go('#/prog/' + p.id);
    };
    openSheet(() => `<h2 style="margin-top:0">Nyt program</h2><label class="f"><span>Navn</span><input class="in" name="n" placeholder="F.eks. Pull-up specialisering"></label>
      <label class="f"><span>Dage om ugen</span></label><div class="chips">${[2, 3, 4, 5, 6].map(x => `<button class="chip ${n === x ? 'on' : ''}" data-a="nbDays" data-v="${x}">${x}</button>`).join('')}</div>
      <button class="btn pri block mt2" data-a="nbCreate">Opret</button>`);
  },
  progActive() { const p = curProg(); S.activeProg = S.activeProg === p.id ? null : p.id; save(); render(); },
  progAuto() { const p = curProg(); p.auto = !p.auto; save(); render(); },
  progWeeks(el) { const p = curProg(); p.weeks = Math.max(1, Math.min(16, p.weeks + +el.dataset.v)); save(); render(); },
  progRegen(el) {
    const p = curProg(), n = +el.dataset.v; if (n === p.days.length) return;
    if (!confirm(`Generér ${n} dage om ugen fra skabelonen? Dine ændringer i dagene overskrives.`)) return;
    const np = buildProgram(p.tpl, n, p.level, p.treeLvls || {});
    p.days = np.days; p.pos = { week: p.pos.week, day: 0 }; save(); render();
  },
  progDup() {
    // A copy is always the user's own program, also when the original came from a trainer
    const src = curProg(), p = clone(src); p.id = newId(); delete p.owner; delete p.author; p.created = Date.now();
    p.name += fromTrainer(src) ? ' (min kopi)' : ' (kopi)'; p.pos = { week: 0, day: 0 }; S.programs.push(p); save(); toast('Kopieret til dine programmer'); go('#/prog/' + p.id);
  },
  progDel() { const p = curProg(); if (!confirm('Slet “' + p.name + '”? Din træningshistorik bevares.')) return; S.programs = S.programs.filter(x => x !== p); if (S.activeProg === p.id) S.activeProg = S.programs[0] ? S.programs[0].id : null; save(); go('#/programs'); },
  addDay() { const p = curProg(); p.days.push({ id: uid(), name: 'Dag ' + (p.days.length + 1), items: [] }); save(); render(); },
  dayStart(el) { const p = curProg(); if (S.active && !confirm('Der er allerede en træning i gang. Erstat den?')) return; startWorkout(p.id, p.pos.week, +el.dataset.d); },
  dayMenu(el) {
    const p = curProg(), di = +el.dataset.d;
    openSheet(() => `<h2 style="margin-top:0">${esc(p.days[di].name)}</h2>
      <button class="btn block" data-a="dmMove" data-v="-1">↑ Flyt dag op</button><button class="btn block mt" data-a="dmMove" data-v="1">↓ Flyt dag ned</button>
      <button class="btn block mt" data-a="dmDup">Duplikér dag</button><button class="btn block mt" data-a="dmNext">Sæt som næste træning</button>
      <button class="btn danger block mt" data-a="dmDel">Slet dag</button>`);
    A.dmMove = b => { const j = di + +b.dataset.v; if (j < 0 || j >= p.days.length) return; [p.days[di], p.days[j]] = [p.days[j], p.days[di]]; save(); closeSheet(); render(); };
    A.dmDup = () => { const d = clone(p.days[di]); d.id = uid(); d.name += ' (kopi)'; d.items.forEach(it => it.id = uid()); p.days.splice(di + 1, 0, d); save(); closeSheet(); render(); };
    A.dmNext = () => { p.pos.day = di; save(); closeSheet(); render(); toast('Næste træning: ' + p.days[di].name); };
    A.dmDel = () => { if (p.days.length <= 1) return toast('Et program skal have mindst én dag'); if (!confirm('Slet dagen?')) return; p.days.splice(di, 1); clampPos(p); save(); closeSheet(); render(); };
  },
  addItem(el) { const p = curProg(), di = +el.dataset.d; pickEx('Tilføj øvelse', id => { p.days[di].items.push(newItem(id)); save(); closeSheet(); render(); }); },
  itemMove(el) { const p = curProg(), L = p.days[+el.dataset.d].items, i = +el.dataset.ii, j = i + +el.dataset.v; if (j < 0 || j >= L.length) return; [L[i], L[j]] = [L[j], L[i]]; save(); render(); },
  editItem(el) { const p = curProg(), di = +el.dataset.d, ii = +el.dataset.ii; EDIT = { p, di, ii, item: clone(p.days[di].items[ii]) }; openSheet(editSheet); },
  edChangeEx() { pickEx('Skift øvelse', id => { EDIT.item.ex = id; EDIT.item.alts = defaultAlts(id); openSheet(editSheet); }); },
  edAddAlt() { pickEx('Tilføj variant', id => { EDIT.item.alts = EDIT.item.alts || []; if (!EDIT.item.alts.includes(id) && id !== EDIT.item.ex) EDIT.item.alts.push(id); openSheet(editSheet); }); },
  edDelAlt(el) { EDIT.item.alts.splice(+el.dataset.v, 1); renderSheet(); },
  edKind(el) {
    const k = el.dataset.v, it = EDIT.item;
    if (k === 'sets') { delete it.block; delete it.circuit; if (!it.sets.length) it.sets = newItem(it.ex).sets; }
    else {
      it.block = { ladder: { kind: 'ladder', top: 5, rounds: 3, rest: 45 }, emom: { kind: 'emom', min: 10, reps: 3 }, amrap: { kind: 'amrap', min: 12 }, tabata: { kind: 'tabata', rounds: 8, work: 20, rest: 10 } }[k];
      if (k === 'amrap' && !it.circuit) it.circuit = [{ ex: it.ex, r: 5 }];
      if (k !== 'amrap') delete it.circuit;
      it.wave = 'none';
    }
    renderSheet();
  },
  edAddSet() { const it = EDIT.item, l = it.sets[it.sets.length - 1]; it.sets.push(l ? clone(l) : { r: 8, rMax: 12, rest: S.settings.rest }); renderSheet(); },
  edDelSet(el) { EDIT.item.sets.splice(+el.dataset.j, 1); renderSheet(); },
  edAddCirc() { pickEx('Øvelse i runden', id => { EDIT.item.circuit.push({ ex: id, r: 10 }); openSheet(editSheet); }); },
  edDelCirc(el) { EDIT.item.circuit.splice(+el.dataset.v, 1); renderSheet(); },
  edSave() { EDIT.p.days[EDIT.di].items[EDIT.ii] = EDIT.item; save(); closeSheet(); render(); },
  edDelete() { if (!confirm('Fjern øvelsen fra dagen?')) return; EDIT.p.days[EDIT.di].items.splice(EDIT.ii, 1); save(); closeSheet(); render(); },
  pick(el) { PICK.cb(el.dataset.id); },
  pickCat(el) { PICK.cat = el.dataset.v; renderSheet(); },

  // Statistik
  stMetric(el) { ST.metric = el.dataset.v; render(); },
  delLog(el) { if (confirm('Slet denne træning fra historikken?')) { S.logs = S.logs.filter(l => l.id !== el.dataset.id); save(); render(); } },
  newTest() { TEST = { k: 'pullup', v: '' }; openSheet(testSheet); },
  testSave() {
    const v = num(TEST.v); if (!v) return toast('Indtast et resultat');
    const t = TESTS.find(x => x.k === TEST.k);
    S.tests.push({ id: newId(), k: t.k, v, date: Date.now() });
    if (t.lift) S.rm[t.lift] = v;
    save(); closeSheet(); toast('Test gemt: ' + t.n + ' ' + fmt(v) + ' ' + t.u); render();
  },
  setRm(el) { S.rm[el.dataset.k] = +el.dataset.v; save(); el.textContent = '✓ Opdateret'; el.disabled = true; },

  // Indstillinger
  setToggle(el) { S.settings[el.dataset.k] = !S.settings[el.dataset.k]; save(); render(); },
  testSound() { const s = S.settings.sound; S.settings.sound = true; beep(990, .2, 3); S.settings.sound = s; buzz([300, 120, 300]); },
  install() { if (DEFER) { DEFER.prompt(); DEFER.userChoice.finally(() => { DEFER = null; render(); }); } },
  export() {
    const name = 'powerkrop-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    PLATFORM.saveTextFile(name, JSON.stringify(Object.assign({}, S, { v: FORMAT_VERSION, active: null }), null, 1), 'application/json')
      .catch(() => toast('Kunne ikke eksportere backup'));
  },
  // Login
  toInvite() { AUTHFORM = { busy: false, error: '' }; go('#/invite'); },
  toLogin() { AUTHFORM = { busy: false, error: '' }; go('#/login'); },
  async doLogin() {
    const email = $('#li-email').value, pw = $('#li-pw').value;
    if (!email.trim() || !pw) { AUTHFORM.error = 'Udfyld e-mail og password'; return render(); }
    AUTHFORM = { busy: true, error: '' }; render();
    try {
      const p = await AUTH.login(email, pw);
      AUTHFORM = { busy: false, error: '' }; toast('Velkommen, ' + p.display_name); go('#/');
    } catch (e) {
      AUTHFORM = { busy: false, error: e.message }; render();
      const el = $('#li-email'); if (el) el.value = email;
    }
  },
  async doInvite() {
    const raw = $('#iv-token').value, token = inviteTokenFrom(raw), pw = $('#iv-pw').value, pw2 = $('#iv-pw2').value;
    // render() rebuilds the form, so a typed code is put back (passwords are deliberately not)
    const keep = () => { const el = $('#iv-token'); if (el && el.type !== 'hidden') el.value = raw; };
    if (!token) { AUTHFORM.error = 'Indsæt invitationskoden eller linket'; render(); return keep(); }
    if (pw.length < 10) { AUTHFORM.error = 'Passwordet skal være mindst 10 tegn'; render(); return keep(); }
    if (pw !== pw2) { AUTHFORM.error = 'De to passwords er ikke ens'; render(); return keep(); }
    AUTHFORM = { busy: true, error: '' }; render();
    try {
      const p = await AUTH.acceptInvite(token, pw);
      AUTHFORM = { busy: false, error: '' }; toast('Velkommen, ' + p.display_name); go('#/');
    } catch (e) {
      AUTHFORM = { busy: false, error: e.message }; render(); keep();
    }
  },
  async syncNow() { if (updateRequired()) return toast('Opdatér appen for at synkronisere'); await SYNC.run(); render(); },
  getUpdate() { PLATFORM.openExternal(API_BASE_URL + '/app'); },
  async logout() {
    // Unsynced changes stay in this user's database on the phone and are sent at the next login
    await flushSave();
    const n = await SYNC.pending().catch(() => 0);
    const msg = n
      ? `Du har ${n} ændring${n === 1 ? '' : 'er'}, der ikke er synkroniseret endnu.\n\nDe bliver liggende på telefonen og sendes, næste gang du logger ind her – men de går tabt, hvis appen afinstalleres eller dens data ryddes.\n\nLog ud alligevel?`
      : 'Log ud? Dine data er gemt på din konto.';
    if (!confirm(msg)) return;
    await AUTH.logout(); AUTHFORM = { busy: false, error: '' }; go('#/login');
  },
  async reset() {
    if (!AUTH.loggedIn()) {
      if (confirm('Slet ALLE programmer, logs og indstillinger på denne enhed?') && confirm('Er du helt sikker? Det kan ikke fortrydes.')) { S = defaults(); save(); go('#/'); }
      return;
    }
    // With an account an empty S would be synced as deletions of everything on the server. Only the copy on this
    // phone is removed; the account's data is fetched again afterwards.
    await flushSave();
    const n = await SYNC.pending().catch(() => 0);
    const warn = n ? `

ADVARSEL: ${n} ændringer er ikke synkroniseret endnu og går tabt.` : '';
    if (!confirm('Slet data på denne telefon? Dine data på kontoen bevares og hentes igen.' + warn)) return;
    const id = AUTH.profile.id;
    STORE.close(); STORE_KEY = null;
    try { await Dexie.delete('powerkrop-' + id); } catch (e) { console.error(e); toast('Kunne ikke slette data på telefonen'); }
    await boot(); go('#/');
  },
};

// Input-ændringer
const C = {
  variant(el) { const a = S.active.items[+el.dataset.i]; a.ex = el.value; if (!a.sets.some(s => s.done)) fillSets(a, a.sets.map(s => s.tgt)); else a.hint = null; save(); render(); },
  setv(el) { const s = S.active.items[+el.dataset.i].sets[+el.dataset.j]; s[el.dataset.f] = el.value; save(); },
  blockRes(el) { const a = S.active.items[+el.dataset.i]; a.result = a.result || {}; a.result[a.block.kind === 'amrap' ? 'rounds' : 'reps'] = num(el.value); save(); },
  video(el) { const v = el.value.trim(); if (v && !ytId(v)) return toast('Det ligner ikke et YouTube-link'); if (v) S.videos[el.dataset.id] = v; else delete S.videos[el.dataset.id]; save(); render(); },
  rm(el) { S.rm[el.dataset.k] = num(el.value); save(); },
  setNum(el) { S.settings[el.dataset.k] = num(el.value) || defaults().settings[el.dataset.k]; save(); },
  setupTree(el) { SETUP.lv[el.dataset.k] = +el.value; },
  progName(el) { curProg().name = el.value.trim() || 'Program'; save(); },
  dayName(el) { curProg().days[+el.dataset.d].name = el.value.trim() || 'Dag'; save(); },
  edWave(el) { EDIT.item.wave = el.value; renderSheet(); },
  edLift(el) {
    const it = EDIT.item; it.lift = el.value || null;
    it.sets.forEach(s => { if (it.lift) { s.pct = s.pct || 70; delete s.kg; } else { delete s.pct; } });
    renderSheet();
  },
  edSet(el) {
    const s = EDIT.item.sets[+el.dataset.j], f = el.dataset.f;
    if (f === 'rpe') { s.amrap = el.value === 'max'; s.rpe = s.amrap || !el.value ? undefined : +el.value; if (s.amrap && !s.r) s.r = 1; return; }
    if (el.value === '') delete s[f]; else s[f] = num(el.value);
  },
  edBlock(el) { const k = el.dataset.k; EDIT.item.block[k] = k === 'down' ? !!el.value : num(el.value); },
  edCirc(el) { EDIT.item.circuit[+el.dataset.v].r = num(el.value); },
  edNote(el) { EDIT.item.note = el.value; },
  stEx(el) { ST.ex = el.value; ST.metric = null; render(); },
  testK(el) { TEST.k = el.value; renderSheet(); },
  testV(el) { TEST.v = el.value; },
  import(el) {
    const f = el.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        // Reads both old backups (format v1, 8-character ids) and new ones (v2, UUIDs)
        const d = migrateLegacyState(JSON.parse(r.result));
        d.programs = d.programs.map(sanitizeProgram);   // a backup file is untrusted input
        if (AUTH.loggedIn()) {
          // With an account the backup is merged in: replacing would delete data on the server through sync
          const m = mergeImport(S, d), a = m.added;
          if (!a.programs && !a.logs && !a.tests && !a.customEx) return toast('Alt i filen findes allerede på din konto');
          const msg = `Tilføj til din konto:\n• ${a.programs} programmer\n• ${a.logs} træninger\n• ${a.tests} maks-tests` +
            (a.customEx ? `\n• ${a.customEx} egne øvelser` : '') +
            (m.skipped.programs + m.skipped.logs ? `\n\n${m.skipped.programs + m.skipped.logs} findes allerede og springes over.` : '');
          if (!confirm(msg)) return;
          S = withDefaults(m.state); flushSave(); scheduleSync(0); toast('Backup importeret'); go('#/');
          return;
        }
        if (!confirm(`Importér backup med ${d.programs.length} programmer og ${d.logs.length} træninger? Nuværende data erstattes.`)) return;
        S = withDefaults(d); flushSave(); toast('Backup importeret'); go('#/');
      } catch (e) { toast('Ugyldig backup-fil'); }
    };
    r.readAsText(f);
  },
};
// Live-søgning
const IN = {
  libQ(el) { LIB.q = el.value; $('#liblist').innerHTML = libList(); },
  pickQ(el) { PICK.q = el.value; $('#picklist').innerHTML = pickList(libFilter(PICK.q, PICK.cat)); },
  testV(el) { TEST.v = el.value; },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]');
  if (!el) return;
  const fn = A[el.dataset.a];
  if (fn) { e.preventDefault(); fn(el, e); }
});
// In the Android app, external links (YouTube etc.) open in the system browser instead of inside the WebView
document.addEventListener('click', e => {
  const a = PLATFORM.native && e.target.closest('a[target=_blank]');
  if (a && /^https?:/.test(a.href)) { e.preventDefault(); PLATFORM.openExternal(a.href); }
});
// Forms (login): submit via the button or the keyboard's Go key
document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-submit]');
  if (!f) return;
  e.preventDefault();
  if (!AUTHFORM.busy && A[f.dataset.submit]) A[f.dataset.submit](f, e);
});
document.addEventListener('change', e => { const el = e.target.closest('[data-c]'); if (el && C[el.dataset.c]) C[el.dataset.c](el); });
document.addEventListener('input', e => { const el = e.target.closest('[data-in]'); if (el && IN[el.dataset.in]) IN[el.dataset.in](el); });
// Vælg hele indholdet ved fokus i talfelter – hurtigere at rette på telefonen
document.addEventListener('focusin', e => { if (e.target.matches('.sets input, .setrow input')) setTimeout(() => e.target.select(), 0); });

// Opdatér træningsur hvert minut
setInterval(() => { if ((ROUTE[0] || '') === 'workout' && !SHEET && !document.activeElement.matches('input,select,textarea')) render(); }, 60000);

// The Android app ships every file in the APK, so it needs no service worker
if (!PLATFORM.native && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => { });
}
// Invite links (App Links) open the activation screen with the token filled in
PLATFORM.onDeepLink(url => {
  const token = inviteTokenFrom((url.match(/\/invite\/([^?#]+)/) || [])[1]);
  if (!token) return;
  if (AUTH.loggedIn()) { toast('Du er allerede logget ind – log ud for at bruge invitationen'); return; }
  AUTHFORM = { busy: false, error: '' }; go('#/invite/' + encodeURIComponent(token));
});
// A session that has been revoked on the server (logged out elsewhere, account disabled) ends here
// Login, logout and a session revoked on the server all switch to the right user's database
AUTH.onChange(() => boot());
AUTH.verify();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { AUTH.verify(); checkUpdate(); } });
checkUpdate();

boot();
