// Endpoints for the admin website (/admin): user details, athlete profiles, programs for a user and the
// trainers' own templates. Every rule is also enforced by RLS (migrations/002_admin.sql); the checks here
// give clear Danish errors.
import { randomUUID } from 'node:crypto';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { requireUser, type Deps } from '../app.ts';
import { tx, type Tx } from '../db.ts';
import { forbidden, notFound } from '../errors.ts';
import { loadProfile, myRole } from '../profile.ts';

const Uuid = Type.String({ format: 'uuid' });
const IdParams = Type.Object({ id: Uuid });
const Level = Type.Integer({ minimum: 0, maximum: 2 });
const TreeLevels = Type.Record(Type.String({ maxLength: 32 }), Type.Integer({ minimum: 0, maximum: 50 }), { maxProperties: 40 });
const AthleteBody = Type.Object({
  level: Level,
  tree_levels: TreeLevels,
  goals: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
  notes: Type.Optional(Type.Union([Type.String({ maxLength: 4000 }), Type.Null()])),
}, { additionalProperties: false });
const ProgramData = Type.Record(Type.String(), Type.Unknown());
const ProgramBody = Type.Object({
  id: Type.Optional(Uuid),
  name: Type.String({ minLength: 1, maxLength: 200 }),
  template_key: Type.Optional(Type.Union([Type.String({ maxLength: 64 }), Type.Null()])),
  level: Type.Optional(Type.Union([Type.String({ maxLength: 32 }), Type.Null()])),
  days_per_week: Type.Optional(Type.Union([Type.Integer({ minimum: 1, maximum: 7 }), Type.Null()])),
  data: ProgramData,
}, { additionalProperties: false });
const TemplateBody = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.Optional(Type.Union([Type.String({ maxLength: 4000 }), Type.Null()])),
  level: Type.Optional(Type.Union([Level, Type.Null()])),
  days_per_week: Type.Optional(Type.Union([Type.Integer({ minimum: 1, maximum: 7 }), Type.Null()])),
  tags: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 40 }), { maxItems: 20 })),
  data: ProgramData,
  shared: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

const PROGRAM_COLS = 'id, owner_id, created_by, name, template_key, level, days_per_week, data, created_at, updated_at';
const TEMPLATE_COLS = 't.id, t.created_by, u.display_name as created_by_name, t.name, t.description, t.level, t.days_per_week, t.tags, t.data, t.shared, t.created_at, t.updated_at';

async function requireStaff(c: Tx) {
  const role = await myRole(c);
  if (role !== 'admin' && role !== 'trainer') throw forbidden('Kun admin og trænere har adgang');
  return role;
}

