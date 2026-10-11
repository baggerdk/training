import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createStore } = require('../js/store.js');
const { migrateLegacyState } = require('../js/legacy.js');
const { newId } = require('../js/ids.js');

const defaults = () => ({ v: 2, programs: [], activeProg: null, logs: [], tests: [], customEx: [], videos: {}, rm: {}, settings: {}, active: null });
const fixture = () => migrateLegacyState(JSON.parse(readFileSync(new URL('./fixtures/legacy-v1.json', import.meta.url), 'utf8')));
let dbName;
beforeEach(() => { dbName = 'test-' + newId(); });

async function reopen(store) {
  store.close();
  await store.open(dbName);
  return store.load(defaults());
}

describe('lokal lagring i IndexedDB', () => {
  it('gemmer og indlæser hele tilstanden uændret, i samme rækkefølge', async () => {
    const store = createStore();
    await store.open(dbName);
    const s = fixture();
    await store.persist(s);
    expect(await reopen(store)).toEqual(s);
  });

  it('skriver kun det, der er ændret', async () => {
    const store = createStore();
    await store.open(dbName);
    const s = fixture();
    expect(await store.persist(s)).toBeGreaterThan(10);
    expect(await store.persist(s)).toBe(0);                     // nothing changed
    // Logs are immutable by convention (the app replaces a log, never edits it in place)
    const l = JSON.parse(JSON.stringify(s.logs[1])); l.items[0].sets[0].kg = 102.5; s.logs[1] = l;
    expect(await store.persist(s)).toBe(1);                     // exactly one row
    s.programs[0].name = 'Omdøbt';                           // programs are edited in place and still detected
    expect(await store.persist(s)).toBe(1);
    s.settings.rest = 90;
    expect(await store.persist(s)).toBe(1);
    expect((await reopen(store)).logs[1].items[0].sets[0].kg).toBe(102.5);
  });

  it('sletter rækker, der er fjernet fra tilstanden (også ved "Slet alle data")', async () => {
    const store = createStore();
    await store.open(dbName);
    const s = fixture();
    await store.persist(s);
    const removed = s.logs.splice(2, 1)[0];
    await store.persist(s);
    const after = await reopen(store);
    expect(after.logs.map(l => l.id)).not.toContain(removed.id);
    expect(after.logs).toHaveLength(4);
    await store.persist(defaults());
    expect(await store.isEmpty()).toBe(true);
    expect(await reopen(store)).toEqual(defaults());
  });

  it('holder brugernes databaser adskilt', async () => {
    const a = createStore(), b = createStore();
    await a.open(dbName + '-a'); await b.open(dbName + '-b');
    await a.persist(fixture());
    expect(await b.isEmpty()).toBe(true);
    expect((await b.load(defaults())).programs).toEqual([]);
  });

  it('en fejlet skrivning blokerer ikke de næste', async () => {
    const store = createStore();
    await store.open(dbName);
    store.close();
    await expect(store.persist(fixture())).rejects.toThrow('ikke åben');
    await store.open(dbName);
    await expect(store.persist(fixture())).resolves.toBeGreaterThan(0);
  });
});
