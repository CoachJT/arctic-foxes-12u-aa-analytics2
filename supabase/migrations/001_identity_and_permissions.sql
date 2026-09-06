-- Arctic Foxes web identity and capability foundation.
-- This migration creates no users, teams, secrets, or production data.

create extension if not exists "pgcrypto";

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.roles (
  id text primary key,
  label text not null,
  description text not null
);

create table public.role_permissions (
  role_id text not null references public.roles(id) on delete cascade,
  capability text not null,
  primary key (role_id, capability)
);

create table public.team_memberships (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id text not null references public.roles(id),
  status text not null default 'invited' check (status in ('invited', 'active', 'suspended')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index team_memberships_user_idx on public.team_memberships(user_id);
create index team_memberships_team_status_idx on public.team_memberships(team_id, status);

insert into public.roles (id, label, description) values
  ('owner', 'Owner / Head Coach', 'Full team and administrative access.'),
  ('assistant_goalie', 'Assistant Coach / Goalie Coach', 'Team coaching access with goalie analytics and evaluation access.'),
  ('assistant', 'Assistant Coach', 'Team coaching access without administrative or goalie-specific access.')
on conflict (id) do update set
  label = excluded.label,
  description = excluded.description;

insert into public.role_permissions (role_id, capability)
select 'owner', capability
from unnest(array[
  'dashboard.view', 'schedule.view', 'schedule.edit',
  'stats.view', 'stats.edit', 'stats.editOfficial',
  'players.view', 'players.evaluate',
  'games.view', 'games.edit', 'games.delete',
  'scouting.view', 'scouting.edit', 'scouting.private',
  'reports.view', 'reports.edit',
  'goalieAnalytics.view', 'goalieAnalytics.edit',
  'admin.users', 'admin.permissions',
  'backup.restore', 'release.manage', 'seasons.delete'
]::text[]) as capabilities(capability)
on conflict do nothing;

insert into public.role_permissions (role_id, capability)
select 'assistant_goalie', capability
from unnest(array[
  'dashboard.view', 'schedule.view', 'schedule.edit',
  'stats.view', 'stats.edit',
  'players.view', 'players.evaluate',
  'games.view', 'games.edit',
  'scouting.view', 'scouting.edit', 'scouting.private',
  'reports.view', 'reports.edit',
  'goalieAnalytics.view', 'goalieAnalytics.edit'
]::text[]) as capabilities(capability)
on conflict do nothing;

insert into public.role_permissions (role_id, capability)
select 'assistant', capability
from unnest(array[
  'dashboard.view', 'schedule.view', 'schedule.edit',
  'stats.view', 'stats.edit',
  'players.view', 'players.evaluate',
  'games.view',
  'scouting.view', 'scouting.edit',
  'reports.view', 'reports.edit'
]::text[]) as capabilities(capability)
on conflict do nothing;

create or replace function public.is_team_member(target_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.team_memberships membership
    where membership.team_id = target_team_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
  );
$$;

create or replace function public.has_team_capability(target_team_id uuid, requested_capability text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.team_memberships membership
    join public.role_permissions permission on permission.role_id = membership.role_id
    where membership.team_id = target_team_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and permission.capability = requested_capability
  );
$$;

create or replace function public.is_team_owner(target_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_team_capability(target_team_id, 'admin.permissions');
$$;

create or replace function public.prevent_final_owner_loss()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(old.team_id::text, 0));
  if old.role_id = 'owner'
     and (new.role_id <> 'owner' or new.status <> 'active') then
    if not exists (
      select 1
      from public.team_memberships membership
      where membership.team_id = old.team_id
        and membership.user_id <> old.user_id
        and membership.role_id = 'owner'
        and membership.status = 'active'
    ) then
      raise exception 'A team must retain at least one active owner.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.prevent_final_owner_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(old.team_id::text, 0));
  if old.role_id = 'owner'
     and old.status = 'active'
     and not exists (
       select 1
       from public.team_memberships membership
       where membership.team_id = old.team_id
         and membership.user_id <> old.user_id
         and membership.role_id = 'owner'
         and membership.status = 'active'
     ) then
    raise exception 'A team must retain at least one active owner.';
  end if;
  return old;
end;
$$;

create trigger team_memberships_prevent_final_owner_update
before update of role_id, status on public.team_memberships
for each row execute function public.prevent_final_owner_loss();

create trigger team_memberships_prevent_final_owner_delete
before delete on public.team_memberships
for each row execute function public.prevent_final_owner_delete();

alter table public.teams enable row level security;
alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.team_memberships enable row level security;

create policy teams_select_for_members
on public.teams for select
to authenticated
using (public.is_team_member(id));

create policy teams_update_for_owners
on public.teams for update
to authenticated
using (public.is_team_owner(id))
with check (public.is_team_owner(id));

create policy teams_delete_for_owners
on public.teams for delete
to authenticated
using (public.is_team_owner(id));

create policy profiles_select_for_self_or_teammates
on public.profiles for select
to authenticated
using (
  id = (select auth.uid())
  or exists (
    select 1
    from public.team_memberships viewer_membership
    join public.team_memberships profile_membership
      on profile_membership.team_id = viewer_membership.team_id
     and profile_membership.user_id = profiles.id
     and profile_membership.status = 'active'
    where viewer_membership.user_id = (select auth.uid())
      and viewer_membership.status = 'active'
  )
);

create policy profiles_insert_self
on public.profiles for insert
to authenticated
with check (id = (select auth.uid()));

create policy profiles_update_self
on public.profiles for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy roles_select_for_authenticated
on public.roles for select
to authenticated
using (true);

create policy role_permissions_select_for_authenticated
on public.role_permissions for select
to authenticated
using (true);

create policy memberships_select_for_teammates
on public.team_memberships for select
to authenticated
using (public.is_team_member(team_id));

create policy memberships_insert_for_owners
on public.team_memberships for insert
to authenticated
with check (
  public.is_team_owner(team_id)
  and invited_by = (select auth.uid())
);

create policy memberships_update_for_owners
on public.team_memberships for update
to authenticated
using (public.is_team_owner(team_id))
with check (public.is_team_owner(team_id));

create policy memberships_delete_for_owners
on public.team_memberships for delete
to authenticated
using (public.is_team_owner(team_id));

revoke all on public.teams, public.profiles, public.roles,
  public.role_permissions, public.team_memberships from anon;
grant select on public.roles, public.role_permissions to authenticated;
grant select, insert, update, delete on public.teams to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select on public.role_permissions to authenticated;
grant select, insert, update, delete on public.team_memberships to authenticated;

revoke all on function public.is_team_member(uuid) from public;
revoke all on function public.has_team_capability(uuid, text) from public;
revoke all on function public.is_team_owner(uuid) from public;
grant execute on function public.is_team_member(uuid) to authenticated;
grant execute on function public.has_team_capability(uuid, text) to authenticated;
grant execute on function public.is_team_owner(uuid) to authenticated;
