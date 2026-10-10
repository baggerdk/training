// Applies server/migrations/*.sql in name order, each in its own transaction, as powerkrop_owner.
// Applied files are recorded in schema_migrations; an advisory lock stops two API containers racing.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { loadConfig } from './config.ts';
import { ownerConnection } from './db.ts';

const LOCK_ID = 7_340_201;

export async function migrate(client: pg.Client, dir: string): Promise<string[]> {
  const applied: string[] = [];
  await client.query('select pg_advisory_lock($1)', [LOCK_ID]);
  try {
    await client.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
    const done = new Set((await client.query<{ name: string }>('select name from schema_migrations')).rows.map(r => r.name));
    const files = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(path.join(dir, f), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (name) values ($1)', [f]);
        await client.query('commit');
        applied.push(f);
      } catch (e) {
        await client.query('rollback');
        throw new Error(`Migrationen ${f} fejlede: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
  }
  return applied;
}

export async function migrateFromConfig(): Promise<string[]> {
  const cfg = loadConfig();
  const client = ownerConnection(cfg);
  await client.connect();
  try {
    return await migrate(client, cfg.migrationsDir);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const applied = await migrateFromConfig();
  console.log(applied.length ? `Migrationer kørt: ${applied.join(', ')}` : 'Databasen er opdateret');
}