export async function adminRoutes(app: FastifyInstance, { db }: Deps) {
  // A user with their athlete profile and a short training summary
  app.get('/users/:id', { schema: { params: IdParams } }, async req => {
    const me = requireUser(req);
    const { id } = req.params as Static<typeof IdParams>;
    return tx(db, me.id, async c => {
      if (id !== me.id) await requireStaff(c);
      const profile = await loadProfile(c, id);
      const athlete = (await c.query('select level, tree_levels, goals, notes, updated_by, updated_at from athlete_profiles where user_id = $1', [id])).rows[0] ?? null;
      const stats = (await c.query(`select
          (select count(*)::int from workout_sessions where user_id = $1 and deleted_at is null) as workouts,
          (select max(finished_at) from workout_sessions where user_id = $1 and deleted_at is null) as last_workout,
          (select count(*)::int from programs where owner_id = $1 and deleted_at is null) as programs`, [id])).rows[0];
      return { profile, athlete, stats };
    });
  });

  app.put('/users/:id/athlete', { schema: { params: IdParams, body: AthleteBody } }, async req => {
    const me = requireUser(req);
    const { id } = req.params as Static<typeof IdParams>;
    const b = req.body as Static<typeof AthleteBody>;
    return tx(db, me.id, async c => {
      if (id !== me.id) await requireStaff(c);
      await loadProfile(c, id);   // 404 if the caller may not see the user
      await c.query(`insert into athlete_profiles (user_id, level, tree_levels, goals, notes) values ($1, $2, $3, $4, $5)
        on conflict (user_id) do update set level = excluded.level, tree_levels = excluded.tree_levels, goals = excluded.goals, notes = excluded.notes`,
        [id, b.level, JSON.stringify(b.tree_levels), b.goals ?? null, b.notes ?? null]);
      return (await c.query('select level, tree_levels, goals, notes, updated_by, updated_at from athlete_profiles where user_id = $1', [id])).rows[0];
    });
  });

  app.get('/users/:id/programs', { schema: { params: IdParams } }, async req => {
    const me = requireUser(req);
    const { id } = req.params as Static<typeof IdParams>;
    return tx(db, me.id, async c => {
      if (id !== me.id) await requireStaff(c);
      return (await c.query(`select ${PROGRAM_COLS} from programs where owner_id = $1 and deleted_at is null order by created_at desc`, [id])).rows;
    });
  });

  // A program for a user. The users_guard/programs_guard triggers make the caller its author (created_by),
  // so the user sees it as "from your trainer" and can't edit it (RLS).
  app.post('/users/:id/programs', { schema: { params: IdParams, body: ProgramBody } }, async (req, reply) => {
    const me = requireUser(req);
    const { id } = req.params as Static<typeof IdParams>;
    const b = req.body as Static<typeof ProgramBody>;
    const row = await tx(db, me.id, async c => {
      if (id !== me.id) await requireStaff(c);
      await loadProfile(c, id);
      const pid = b.id ?? randomUUID();
      await c.query('insert into programs (id, owner_id, name, template_key, level, days_per_week, data) values ($1, $2, $3, $4, $5, $6, $7)',
        [pid, id, b.name.trim(), b.template_key ?? null, b.level ?? null, b.days_per_week ?? null, JSON.stringify(b.data)]);
      return (await c.query(`select ${PROGRAM_COLS} from programs where id = $1`, [pid])).rows[0];
    });
    return reply.code(201).send(row);
  });

  app.put('/programs/:id', { schema: { params: IdParams, body: ProgramBody } }, async req => {
    const me = requireUser(req);
    const { id } = req.params as Static<typeof IdParams>;
    const b = req.body as Static<typeof ProgramBody>;
    return tx(db, me.id, async c => {
      const r = await c.query('update programs set name = $2, template_key = $3, level = $4, days_per_week = $5, data = $6 where id = $1 and deleted_at is null',
        [id, b.name.trim(), b.template_key ?? null, b.level ?? null, b.days_per_week ?? null, JSON.stringify(b.data)]);
      if (!r.rowCount) throw notFound('Programmet findes ikke, eller du må ikke redigere det');
      return (await c.query(`select ${PROGRAM_COLS} from programs where id = $1`, [id])).rows[0];
    });
  });

  app.delete('/programs/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const me = requireUser(req);
    const { id } = req.params as Static<typeof IdParams>;
    await tx(db, me.id, async c => {
      const r = await c.query('update programs set deleted_at = now() where id = $1 and deleted_at is null', [id]);
      if (!r.rowCount) throw notFound('Programmet findes ikke, eller du må ikke slette det');
    });
    return reply.code(204).send();
  });

  // ---- The trainers' own templates
  app.get('/templates', async req => {
    const me = requireUser(req);
    return tx(db, me.id, async c => {
      await requireStaff(c);
      return (await c.query(`select ${TEMPLATE_COLS} from program_templates t left join users u on u.id = t.created_by
        where t.deleted_at is null order by t.name`)).rows;
    });
  });

  app.post('/templates', { schema: { body: TemplateBody } }, async (req, reply) => {
    const me = requireUser(req);
    const b = req.body as Static<typeof TemplateBody>;
    const row = await tx(db, me.id, async c => {
      await requireStaff(c);
      const id = randomUUID();
      await c.query(`insert into program_templates (id, name, description, level, days_per_week, tags, data, shared)
        values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, b.name.trim(), b.description ?? null, b.level ?? null, b.days_per_week ?? null, b.tags ?? [], JSON.stringify(b.data), b.shared ?? false]);
      return (await c.query(`select ${TEMPLATE_COLS} from program_templates t left join users u on u.id = t.created_by where t.id = $1`, [id])).rows[0];
    });
    return reply.code(201).send(row);
  });

  app.put('/templates/:id', { schema: { params: IdParams, body: TemplateBody } }, async req => {
    const me = requireUser(req);
    const { id } = req.params as Static<typeof IdParams>;
    const b = req.body as Static<typeof TemplateBody>;
    return tx(db, me.id, async c => {
      await requireStaff(c);
      const r = await c.query(`update program_templates set name = $2, description = $3, level = $4, days_per_week = $5, tags = $6, data = $7, shared = $8
        where id = $1 and deleted_at is null`,
        [id, b.name.trim(), b.description ?? null, b.level ?? null, b.days_per_week ?? null, b.tags ?? [], JSON.stringify(b.data), b.shared ?? false]);
      if (!r.rowCount) throw notFound('Skabelonen findes ikke, eller du må ikke redigere den');
      return (await c.query(`select ${TEMPLATE_COLS} from program_templates t left join users u on u.id = t.created_by where t.id = $1`, [id])).rows[0];
    });
  });

  app.delete('/templates/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const me = requireUser(req);
    const { id } = req.params as Static<typeof IdParams>;
    await tx(db, me.id, async c => {
      await requireStaff(c);
      const r = await c.query('update program_templates set deleted_at = now() where id = $1 and deleted_at is null', [id]);
      if (!r.rowCount) throw notFound('Skabelonen findes ikke, eller du må ikke slette den');
    });
    return reply.code(204).send();
  });
}
