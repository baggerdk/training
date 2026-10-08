import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { testConfig } from './env.ts';
import { auth, createAdmin, createVia, inviteToken, PASSWORD, resetDb, setupApp, teardownApp, uniqueEmail, type Ctx, type TestUser } from './helpers.ts';

let ctx: Ctx;
let admin: TestUser;

beforeAll(async () => {
  await resetDb();
  ctx = await setupApp();
  admin = await createAdmin(ctx);
});
afterAll(() => teardownApp(ctx));

const post = (url: string, payload: unknown, headers = {}) => ctx.app.inject({ method: 'POST', url, payload: payload as object, headers });

describe('login', () => {
  it('logger ind med korrekt password og returnerer profil uden password_hash', async () => {
    const r = await post('/auth/login', { email: admin.email, password: PASSWORD });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.access).toBeTruthy();
    expect(body.refresh).toBeTruthy();
    expect(body.profile.role).toBe('admin');
    expect(body.profile).not.toHaveProperty('password_hash');
  });

  it('afviser forkert password og ukendt e-mail med samme svar', async () => {
    const wrong = await post('/auth/login', { email: admin.email, password: 'forkert-forkert' });
    const unknown = await post('/auth/login', { email: 'findes.ikke@example.test', password: 'forkert-forkert' });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it('e-mail er ikke versalfølsom (citext)', async () => {
    const r = await post('/auth/login', { email: admin.email.toUpperCase(), password: PASSWORD });
    expect(r.statusCode).toBe(200);
  });

  it('afviser kald uden eller med ugyldigt token', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/me' })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'GET', url: '/me', headers: { authorization: 'Bearer abc' } })).statusCode).toBe(401);
  });
});

describe('refresh-token', () => {
  it('roterer: det gamle token virker ikke igen', async () => {
    const login = (await post('/auth/login', { email: admin.email, password: PASSWORD })).json();
    const r1 = await post('/auth/refresh', { refresh: login.refresh });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().refresh).not.toBe(login.refresh);
    const r2 = await post('/auth/refresh', { refresh: r1.json().refresh });
    expect(r2.statusCode).toBe(200);
  });

  it('genbrug af et roteret token logger brugeren ud overalt', async () => {
    const login = (await post('/auth/login', { email: admin.email, password: PASSWORD })).json();
    const next = (await post('/auth/refresh', { refresh: login.refresh })).json();
    expect((await post('/auth/refresh', { refresh: login.refresh })).statusCode).toBe(401);   // reuse
    expect((await post('/auth/refresh', { refresh: next.refresh })).statusCode).toBe(401);    // family revoked
  });

  it('logout tilbagekalder tokenet', async () => {
    const login = (await post('/auth/login', { email: admin.email, password: PASSWORD })).json();
    expect((await post('/auth/logout', { refresh: login.refresh })).statusCode).toBe(204);
    expect((await post('/auth/refresh', { refresh: login.refresh })).statusCode).toBe(401);
  });
});

describe('invitationer', () => {
  it('et invitationslink kan kun bruges én gang', async () => {
    const r = await post('/users', { email: uniqueEmail('inv'), display_name: 'Inv' }, auth(admin));
    const token = inviteToken(r.json().inviteUrl);
    expect((await post('/auth/accept-invite', { token, password: PASSWORD })).statusCode).toBe(200);
    expect((await post('/auth/accept-invite', { token, password: PASSWORD })).statusCode).toBe(410);
  });

  it('et nyt link (glemt password) gør det gamle ugyldigt og sætter nyt password', async () => {
    const email = uniqueEmail('reset');
    const created = (await post('/users', { email, display_name: 'Reset' }, auth(admin))).json();
    const first = inviteToken(created.inviteUrl);
    const second = inviteToken((await post(`/users/${created.profile.id}/invite`, {}, auth(admin))).json().inviteUrl);
    expect((await post('/auth/accept-invite', { token: first, password: PASSWORD })).statusCode).toBe(410);
    expect((await post('/auth/accept-invite', { token: second, password: 'et-helt-nyt-password' })).statusCode).toBe(200);
    expect((await post('/auth/login', { email, password: 'et-helt-nyt-password' })).statusCode).toBe(200);
  });

  it('kræver et password på mindst 10 tegn', async () => {
    const r = await post('/users', { email: uniqueEmail('short'), display_name: 'Kort' }, auth(admin));
    expect((await post('/auth/accept-invite', { token: inviteToken(r.json().inviteUrl), password: 'kort' })).statusCode).toBe(400);
  });

  it('en bruger kan ikke lave et link til sig selv eller andre', async () => {
    const user = await createVia(ctx, admin, { email: uniqueEmail('self') });
    expect((await post(`/users/${user.id}/invite`, {}, auth(user))).statusCode).toBe(403);
    expect((await post(`/users/${admin.id}/invite`, {}, auth(user))).statusCode).toBe(403);
  });
});

describe('beskyttelse mod brute force', () => {
  it('begrænser login-forsøg pr. IP (Cloudflares IP-header bruges)', async () => {
    const limitedApp = await buildApp(testConfig({ AUTH_RATE_LIMIT: '3' }), ctx.db, { logger: false });
    const attempt = (ip: string) => limitedApp.inject({ method: 'POST', url: '/auth/login', headers: { 'cf-connecting-ip': ip },
      payload: { email: admin.email, password: 'forkert-forkert' } });
    for (let i = 0; i < 3; i++) expect((await attempt('203.0.113.7')).statusCode).toBe(401);
    expect((await attempt('203.0.113.7')).statusCode).toBe(429);
    expect((await attempt('203.0.113.8')).statusCode).toBe(401);   // another IP is not affected
    await limitedApp.close();
  });
});

describe('skift password og deaktivering', () => {
  it('kræver det nuværende password og logger andre sessioner ud', async () => {
    const user = await createVia(ctx, admin, { email: uniqueEmail('pw') });
    const other = (await post('/auth/login', { email: user.email, password: PASSWORD })).json();
    expect((await post('/auth/change-password', { current: 'forkert', password: 'nyt-password-123' }, auth(user))).statusCode).toBe(401);
    const r = await post('/auth/change-password', { current: PASSWORD, password: 'nyt-password-123', refresh: user.refresh }, auth(user));
    expect(r.statusCode).toBe(204);
    expect((await post('/auth/refresh', { refresh: other.refresh })).statusCode).toBe(401);
    expect((await post('/auth/refresh', { refresh: user.refresh })).statusCode).toBe(200);
    expect((await post('/auth/login', { email: user.email, password: 'nyt-password-123' })).statusCode).toBe(200);
  });

  it('en deaktiveret bruger kan ikke logge ind eller forny sin session', async () => {
    const user = await createVia(ctx, admin, { email: uniqueEmail('dis') });
    const r = await ctx.app.inject({ method: 'PATCH', url: `/users/${user.id}`, headers: auth(admin), payload: { disabled: true } });
    expect(r.statusCode).toBe(200);
    expect((await post('/auth/login', { email: user.email, password: PASSWORD })).statusCode).toBe(401);
    expect((await post('/auth/refresh', { refresh: user.refresh })).statusCode).toBe(401);
  });
});
