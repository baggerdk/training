import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { requireUser, type Deps } from '../app.ts';
import { hashPassword, PASSWORD_MIN, verifyPassword } from '../auth/passwords.ts';
import { daysFromNow, newOpaqueToken, REFRESH_TTL_DAYS, sha256 } from '../auth/tokens.ts';
import { tx } from '../db.ts';
import { ApiError } from '../errors.ts';
import { loadProfile } from '../profile.ts';

const LoginBody = Type.Object({ email: Type.String({ minLength: 3, maxLength: 254 }), password: Type.String({ minLength: 1, maxLength: 200 }) });
const RefreshBody = Type.Object({ refresh: Type.String({ minLength: 20, maxLength: 200 }) });
const AcceptBody = Type.Object({ token: Type.String({ minLength: 20, maxLength: 200 }), password: Type.String({ minLength: PASSWORD_MIN, maxLength: 200 }) });
const ChangeBody = Type.Object({
  current: Type.String({ minLength: 1, maxLength: 200 }),
  password: Type.String({ minLength: PASSWORD_MIN, maxLength: 200 }),
  refresh: Type.Optional(Type.String({ maxLength: 200 })),   // the session to keep; all others are logged out
});

export async function authRoutes(app: FastifyInstance, { db, tokens, cfg }: Deps) {
  // Brute-force protection on top of Cloudflare's rule: AUTH_RATE_LIMIT (default 10) attempts per minute per IP
  const limited = { rateLimit: { max: cfg.authRateLimit, timeWindow: '1 minute' } };

  async function issueSession(userId: string) {
    const refresh = newOpaqueToken();
    const profile = await tx(db, userId, async c => {
      await c.query('select auth_create_refresh($1, $2, $3)', [userId, sha256(refresh), daysFromNow(REFRESH_TTL_DAYS)]);
      return loadProfile(c, userId);
    });
    return { access: await tokens.signAccess({ id: profile.id, role: profile.role }), refresh, profile };
  }

  app.post('/auth/login', { config: limited, schema: { body: LoginBody } }, async req => {
    const { email, password } = req.body as Static<typeof LoginBody>;
    const row = await tx(db, null, async c =>
      (await c.query<{ id: string; password_hash: string | null; disabled: boolean }>('select * from auth_login_lookup($1)', [email.trim()])).rows[0]);
    const ok = await verifyPassword(row && !row.disabled ? row.password_hash : null, password);
    if (!row || row.disabled || !ok) throw new ApiError(401, 'invalid_credentials', 'Forkert e-mail eller password');
    return issueSession(row.id);
  });

  app.post('/auth/refresh', { config: limited, schema: { body: RefreshBody } }, async req => {
    const { refresh } = req.body as Static<typeof RefreshBody>;
    const next = newOpaqueToken();
    const r = await tx(db, null, async c =>
      (await c.query<{ user_id: string | null; status: string }>('select * from auth_rotate_refresh($1, $2, $3)',
        [sha256(refresh), sha256(next), daysFromNow(REFRESH_TTL_DAYS)])).rows[0]);
    if (r?.status !== 'ok' || !r.user_id) throw new ApiError(401, 'session_expired', 'Din session er udløbet – log ind igen');
    const profile = await tx(db, r.user_id, c => loadProfile(c, r.user_id!));
    return { access: await tokens.signAccess({ id: profile.id, role: profile.role }), refresh: next };
  });

  app.post('/auth/logout', { schema: { body: RefreshBody } }, async (req, reply) => {
    const { refresh } = req.body as Static<typeof RefreshBody>;
    await tx(db, null, c => c.query('select auth_revoke_refresh($1)', [sha256(refresh)]));
    return reply.code(204).send();
  });

  app.post('/auth/accept-invite', { config: limited, schema: { body: AcceptBody } }, async req => {
    const { token, password } = req.body as Static<typeof AcceptBody>;
    const hashed = await hashPassword(password);
    const userId = await tx(db, null, async c =>
      (await c.query<{ id: string | null }>('select auth_accept_invite($1, $2) as id', [sha256(token), hashed])).rows[0]?.id);
    if (!userId) throw new ApiError(410, 'invite_invalid', 'Invitationslinket er ugyldigt, allerede brugt eller udløbet. Bed din træner om et nyt.');
    return issueSession(userId);
  });

  app.post('/auth/change-password', { config: limited, schema: { body: ChangeBody } }, async (req, reply) => {
    const me = requireUser(req);
    const { current, password, refresh } = req.body as Static<typeof ChangeBody>;
    const currentHash = await tx(db, me.id, async c =>
      (await c.query<{ h: string | null }>('select auth_get_own_password_hash() as h')).rows[0]?.h ?? null);
    if (!(await verifyPassword(currentHash, current))) throw new ApiError(401, 'invalid_credentials', 'Det nuværende password er forkert');
    const hashed = await hashPassword(password);
    await tx(db, me.id, c => c.query('select auth_set_own_password($1, $2)', [hashed, refresh ? sha256(refresh) : null]));
    return reply.code(204).send();
  });

  app.get('/me', async req => {
    const me = requireUser(req);
    return tx(db, me.id, c => loadProfile(c, me.id));
  });
}
