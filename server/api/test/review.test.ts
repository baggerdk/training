// Regression tests for the holes found in the code review (migration 003 and /sync/push)
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tx } from '../src/db.ts';
import { auth, createCast, createVia, program, resetDb, setupApp, teardownApp, uniqueEmail, type Ctx, type TestUser } from './helpers.ts';

let ctx: Ctx;
let cast: Awaited<ReturnType<typeof createCast>>;

beforeAll(async () => {
  await resetDb();
  ctx = await setupApp();
  cast = await createCast(ctx);
});
afterAll(() => teardownApp(ctx));

const asUser = <T>(userId: string | null, sql: string, params: unknown[] = []) =>
  tx(ctx.db, userId, async c => (await c.query(sql, params)).rows as T[]);
const push = (u: TestUser, changes: unknown[]) =>
  ctx.app.inject({ method: 'POST', url: '/sync/push', headers: auth(u), payload: { changes } });
const now = () => new Date().toISOString();

describe('fejl fundet i kodereviewet (regression)', () => {
  it('et sæt kan ikke flyttes ind i en anden brugers træning', async () => {
    const mine = randomUUID(), theirs = randomUUID(), set = randomUUID();
    await push(cast.userA, [
      { table: 'workout_sessions', op: 'upsert', row: { id: mine, started_at: now() } },
      { table: 'set_logs', op: 'upsert', row: { id: set, session_id: mine, exercise_id: 'dip', set_index: 0, logged_at: now() } },
    ]);
    await push(cast.userB, [{ table: 'workout_sessions', op: 'upsert', row: { id: theirs, started_at: now() } }]);
    await expect(asUser(cast.userA.id, 'update set_logs set session_id = $1 where id = $2', [theirs, set]))
      .rejects.toMatchObject({ code: '42501' });
  });

  it('en træning kan ikke ændres til at pege på et program, brugeren ikke kan se', async () => {
    const s = randomUUID(), p = program(cast.userB.id);
    await push(cast.userB, [{ table: 'programs', op: 'upsert', row: p }]);
    await push(cast.userA, [{ table: 'workout_sessions', op: 'upsert', row: { id: s, started_at: now() } }]);
    await expect(asUser(cast.userA.id, 'update workout_sessions set program_id = $1 where id = $2', [p.id, s]))
      .rejects.toMatchObject({ code: '42501' });
  });

  it('at slette et program fra træneren afvises som forbudt (ikke "findes ikke")', async () => {
    const p = program(cast.userA.id);
    expect((await push(cast.trainerA, [{ table: 'programs', op: 'upsert', row: p }])).json().applied).toBe(1);
    const r = (await push(cast.userA, [{ table: 'programs', op: 'delete', row: { id: p.id } }])).json();
    expect(r.rejected).toEqual([expect.objectContaining({ index: 0, reason: 'forbidden' })]);
  });

  it('et tabelnavn fra Object.prototype er en ukendt tabel, ikke en serverfejl', async () => {
    const r = await push(cast.userA, [{ table: 'constructor', op: 'upsert', row: {} }]);
    expect(r.statusCode).toBe(200);
    expect(r.json().rejected).toEqual([expect.objectContaining({ reason: 'unknown_table' })]);
  });

  it('en deaktiveret træner kan ikke lave invitationslinks', async () => {
    const trainer = await createVia(ctx, cast.admin, { email: uniqueEmail('t-off'), role: 'trainer' });
    const user = await createVia(ctx, trainer, { email: uniqueEmail('u-off') });
    await asUser(cast.admin.id, 'update users set disabled_at = now() where id = $1', [trainer.id]);
    await expect(asUser(trainer.id, "select auth_create_invite($1, 'h-' || gen_random_uuid(), now() + interval '1 day')", [user.id]))
      .rejects.toMatchObject({ code: '42501' });
  });

  it('den sidste aktive admin kan ikke slette sig selv eller miste rollen', async () => {
    await expect(asUser(cast.admin.id, 'delete from users where id = $1', [cast.admin.id])).rejects.toMatchObject({ code: '42501' });
    const other = await createVia(ctx, cast.admin, { email: uniqueEmail('admin2'), role: 'admin' });
    // With a second admin, the second one can take the first one's role
    await asUser(other.id, "update users set role = 'trainer' where id = $1", [cast.admin.id]);
    await expect(asUser(other.id, 'delete from users where id = $1', [other.id])).rejects.toMatchObject({ code: '42501' });
    await asUser(other.id, "update users set role = 'admin' where id = $1", [cast.admin.id]);
  });

  it('managed_user_ids svarer til can_manage', async () => {
    for (const u of [cast.admin, cast.trainerA, cast.trainerB, cast.userA]) {
      const viaSet = (await asUser<{ id: string }>(u.id, 'select id from users order by id')).map(r => r.id);
      const viaFn = (await tx(ctx.db, u.id, async c =>
        (await c.query<{ id: string }>('select id from users where can_manage(id) order by id')).rows)).map(r => r.id);
      expect(viaSet).toEqual(viaFn);
    }
  });
});
