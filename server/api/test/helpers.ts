// Test fixtures: an app instance on the test database and users created the real way (invite → password).
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { buildApp } from '../src/app.ts';
import { sha256, newOpaqueToken, daysFromNow } from '../src/auth/tokens.ts';
import { createAppPool, ownerConnection, type Db } from '../src/db.ts';
import { SUPERUSER, testConfig } from './env.ts';

export const PASSWORD = 'korrekt-hest-batteri';

export interface Ctx { app: FastifyInstance; db: Db }
export interface TestUser { id: string; email: string; access: string; refresh: string; role: string }

export async function setupApp(): Promise<Ctx> {
  const cfg = testConfig();
  const db = createAppPool(cfg);
  const app = await buildApp(cfg, db, { logger: false });
  return { app, db };
}

export async function teardownApp(ctx: Ctx) {
  await ctx.app.close();
  await ctx.db.end();
}

// Empties every table between test files (superuser, so RLS doesn't get in the way)
export async function resetDb() {
  const c = new pg.Client(SUPERUSER);
  await c.connect();
  await c.query(`truncate users, refresh_tokens, invites, programs, program_progress, workout_sessions, set_logs,
    training_maxes, user_exercise_videos, max_tests, user_settings, custom_exercises cascade`);
  await c.end();
}

export const auth = (u: { access: string }) => ({ authorization: `Bearer ${u.access}` });
export const inviteToken = (url: string) => url.slice(url.lastIndexOf('/') + 1);
export const uniqueEmail = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}@example.test`;

async function acceptInvite(ctx: Ctx, token: string): Promise<{ access: string; refresh: string; profile: { id: string; role: string; email: string } }> {
  const r = await ctx.app.inject({ method: 'POST', url: '/auth/accept-invite', payload: { token, password: PASSWORD } });
  if (r.statusCode !== 200) throw new Error(`accept-invite: ${r.statusCode} ${r.body}`);
  return r.json();
}

// The first admin, exactly as create-admin.ts makes it
export async function createAdmin(ctx: Ctx): Promise<TestUser> {
  const token = newOpaqueToken();
  const client = ownerConnection(testConfig());
  await client.connect();
  await client.query('select admin_bootstrap($1, $2, $3, $4)', [uniqueEmail('admin'), 'Admin', sha256(token), daysFromNow(7)]);
  await client.end();
  const s = await acceptInvite(ctx, token);
  return { id: s.profile.id, email: s.profile.email, access: s.access, refresh: s.refresh, role: s.profile.role };
}

export async function createVia(ctx: Ctx, creator: TestUser, body: Record<string, unknown>): Promise<TestUser> {
  const r = await ctx.app.inject({ method: 'POST', url: '/users', headers: auth(creator), payload: { display_name: 'Test', ...body } });
  if (r.statusCode !== 201) throw new Error(`POST /users: ${r.statusCode} ${r.body}`);
  const s = await acceptInvite(ctx, inviteToken(r.json().inviteUrl));
  return { id: s.profile.id, email: s.profile.email, access: s.access, refresh: s.refresh, role: s.profile.role };
}

// admin, trainer A with user A, trainer B with user B
export async function createCast(ctx: Ctx) {
  const admin = await createAdmin(ctx);
  const trainerA = await createVia(ctx, admin, { email: uniqueEmail('trainer-a'), role: 'trainer' });
  const trainerB = await createVia(ctx, admin, { email: uniqueEmail('trainer-b'), role: 'trainer' });
  const userA = await createVia(ctx, trainerA, { email: uniqueEmail('user-a') });
  const userB = await createVia(ctx, trainerB, { email: uniqueEmail('user-b') });
  return { admin, trainerA, trainerB, userA, userB };
}

export const program = (ownerId: string, name = 'Program') => ({
  id: randomUUID(), owner_id: ownerId, name, template_key: 'cal', level: 'begynder', days_per_week: 3,
  data: { days: [{ name: 'Dag 1', items: [{ ex: 'pullup', sets: [{ r: 5 }] }] }] },
});
