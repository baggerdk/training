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

  return { FORMAT_VERSION, LEGACY_KEY, migrateLegacyState };
});
