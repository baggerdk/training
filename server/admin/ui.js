// Small UI helpers shared by the admin views: escaping, toast, modal, router and event delegation.
'use strict';

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; };
const fmt = n => (Math.round(n * 10) / 10).toString().replace('.', ',');
const clone = o => JSON.parse(JSON.stringify(o));
const dkDate = ts => (ts ? new Date(ts).toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' }) : '–');
const ROLE_NAMES = { admin: 'Admin', trainer: 'Træner', user: 'Bruger' };
const LEVEL_TEXT = ['begynder', 'øvet', 'avanceret'];   // programs.level in the database

let toastTimer = null;
function toast(msg, ms) {
  const el = $('#toast');
  el.textContent = msg; el.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), ms || 3000);
}

// Modal: openModal(title, html) – content events go through the same data-a handlers
function openModal(title, html) {
  const m = $('#modal');
  m.innerHTML = `<div class="box" role="dialog" aria-modal="true"><div class="head"><h3 class="grow" style="margin:0">${esc(title)}</h3>
    <button class="btn sm ghost" data-a="closeModal">Luk</button></div><div class="body">${html}</div></div>`;
  m.classList.remove('hidden');
}
function closeModal() { const m = $('#modal'); m.classList.add('hidden'); m.innerHTML = ''; }

function exThumb(ex) {
  if (ex && ex.img) return `<img class="thumb" loading="lazy" src="img/ex/${esc(ex.img)}/0.jpg" alt="">`;
  const ini = ex ? ex.n.replace(/[^A-Za-zÆØÅæøå ]/g, '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() : '?';
  return `<div class="thumb">${esc(ini)}</div>`;
}
const exName = id => { const e = exById(id); return e ? e.n : id; };

// Router: #/path/segments?query → VIEWS[path[0]]
let ROUTE = [], QUERY = new URLSearchParams();
const ACTIONS = {}, CHANGES = {}, INPUTS = {}, SUBMITS = {};
const VIEWS = {};
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
async function render() {
  const raw = (location.hash || '#/').slice(2), [path, qs] = raw.split('?');
  ROUTE = path.split('/').filter(Boolean).map(decodeURIComponent);
  QUERY = new URLSearchParams(qs || '');
  let v = ROUTE[0] || 'users';
  if (!API.loggedIn()) v = 'login';
  renderNav(v);
  const view = VIEWS[v] || VIEWS.users;
  try {
    const html = await view();
    if (html !== undefined) $('#app').innerHTML = html;
  } catch (e) {
    if (e && e.status === 401) { go('#/login'); return; }
    $('#app').innerHTML = `<div class="hint err">${esc(e.message || e)}</div>`;
  }
}
function renderNav(v) {
  if (!API.loggedIn()) { $('#nav').innerHTML = ''; return; }
  const p = API.profile, link = (h, label, key) => `<a href="${h}" class="${v === key ? 'on' : ''}">${label}</a>`;
  $('#nav').innerHTML = link('#/', API.isAdmin() ? 'Brugere' : 'Mine brugere', 'users') + link('#/templates', 'Skabeloner', 'templates') +
    `<span class="me">${esc(p.display_name)} · ${ROLE_NAMES[p.role]}</span><button class="btn sm ghost" data-a="logout">Log ud</button>`;
}
window.addEventListener('hashchange', () => { closeModal(); render(); });

document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]');
  if (el && ACTIONS[el.dataset.a]) { e.preventDefault(); ACTIONS[el.dataset.a](el, e); }
  else if (e.target.id === 'modal') closeModal();
});
document.addEventListener('change', e => { const el = e.target.closest('[data-c]'); if (el && CHANGES[el.dataset.c]) CHANGES[el.dataset.c](el, e); });
document.addEventListener('input', e => { const el = e.target.closest('[data-in]'); if (el && INPUTS[el.dataset.in]) INPUTS[el.dataset.in](el, e); });
document.addEventListener('submit', e => { const f = e.target.closest('form[data-submit]'); if (f) { e.preventDefault(); SUBMITS[f.dataset.submit](f, e); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

ACTIONS.closeModal = closeModal;
ACTIONS.logout = async () => { await API.logout(); go('#/login'); };
ACTIONS.copy = async el => {
  const input = document.getElementById(el.dataset.target);
  try { await navigator.clipboard.writeText(input.value); toast('Kopieret'); } catch (e) { input.select(); toast('Markeret – tryk Ctrl+C'); }
};
