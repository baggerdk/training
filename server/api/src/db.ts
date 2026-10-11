import pg from 'pg';
import type { Config } from './config.ts';

// numeric comes back as a string by default; the app only stores small decimal values (kg, RPE)
pg.types.setTypeParser(pg.types.builtins.NUMERIC, v => (v === null ? null : Number(v)));

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export function createAppPool(cfg: Config): Db {
  return new pg.Pool({ ...cfg.db, user: 'powerkrop_app', password: cfg.appPassword, max: 10 });
}

export function ownerConnection(cfg: Pick<Config, 'db' | 'ownerPassword'>): pg.Client {
  if (!cfg.ownerPassword) throw new Error('OWNER_PASSWORD mangler – migrationer og scripts køres med migrate-tjenesten');
  return new pg.Client({ ...cfg.db, user: 'powerkrop_owner', password: cfg.ownerPassword });
}

// Every request runs in its own transaction with app.user_id set for RLS (cleared at commit/rollback).
// userId null = not logged in: RLS then shows nothing, and only the auth functions are useful.
export async function tx<T>(db: Db, userId: string | null, fn: (c: Tx) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('app.user_id', $1, true)", [userId ?? '']);
    const result = await fn(c);
    await c.query('commit');
    return result;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

// Postgres error codes the API maps to HTTP statuses
export const PG = {
  insufficientPrivilege: '42501',
  uniqueViolation: '23505',
  foreignKeyViolation: '23503',
  checkViolation: '23514',
} as const;

export function pgCode(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : undefined;
}
