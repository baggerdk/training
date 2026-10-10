// Translation between the app's state S and the server's sync tables (server/api/src/sync/tables.ts).
//
// stateToRows(S, me) → Map 'table|key' → { table, row } is everything the server should have.
// applyRows(S, changes, me) merges rows from /sync/pull into S.
// A row produced from S, applied to an empty S and produced again must be identical (tested), otherwise the
// sync engine would keep pushing the same data back and forth.
(function (root, factory) {
  const ids = typeof module === 'object' && module.exports ? require('./ids.js') : root;
  const m = factory(ids);
  if (typeof module === 'object' && module.exports) module.exports = m; else Object.assign(root, m);
})(this, function (ids) {
  'use strict';

  // Push order: a row must come after the rows it references (programs → progress/sessions → sets)
  const TABLE_ORDER = ['programs', 'program_progress', 'workout_sessions', 'set_logs', 'training_maxes',
    'user_exercise_videos', 'max_tests', 'user_settings', 'custom_exercises'];
  const LEVELS = ['begynder', 'øvet', 'avanceret'];
  const TEST_UNITS = { plank: 's', lsit: 's', hang: 's', rm_squat: 'kg', rm_bench: 'kg', rm_deadlift: 'kg', rm_ohp: 'kg' };

  const iso = ms => (typeof ms === 'number' && isFinite(ms) ? new Date(ms).toISOString() : null);
  const ms = s => (s ? Date.parse(s) : null);
  const int = v => (typeof v === 'number' && isFinite(v) && v >= 0 ? Math.round(v) : null);
  const pos = v => (typeof v === 'number' && isFinite(v) && v > 0 ? v : null);
  const text = (v, max) => (typeof v === 'string' && v.length ? v.slice(0, max) : null);
  const omit = (o, keys) => { const r = {}; for (const k of Object.keys(o)) if (!keys.includes(k)) r[k] = o[k]; return r; };

  // JSON with sorted keys, so Postgres' jsonb key order never looks like a change
  function stableStringify(v) {
    if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }

  // Every logged set needs a stable id for its set_logs row. Returns true if S was changed (then save it).
  function ensureIds(S) {
    let changed = false;
    for (const l of S.logs || []) for (const it of l.items || []) for (const s of it.sets || []) {
      if (!s.sid) { s.sid = ids.newId(); changed = true; }
    }
    return changed;
  }

  function stateToRows(S, me) {
    const out = new Map();
    const add = (table, key, row) => out.set(table + '|' + key, { table, row });

    const programIds = new Set();
    for (const p of S.programs || []) {
      if (!ids.isUuid(p.id)) continue;
      programIds.add(p.id);
      add('programs', p.id, {
        id: p.id, owner_id: p.owner || me, name: text(p.name, 200) || 'Program',
        template_key: text(p.tpl, 64), level: LEVELS[p.level] || null,
        days_per_week: p.days && p.days.length >= 1 && p.days.length <= 7 ? p.days.length : null,
        data: omit(p, ['id', 'name', 'pos', 'owner', 'author']),
      });
      if (p.pos) add('program_progress', p.id, { program_id: p.id, week: int(p.pos.week) || 0, day: int(p.pos.day) || 0 });
    }

    for (const l of S.logs || []) {
      if (!ids.isUuid(l.id)) continue;
      add('workout_sessions', l.id, {
        id: l.id, program_id: l.progId && programIds.has(l.progId) ? l.progId : null,
        week_index: int(l.week), day_index: int(l.day), name: text(l.name, 200),
        started_at: iso(l.start || l.date), finished_at: iso(l.date),
        data: omit(l, ['id', 'progId']),
      });
      (l.items || []).forEach((it, ii) => (it.sets || []).forEach((s, si) => {
        if (!s.sid || !it.ex) return;
        add('set_logs', s.sid, {
          id: s.sid, session_id: l.id, exercise_id: String(it.ex).slice(0, 64), item_index: ii, set_index: si,
          reps: int(s.r) || null, weight_kg: pos(s.kg), duration_s: int(s.t) || null,
          rpe: s.rpe > 0 && s.rpe <= 10 ? s.rpe : null, target: s.tgt && typeof s.tgt === 'object' ? s.tgt : null,
          logged_at: iso(l.date),
        });
      }));
    }

    for (const [lift, kg] of Object.entries(S.rm || {})) add('training_maxes', lift, { lift_key: lift, one_rm_kg: typeof kg === 'number' && kg >= 0 ? kg : 0 });
    for (const [ex, url] of Object.entries(S.videos || {})) {
      if (typeof url === 'string' && /^https:\/\//.test(url) && url.length <= 500) add('user_exercise_videos', ex, { exercise_id: ex, url });
    }
    for (const t of S.tests || []) {
      if (!ids.isUuid(t.id)) continue;
      add('max_tests', t.id, { id: t.id, test_key: String(t.k).slice(0, 64), value: Math.max(0, Number(t.v) || 0), unit: TEST_UNITS[t.k] || 'reps', tested_at: iso(t.date) });
    }
    add('user_settings', 'me', { data: { settings: S.settings || {}, activeProgramId: S.activeProg || null } });
    for (const e of S.customEx || []) {
      if (/^my-/.test(e.id)) add('custom_exercises', e.id, { exercise_id: e.id, data: omit(e, ['id']) });
    }
    return out;
  }

  const keyOf = (table, r) => table + '|' + ({
    program_progress: r.program_id, training_maxes: r.lift_key, user_exercise_videos: r.exercise_id,
    user_settings: 'me', custom_exercises: r.exercise_id,
  }[table] || r.id);

  function upsertById(list, entity) {
    const i = list.findIndex(x => x.id === entity.id);
    if (i >= 0) list[i] = entity; else list.push(entity);
  }
  const removeById = (list, id) => { const i = list.findIndex(x => x.id === id); if (i >= 0) list.splice(i, 1); };

  // Applies /sync/pull changes to S. Returns the keys that were applied (or removed), so the engine can mark
  // them as "the server has this". Programs written for other users (a trainer's own device) are left out for now.
  function applyRows(S, changes, me) {
    const applied = [];
    const done = (table, r) => applied.push(keyOf(table, r));
    for (const table of TABLE_ORDER) for (const r of (changes[table] || [])) {
      const gone = !!r.deleted_at;
      switch (table) {
        case 'programs': {
          if (r.owner_id !== me) continue;
          const old = S.programs.find(p => p.id === r.id);
          if (gone) { removeById(S.programs, r.id); if (S.activeProg === r.id) S.activeProg = null; }
          else {
            const p = Object.assign({}, r.data, { id: r.id, name: r.name });
            if (r.owner_id !== me || (r.created_by && r.created_by !== me)) Object.assign(p, { owner: r.owner_id, author: r.created_by });
            if (old && old.pos) p.pos = old.pos;
            upsertById(S.programs, p);
          }
          break;
        }
        case 'program_progress': {
          const p = S.programs.find(x => x.id === r.program_id);
          if (!p) continue;
          if (gone) delete p.pos; else p.pos = { week: r.week, day: r.day };
          break;
        }
        case 'workout_sessions':
          if (gone) removeById(S.logs, r.id);
          else upsertById(S.logs, Object.assign({}, r.data, { id: r.id, progId: r.program_id }));
          break;
        case 'set_logs':
          break;   // derived from the session's data; only acknowledged
        case 'training_maxes':
          S.rm[r.lift_key] = gone ? 0 : (r.one_rm_kg || 0);
          break;
        case 'user_exercise_videos':
          if (gone) delete S.videos[r.exercise_id]; else S.videos[r.exercise_id] = r.url;
          break;
        case 'max_tests':
          if (gone) removeById(S.tests, r.id);
          else upsertById(S.tests, { id: r.id, k: r.test_key, v: r.value, date: ms(r.tested_at) });
          break;
        case 'user_settings':
          S.settings = Object.assign({}, S.settings, r.data && r.data.settings);
          S.activeProg = (r.data && r.data.activeProgramId) || null;
          break;
        case 'custom_exercises':
          if (gone) removeById(S.customEx, r.exercise_id);
          else upsertById(S.customEx, Object.assign({}, r.data, { id: r.exercise_id }));
          break;
      }
      done(table, r);
    }
    S.logs.sort((a, b) => (a.date || 0) - (b.date || 0));
    S.tests.sort((a, b) => (a.date || 0) - (b.date || 0));
    return applied;
  }

  return { TABLE_ORDER, stableStringify, ensureIds, stateToRows, applyRows, keyOf };
});
