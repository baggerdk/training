import { randomUUID } from 'node:crypto';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { requireUser, type Deps } from '../app.ts';
import { daysFromNow, INVITE_TTL_DAYS, newOpaqueToken, sha256 } from '../auth/tokens.ts';
import { PG, pgCode, tx, type Tx } from '../db.ts';
import { ApiError, forbidden, notFound } from '../errors.ts';
import { loadProfile, myRole, PROFILE_COLS } from '../profile.ts';

const Uuid = Type.String({ format: 'uuid' });
const Role = Type.Union([Type.Literal('admin'), Type.Literal('trainer'), Type.Literal('user')]);
const IdParams = Type.Object({ id: Uuid });
const CreateBody = Type.Object({
  email: Type.String({ format: 'email', maxLength: 254 }),
  display_name: Type.String({ minLength: 1, maxLength: 100 }),
  role: Type.Optional(Role),
  trainer_id: Type.Optional(Type.Union([Uuid, Type.Null()])),
});
const PatchBody = Type.Object({
  display_name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  email: Type.Optional(Type.String({ format: 'email', maxLength: 254 })),
  role: Type.Optional(Role),
  trainer_id: Type.Optional(Type.Union([Uuid, Type.Null()])),
  disabled: Type.Optional(Type.Boolean()),
}, { minProperties: 1, additionalProperties: false });

const emailTaken = () => new ApiError(409, 'email_taken', 'E-mailen er allerede i brug');

export async function userRoutes(app: FastifyInstance, { db, cfg }: Deps) {
  // One-time link (7 days) the admin/trainer sends to the user themselves (SMS, Messenger, …).
  // Also used as "forgot password": a new link replaces the old one.
  async function createInvite(c: Tx, userId: string): Promise<string> {
    const token = newOpaqueToken();
    await c.query('select auth_create_invite($1, $2, $3)', [userId, sha256(token), daysFromNow(INVITE_TTL_DAYS)]);
    return cfg.inviteBaseUrl + token;
  }

  // admin: everyone · trainer: own users · user: nobody (only themselves, via /me)
  app.get('/users', async req => {
    const me = requireUser(req);
    return tx(db, me.id, async c =>
      (await c.query(`select ${PROFILE_COLS} from users where id <> app_uid() order by display_name`)).rows);
  });

  app.post('/users', { schema: { body: CreateBody } }, async (req, reply) => {
    const me = requireUser(req);
    const body = req.body as Static<typeof CreateBody>;
    const result = await tx(db, me.id, async c => {
      const role = await myRole(c);
      if (role !== 'admin' && role !== 'trainer') throw forbidden('Du har ikke rettighed til at oprette brugere');
      if (role === 'trainer' && body.role && body.role !== 'user') throw forbidden('En træner kan kun oprette brugere');
      const id = randomUUID();
      try {
        // For a trainer, the users_guard trigger forces role = 'user' and trainer_id = the trainer
        await c.query('insert into users (id, email, display_name, role, trainer_id) values ($1, $2, $3, $4, $5)',
          [id, body.email.trim(), body.display_name.trim(), body.role ?? 'user', body.trainer_id ?? null]);
      } catch (e) {
        if (pgCode(e) === PG.uniqueViolation) throw emailTaken();
        throw e;
      }
      return { profile: await loadProfile(c, id), inviteUrl: await createInvite(c, id) };
    });
    return reply.code(201).send(result);
  });

  app.post('/users/:id/invite', { schema: { params: IdParams } }, async req => {
    const me = requireUser(req);
    const { id } = req.params as Static<typeof IdParams>;
    return tx(db, me.id, async c => ({ inviteUrl: await createInvite(c, id) }));
  });

  // Rules live in the database (users_guard + RLS): only admins change role/trainer/e-mail/disabled,
  // nobody changes their own role, everyone may change their own display_name
  app.patch('/users/:id', { schema: { params: IdParams, body: PatchBody } }, async req => {
    const me = requireUser(req);
    const { id } = req.params as Static<typeof IdParams>;
    const body = req.body as Static<typeof PatchBody>;
    const set: string[] = [], vals: unknown[] = [id];
    const add = (col: string, v: unknown) => { vals.push(v); set.push(`${col} = $${vals.length}`); };
    if (body.display_name !== undefined) add('display_name', body.display_name.trim());
    if (body.email !== undefined) add('email', body.email.trim());
    if (body.role !== undefined) add('role', body.role);
    if (body.trainer_id !== undefined) add('trainer_id', body.trainer_id);
    if (body.disabled !== undefined) set.push(body.disabled ? 'disabled_at = coalesce(disabled_at, now())' : 'disabled_at = null');
    return tx(db, me.id, async c => {
      try {
        const r = await c.query(`update users set ${set.join(', ')} where id = $1`, vals);
        if (!r.rowCount) throw notFound('Brugeren findes ikke');
      } catch (e) {
        if (pgCode(e) === PG.uniqueViolation) throw emailTaken();
        throw e;
      }
      if (body.disabled) await c.query('select auth_revoke_all_refresh($1)', [id]);
      return loadProfile(c, id);
    });
  });

  // Admin: anyone. Everyone: their own account ("Slet min konto") – all their data is deleted with it (cascade).
  app.delete('/users/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const me = requireUser(req);
    const { id } = req.params as Static<typeof IdParams>;
    await tx(db, me.id, async c => {
      const r = await c.query('delete from users where id = $1', [id]);
      if (!r.rowCount) throw notFound('Brugeren findes ikke, eller du må ikke slette den');
    });
    return reply.code(204).send();
  });
}
