import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createCast, program, resetDb, setupApp, teardownApp, type Ctx, type TestUser } from './helpers.ts';

let ctx: Ctx;
let cast: Awaited<ReturnType<typeof createCast>>;

beforeAll(async () => {
  await resetDb();
  ctx = await setupApp();
  cast = await createCast(ctx);
});
afterAll(() => teardownApp(ctx));

type Change = { table: string; op: 'upsert' | 'delete'; row: Record<string, unknown> };
const push = async (as: TestUser, changes: Change[]) => {
  const r = await ctx.app.inject({ method: 'POST', url: '/sync/push', headers: auth(as), payload: { changes } });
  expect(r.statusCode).toBe(200);
  return r.json() as { applied: number; rejected: { index: number; reason: string }[] };
};
const pull = async (as: TestUser, since?: string) => {
  const r = await ctx.app.inject({ method: 'GET', url: `/sync/pull${since ? `?since=${encodeURIComponent(since)}` : ''}`, headers: auth(as) });
  expect(r.statusCode).toBe(200);
  return r.json() as { cursor: string; changes: Record<string, Record<string, unknown>[]> };
};

function workout(userId?: string) {
  const sessionId = randomUUID();
  return {
    sessionId,
    changes: [
      { table: 'workout_sessions', op: 'upsert' as const, row: { id: sessionId, ...(userId ? { user_id: userId } : {}), name: 'Dag 1', started_at: new Date().toISOString(), data: { blocks: [] } } },
      { table: 'set_logs', op: 'upsert' as const, row: { id: randomUUID(), session_id: sessionId, exercise_id: 'pullup', set_index: 0, reps: 8, weight_kg: 2.5, rpe: 8, target: { r: 5, rMax: 8 }, logged_at: new Date().toISOString() } },
    ],
  };
}

describe('push og pull', () => {
  it('en bruger kan gemme og hente sine egne data', async () => {
    const w = workout();
    const res = await push(cast.userA, [
      ...w.changes,
      { table: 'training_maxes', op: 'upsert', row: { lift_key: 'squat', one_rm_kg: 120.5 } },
      { table: 'user_exercise_videos', op: 'upsert', row: { exercise_id: 'pullup', url: 'https://youtu.be/eGo4IYlbE5g' } },
      { table: 'max_tests', op: 'upsert', row: { id: randomUUID(), test_key: 'hang', value: 60, unit: 's', tested_at: new Date().toISOString() } },
      { table: 'user_settings', op: 'upsert', row: { data: { tmPct: 90, activeProgramId: null } } },
      { table: 'custom_exercises', op: 'upsert', row: { exercise_id: 'my-abc123', data: { n: 'Min øvelse', c: 'pull', type: 'reps', cues: [] } } },
    ]);
    expect(res).toEqual({ applied: 7, rejected: [] });
    const { changes } = await pull(cast.userA);
    expect(changes.workout_sessions!.map(r => r.id)).toContain(w.sessionId);
    expect(changes.set_logs![0]).toMatchObject({ exercise_id: 'pullup', reps: 8, weight_kg: 2.5, user_id: cast.userA.id });
    expect(changes.training_maxes![0]).toMatchObject({ lift_key: 'squat', one_rm_kg: 120.5 });
    expect(changes.custom_exercises![0]!.data).toMatchObject({ n: 'Min øvelse' });
  });

  it('user_id fra klienten ignoreres ikke stille: en anden brugers id afvises', async () => {
    const res = await push(cast.userA, [{ table: 'max_tests', op: 'upsert', row: { id: randomUUID(), user_id: cast.userB.id, test_key: 'pullup', value: 10, unit: 'reps', tested_at: new Date().toISOString() } }]);
    expect(res.rejected[0]?.reason).toBe('forbidden');
  });

  it('en bruger kan ikke overskrive en anden brugers række med samme id', async () => {
    const id = randomUUID();
    await push(cast.userB, [{ table: 'max_tests', op: 'upsert', row: { id, test_key: 'pullup', value: 10, unit: 'reps', tested_at: new Date().toISOString() } }]);
    const res = await push(cast.userA, [{ table: 'max_tests', op: 'upsert', row: { id, test_key: 'pullup', value: 99, unit: 'reps', tested_at: new Date().toISOString() } }]);
    expect(res.rejected[0]?.reason).toBe('forbidden');
  });

  it('en ugyldig række afviser kun sig selv, resten gemmes', async () => {
    const res = await push(cast.userA, [
      { table: 'max_tests', op: 'upsert', row: { id: randomUUID(), test_key: 'pullup', value: 10, unit: 'kilo', tested_at: new Date().toISOString() } },
      { table: 'max_tests', op: 'upsert', row: { id: 'ikke-en-uuid', test_key: 'pullup', value: 10, unit: 'reps', tested_at: new Date().toISOString() } },
      { table: 'findes_ikke', op: 'upsert', row: {} },
      { table: 'max_tests', op: 'upsert', row: { id: randomUUID(), test_key: 'pullup', value: 12, unit: 'reps', tested_at: new Date().toISOString() } },
    ]);
    expect(res.applied).toBe(1);
    expect(res.rejected.map(r => [r.index, r.reason])).toEqual([[0, 'invalid'], [1, 'invalid'], [2, 'unknown_table']]);
  });

  it('set_logs kan ikke hænge på en anden brugers træning', async () => {
    const w = workout();
    await push(cast.userB, w.changes);
    const res = await push(cast.userA, [{ ...w.changes[1]!, row: { ...w.changes[1]!.row, id: randomUUID() } }]);
    expect(res.rejected[0]?.reason).toBe('forbidden');
  });

  it('pull med cursor giver kun nye ændringer, og sletning er soft delete', async () => {
    const id = randomUUID();
    await push(cast.userA, [{ table: 'max_tests', op: 'upsert', row: { id, test_key: 'dip', value: 15, unit: 'reps', tested_at: new Date().toISOString() } }]);
    const first = await pull(cast.userA);
    const res = await push(cast.userA, [{ table: 'max_tests', op: 'delete', row: { id } }]);
    expect(res.applied).toBe(1);
    const next = await pull(cast.userA, first.cursor);
    const row = next.changes.max_tests!.find(r => r.id === id);
    expect(row?.deleted_at).toBeTruthy();
    // The cursor lies 30 s back, so recent rows may be repeated – but nothing older than the cursor
    expect(next.changes.max_tests!.every(r => (r.updated_at as string) > first.cursor)).toBe(true);
  });

  it('afviser en cursor, der ikke er et tidspunkt', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: '/sync/pull?since=igår', headers: auth(cast.userA) });
    expect(r.statusCode).toBe(400);
  });
});

