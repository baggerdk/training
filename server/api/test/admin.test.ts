// Admin website endpoints: athlete profiles, programs for a user, trainer templates and the static site.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createCast, resetDb, setupApp, teardownApp, type Ctx, type TestUser } from './helpers.ts';

let ctx: Ctx;
let cast: Awaited<ReturnType<typeof createCast>>;

beforeAll(async () => {
  await resetDb();
  ctx = await setupApp();
  cast = await createCast(ctx);
});
afterAll(() => teardownApp(ctx));

const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, as: TestUser | null, payload?: object) =>
  ctx.app.inject({ method, url, payload, headers: as ? auth(as) : {} });
const programBody = (name = 'Program fra træner') => ({
  name, template_key: 'cal', level: 'begynder', days_per_week: 2,
  data: { tpl: 'cal', level: 0, weeks: 4, auto: true, created: 1760000000000, treeLvls: { pull: 2 }, days: [{ id: 'd1', name: 'Dag 1', items: [] }, { id: 'd2', name: 'Dag 2', items: [] }] },
});

describe('brugerdetaljer og atletprofil', () => {
  it('træneren ser sin bruger med profil og statistik; træner B gør ikke', async () => {
    const r = await req('GET', `/users/${cast.userA.id}`, cast.trainerA);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ profile: { id: cast.userA.id }, athlete: null, stats: { workouts: 0, programs: 0 } });
    expect((await req('GET', `/users/${cast.userA.id}`, cast.trainerB)).statusCode).toBe(404);
    expect((await req('GET', `/users/${cast.userB.id}`, cast.userA)).statusCode).toBe(403);
  });

  it('træneren sætter niveau og trin pr. træ; ændringen huskes med hvem der lavede den', async () => {
    const r = await req('PUT', `/users/${cast.userA.id}/athlete`, cast.trainerA, { level: 1, tree_levels: { pull: 4, dip: 3 }, goals: 'Første muscle-up' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ level: 1, tree_levels: { pull: 4, dip: 3 }, goals: 'Første muscle-up', updated_by: cast.trainerA.id });
    expect((await req('GET', `/users/${cast.userA.id}`, cast.trainerA)).json().athlete.level).toBe(1);
  });

  it('træner B og andre brugere kan ikke ændre profilen; brugeren selv kan', async () => {
    expect((await req('PUT', `/users/${cast.userA.id}/athlete`, cast.trainerB, { level: 2, tree_levels: {} })).statusCode).toBe(404);
    expect((await req('PUT', `/users/${cast.userA.id}/athlete`, cast.userB, { level: 2, tree_levels: {} })).statusCode).toBe(403);
    expect((await req('PUT', `/users/${cast.userA.id}/athlete`, cast.userA, { level: 1, tree_levels: { pull: 5 } })).statusCode).toBe(200);
  });

  it('afviser ugyldige profiler', async () => {
    expect((await req('PUT', `/users/${cast.userA.id}/athlete`, cast.trainerA, { level: 3, tree_levels: {} })).statusCode).toBe(400);
    expect((await req('PUT', `/users/${cast.userA.id}/athlete`, cast.trainerA, { level: 0, tree_levels: { pull: -1 } })).statusCode).toBe(400);
  });
});

describe('programmer til en bruger', () => {
  let programId: string;

  it('træneren laver et program til sin bruger; det står med træneren som forfatter', async () => {
    const r = await req('POST', `/users/${cast.userA.id}/programs`, cast.trainerA, programBody());
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ owner_id: cast.userA.id, created_by: cast.trainerA.id, name: 'Program fra træner', days_per_week: 2 });
    programId = r.json().id;
    expect((await req('GET', `/users/${cast.userA.id}/programs`, cast.trainerA)).json().map((p: { id: string }) => p.id)).toContain(programId);
  });

  it('brugeren får programmet via sync, men kan ikke redigere eller slette det', async () => {
    const pull = (await req('GET', '/sync/pull', cast.userA)).json();
    expect(pull.changes.programs.find((p: { id: string }) => p.id === programId)).toMatchObject({ created_by: cast.trainerA.id });
    expect((await req('PUT', `/programs/${programId}`, cast.userA, programBody('Mit nu'))).statusCode).toBe(404);
    expect((await req('DELETE', `/programs/${programId}`, cast.userA)).statusCode).toBe(404);
  });

  it('træneren kan rette og slette sit program (soft delete)', async () => {
    const r = await req('PUT', `/programs/${programId}`, cast.trainerA, programBody('Rettet'));
    expect(r.statusCode).toBe(200);
    expect(r.json().name).toBe('Rettet');
    expect((await req('DELETE', `/programs/${programId}`, cast.trainerA)).statusCode).toBe(204);
    expect((await req('GET', `/users/${cast.userA.id}/programs`, cast.trainerA)).json()).toEqual([]);
  });

  it('træner B kan hverken lave eller se programmer for træner A\'s bruger', async () => {
    expect((await req('POST', `/users/${cast.userA.id}/programs`, cast.trainerB, programBody())).statusCode).toBe(404);
    expect((await req('GET', `/users/${cast.userA.id}/programs`, cast.trainerB)).json()).toEqual([]);
  });

  it('admin kan lave programmer til alle', async () => {
    expect((await req('POST', `/users/${cast.userB.id}/programs`, cast.admin, programBody())).statusCode).toBe(201);
  });
});

