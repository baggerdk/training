import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { createTokenService, type AccessClaims, type TokenService } from './auth/tokens.ts';
import type { Config } from './config.ts';
import { PG, pgCode, type Db } from './db.ts';
import { ApiError, unauthorized } from './errors.ts';
import { authRoutes } from './routes/auth.ts';
import { healthRoutes } from './routes/health.ts';
import { syncRoutes } from './routes/sync.ts';
import { userRoutes } from './routes/users.ts';
import { wellKnownRoutes } from './routes/wellknown.ts';
import { inviteRoutes } from './routes/invite.ts';
import { adminRoutes } from './routes/admin.ts';
import { adminSiteRoutes } from './routes/admin-site.ts';

declare module 'fastify' {
  interface FastifyRequest { auth: AccessClaims | null }
}

export interface Deps { db: Db; cfg: Config; tokens: TokenService }

// Returns the logged-in user or throws 401
export function requireUser(req: FastifyRequest): AccessClaims {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

// Cloudflare Tunnel is the only way in, so CF-Connecting-IP is the client's real IP (logging, rate limiting)
export const clientIp = (req: FastifyRequest): string => String(req.headers['cf-connecting-ip'] ?? req.ip);

export async function buildApp(cfg: Config, db: Db, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? true,
    bodyLimit: 5 * 1024 * 1024,
    trustProxy: false,
  });
  const deps: Deps = { db, cfg, tokens: createTokenService(cfg.jwtSecret) };

  await app.register(cors, {
    origin: cfg.corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  });
  await app.register(rateLimit, { global: false, keyGenerator: clientIp });

  // Bearer access token → req.auth. A bad or expired token counts as not logged in.
  app.decorateRequest('auth', null);
  app.addHook('onRequest', async req => {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) return;
    try { req.auth = await deps.tokens.verifyAccess(h.slice(7)); } catch { req.auth = null; }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) return reply.code(err.status).send({ error: err.code, message: err.message });
    const e = err as { validation?: unknown; statusCode?: number; message: string };
    if (e.validation) return reply.code(400).send({ error: 'invalid_request', message: 'Ugyldig forespørgsel', detail: e.message });
    if (e.statusCode === 429) return reply.code(429).send({ error: 'rate_limited', message: 'For mange forsøg – vent et minut, og prøv igen' });
    const code = pgCode(err);
    if (code === PG.insufficientPrivilege) return reply.code(403).send({ error: 'forbidden', message: 'Du har ikke rettighed til at gøre dette' });
    if (code === PG.checkViolation) return reply.code(400).send({ error: 'invalid_request', message: 'Ugyldige data' });
    // Fastify's own client errors (bad JSON, wrong Content-Length, body too large, …) are not server errors
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.code(e.statusCode).send({ error: 'invalid_request', message: e.statusCode === 413 ? 'Forespørgslen er for stor' : 'Ugyldig forespørgsel' });
    }
    req.log.error(err);
    return reply.code(500).send({ error: 'server_error', message: 'Der opstod en fejl på serveren' });
  });

  await app.register(healthRoutes, deps);
  await app.register(authRoutes, deps);
  await app.register(userRoutes, deps);
  await app.register(syncRoutes, deps);
  await app.register(wellKnownRoutes, deps);
  await app.register(inviteRoutes, deps);
  await app.register(adminRoutes, deps);
  await app.register(adminSiteRoutes, deps);
  return app;
}
