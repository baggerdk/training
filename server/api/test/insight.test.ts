// Trainer insight (phase 12): a user's history, records and tests – readable by their trainer and admins only
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createCast, resetDb, setupApp, teardownApp, type Ctx, type TestUser } from './helpers.ts';

let ctx: Ctx;
let cast: Awaited<ReturnType<typeof createCast>>;
const sessions: string[] = [];

const get = (url: string, as: TestUser) => ctx.app.inject({ method: 'GET', url, headers: auth(as) });
const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n, 17)).toISOString();

beforeAll(async () => {
  await resetDb();
  ctx = await setupApp();
  cast = await createCast(ctx);
  const changes: unknown[] = [];
  for (let n = 0; n < 5; n++) {
    const id = randomUUID(); sessions.push(id);
    changes.push({ table: 'workout_sessions', op: 'upsert', row: { id, name: `Dag ${n + 1}`, started_at: day(n), finished_at: day(n), data: { items: [{ ex: 'pullup' }] } } });
    changes.push({ table: 'set_logs', op: 'upsert', row: { id: randomUUID(), session_id: id, exercise_id: 'pullup', set_index: 0, reps: 5 + n, logged_at: day(n) } });
    changes.push({ table: 'set_logs', op: 'upsert', row: { id: randomUUID(), session_id: id, exercise_id: 'back-squat', set_index: 0, reps: 5, weight_kg: 100 + n * 5, logged_at: day(n) } });
  }
  changes.push({ table: 'max_tests', op: 'upsert', row: { id: randomUUID(), test_key: 'pullup', value: 12, unit: 'reps', tested_at: day(2) } });
  changes.push({ table: 'training_maxes', op: 'upsert', row: { lift_key: 'squat', one_rm_kg: 130 } });
  changes.push({ table: 'custom_exercises', op: 'upsert', row: { exercise_id: 'my-abc123', data: { n: 'Ringrows', c: 'pull', type: 'reps' } } });
  const r = await ctx.app.inject({ method: 'POST', url: '/sync/push', headers: auth(cast.userA), payload: { changes } });
  if (r.json().rejected.length) throw new Error(JSON.stringify(r.json().rejected));
  // A deleted workout does not count
  await ctx.app.inject({ method: 'POST', url: '/sync/push', headers: auth(cast.userA), payload: { changes: [{ table: 'workout_sessions', op: 'delete', row: { id: sessions[4] } }] } });
});
afterAll(() => teardownApp(ctx));

describe('trænerindsigt', () => {
  it('træneren ser historikken nyest først, side for side', async () => {
    const p1 = (await get(`/users/${cast.userA.id}/sessions?limit=2`, cast.trainerA)).json();
    expect(p1.sessions.map((s: { name: string }) => s.name)).toEqual(['Dag 4', 'Dag 3']);
    expect(p1.more).toBe(true);
    expect(p1.sessions[0].data).toEqual({ items: [{ ex: 'pullup' }] });
    const before = encodeURIComponent(p1.sessions[1].started_at);
    const p2 = (await get(`/users/${cast.userA.id}/sessions?limit=2&before=${before}`, cast.trainerA)).json();
    expect(p2.sessions.map((s: { name: string }) => s.name)).toEqual(['Dag 2', 'Dag 1']);
    expect(p2.more).toBe(false);
  });

  it('rekorder, maks-tests, 1RM, uger og egne øvelser (slettede træninger tæller ikke)', async () => {
    const r = await get(`/users/${cast.userA.id}/insight`, cast.trainerA);
    expect(r.statusCode).toBe(200);
    const d = r.json();
    const rec = Object.fromEntries(d.records.map((x: { exercise_id: string }) => [x.exercise_id, x]));
    expect(rec.pullup).toMatchObject({ reps: 8, kg: null, sets: 4 });
    expect(rec['back-squat']).toMatchObject({ kg: 115, reps: null, sets: 4 });
    expect(rec['back-squat'].e1rm).toBeCloseTo(115 * (1 + 5 / 30));
    expect(d.tests).toEqual([expect.objectContaining({ test_key: 'pullup', value: 12, unit: 'reps' })]);
    expect(d.maxes).toEqual([{ lift_key: 'squat', one_rm_kg: 130 }]);
    expect(d.custom).toEqual([{ exercise_id: 'my-abc123', name: 'Ringrows' }]);
    expect(Array.isArray(d.weeks)).toBe(true);
  });

  it('træner B ser intet, en anden bruger får 403, og brugeren selv kan se sit eget', async () => {
    expect((await get(`/users/${cast.userA.id}/sessions`, cast.trainerB)).statusCode).toBe(404);
    expect((await get(`/users/${cast.userA.id}/insight`, cast.trainerB)).statusCode).toBe(404);
    expect((await get(`/users/${cast.userA.id}/insight`, cast.userB)).statusCode).toBe(403);
    expect((await get(`/users/${cast.userA.id}/sessions`, cast.userA)).statusCode).toBe(200);
    expect((await get(`/users/${cast.userA.id}/insight`, cast.admin)).statusCode).toBe(200);
  });

  it('afviser ugyldige parametre', async () => {
    expect((await get(`/users/${cast.userA.id}/sessions?limit=500`, cast.trainerA)).statusCode).toBe(400);
    expect((await get(`/users/${cast.userA.id}/sessions?before=igår`, cast.trainerA)).statusCode).toBe(400);
  });
});