describe('trænernes egne skabeloner', () => {
  let tid: string;
  const tpl = (name: string, shared = false) => ({ name, description: 'Til begyndere', level: 0, days_per_week: 2, tags: ['pull-up', 'begynder'], data: programBody().data, shared });

  it('kun admin og trænere har adgang', async () => {
    expect((await req('GET', '/templates', cast.userA)).statusCode).toBe(403);
    expect((await req('POST', '/templates', cast.userA, tpl('X'))).statusCode).toBe(403);
  });

  it('en træner gemmer en skabelon; andre trænere ser den først, når den deles', async () => {
    const r = await req('POST', '/templates', cast.trainerA, tpl('A\'s pull-up 2 dage'));
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ created_by: cast.trainerA.id, tags: ['pull-up', 'begynder'], shared: false });
    tid = r.json().id;
    const names = async (u: TestUser) => (await req('GET', '/templates', u)).json().map((t: { name: string }) => t.name);
    expect(await names(cast.trainerA)).toContain('A\'s pull-up 2 dage');
    expect(await names(cast.trainerB)).not.toContain('A\'s pull-up 2 dage');
    expect(await names(cast.admin)).toContain('A\'s pull-up 2 dage');
    await req('PUT', `/templates/${tid}`, cast.trainerA, tpl('A\'s pull-up 2 dage', true));
    expect(await names(cast.trainerB)).toContain('A\'s pull-up 2 dage');
  });

  it('træner B kan ikke rette eller slette A\'s skabelon, selv når den er delt', async () => {
    expect((await req('PUT', `/templates/${tid}`, cast.trainerB, tpl('Hack'))).statusCode).toBe(404);
    expect((await req('DELETE', `/templates/${tid}`, cast.trainerB)).statusCode).toBe(404);
    expect((await req('DELETE', `/templates/${tid}`, cast.trainerA)).statusCode).toBe(204);
    expect((await req('GET', '/templates', cast.trainerA)).json().map((t: { id: string }) => t.id)).not.toContain(tid);
  });
});

describe('selve hjemmesiden på /admin', () => {
  it('serveres med streng CSP på samme domæne', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: '/admin/' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/html/);
    expect(r.headers['content-security-policy']).toContain("script-src 'self'");
    expect((await ctx.app.inject({ method: 'GET', url: '/admin' })).statusCode).toBe(302);
  });

  it('deler kun appens godkendte filer – aldrig resten af repoet', async () => {
    const ok = await ctx.app.inject({ method: 'GET', url: '/admin/shared/templates.js' });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toContain('function buildProgram');
    for (const bad of ['/admin/shared/app.js', '/admin/shared/..%2F..%2Fserver%2F.env', '/admin/shared/%2E%2E%2Fpackage.json']) {
      expect((await ctx.app.inject({ method: 'GET', url: bad })).statusCode, bad).toBe(404);
    }
    expect((await ctx.app.inject({ method: 'GET', url: '/admin/img/../server/.env' })).statusCode).not.toBe(200);
  });
});

it('ukendte programmer giver 404', async () => {
  expect((await req('PUT', `/programs/${randomUUID()}`, cast.admin, programBody())).statusCode).toBe(404);
});

describe('fejlhåndtering', () => {
  it('ødelagt JSON eller forkert Content-Length giver 400, ikke 500', async () => {
    const bad = await ctx.app.inject({ method: 'POST', url: '/auth/login', headers: { 'content-type': 'application/json' }, payload: '{"email":' });
    expect(bad.statusCode).toBe(400);
    const len = await ctx.app.inject({ method: 'POST', url: '/auth/login', headers: { 'content-type': 'application/json', 'content-length': '999' }, payload: '{"email":"a@b.c","password":"x"}' });
    expect(len.statusCode).toBeLessThan(500);
  });
});
