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
  // A log that gets ids is replaced by a new object: logs are treated as immutable (js/store.js caches their JSON).
  function ensureIds(S) {
    let changed = false;
    (S.logs || []).forEach((l, i) => {
      if (!(l.items || []).some(it => (it.sets || []).some(s => !s.sid))) return;
      S.logs[i] = Object.assign({}, l, { items: l.items.map(it => Object.assign({}, it, {
        sets: (it.sets || []).map(s => (s.sid ? s : Object.assign({}, s, { sid: ids.newId() }))),
      })) });
      changed = true;
    });
    return changed;
  }

  // A program from the server or a backup file is someone else's data: keep only the fields the app knows,
  // with the expected types, so nothing unexpected (e.g. markup in a number field) reaches the UI.
  const numOrUndef = v => (typeof v === 'number' && isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && isFinite(+v) ? +v : undefined));
  const EX_ID = /^[A-Za-z0-9_-]{1,64}$/;
  const SET_NUMS = ['r', 'rMax', 't', 'tMax', 'kg', 'pct', 'rpe', 'rest'];
  const BLOCK_NUMS = ['top', 'rounds', 'rest', 'min', 'reps', 'work'];
  const BLOCK_KINDS = ['ladder', 'emom', 'amrap', 'tabata'];
  // Only fields that are present are touched, so valid data passes through unchanged (sync stays lossless)
  const fixNum = (o, k) => { if (k in o && o[k] !== null) { const v = numOrUndef(o[k]); if (v === undefined) delete o[k]; else o[k] = v; } };
  const fixStr = (o, k, max) => { if (k in o && o[k] !== null) { if (typeof o[k] === 'string') o[k] = o[k].slice(0, max); else delete o[k]; } };
  const fixBool = (o, k) => { if (k in o) o[k] = !!o[k]; };
  function sanitizeItem(src) {
    const it = Object.assign({}, src);
    fixStr(it, 'id', 64);
    // Exercise ids are a fixed format (kebab-case or my-<uid>); anything else could carry markup into the UI
    if ('ex' in it && !EX_ID.test(it.ex)) it.ex = '';
    fixStr(it, 'wave', 16); fixStr(it, 'lift', 16); fixStr(it, 'note', 1000);
    if ('alts' in it) it.alts = Array.isArray(it.alts) ? it.alts.filter(x => EX_ID.test(x)) : [];
    if ('sets' in it) it.sets = (Array.isArray(it.sets) ? it.sets : []).filter(x => x && typeof x === 'object').map(x => {
      const o = Object.assign({}, x); SET_NUMS.forEach(k => fixNum(o, k)); fixBool(o, 'amrap'); fixBool(o, 'deload'); return o;
    });
    if ('block' in it && it.block !== null) {
      if (it.block && typeof it.block === 'object' && BLOCK_KINDS.includes(it.block.kind)) {
        const b = Object.assign({}, it.block); BLOCK_NUMS.forEach(k => fixNum(b, k)); fixBool(b, 'down'); it.block = b;
      } else delete it.block;
    }
    if ('circuit' in it && it.circuit !== null) {
      it.circuit = Array.isArray(it.circuit) ? it.circuit.filter(c => c && typeof c === 'object')
        .map(c => ({ ex: EX_ID.test(c.ex) ? c.ex : '', r: numOrUndef(c.r) || 1 })) : undefined;
      if (!it.circuit) delete it.circuit;
    }
    return it;
  }
  function sanitizeProgram(src) {
    const p = Object.assign({}, src);
    fixStr(p, 'name', 200); if (!p.name) p.name = 'Program';
    fixStr(p, 'tpl', 64); fixStr(p, 'desc', 4000);
    if ('weeks' in p) p.weeks = Math.max(1, Math.min(52, Math.round(numOrUndef(p.weeks) || 4)));
    fixNum(p, 'created'); fixBool(p, 'auto');
    if ('level' in p && ![0, 1, 2].includes(p.level)) p.level = 0;
    if ('treeLvls' in p) p.treeLvls = p.treeLvls && typeof p.treeLvls === 'object'
      ? Object.fromEntries(Object.entries(p.treeLvls).map(([k, v]) => [String(k).slice(0, 32), Math.round(numOrUndef(v) || 0)])) : {};
    p.days = (Array.isArray(p.days) ? p.days : []).filter(d => d && typeof d === 'object').map(d => {
      const o = Object.assign({}, d); fixStr(o, 'id', 64); fixStr(o, 'name', 200);
      o.items = (Array.isArray(d.items) ? d.items : []).filter(x => x && typeof x === 'object').map(sanitizeItem);
      return o;
    });
    if (p.pos && typeof p.pos === 'object') p.pos = { week: Math.max(0, Math.round(numOrUndef(p.pos.week) || 0)), day: Math.max(0, Math.round(numOrUndef(p.pos.day) || 0)) };
    return p;
  }

  // One app program ↔ one row in `programs`. Shared with the admin website, so both write the same shape.
  function programToRow(p, ownerId) {
    return {
      id: p.id, owner_id: p.owner || ownerId, name: text(p.name, 200) || 'Program',
      template_key: text(p.tpl, 64), level: LEVELS[p.level] || null,
      days_per_week: p.days && p.days.length >= 1 && p.days.length <= 7 ? p.days.length : null,
      data: omit(p, ['id', 'name', 'pos', 'owner', 'author']),
    };
  }
  function rowToProgram(r, me) {
    const p = sanitizeProgram(Object.assign({}, r.data, { id: r.id, name: r.name }));
    if (r.owner_id !== me || (r.created_by && r.created_by !== me)) Object.assign(p, { owner: r.owner_id, author: r.created_by });
    return p;
  }

  function stateToRows(S, me) {
    const out = new Map();
    const add = (table, key, row) => out.set(table + '|' + key, { table, row });

    const programIds = new Set();
    for (const p of S.programs || []) {
      if (!ids.isUuid(p.id)) continue;
      programIds.add(p.id);
      add('programs', p.id, programToRow(p, me));
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

  // An id → entity index over a list, applied back in one go (avoids a linear search per pulled row)
  function indexed(list) {
    const m = new Map(list.map(x => [x.id, x]));
    let dirty = false;
    return {
      get: id => m.get(id),
      put: e => { m.set(e.id, e); dirty = true; },
      del: id => { dirty = m.delete(id) || dirty; },
      apply: target => { if (dirty) { target.length = 0; for (const v of m.values()) target.push(v); } },
    };
  }
  const setKeys = log => ((log && log.items) || []).flatMap(it => (it.sets || []).filter(s => s.sid).map(s => 'set_logs|' + s.sid));

  // Applies /sync/pull changes to S. Returns the keys that were applied (or removed), so the engine can mark
  // them as "the server has this". Programs written for other users (a trainer's own device) are left out for now.
  // A workout's sets are acknowledged together with the workout (the set_logs rows are derived from it).
  function applyRows(S, changes, me) {
    const applied = [];
    const done = (table, r) => applied.push(keyOf(table, r));
    const programs = indexed(S.programs), logs = indexed(S.logs), tests = indexed(S.tests), custom = indexed(S.customEx);
    for (const table of TABLE_ORDER) for (const r of (changes[table] || [])) {
      const gone = !!r.deleted_at;
      switch (table) {
        case 'programs': {
          if (r.owner_id !== me) continue;
          const old = programs.get(r.id);
          if (gone) { programs.del(r.id); if (S.activeProg === r.id) S.activeProg = null; }
          else {
            const p = rowToProgram(r, me);
            if (old && old.pos) p.pos = old.pos;
            programs.put(p);
          }
          break;
        }
        case 'program_progress': {
          const p = programs.get(r.program_id);
          if (!p) continue;
          const np = Object.assign({}, p);
          if (gone) delete np.pos; else np.pos = { week: r.week, day: r.day };
          programs.put(np);
          break;
        }
        case 'workout_sessions': {
          const old = logs.get(r.id);
          if (gone) { applied.push(...setKeys(old)); logs.del(r.id); }
          else { const l = Object.assign({}, r.data, { id: r.id, progId: r.program_id }); logs.put(l); applied.push(...setKeys(old), ...setKeys(l)); }
          break;
        }
        case 'set_logs':
          break;   // derived from the session's data; acknowledged together with it
        case 'training_maxes':
          S.rm[r.lift_key] = gone ? 0 : (r.one_rm_kg || 0);
          break;
        case 'user_exercise_videos':
          if (gone) delete S.videos[r.exercise_id]; else S.videos[r.exercise_id] = r.url;
          break;
        case 'max_tests':
          if (gone) tests.del(r.id);
          else tests.put({ id: r.id, k: r.test_key, v: r.value, date: ms(r.tested_at) });
          break;
        case 'user_settings':
          S.settings = Object.assign({}, S.settings, r.data && r.data.settings);
          S.activeProg = (r.data && r.data.activeProgramId) || null;
          break;
        case 'custom_exercises':
          if (gone) custom.del(r.exercise_id);
          else custom.put(Object.assign({}, r.data, { id: r.exercise_id }));
          break;
      }
      done(table, r);
    }
    programs.apply(S.programs); logs.apply(S.logs); tests.apply(S.tests); custom.apply(S.customEx);
    S.logs.sort((a, b) => (a.date || 0) - (b.date || 0));
    S.tests.sort((a, b) => (a.date || 0) - (b.date || 0));
    return applied;
  }

  return { TABLE_ORDER, stableStringify, ensureIds, sanitizeProgram, programToRow, rowToProgram, stateToRows, applyRows, keyOf };
});
