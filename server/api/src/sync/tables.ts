// The tables the app synchronises, and which columns the client may write.
// user_id / created_by / updated_at are always set by the server, never trusted from the client.

export type ColType = 'uuid' | 'text' | 'int' | 'num' | 'json' | 'ts';
export interface Col { name: string; type: ColType; required?: boolean }

export interface SyncTable {
  name: string;
  pk: string[];
  cols: Col[];                    // writable by the client (incl. client-side pk columns)
  owner: 'user_id' | 'owner_id';  // user_id: always the caller · owner_id: programs, may be a managed user
  softDelete: boolean;
  pullScope: string;              // what the caller's own device needs (RLS still applies on top)
  readOnlyCols: string[];         // extra columns returned on pull
}

const userTable = (name: string, pk: string[], cols: Col[], softDelete = true): SyncTable => ({
  name, pk, cols, owner: 'user_id', softDelete, pullScope: 'user_id = app_uid()',
  readOnlyCols: ['user_id', ...(softDelete ? ['deleted_at'] : []), 'updated_at'],
});

export const SYNC_TABLES: Record<string, SyncTable> = {
  programs: {
    name: 'programs', pk: ['id'], owner: 'owner_id', softDelete: true,
    // A trainer's device gets the programs they wrote for their users as well
    pullScope: '(owner_id = app_uid() or created_by = app_uid())',
    readOnlyCols: ['created_by', 'deleted_at', 'created_at', 'updated_at'],
    cols: [
      { name: 'id', type: 'uuid', required: true }, { name: 'owner_id', type: 'uuid' },
      { name: 'name', type: 'text', required: true }, { name: 'template_key', type: 'text' },
      { name: 'level', type: 'text' }, { name: 'days_per_week', type: 'int' },
      { name: 'data', type: 'json', required: true },
    ],
  },
  program_progress: userTable('program_progress', ['user_id', 'program_id'], [
    { name: 'program_id', type: 'uuid', required: true }, { name: 'week', type: 'int' }, { name: 'day', type: 'int' },
  ]),
  workout_sessions: userTable('workout_sessions', ['id'], [
    { name: 'id', type: 'uuid', required: true }, { name: 'program_id', type: 'uuid' },
    { name: 'week_index', type: 'int' }, { name: 'day_index', type: 'int' }, { name: 'name', type: 'text' },
    { name: 'started_at', type: 'ts', required: true }, { name: 'finished_at', type: 'ts' },
    { name: 'notes', type: 'text' }, { name: 'data', type: 'json' },
  ]),
  set_logs: userTable('set_logs', ['id'], [
    { name: 'id', type: 'uuid', required: true }, { name: 'session_id', type: 'uuid', required: true },
    { name: 'exercise_id', type: 'text', required: true }, { name: 'variant', type: 'text' },
    { name: 'item_index', type: 'int' }, { name: 'set_index', type: 'int', required: true },
    { name: 'reps', type: 'int' }, { name: 'weight_kg', type: 'num' }, { name: 'duration_s', type: 'int' },
    { name: 'rpe', type: 'num' }, { name: 'target', type: 'json' }, { name: 'logged_at', type: 'ts', required: true },
  ]),
  training_maxes: userTable('training_maxes', ['user_id', 'lift_key'], [
    { name: 'lift_key', type: 'text', required: true }, { name: 'one_rm_kg', type: 'num' }, { name: 'tm_kg', type: 'num' },
  ]),
  user_exercise_videos: userTable('user_exercise_videos', ['user_id', 'exercise_id'], [
    { name: 'exercise_id', type: 'text', required: true }, { name: 'url', type: 'text', required: true },
  ]),
  max_tests: userTable('max_tests', ['id'], [
    { name: 'id', type: 'uuid', required: true }, { name: 'test_key', type: 'text', required: true },
    { name: 'value', type: 'num', required: true }, { name: 'unit', type: 'text', required: true },
    { name: 'tested_at', type: 'ts', required: true },
  ]),
  user_settings: userTable('user_settings', ['user_id'], [{ name: 'data', type: 'json', required: true }], false),
  custom_exercises: userTable('custom_exercises', ['user_id', 'exercise_id'], [
    { name: 'exercise_id', type: 'text', required: true }, { name: 'data', type: 'json', required: true },
  ]),
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Returns the SQL parameter value, or throws a message (Danish) when the value is invalid
export function coerce(col: Col, v: unknown): unknown {
  if (v === null || v === undefined) {
    if (col.required) throw new Error(`${col.name} mangler`);
    return null;
  }
  switch (col.type) {
    case 'uuid': if (typeof v === 'string' && UUID_RE.test(v)) return v; break;
    case 'text': if (typeof v === 'string' && v.length <= 4000) return v; break;
    case 'int': if (Number.isInteger(v)) return v; break;
    case 'num': if (typeof v === 'number' && Number.isFinite(v)) return v; break;
    case 'json': if (typeof v === 'object' && !Array.isArray(v)) return JSON.stringify(v); break;
    case 'ts': if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) return v; break;
  }
  throw new Error(`${col.name} har en ugyldig værdi`);
}
