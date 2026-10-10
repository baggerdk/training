import { ownerConnection } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { testConfig } from './env.ts';

// Runs the real migrations once against the throwaway database from compose.test.yml
export default async function setup() {
  const cfg = testConfig();
  const client = ownerConnection(cfg);
  try {
    await client.connect();
  } catch (e) {
    throw new Error(`Test-databasen svarer ikke på 127.0.0.1:15433. Start den med: docker compose -f compose.test.yml up -d --wait (${(e as Error).message})`);
  }
  try {
    await migrate(client, cfg.migrationsDir);
  } finally {
    await client.end();
  }
}
