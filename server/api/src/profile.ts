import type { Tx } from './db.ts';
import { notFound } from './errors.ts';

// Every column the API may return from users. password_hash is not readable by powerkrop_app at all.
export const PROFILE_COLS = 'id, email, display_name, role, trainer_id, created_by, disabled_at, created_at, updated_at';

export interface Profile {
  id: string; email: string; display_name: string; role: 'admin' | 'trainer' | 'user';
  trainer_id: string | null; created_by: string | null; disabled_at: Date | null; created_at: Date; updated_at: Date;
}

export async function loadProfile(c: Tx, id: string): Promise<Profile> {
  const r = await c.query<Profile>(`select ${PROFILE_COLS} from users where id = $1`, [id]);
  if (!r.rows[0]) throw notFound('Brugeren findes ikke');
  return r.rows[0];
}

export async function myRole(c: Tx): Promise<Profile['role'] | null> {
  return (await c.query<{ role: Profile['role'] | null }>('select app_user_role() as role')).rows[0]?.role ?? null;
}
