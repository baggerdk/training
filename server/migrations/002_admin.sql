-- Admin website: the athlete profile a trainer sets up programs from, and the trainers' own program templates.

-- Level and progression step per tree (keys = the app's TREES, values = step index), goals and notes.
-- Written by the user's trainer or an admin (or the user themselves); read by everyone who manages the user.
create table athlete_profiles (
  user_id     uuid primary key references users(id) on delete cascade,
  level       int not null default 0 check (level between 0 and 2),        -- 0 begynder · 1 øvet · 2 avanceret
  tree_levels jsonb not null default '{}' check (jsonb_typeof(tree_levels) = 'object'),
  goals       text check (char_length(goals) <= 2000),
  notes       text check (char_length(notes) <= 4000),
  updated_by  uuid references users(id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- A trainer's own template: a whole program (the app's program format in `data`) to reuse for several users.
-- `shared` makes it visible to every trainer and admin.
create table program_templates (
  id            uuid primary key default gen_random_uuid(),
  created_by    uuid references users(id) on delete set null,
  name          text not null check (char_length(name) between 1 and 200),
  description   text check (char_length(description) <= 4000),
  level         int check (level between 0 and 2),
  days_per_week int check (days_per_week between 1 and 7),
  tags          text[] not null default '{}' check (cardinality(tags) <= 20),
  data          jsonb not null check (jsonb_typeof(data) = 'object'),
  shared        boolean not null default false,
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index program_templates_author_idx on program_templates (created_by) where deleted_at is null;

create trigger athlete_profiles_updated_at before insert or update on athlete_profiles for each row execute function set_updated_at();
create trigger program_templates_updated_at before insert or update on program_templates for each row execute function set_updated_at();

-- Who changed a profile, and who owns a template, is always the caller (API role only, like the other guards)
create function athlete_profiles_guard() returns trigger language plpgsql as $$
begin
  if current_user = 'powerkrop_app' then new.updated_by := app_uid(); end if;
  return new;
end $$;
create trigger athlete_profiles_guard before insert or update on athlete_profiles for each row execute function athlete_profiles_guard();

create function program_templates_guard() returns trigger language plpgsql as $$
begin
  if current_user <> 'powerkrop_app' then return new; end if;
  if tg_op = 'INSERT' then
    new.created_by := app_uid();
  elsif new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
    raise exception 'created_by kan ikke ændres' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger program_templates_guard before insert or update on program_templates for each row execute function program_templates_guard();

alter table athlete_profiles enable row level security;
alter table athlete_profiles force row level security;
create policy athlete_profiles_select on athlete_profiles for select using (can_manage(user_id));
create policy athlete_profiles_insert on athlete_profiles for insert with check (can_manage(user_id));
create policy athlete_profiles_update on athlete_profiles for update using (can_manage(user_id)) with check (can_manage(user_id));

alter table program_templates enable row level security;
alter table program_templates force row level security;
-- Templates are a trainer tool: only admins and trainers see or write them
create policy program_templates_select on program_templates for select
  using (app_user_role() in ('admin', 'trainer') and (created_by = app_uid() or shared or is_admin()));
create policy program_templates_insert on program_templates for insert
  with check (app_user_role() in ('admin', 'trainer'));
create policy program_templates_update on program_templates for update
  using (app_user_role() in ('admin', 'trainer') and (created_by = app_uid() or is_admin()))
  with check (app_user_role() in ('admin', 'trainer'));

grant select, insert, update on athlete_profiles, program_templates to powerkrop_app;
grant select, insert, update, delete on athlete_profiles, program_templates to powerkrop_definer;