describe('programmer og deling', () => {
  it('træneren laver et program til sin bruger; brugeren ser det, men kan ikke redigere det', async () => {
    const p = program(cast.userA.id, 'Fra træner');
    expect((await push(cast.trainerA, [{ table: 'programs', op: 'upsert', row: p }])).applied).toBe(1);
    const mine = (await pull(cast.userA)).changes.programs!.find(r => r.id === p.id);
    expect(mine).toMatchObject({ owner_id: cast.userA.id, created_by: cast.trainerA.id, name: 'Fra træner' });
    const edit = await push(cast.userA, [{ table: 'programs', op: 'upsert', row: { ...p, name: 'Ændret' } }]);
    expect(edit.rejected[0]?.reason).toBe('forbidden');
    // …but the user may follow it: progress lives in its own table
    const prog = await push(cast.userA, [{ table: 'program_progress', op: 'upsert', row: { program_id: p.id, week: 1, day: 2 } }]);
    expect(prog).toEqual({ applied: 1, rejected: [] });
    // The trainer's device gets the program too, and the trainer can edit it
    expect((await pull(cast.trainerA)).changes.programs!.map(r => r.id)).toContain(p.id);
    expect((await push(cast.trainerA, [{ table: 'programs', op: 'upsert', row: { ...p, name: 'Opdateret' } }])).applied).toBe(1);
  });

  it('træner B kan ikke lave programmer til træner A\'s bruger', async () => {
    const res = await push(cast.trainerB, [{ table: 'programs', op: 'upsert', row: program(cast.userA.id) }]);
    expect(res.rejected[0]?.reason).toBe('forbidden');
  });

  it('en bruger kan ikke lave programmer til andre, men gerne til sig selv', async () => {
    expect((await push(cast.userA, [{ table: 'programs', op: 'upsert', row: program(cast.userB.id) }])).rejected[0]?.reason).toBe('forbidden');
    expect((await push(cast.userA, [{ table: 'programs', op: 'upsert', row: program(cast.userA.id) }])).applied).toBe(1);
  });

  it('owner_id kan ikke ændres efterfølgende', async () => {
    const p = program(cast.userA.id);
    await push(cast.trainerA, [{ table: 'programs', op: 'upsert', row: p }]);
    const r = await push(cast.trainerA, [{ table: 'programs', op: 'upsert', row: { ...p, owner_id: cast.trainerA.id } }]);
    expect(r.rejected[0]?.reason).toBe('forbidden');
  });

  it('en træner kan ikke skrive i sin brugers træningslog', async () => {
    const res = await push(cast.trainerA, workout(cast.userA.id).changes);
    expect(res.rejected.map(r => r.reason)).toContain('forbidden');
  });
});
