-- Multi-team structural foundation.
-- Existing team_id values remain the primary tenant boundary.
-- This migration is additive and preserves existing team, membership, role,
-- capability, source, and synced-data identifiers.

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.organization_memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id text not null check (role_id in ('org_owner', 'org_admin', 'org_member')),
  status text not null default 'invited' check (status in ('invited', 'active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_memberships_user_idx
  on public.organization_memberships(user_id, status);
create index organization_memberships_org_status_idx
  on public.organization_memberships(organization_id, status);
alter table public.teams
  add column organization_id uuid,
  add column default_season_id uuid;
create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  season_key text not null,
  status text not null default 'planned' check (status in ('planned', 'active', 'archived')),
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, season_key),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index seasons_team_status_idx
  on public.seasons(team_id, status);
create table public.team_branding (
  team_id uuid primary key references public.teams(id) on delete cascade,
  display_name text not null,
  short_name text not null,
  logo_url text,
  primary_color text not null,
  secondary_color text not null,
  accent_color text not null,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.organizations (name, slug)
values ('Arctic Foxes', 'arctic-foxes')
on conflict (slug) do update set
  name = excluded.name,
  updated_at = now();
update public.teams
set organization_id = organization.id
from public.organizations organization
where organization.slug = 'arctic-foxes'
  and public.teams.slug = 'arctic-foxes-12u-aa'
  and public.teams.organization_id is null;
alter table public.teams
  alter column organization_id set not null;
alter table public.teams
  add constraint teams_organization_fk
  foreign key (organization_id) references public.organizations(id) on delete cascade;
insert into public.organization_memberships (organization_id, user_id, role_id, status)
select
  team.organization_id,
  membership.user_id,
  case when membership.role_id = 'owner' then 'org_owner' else 'org_member' end,
  'active'
from public.team_memberships membership
join public.teams team on team.id = membership.team_id
join public.organizations organization on organization.id = team.organization_id
where team.slug = 'arctic-foxes-12u-aa'
  and membership.status = 'active'
on conflict (organization_id, user_id) do update set
  role_id = excluded.role_id,
  status = 'active',
  updated_at = now();
insert into public.seasons (team_id, name, season_key, status, starts_on, ends_on)
select
  team.id,
  '2026–2027 Season',
  '2026-2027',
  'active',
  date '2026-09-01',
  date '2027-04-30'
from public.teams team
where team.slug = 'arctic-foxes-12u-aa'
on conflict (team_id, season_key) do update set
  name = excluded.name,
  status = excluded.status,
  starts_on = excluded.starts_on,
  ends_on = excluded.ends_on,
  updated_at = now();
update public.teams team
set default_season_id = season.id
from public.seasons season
where season.team_id = team.id
  and team.slug = 'arctic-foxes-12u-aa'
  and season.season_key = '2026-2027';
alter table public.teams
  add constraint teams_default_season_fk
  foreign key (default_season_id) references public.seasons(id) on delete set null;
insert into public.team_branding (
  team_id,
  display_name,
  short_name,
  primary_color,
  secondary_color,
  accent_color,
  settings
)
select
  team.id,
  'Arctic Foxes 12U AA',
  'AF 12U AA',
  '#d71920',
  '#0d0e10',
  '#f2f3f4',
  '{"theme":"arctic-foxes","font":"default"}'::jsonb
from public.teams team
where team.slug = 'arctic-foxes-12u-aa'
on conflict (team_id) do update set
  display_name = excluded.display_name,
  short_name = excluded.short_name,
  primary_color = excluded.primary_color,
  secondary_color = excluded.secondary_color,
  accent_color = excluded.accent_color,
  settings = excluded.settings,
  updated_at = now();
create index teams_organization_idx
  on public.teams(organization_id);
create or replace function public.is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
  );
$$;
create or replace function public.has_org_role(target_organization_id uuid, requested_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and membership.role_id = requested_role
  );
$$;
create or replace function public.can_access_team_season(target_team_id uuid, target_season_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.seasons season
    where season.id = target_season_id
      and season.team_id = target_team_id
      and public.is_team_member(target_team_id)
  );
$$;
alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.seasons enable row level security;
alter table public.team_branding enable row level security;
create policy organizations_select_for_members
on public.organizations for select
to authenticated
using (public.is_org_member(id));
create policy organization_memberships_select_for_org_members
on public.organization_memberships for select
to authenticated
using (public.is_org_member(organization_id));
create policy organization_memberships_insert_for_org_owners
on public.organization_memberships for insert
to authenticated
with check (public.has_org_role(organization_id, 'org_owner'));
create policy organization_memberships_update_for_org_owners
on public.organization_memberships for update
to authenticated
using (public.has_org_role(organization_id, 'org_owner'))
with check (public.has_org_role(organization_id, 'org_owner'));
create policy organization_memberships_delete_for_org_owners
on public.organization_memberships for delete
to authenticated
using (public.has_org_role(organization_id, 'org_owner'));
create policy seasons_select_for_team_members
on public.seasons for select
to authenticated
using (public.has_team_capability(team_id, 'dashboard.view'));
create policy seasons_insert_for_team_owners
on public.seasons for insert
to authenticated
with check (public.is_team_owner(team_id));
create policy seasons_update_for_team_owners
on public.seasons for update
to authenticated
using (public.is_team_owner(team_id))
with check (public.is_team_owner(team_id));
create policy team_branding_select_for_team_members
on public.team_branding for select
to authenticated
using (public.is_team_member(team_id));
create policy team_branding_insert_for_team_owners
on public.team_branding for insert
to authenticated
with check (public.is_team_owner(team_id));
create policy team_branding_update_for_team_owners
on public.team_branding for update
to authenticated
using (public.is_team_owner(team_id))
with check (public.is_team_owner(team_id));
revoke all on public.organizations,
  public.organization_memberships,
  public.seasons,
  public.team_branding
from anon;
grant select on public.organizations to authenticated;
grant select, insert, update, delete on public.organization_memberships to authenticated;
grant select, insert, update on public.seasons to authenticated;
grant select, insert, update on public.team_branding to authenticated;
revoke all on function public.is_org_member(uuid) from public;
revoke all on function public.has_org_role(uuid, text) from public;
revoke all on function public.can_access_team_season(uuid, uuid) from public;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, text) to authenticated;
grant execute on function public.can_access_team_season(uuid, uuid) to authenticated;
