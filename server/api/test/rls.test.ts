// The database's own safety net, tested without the API: plain SQL as powerkrop_app with app.user_id set.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tx } from '../src/db.ts';
import { auth, createCast, program, resetDb, setupApp, teardownApp, type Ctx } from './helpers.ts';

let ctx: Ctx;
let cast: Awaited<ReturnType<typeof createCast>>;
let sessionA: string;

beforeAll(async () => {
  await resetDb();
  ctx = await setupApp();
  cast = await createCast(ctx);
  sessionA = randomUUID();
  await ctx.app.inject({ method: 'POST', url: '/sync/push', headers: auth(cast.userA), payload: { changes: [
    { table: 'workout_sessions', op: 'upsert', row: { id: sessionA, started_at: new Date().toISOString() } },
    { table: 'set_logs', op: 'upsert', row: { id: randomUUID(), session_id: sessionA, exercise_id: 'dip', set_index: 0, reps: 10, logged_at: new Date().toISOString() } },
  ] } });
});
afterAll(() => teardownApp(ctx));

const asUser = <T>(userId: string | null, sql: string, params: unknown[] = []) =>
  tx(ctx.db, userId, async c => (await c.query(sql, params)).rows as T[]);

describe('RLS som sikkerhedsnet', () => {
  it('uden app.user_id kan man intet se', async () => {
    expect(await asUser(null, 'select id from users')).toEqual([]);
    expect(await asUser(null, 'select id from set_logs')).toEqual([]);
    expect(await asUser(null, 'select id from workout_sessions')).toEqual([]);
  });

  it('API-rollen kan aldrig læse password_hash', async () => {
    await expect(asUser(cast.admin.id, 'select password_hash from users')).rejects.toMatchObject({ code: '42501' });
  });

  it('API-rollen kan ikke røre refresh_tokens og invites direkte', async () => {
    await expect(asUser(cast.admin.id, 'select * from refresh_tokens')).rejects.toMatchObject({ code: '42501' });
    await expect(asUser(cast.admin.id, 'select * from invites')).rejects.toMatchObject({ code: '42501' });
  });

  it('admin_bootstrap kan ikke kaldes af API-rollen', async () => {
    await expect(asUser(null, "select admin_bootstrap('x@example.test', 'X', 'h', now())")).rejects.toMatchObject({ code: '42501' });
  });

  it('træner A kan læse sin brugers log, træner B kan ikke', async () => {
    expect(await asUser(cast.trainerA.id, 'select id from workout_sessions where id = $1', [sessionA])).toHaveLength(1);
    expect(await asUser(cast.trainerB.id, 'select id from workout_sessions where id = $1', [sessionA])).toHaveLength(0);
    expect(await asUser(cast.userB.id, 'select id from set_logs where session_id = $1', [sessionA])).toHaveLength(0);
  });

  it('træneren kan ikke ændre i brugerens log', async () => {
    const rows = await asUser(cast.trainerA.id, "update workout_sessions set notes = 'snyd' where id = $1 returning id", [sessionA]);
    expect(rows).toHaveLength(0);
  });

  it('en bruger kan ikke opdatere et program, træneren har lavet', async () => {
    const p = program(cast.userA.id);
    await tx(ctx.db, cast.trainerA.id, c => c.query(
      'insert into programs (id, owner_id, name, data) values ($1, $2, $3, $4)', [p.id, p.owner_id, p.name, p.data]));
    const rows = await asUser(cast.userA.id, "update programs set name = 'mit nu' where id = $1 returning id", [p.id]);
    expect(rows).toHaveLength(0);
  });

  it('en bruger kan ikke give sig selv en anden rolle direkte i databasen', async () => {
    await expect(asUser(cast.userA.id, "update users set role = 'admin' where id = $1", [cast.userA.id])).rejects.toMatchObject({ code: '42501' });
  });

  it('en træner kan ikke oprette en admin direkte i databasen', async () => {
    await asUser(cast.trainerA.id, "insert into users (id, email, display_name, role) values ($1, $2, 'X', 'admin')",
      [randomUUID(), `${randomUUID()}@example.test`]);
    const rows = await asUser<{ role: string; trainer_id: string }>(cast.admin.id,
      "select role, trainer_id from users where created_by = $1 and display_name = 'X'", [cast.trainerA.id]);
    expect(rows).toEqual([{ role: 'user', trainer_id: cast.trainerA.id }]);
  });

  it('en almindelig bruger kan slet ikke indsætte brugere', async () => {
    await expect(asUser(cast.userA.id, "insert into users (id, email, display_name) values ($1, $2, 'Y')",
      [randomUUID(), `${randomUUID()}@example.test`])).rejects.toMatchObject({ code: '42501' });
  });
});
