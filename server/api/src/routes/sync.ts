import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { requireUser, type Deps } from '../app.ts';
import { PG, pgCode, tx, type Tx } from '../db.ts';
import { PROFILE_COLS } from '../profile.ts';
import { coerce, SYNC_TABLES, type SyncTable } from '../sync/tables.ts';

const PullQuery = Type.Object({ since: Type.Optional(Type.String({ format: 'date-time' })) });
const Change = Type.Object({
  table: Type.String({ maxLength: 64 }),
  op: Type.Union([Type.Literal('upsert'), Type.Literal('delete')]),
  row: Type.Record(Type.String(), Type.Unknown()),
});
// Batches are capped, so a push transaction stays well under the 30-second pull overlap
const PushBody = Type.Object({ changes: Type.Array(Change, { maxItems: 500 }) });

// Pull hands out a cursor 30 s before the transaction started. updated_at is now() = transaction start,
// so a write that commits shortly after this pull still has updated_at > cursor and is caught next time.
// The client merges idempotently (last-write-wins on updated_at), so rows seen twice do no harm.
const OVERLAP = "interval '30 seconds'";

interface Rejected { index: number; table: string; reason: string; message: string }

class RowError extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) { super(message); this.reason = reason; }
}

function rejection(e: unknown): RowError {
  if (e instanceof RowError) return e;
  switch (pgCode(e)) {
    case PG.insufficientPrivilege: return new RowError('forbidden', 'Du har ikke rettighed til at ændre denne række');
    case PG.foreignKeyViolation: return new RowError('invalid_reference', 'Rækken peger på noget, der ikke findes');
    case PG.checkViolation: case '23502': case '22P02': case '22003': case '22007': case '22008':
      return new RowError('invalid', 'Ugyldige data');
  }
  throw e;
}

async function applyChange(c: Tx, me: string, t: SyncTable, op: 'upsert' | 'delete', row: Record<string, unknown>) {
  const ownerVal = row[t.owner];
  if (t.owner === 'user_id' && ownerVal !== undefined && ownerVal !== me) {
    throw new RowError('forbidden', 'Du kan kun gemme dine egne data');
  }
  const values: Record<string, unknown> = {};
  try {
    for (const col of t.cols) if (op === 'upsert' || t.pk.includes(col.name)) {
      if (op === 'upsert' && !(col.name in row) && !col.required) continue;   // leave omitted columns untouched
      values[col.name] = coerce(col, row[col.name]);
    }
  } catch (e) {
    throw new RowError('invalid', (e as Error).message);
  }
  values[t.owner] = t.owner === 'user_id' ? me : (values.owner_id ?? me);

  if (op === 'delete') {
    if (!t.softDelete) throw new RowError('invalid', `${t.name} kan ikke slettes`);
    const keys = t.pk.map((k, i) => `${k} = $${i + 1}`).join(' and ');
    const r = await c.query(`update ${t.name} set deleted_at = now() where ${keys}`, t.pk.map(k => values[k]));
    if (!r.rowCount) {
      // Visible but not writable (e.g. a program from the trainer) is a refusal, not a missing row:
      // the client must keep the row, not forget it
      const seen = await c.query(`select 1 from ${t.name} where ${keys}`, t.pk.map(k => values[k]));
      if (seen.rowCount) throw new RowError('forbidden', 'Du har ikke rettighed til at slette denne række');
      throw new RowError('not_found', 'Rækken findes ikke');
    }
    return;
  }

  const cols = Object.keys(values);
  const params = cols.map((col, i) => `$${i + 1}${t.cols.find(x => x.name === col)?.type === 'json' ? '::jsonb' : ''}`);
  const updates = cols.filter(col => !t.pk.includes(col)).map(col => `${col} = excluded.${col}`);
  if (t.softDelete) updates.push('deleted_at = null');      // a later write revives a deleted row (last write wins)
  await c.query(
    `insert into ${t.name} (${cols.join(', ')}) values (${params.join(', ')})
     on conflict (${t.pk.join(', ')}) do update set ${updates.length ? updates.join(', ') : `${t.pk[0]} = excluded.${t.pk[0]}`}`,
    cols.map(col => values[col]));
}

export async function syncRoutes(app: FastifyInstance, { db }: Deps) {
  // Everything changed since the cursor that this device should have. RLS limits it further.
  app.get('/sync/pull', { schema: { querystring: PullQuery } }, async req => {
    const me = requireUser(req);
    const { since } = req.query as Static<typeof PullQuery>;
    return tx(db, me.id, async c => {
      const cursor = (await c.query<{ cursor: Date }>(`select now() - ${OVERLAP} as cursor`)).rows[0]!.cursor;
      const changed = '($1::timestamptz is null or updated_at > $1)';
      const changes: Record<string, unknown[]> = {
        users: (await c.query(`select ${PROFILE_COLS} from users where ${changed} order by updated_at`, [since ?? null])).rows,
      };
      for (const t of Object.values(SYNC_TABLES)) {
        const cols = [...new Set([...t.cols.map(x => x.name), ...t.pk, ...t.readOnlyCols, t.owner])];
        changes[t.name] = (await c.query(
          `select ${cols.join(', ')} from ${t.name} where ${t.pullScope} and ${changed} order by updated_at`, [since ?? null])).rows;
      }
      return { cursor, changes };
    });
  });

  // Applies the client's outbox. Each change gets a savepoint, so one rejected row doesn't stop the rest.
  app.post('/sync/push', { schema: { body: PushBody } }, async req => {
    const me = requireUser(req);
    const { changes } = req.body as Static<typeof PushBody>;
    return tx(db, me.id, async c => {
      let applied = 0;
      const rejected: Rejected[] = [];
      for (const [index, ch] of changes.entries()) {
        const t = Object.hasOwn(SYNC_TABLES, ch.table) ? SYNC_TABLES[ch.table] : undefined;
        if (!t) { rejected.push({ index, table: ch.table, reason: 'unknown_table', message: 'Ukendt tabel' }); continue; }
        await c.query('savepoint change');
        try {
          await applyChange(c, me.id, t, ch.op, ch.row);
          await c.query('release savepoint change');
          applied++;
        } catch (e) {
          await c.query('rollback to savepoint change');
          const r = rejection(e);
          rejected.push({ index, table: ch.table, reason: r.reason, message: r.message });
        }
      }
      return { applied, rejected };
    });
  });
}

