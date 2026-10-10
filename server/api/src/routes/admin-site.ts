// Serves the admin website at /admin/ (server/admin) on the API's own origin, so it needs no CORS and no
// extra Cloudflare setup. The app's exercise data and template logic are shared with it from an allowlist –
// never a whole directory, because in development the "shared" directory is the repo root.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Deps } from '../app.ts';

export const SHARED_JS = ['data.js', 'ids.js', 'templates.js', 'progression.js', 'sync-map.js', 'guide.js'];

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; " +
  "base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function secure(reply: FastifyReply) {
  reply.header('content-security-policy', CSP)
    .header('x-content-type-options', 'nosniff')
    .header('referrer-policy', 'no-referrer')
    .header('x-robots-tag', 'noindex');
}

export async function adminSiteRoutes(app: FastifyInstance, { cfg }: Deps) {
  app.get('/admin', (_req, reply) => reply.redirect('/admin/'));

  await app.register(async scoped => {
    scoped.addHook('onSend', async (_req, reply) => { secure(reply); });
    await scoped.register(fastifyStatic, { root: cfg.adminDir, prefix: '/admin/', index: 'index.html', decorateReply: false, cacheControl: false });
    // Exercise pictures for the program builder
    await scoped.register(fastifyStatic, { root: path.join(cfg.sharedDir, 'img'), prefix: '/admin/img/', decorateReply: false, maxAge: '1d' });

    scoped.get<{ Params: { file: string } }>('/admin/shared/:file', async (req, reply) => {
      const file = req.params.file;
      if (!SHARED_JS.includes(file)) return reply.code(404).send({ error: 'not_found', message: 'Findes ikke' });
      const src = await readFile(path.join(cfg.sharedDir, 'js', file), 'utf8');
      return reply.header('content-type', 'text/javascript; charset=utf-8').header('cache-control', 'no-cache').send(src);
    });
  });
}
