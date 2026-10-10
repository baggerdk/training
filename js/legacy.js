// Converts data from the old account-free app (format v1: 8-character ids, stored in localStorage under
// 'stalkrop-v1', also the format of old JSON backups) to format v2, where everything the server stores has a UUID.
// Pure function: the input is not modified. References (log.progId, activeProg, active.progId) follow their program.
(function (root, factory) {
  const ids = typeof module === 'object' && module.exports ? require('./ids.js') : root;
  const m = factory(ids);
  if (typeof module === 'object' && module.exports) module.exports = m; else Object.assign(root, m);
})(this, function (ids) {
  'use strict';
  const FORMAT_VERSION = 2;
  const LEGACY_KEY = 'stalkrop-v1';

  function migrateLegacyState(old, makeId) {
    if (!old || typeof old !== 'object' || !Array.isArray(old.programs) || !Array.isArray(old.logs)) {
      throw new Error('Filen ligner ikke en backup fra power-krop');
    }
    makeId = makeId || ids.newId;
    const s = JSON.parse(JSON.stringify(old));
    if ((s.v || 1) >= FORMAT_VERSION) return s;

    const programIds = {};
    const keepOrNew = id => (ids.isUuid(id) ? id : makeId());
    s.programs = s.programs.map(p => { const id = keepOrNew(p.id); programIds[p.id] = id; return Object.assign(p, { id }); });
    // A log of a deleted program loses the reference (it pointed to nothing before either)
    const progRef = id => (id && programIds[id]) || null;
    s.logs = s.logs.map(l => Object.assign(l, { id: keepOrNew(l.id), progId: progRef(l.progId) }));
    s.tests = (s.tests || []).map(t => Object.assign(t, { id: keepOrNew(t.id) }));
    s.activeProg = progRef(s.activeProg);
    if (s.active && s.active.progId) s.active.progId = progRef(s.active.progId);
    s.v = FORMAT_VERSION;
    return s;
  }

  // Merges an imported backup (already converted with migrateLegacyState) into the current state without
  // deleting anything – with sync, replacing would delete everything on the server that isn't in the file.
  // Duplicates are recognised by id and by content, so importing the same old backup twice adds nothing
  // (its 8-character ids get new UUIDs on every conversion). Pure: returns a new state and a summary.
  function mergeImport(current, incoming) {
    const s = JSON.parse(JSON.stringify(current)), inc = JSON.parse(JSON.stringify(incoming));
    const added = { programs: 0, logs: 0, tests: 0, customEx: 0 }, skipped = { programs: 0, logs: 0, tests: 0, customEx: 0 };
    ['programs', 'logs', 'tests', 'customEx'].forEach(k => { s[k] = s[k] || []; inc[k] = inc[k] || []; });

    // Programs: same id, or same name created at the same moment
    const progFp = p => (p.name || '') + '|' + (p.created || '');
    const progMap = {};
    for (const p of inc.programs) {
      const same = s.programs.find(x => x.id === p.id || progFp(x) === progFp(p));
      if (same) { progMap[p.id] = same.id; skipped.programs++; } else { s.programs.push(p); progMap[p.id] = p.id; added.programs++; }
    }
    // Workouts: same id, or the same workout (finished at the same moment with the same name)
    const logFp = l => (l.date || '') + '|' + (l.name || '') + '|' + (l.start || '');
    for (const l of inc.logs) {
      if (s.logs.some(x => x.id === l.id || logFp(x) === logFp(l))) { skipped.logs++; continue; }
      s.logs.push(Object.assign(l, { progId: l.progId ? progMap[l.progId] || null : null }));
      added.logs++;
    }
    for (const t of inc.tests) {
      if (s.tests.some(x => x.id === t.id || (x.k === t.k && x.date === t.date))) { skipped.tests++; continue; }
      s.tests.push(t); added.tests++;
    }
    for (const e of inc.customEx) {
      if (s.customEx.some(x => x.id === e.id)) { skipped.customEx++; continue; }
      s.customEx.push(e); added.customEx++;
    }
    s.logs.sort((a, b) => (a.date || 0) - (b.date || 0));
    s.tests.sort((a, b) => (a.date || 0) - (b.date || 0));

    // Videos and 1RM only fill gaps; the current settings and active program win
    s.videos = Object.assign({}, inc.videos, s.videos);
    s.rm = Object.assign({}, s.rm);
    for (const [lift, kg] of Object.entries(inc.rm || {})) if (!s.rm[lift] && kg) s.rm[lift] = kg;
    if (!s.activeProg && inc.activeProg) s.activeProg = progMap[inc.activeProg] || null;
    return { state: s, added, skipped };
  }

  return { FORMAT_VERSION, LEGACY_KEY, migrateLegacyState, mergeImport };
});
