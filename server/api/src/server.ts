// Entry point in the container: run migrations (only if OWNER_PASSWORD is set – in production the one-shot
// migrate service does it, so the API itself never holds the owner password), then serve on :3000 (reached only through Cloudflare Tunnel)
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createAppPool } from './db.ts';
import { migrateFromConfig } from './migrate.ts';

const cfg = loadConfig();
const applied = cfg.ownerPassword ? await migrateFromConfig() : [];
const db = createAppPool(cfg);
const app = await buildApp(cfg, db);
if (applied.length) app.log.info({ applied }, 'Migrationer kørt');

const shutdown = async () => {
  await app.close();
  await db.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ host: '0.0.0.0', port: cfg.port });
