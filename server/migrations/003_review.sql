-- Fixes from the code review: NULL-safe permission checks, reference checks on UPDATE as well as INSERT,
-- a guard against removing the last admin, and RLS policies that evaluate the permission lookup once per
-- statement instead of once per row.

-- ---------------------------------------------------------------- NULL-safe checks
-- For a disabled caller app_user_role() is NULL, and NULL inside "not (…)" lets an IF fall through.
create or replace function can_manage(target uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(target = app_uid()
      or is_admin()
      or (app_user_role() = 'trainer'
          and exists (select 1 from users u where u.id = target and u.trainer_id = app_uid())), false) $$;

create or replace function auth_create_invite(p_user uuid, p_hash text, p_expires timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user = app_uid() or coalesce(app_user_role() not in ('admin', 'trainer'), true)
     or not can_manage(p_user) then
    raise exception 'Du må ikke lave et invitationslink til denne bruger' using errcode = '42501';
  end if;
  update invites set used_at = now() where user_id = p_user and used_at is null;   -- old links stop working
  insert into invites (token_hash, user_id, expires_at) values (p_hash, p_user, p_expires);
end $$;

-- ---------------------------------------------------------------- managed users as a set
-- The ids the caller may see/manage (= every id for which can_manage(id) is true). Used in policies as
-- "x in (select managed_user_ids())", which runs once per statement instead of once per row.
create function managed_user_ids() returns setof uuid language sql stable security definer set search_path = public as $$
  select app_uid() where app_uid() is not null
  union
  select id from users where is_admin()
  union
  select id from users where trainer_id = app_uid() and app_user_role() = 'trainer' $$;

alter function managed_user_ids() owner to powerkrop_definer;
revoke all on function managed_user_ids() from public;
grant execute on function managed_user_ids() to powerkrop_app;

-- ---------------------------------------------------------------- policies
alter policy users_select on users using (id in (select managed_user_ids()));
alter policy users_update on users using (id in (select managed_user_ids())) with check (id in (select managed_user_ids()));
alter policy users_delete on users using ((select is_admin()) or id = (select app_uid()));

alter policy programs_select on programs using (owner_id in (select managed_user_ids()));
alter policy programs_insert on programs with check (owner_id in (select managed_user_ids()));
alter policy programs_update on programs
  using (owner_id in (select managed_user_ids())
         and (owner_id <> (select app_uid()) or created_by = (select app_uid()) or created_by is null))
  with check (owner_id in (select managed_user_ids()));

do $$
declare t text;
begin
  foreach t in array array['program_progress', 'workout_sessions', 'set_logs', 'training_maxes',
                           'user_exercise_videos', 'max_tests', 'user_settings', 'custom_exercises']
  loop
    execute format('alter policy %I on %I using (user_id in (select managed_user_ids()))', t || '_select', t);
    execute format('alter policy %I on %I using (user_id = (select app_uid())) with check (user_id = (select app_uid()))',
                   t || '_update', t);
  end loop;
end $$;

alter policy training_maxes_insert on training_maxes with check (user_id = (select app_uid()));
alter policy user_exercise_videos_insert on user_exercise_videos with check (user_id = (select app_uid()));
alter policy max_tests_insert on max_tests with check (user_id = (select app_uid()));
alter policy user_settings_insert on user_settings with check (user_id = (select app_uid()));
alter policy custom_exercises_insert on custom_exercises with check (user_id = (select app_uid()));

-- References must hold after an UPDATE too: a set may not be moved into someone else's session, and a session
-- or progress row may not point at a program the user cannot see
alter policy program_progress_insert on program_progress
  with check (user_id = (select app_uid()) and exists (select 1 from programs p where p.id = program_id));
alter policy program_progress_update on program_progress
  using (user_id = (select app_uid()))
  with check (user_id = (select app_uid()) and exists (select 1 from programs p where p.id = program_id));

alter policy workout_sessions_insert on workout_sessions
  with check (user_id = (select app_uid()) and (program_id is null or exists (select 1 from programs p where p.id = program_id)));
alter policy workout_sessions_update on workout_sessions
  using (user_id = (select app_uid()))
  with check (user_id = (select app_uid()) and (program_id is null or exists (select 1 from programs p where p.id = program_id)));

alter policy set_logs_insert on set_logs
  with check (user_id = (select app_uid())
              and exists (select 1 from workout_sessions s where s.id = session_id and s.user_id = (select app_uid())));
alter policy set_logs_update on set_logs
  using (user_id = (select app_uid()))
  with check (user_id = (select app_uid())
              and exists (select 1 from workout_sessions s where s.id = session_id and s.user_id = (select app_uid())));

alter policy athlete_profiles_select on athlete_profiles using (user_id in (select managed_user_ids()));
alter policy athlete_profiles_insert on athlete_profiles with check (user_id in (select managed_user_ids()));
alter policy athlete_profiles_update on athlete_profiles
  using (user_id in (select managed_user_ids())) with check (user_id in (select managed_user_ids()));

-- ---------------------------------------------------------------- the last admin
-- Without an active admin nobody can create trainers or change roles any more. Applies to the API role only;
-- the owner (scripts, restore) can always repair things.
-- Not SECURITY DEFINER: only an admin can reach other admins' rows, and an admin sees every user
create function users_last_admin_guard() returns trigger language plpgsql as $$
begin
  if current_user <> 'powerkrop_app' then
    return coalesce(new, old);
  end if;
  if old.role = 'admin' and old.disabled_at is null
     and (tg_op = 'DELETE' or new.role <> 'admin' or new.disabled_at is not null)
     and not exists (select 1 from users where role = 'admin' and disabled_at is null and id <> old.id) then
    raise exception 'Den sidste aktive admin kan ikke slettes, deaktiveres eller få en anden rolle' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

create trigger users_last_admin_guard before update or delete on users
  for each row execute function users_last_admin_guard();

-- ---------------------------------------------------------------- refresh grace period
-- If the response to a refresh is lost (the phone drops off the network mid-request), the app retries with the
-- token that was just rotated. Within 60 seconds, and only while its successor has not been used yet, that
-- counts as a retry: the successor is revoked and a new token is issued instead of logging out everywhere.
alter table refresh_tokens add column replaced_by uuid references refresh_tokens(id) on delete set null;

create or replace function auth_rotate_refresh(p_old_hash text, p_new_hash text, p_expires timestamptz)
returns table (user_id uuid, status text)
language plpgsql security definer set search_path = public as $$
declare t refresh_tokens%rowtype; v_new uuid;
begin
  select * into t from refresh_tokens where token_hash = p_old_hash for update;
  if not found then
    return query select null::uuid, 'invalid'; return;
  end if;
  if t.revoked_at is not null and t.rotated then
    if t.revoked_at > now() - interval '60 seconds' and t.replaced_by is not null
       and exists (select 1 from refresh_tokens n where n.id = t.replaced_by and n.revoked_at is null) then
      update refresh_tokens set revoked_at = now() where id = t.replaced_by;
    else
      update refresh_tokens set revoked_at = now() where refresh_tokens.user_id = t.user_id and revoked_at is null;
      return query select t.user_id, 'reused'; return;
    end if;
  elsif t.revoked_at is not null then
    return query select t.user_id, 'invalid'; return;
  end if;
  if t.expires_at < now() then
    return query select t.user_id, 'expired'; return;
  end if;
  if exists (select 1 from users where id = t.user_id and disabled_at is not null) then
    return query select t.user_id, 'disabled'; return;
  end if;
  insert into refresh_tokens (user_id, token_hash, expires_at) values (t.user_id, p_new_hash, p_expires) returning id into v_new;
  -- revoked_at is kept from the first rotation, so the grace period never extends itself
  update refresh_tokens set revoked_at = coalesce(revoked_at, now()), rotated = true, replaced_by = v_new where id = t.id;
  return query select t.user_id, 'ok';
end $$;
