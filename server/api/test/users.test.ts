// The role table from CLAUDE.md section 4, tested through the API
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createCast, createVia, resetDb, setupApp, teardownApp, uniqueEmail, type Ctx, type TestUser } from './helpers.ts';

let ctx: Ctx;
let cast: Awaited<ReturnType<typeof createCast>>;

beforeAll(async () => {
  await resetDb();
  ctx = await setupApp();
  cast = await createCast(ctx);
});
afterAll(() => teardownApp(ctx));

const req = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, as: TestUser | null, payload?: object) =>
  ctx.app.inject({ method, url, payload, headers: as ? auth(as) : {} });
const ids = (rows: { id: string }[]) => rows.map(r => r.id).sort();

describe('oprette brugere', () => {
  it('admin kan oprette admin, træner og bruger', async () => {
    for (const role of ['admin', 'trainer', 'user']) {
      const r = await req('POST', '/users', cast.admin, { email: uniqueEmail(role), display_name: role, role });
      expect(r.statusCode).toBe(201);
      expect(r.json().profile.role).toBe(role);
      expect(r.json().inviteUrl).toMatch(/^https:\/\/api\.example\.test\/invite\/[\w-]{43}$/);
    }
  });

  it('en træner opretter kun brugere, som automatisk bliver trænerens egne', async () => {
    const r = await req('POST', '/users', cast.trainerA, { email: uniqueEmail('ny'), display_name: 'Ny' });
    expect(r.statusCode).toBe(201);
    expect(r.json().profile).toMatchObject({ role: 'user', trainer_id: cast.trainerA.id, created_by: cast.trainerA.id });
    expect((await req('POST', '/users', cast.trainerA, { email: uniqueEmail('x'), display_name: 'X', role: 'trainer' })).statusCode).toBe(403);
    // trainer_id from the body is ignored – it is always the trainer
    const other = await req('POST', '/users', cast.trainerA, { email: uniqueEmail('y'), display_name: 'Y', trainer_id: cast.trainerB.id });
    expect(other.json().profile.trainer_id).toBe(cast.trainerA.id);
  });

  it('en bruger og en uautoriseret kan ikke oprette brugere', async () => {
    expect((await req('POST', '/users', cast.userA, { email: uniqueEmail('z'), display_name: 'Z' })).statusCode).toBe(403);
    expect((await req('POST', '/users', null, { email: uniqueEmail('z'), display_name: 'Z' })).statusCode).toBe(401);
  });

  it('afviser en e-mail, der allerede findes', async () => {
    expect((await req('POST', '/users', cast.admin, { email: cast.userA.email, display_name: 'Dublet' })).statusCode).toBe(409);
  });
});

describe('se brugere', () => {
  it('admin ser alle', async () => {
    const rows = (await req('GET', '/users', cast.admin)).json();
    for (const u of [cast.trainerA, cast.trainerB, cast.userA, cast.userB]) expect(ids(rows)).toContain(u.id);
  });

  it('træner A ser kun sine egne brugere – ikke træner B\'s', async () => {
    const rows = (await req('GET', '/users', cast.trainerA)).json() as { id: string; trainer_id: string }[];
    expect(ids(rows)).toContain(cast.userA.id);
    expect(ids(rows)).not.toContain(cast.userB.id);
    expect(ids(rows)).not.toContain(cast.trainerB.id);
    expect(rows.every(r => r.trainer_id === cast.trainerA.id)).toBe(true);
  });

  it('en bruger ser ingen andre end sig selv', async () => {
    expect((await req('GET', '/users', cast.userA)).json()).toEqual([]);
    expect((await req('GET', '/me', cast.userA)).json().id).toBe(cast.userA.id);
  });

  it('ingen svar indeholder password_hash', async () => {
    const rows = (await req('GET', '/users', cast.admin)).json() as object[];
    expect(rows.some(r => 'password_hash' in r)).toBe(false);
  });
});

describe('ændre brugere', () => {
  it('ingen kan ændre sin egen rolle – heller ikke en admin', async () => {
    expect((await req('PATCH', `/users/${cast.userA.id}`, cast.userA, { role: 'admin' })).statusCode).toBe(403);
    expect((await req('PATCH', `/users/${cast.trainerA.id}`, cast.trainerA, { role: 'admin' })).statusCode).toBe(403);
    expect((await req('PATCH', `/users/${cast.admin.id}`, cast.admin, { role: 'user' })).statusCode).toBe(403);
  });

  it('kun admin kan ændre rolle og tilknytte en træner', async () => {
    expect((await req('PATCH', `/users/${cast.userA.id}`, cast.trainerA, { trainer_id: cast.trainerB.id })).statusCode).toBe(403);
    const u = await createVia(ctx, cast.admin, { email: uniqueEmail('flyt') });
    const r = await req('PATCH', `/users/${u.id}`, cast.admin, { trainer_id: cast.trainerB.id });
    expect(r.statusCode).toBe(200);
    expect(r.json().trainer_id).toBe(cast.trainerB.id);
  });

  it('trainer_id skal pege på en træner', async () => {
    const u = await createVia(ctx, cast.admin, { email: uniqueEmail('forkert') });
    expect((await req('PATCH', `/users/${u.id}`, cast.admin, { trainer_id: cast.userB.id })).statusCode).toBe(400);
  });

  it('alle kan ændre eget navn; træner B kan ikke røre træner A\'s bruger', async () => {
    const r = await req('PATCH', `/users/${cast.userA.id}`, cast.userA, { display_name: 'Nyt navn' });
    expect(r.statusCode).toBe(200);
    expect(r.json().display_name).toBe('Nyt navn');
    expect((await req('PATCH', `/users/${cast.userA.id}`, cast.trainerB, { display_name: 'Hack' })).statusCode).toBe(404);
  });
});

describe('slette brugere', () => {
  it('en træner kan ikke slette sine brugere; en bruger kan slette sin egen konto', async () => {
    const u = await createVia(ctx, cast.trainerA, { email: uniqueEmail('slet') });
    expect((await req('DELETE', `/users/${u.id}`, cast.trainerA)).statusCode).toBe(404);
    expect((await req('DELETE', `/users/${u.id}`, u)).statusCode).toBe(204);
    expect(ids((await req('GET', '/users', cast.admin)).json())).not.toContain(u.id);
  });

  it('admin kan slette alle, og trænerens brugere mister bare deres træner', async () => {
    const t = await createVia(ctx, cast.admin, { email: uniqueEmail('t'), role: 'trainer' });
    const u = await createVia(ctx, t, { email: uniqueEmail('u') });
    expect((await req('DELETE', `/users/${t.id}`, cast.admin)).statusCode).toBe(204);
    expect((await req('GET', '/me', u)).json()).toMatchObject({ trainer_id: null, created_by: null });
  });
});
