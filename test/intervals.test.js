import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const { intervalAlarms } = createRequire(import.meta.url)('../js/intervals.js');

const T0 = 1_000_000;
const titles = a => a.map(x => x.title);
const offsets = a => a.map(x => (x.at - T0) / 1000);

describe('baggrundsalarmer til intervaltimere', () => {
  it('EMOM: start, hvert nyt minut og slut', () => {
    const a = intervalAlarms({ kind: 'emom', b: { min: 3, reps: 5 }, t0: T0, pre: 10, running: true }, T0);
    expect(titles(a)).toEqual(['Start!', 'Minut 2 / 3', 'Minut 3 / 3', 'Færdig!']);
    expect(offsets(a)).toEqual([10, 70, 130, 190]);
  });

  it('kun det, der ligger efter nu', () => {
    const a = intervalAlarms({ kind: 'emom', b: { min: 3, reps: 5 }, t0: T0, pre: 10, running: true }, T0 + 100_000);
    expect(titles(a)).toEqual(['Minut 3 / 3', 'Færdig!']);
  });

  it('AMRAP: start og slut', () => {
    expect(offsets(intervalAlarms({ kind: 'amrap', b: { min: 8 }, t0: T0, pre: 10, running: true }, T0))).toEqual([10, 490]);
  });

  it('Tabata: arbejd og hvil skiftevis, og slut', () => {
    const a = intervalAlarms({ kind: 'tabata', b: { work: 20, rest: 10, rounds: 2 }, t0: T0, pre: 0, running: true }, T0 - 1);
    expect(titles(a)).toEqual(['Arbejd · 1/2', 'Hvil · 1/2', 'Arbejd · 2/2', 'Hvil · 2/2', 'Færdig!']);
    expect(offsets(a)).toEqual([0, 20, 30, 50, 60]);
  });

  it('Ladder: kun slut på en igangværende pause', () => {
    expect(offsets(intervalAlarms({ kind: 'ladder', b: { rest: 45 }, mode: 'rest', restStart: T0 }, T0))).toEqual([45]);
    expect(intervalAlarms({ kind: 'ladder', b: { rest: 45 }, mode: 'work' }, T0)).toEqual([]);
  });

  it('ingen alarmer for en timer på pause, en færdig timer eller ingen timer', () => {
    expect(intervalAlarms({ kind: 'emom', b: { min: 3 }, t0: T0, pre: 10, running: false }, T0)).toEqual([]);
    expect(intervalAlarms({ kind: 'emom', b: { min: 3 }, t0: T0, pre: 10, running: true, done: true }, T0)).toEqual([]);
    expect(intervalAlarms(null, T0)).toEqual([]);
  });

  it('højst 60 alarmer', () => {
    expect(intervalAlarms({ kind: 'emom', b: { min: 200 }, t0: T0, pre: 0, running: true }, T0 - 1)).toHaveLength(60);
  });
});
