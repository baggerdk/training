-- power-krop: initial schema, RLS and auth helper functions.
-- Runs as powerkrop_owner. The roles themselves are created by server/db/init/01-roles.sh.
--
-- The database holds only references to the app's static content (exercise_id, template_key, lift_key,
-- test_key) – never images, descriptions or technique cues. Custom exercises are the one exception
-- (custom_exercises), because they exist only on the user's device otherwise.

create extension if not exists citext;

create type app_role as enum ('admin', 'trainer', 'user');

-- ---------------------------------------------------------------- tables

create table users (
  id            uuid primary key default gen_random_uuid(),
  email         citext unique not null check (char_length(email) between 3 and 254),
  password_hash text,                                   -- null until the invite is accepted
  display_name  text not null check (char_length(display_name) between 1 and 100),
  role          app_role not null default 'user',
  trainer_id    uuid references users(id) on delete set null,   -- only for role = 'user'
  created_by    uuid references users(id) on delete set null,
  disabled_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table refresh_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  rotated    boolean not null default false,   -- revoked because it was exchanged for a new token
  created_at timestamptz not null default now()
);

create table invites (
  token_hash text primary key,
  user_id    uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create table programs (
  id            uuid primary key,                       -- generated on the client (offline)
  owner_id      uuid not null references users(id) on delete cascade,  -- who the program is for
  created_by    uuid references users(id) on delete set null,          -- who made it (null = author deleted)
  name          text not null check (char_length(name) between 1 and 200),
  template_key  text check (char_length(template_key) <= 64),
  level         text check (char_length(level) <= 32),
  days_per_week int check (days_per_week between 1 and 7),
  data          jsonb not null check (jsonb_typeof(data) = 'object'),  -- days/items/sets; exercises only as ids
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Per-user position in a program (week/day). Separate from programs, because a user may follow a
-- program a trainer wrote without being allowed to edit it.
create table program_progress (
  user_id    uuid not null references users(id) on delete cascade,
  program_id uuid not null references programs(id) on delete cascade,
  week       int not null default 0 check (week >= 0),
  day        int not null default 0 check (day >= 0),
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, program_id)
);

create table workout_sessions (
  id          uuid primary key,
  user_id     uuid not null references users(id) on delete cascade,
  program_id  uuid references programs(id) on delete set null,
  week_index  int check (week_index >= 0),
  day_index   int check (day_index >= 0),
  name        text check (char_length(name) <= 200),
  started_at  timestamptz not null,
  finished_at timestamptz,
  notes       text check (char_length(notes) <= 4000),
  data        jsonb not null default '{}' check (jsonb_typeof(data) = 'object'),  -- block/circuit results etc.
  deleted_at  timestamptz,
  updated_at  timestamptz not null default now()
);

create table set_logs (
  id          uuid primary key,
  session_id  uuid not null references workout_sessions(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  exercise_id text not null check (char_length(exercise_id) between 1 and 64),
  variant     text check (char_length(variant) <= 64),
  item_index  int not null default 0 check (item_index >= 0),
  set_index   int not null check (set_index >= 0),
  reps        int check (reps >= 0),
  weight_kg   numeric check (weight_kg >= 0),
  duration_s  int check (duration_s >= 0),
  rpe         numeric check (rpe between 0 and 10),
  target      jsonb check (target is null or jsonb_typeof(target) = 'object'),  -- the planned set
  logged_at   timestamptz not null,
  deleted_at  timestamptz,
  updated_at  timestamptz not null default now()
);

-- 1RM per lift (squat|bench|deadlift|ohp), not per exercise – the training max is derived from it
create table training_maxes (
  user_id    uuid not null references users(id) on delete cascade,
  lift_key   text not null check (char_length(lift_key) between 1 and 32),
  one_rm_kg  numeric check (one_rm_kg >= 0),
  tm_kg      numeric check (tm_kg >= 0),
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, lift_key)
);

create table user_exercise_videos (
  user_id     uuid not null references users(id) on delete cascade,
  exercise_id text not null check (char_length(exercise_id) between 1 and 64),
  url         text not null check (char_length(url) <= 500 and url ~ '^https://'),  -- a link, never a file
  deleted_at  timestamptz,
  updated_at  timestamptz not null default now(),
  primary key (user_id, exercise_id)
);

-- test_key is the app's max-test key (pullup, hang, rm_squat, …), not an exercise_id
create table max_tests (
  id         uuid primary key,
  user_id    uuid not null references users(id) on delete cascade,
  test_key   text not null check (char_length(test_key) between 1 and 64),
  value      numeric not null check (value >= 0),
  unit       text not null check (unit in ('reps', 'kg', 's')),
  tested_at  timestamptz not null,
  deleted_at timestamptz,
  updated_at timestamptz not null default now()
);

-- App settings (tmPct, inc, rest, sound, …) and the active program id
create table user_settings (
  user_id    uuid primary key references users(id) on delete cascade,
  data       jsonb not null default '{}' check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now()
);

-- The user's own exercises (id 'my-<uid>'). data = { n, c, type, cues[] } as in the app
create table custom_exercises (
  user_id     uuid not null references users(id) on delete cascade,
  exercise_id text not null check (exercise_id ~ '^my-' and char_length(exercise_id) <= 64),
  data        jsonb not null check (jsonb_typeof(data) = 'object'),
  deleted_at  timestamptz,
  updated_at  timestamptz not null default now(),
  primary key (user_id, exercise_id)
);

create index users_trainer_idx on users (trainer_id);
create index users_updated_idx on users (updated_at);
create index refresh_tokens_user_idx on refresh_tokens (user_id);
create index invites_user_idx on invites (user_id);
create index programs_owner_updated_idx on programs (owner_id, updated_at);
create index programs_author_updated_idx on programs (created_by, updated_at);
create index program_progress_updated_idx on program_progress (user_id, updated_at);
create index workout_sessions_updated_idx on workout_sessions (user_id, updated_at);
create index set_logs_updated_idx on set_logs (user_id, updated_at);
create index set_logs_session_idx on set_logs (session_id);
create index training_maxes_updated_idx on training_maxes (user_id, updated_at);
create index videos_updated_idx on user_exercise_videos (user_id, updated_at);
create index max_tests_updated_idx on max_tests (user_id, updated_at);
create index user_settings_updated_idx on user_settings (user_id, updated_at);
create index custom_exercises_updated_idx on custom_exercises (user_id, updated_at);

-- ---------------------------------------------------------------- updated_at (server time only)
-- /sync/pull relies on updated_at, so the client's clock is never used. now() is the transaction start;
-- pull therefore returns a cursor 30 s in the past (transactions are capped at ~10 s per statement).

create function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['users', 'programs', 'program_progress', 'workout_sessions', 'set_logs',
                           'training_maxes', 'user_exercise_videos', 'max_tests', 'user_settings', 'custom_exercises']
  loop
    execute format('create trigger %I before insert or update on %I for each row execute function set_updated_at()',
                   t || '_updated_at', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- RLS helper functions
-- SECURITY DEFINER functions are owned by powerkrop_definer (BYPASSRLS), so they can read users
-- without recursing into the users policies. FORCE RLS would otherwise apply to the table owner too.

create function app_uid() returns uuid language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid $$;

create function app_user_role() returns app_role language sql stable security definer set search_path = public as $$
  select role from users where id = app_uid() and disabled_at is null $$;

create function is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(app_user_role() = 'admin', false) $$;

-- May the logged-in user see/manage the target user?
create function can_manage(target uuid) returns boolean language sql stable security definer set search_path = public as $$
  select target = app_uid()
      or is_admin()
      or (app_user_role() = 'trainer'
          and exists (select 1 from users u where u.id = target and u.trainer_id = app_uid())) $$;

create function is_trainer(target uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from users where id = target and role = 'trainer') $$;

-- ---------------------------------------------------------------- integrity triggers
-- These guard the API role only. Migrations, scripts and definer functions are trusted.

create function users_guard() returns trigger language plpgsql as $$
begin
  if current_user <> 'powerkrop_app' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if not is_admin() and app_user_role() is distinct from 'trainer' then
      raise exception 'Du har ikke rettighed til at oprette brugere' using errcode = '42501';
    end if;
    new.created_by := app_uid();
    if not is_admin() then
      -- A trainer can only create users, who automatically become the trainer's own users
      new.role := 'user';
      new.trainer_id := app_uid();
    end if;
  else
    if new.id <> old.id or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
      raise exception 'id, created_by og created_at kan ikke ændres' using errcode = '42501';
    end if;
    if new.role <> old.role and old.id = app_uid() then
      raise exception 'Du kan ikke ændre din egen rolle' using errcode = '42501';
    end if;
    if (new.role <> old.role or new.trainer_id is distinct from old.trainer_id
        or new.disabled_at is distinct from old.disabled_at or new.email <> old.email) and not is_admin() then
      raise exception 'Kun en admin kan ændre rolle, træner, e-mail eller deaktivering' using errcode = '42501';
    end if;
    if new.disabled_at is not null and old.id = app_uid() then
      raise exception 'Du kan ikke deaktivere dig selv' using errcode = '42501';
    end if;
  end if;

  if new.role <> 'user' then
    new.trainer_id := null;
  elsif new.trainer_id is not null and not is_trainer(new.trainer_id) then
    raise exception 'trainer_id skal pege på en træner' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger users_guard before insert or update on users for each row execute function users_guard();

create function programs_guard() returns trigger language plpgsql as $$
begin
  if current_user <> 'powerkrop_app' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := app_uid();
  elsif new.owner_id <> old.owner_id or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
    raise exception 'owner_id og created_by kan ikke ændres – kopiér programmet i stedet' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger programs_guard before insert or update on programs for each row execute function programs_guard();

-- ---------------------------------------------------------------- RLS

alter table users enable row level security;
alter table users force row level security;
create policy users_select on users for select using (can_manage(id));
create policy users_insert on users for insert with check (is_admin() or app_user_role() = 'trainer');
create policy users_update on users for update using (can_manage(id)) with check (can_manage(id));
create policy users_delete on users for delete using (is_admin() or id = app_uid());

-- Only reachable through the SECURITY DEFINER auth functions below
alter table refresh_tokens enable row level security;
alter table refresh_tokens force row level security;
alter table invites enable row level security;
alter table invites force row level security;

alter table programs enable row level security;
alter table programs force row level security;
create policy programs_select on programs for select using (can_manage(owner_id));
create policy programs_insert on programs for insert with check (can_manage(owner_id));
-- The owner may not edit a program someone else wrote for them (they copy it instead).
-- A trainer/admin may edit the programs of the users they manage.
create policy programs_update on programs for update
  using (can_manage(owner_id) and (owner_id <> app_uid() or created_by = app_uid() or created_by is null))
  with check (can_manage(owner_id));

-- Tables owned by one user: the user and those who manage them can read; only the user can write.
do $$
declare t text;
begin
  foreach t in array array['program_progress', 'workout_sessions', 'set_logs', 'training_maxes',
                           'user_exercise_videos', 'max_tests', 'user_settings', 'custom_exercises']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I for select using (can_manage(user_id))', t || '_select', t);
    execute format('create policy %I on %I for update using (user_id = app_uid()) with check (user_id = app_uid())', t || '_update', t);
  end loop;
end $$;

create policy program_progress_insert on program_progress for insert
  with check (user_id = app_uid() and exists (select 1 from programs p where p.id = program_id));
create policy workout_sessions_insert on workout_sessions for insert
  with check (user_id = app_uid() and (program_id is null or exists (select 1 from programs p where p.id = program_id)));
create policy set_logs_insert on set_logs for insert
  with check (user_id = app_uid() and exists (select 1 from workout_sessions s where s.id = session_id and s.user_id = app_uid()));
create policy training_maxes_insert on training_maxes for insert with check (user_id = app_uid());
create policy user_exercise_videos_insert on user_exercise_videos for insert with check (user_id = app_uid());
create policy max_tests_insert on max_tests for insert with check (user_id = app_uid());
create policy user_settings_insert on user_settings for insert with check (user_id = app_uid());
create policy custom_exercises_insert on custom_exercises for insert with check (user_id = app_uid());

-- ---------------------------------------------------------------- auth functions (SECURITY DEFINER)
-- refresh_tokens and invites are only touched here. Token values are never stored, only SHA-256 hashes.

create function auth_login_lookup(p_email citext)
returns table (id uuid, password_hash text, disabled boolean)
language sql stable security definer set search_path = public as $$
  select u.id, u.password_hash, u.disabled_at is not null from users u where u.email = p_email $$;

create function auth_create_refresh(p_user uuid, p_hash text, p_expires timestamptz) returns void
language sql security definer set search_path = public as $$
  insert into refresh_tokens (user_id, token_hash, expires_at) values (p_user, p_hash, p_expires) $$;

-- Rotates a refresh token. Reusing an already rotated token revokes every token of that user (stolen-token
-- signal). Tokens revoked by logout or a password change are simply invalid.
create function auth_rotate_refresh(p_old_hash text, p_new_hash text, p_expires timestamptz)
returns table (user_id uuid, status text)
language plpgsql security definer set search_path = public as $$
declare t refresh_tokens%rowtype;
begin
  select * into t from refresh_tokens where token_hash = p_old_hash for update;
  if not found then
    return query select null::uuid, 'invalid'; return;
  end if;
  if t.revoked_at is not null and t.rotated then
    update refresh_tokens set revoked_at = now() where refresh_tokens.user_id = t.user_id and revoked_at is null;
    return query select t.user_id, 'reused'; return;
  end if;
  if t.revoked_at is not null then
    return query select t.user_id, 'invalid'; return;
  end if;
  if t.expires_at < now() then
    return query select t.user_id, 'expired'; return;
  end if;
  if exists (select 1 from users where id = t.user_id and disabled_at is not null) then
    return query select t.user_id, 'disabled'; return;
  end if;
  update refresh_tokens set revoked_at = now(), rotated = true where id = t.id;
  insert into refresh_tokens (user_id, token_hash, expires_at) values (t.user_id, p_new_hash, p_expires);
  return query select t.user_id, 'ok';
end $$;

create function auth_revoke_refresh(p_hash text) returns void
language sql security definer set search_path = public as $$
  update refresh_tokens set revoked_at = now() where token_hash = p_hash and revoked_at is null $$;

-- Logs a user out everywhere, e.g. when an admin disables the account
create function auth_revoke_all_refresh(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Kun en admin kan logge en bruger ud' using errcode = '42501';
  end if;
  update refresh_tokens set revoked_at = now() where user_id = p_user and revoked_at is null;
end $$;

-- New invite/reset link. Only an admin, or the trainer of the user, may create one for someone else.
create function auth_create_invite(p_user uuid, p_hash text, p_expires timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user = app_uid() or app_user_role() not in ('admin', 'trainer') or not can_manage(p_user) then
    raise exception 'Du må ikke lave et invitationslink til denne bruger' using errcode = '42501';
  end if;
  update invites set used_at = now() where user_id = p_user and used_at is null;   -- old links stop working
  insert into invites (token_hash, user_id, expires_at) values (p_hash, p_user, p_expires);
end $$;

-- Sets the password from a valid invite and logs out all existing sessions. Returns the user id or null.
create function auth_accept_invite(p_hash text, p_password_hash text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  update invites set used_at = now()
   where token_hash = p_hash and used_at is null and expires_at > now()
   returning user_id into v_user;
  if v_user is null then return null; end if;
  update users set password_hash = p_password_hash where id = v_user and disabled_at is null;
  if not found then return null; end if;
  update refresh_tokens set revoked_at = now() where user_id = v_user and revoked_at is null;
  return v_user;
end $$;

create function auth_get_own_password_hash() returns text
language sql stable security definer set search_path = public as $$
  select password_hash from users where id = app_uid() $$;

-- Changes the caller's password and revokes their other sessions (keep_hash = the session in use)
create function auth_set_own_password(p_password_hash text, p_keep_refresh_hash text) returns void
language sql security definer set search_path = public as $$
  update users set password_hash = p_password_hash where id = app_uid();
  update refresh_tokens set revoked_at = now()
   where user_id = app_uid() and revoked_at is null and token_hash is distinct from p_keep_refresh_hash $$;

-- Bootstrap of the first admin (server/api/src/scripts/create-admin.ts). Owner only, not the API.
create function admin_bootstrap(p_email citext, p_name text, p_invite_hash text, p_expires timestamptz) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into users (email, display_name, role) values (p_email, p_name, 'admin') returning id into v_id;
  insert into invites (token_hash, user_id, expires_at) values (p_invite_hash, v_id, p_expires);
  return v_id;
end $$;

-- ---------------------------------------------------------------- ownership and privileges

-- The new owner of a function needs CREATE on its schema
grant usage, create on schema public to powerkrop_definer;

do $$
declare f text;
begin
  foreach f in array array['app_user_role()', 'is_admin()', 'can_manage(uuid)', 'is_trainer(uuid)',
    'auth_login_lookup(citext)', 'auth_create_refresh(uuid,text,timestamptz)',
    'auth_rotate_refresh(text,text,timestamptz)', 'auth_revoke_refresh(text)', 'auth_revoke_all_refresh(uuid)',
    'auth_create_invite(uuid,text,timestamptz)', 'auth_accept_invite(text,text)',
    'auth_get_own_password_hash()', 'auth_set_own_password(text,text)',
    'admin_bootstrap(citext,text,text,timestamptz)']
  loop
    execute format('alter function %s owner to powerkrop_definer', f);
    execute format('revoke all on function %s from public', f);
  end loop;
end $$;

grant usage on schema public to powerkrop_app;
grant select, insert, update, delete on all tables in schema public to powerkrop_definer;

grant execute on function app_uid(), app_user_role(), is_admin(), can_manage(uuid), is_trainer(uuid),
  auth_login_lookup(citext), auth_create_refresh(uuid,text,timestamptz), auth_rotate_refresh(text,text,timestamptz),
  auth_revoke_refresh(text), auth_revoke_all_refresh(uuid), auth_create_invite(uuid,text,timestamptz), auth_accept_invite(text,text),
  auth_get_own_password_hash(), auth_set_own_password(text,text)
  to powerkrop_app;
grant execute on function admin_bootstrap(citext,text,text,timestamptz) to powerkrop_owner;

-- The API can never read password_hash (column privileges) and never touches tokens/invites directly
grant select (id, email, display_name, role, trainer_id, created_by, disabled_at, created_at, updated_at) on users to powerkrop_app;
-- id is generated by the API, so the new row can be read back in a separate statement (an INSERT … RETURNING
-- would evaluate can_manage() before the trainer's new user is visible to it)
grant insert (id, email, display_name, role, trainer_id) on users to powerkrop_app;
grant update (email, display_name, role, trainer_id, disabled_at) on users to powerkrop_app;
grant delete on users to powerkrop_app;
grant select, insert, update on programs, program_progress, workout_sessions, set_logs, training_maxes,
  user_exercise_videos, max_tests, user_settings, custom_exercises to powerkrop_app;
