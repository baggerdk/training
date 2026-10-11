// Loads the app's real browser scripts (classic scripts with globals) into an isolated context for tests.
// Ids are made deterministic so generated programs can be compared with saved snapshots.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const FILES = ['js/ids.js', 'js/data.js', 'js/templates.js', 'js/progression.js', 'js/equipment.js', 'js/guide.js'];

export function loadAppLogic() {
  const ctx = { console, crypto: globalThis.crypto };
  vm.createContext(ctx);
  for (const f of FILES) vm.runInContext(readFileSync(new URL('../../' + f, import.meta.url), 'utf8'), ctx, { filename: f });
  let n = 0, u = 0;
  ctx.newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  ctx.uid = () => 'id' + String(++u).padStart(6, '0');
  ctx.resetIds = () => { n = 0; u = 0; };
  // const declarations aren't properties of the context, so expose them explicitly
  vm.runInContext('Object.assign(this, { EXERCISES, TREES, TEMPLATES, LEVELS, LIFTS, PROG, GUIDE, EQUIPMENT, buildProgram, targetsFor, templateTrees, treeOf, defaultAlts })', ctx);
  return ctx;
}
