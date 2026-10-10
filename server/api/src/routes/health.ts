import type { FastifyInstance } from 'fastify';
import type { Deps } from '../app.ts';

// Used by the Docker healthcheck (and possibly Pulse): API up + database reachable
export async function healthRoutes(app: FastifyInstance, { db }: Deps) {
  app.get('/health', async (_req, reply) => {
    try {
      await db.query('select 1');
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'db_unavailable' });
    }
  });
}
