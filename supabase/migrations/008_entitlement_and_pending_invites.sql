-- PuckNexus 2.0 Stage B entitlement and pending-invite foundation.
-- Additive only: this migration does not alter existing teams, seasons,
-- memberships, roles, or synchronized production data.

create table public.plan_catalog (
  plan_id text primary key check (plan_id = upper(plan_id)),
  label text not null check (length(trim(label)) > 0),
  description text not null default '',
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.feature_catalog (
  feature_key text primary key check (feature_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'),
  label text not null check (length(trim(label)) > 0),
  description text not null default '',
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.plan_feature_entitlements (
  plan_id text not null references public.plan_catalog(plan_id) on delete cascade,
  feature_key text not null references public.feature_catalog(feature_key) on delete cascade,
  enabled boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (plan_id, feature_key)
);

create table public.organization_entitlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id text not null references public.plan_catalog(plan_id),
  status text not null default 'active' check (status in ('active', 'suspended', 'expired')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create table public.team_membership_entitlements (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null references public.plan_catalog(plan_id),
  status text not null default 'active' check (status in ('active', 'suspended', 'expired')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create table public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  season_id uuid references public.seasons(id) on delete cascade,
  role_id text not null references public.roles(id),
  plan_id text not null references public.plan_catalog(plan_id),
  token_hash text not null unique check (length(token_hash) >= 32),
  invited_by uuid not null references auth.users(id) on delete restrict,
  accepted_by uuid references auth.users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'revoked')),
  expires_at timestamptz,
  accepted_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (team_id is not null or season_id is null),
  check (
    status <> 'accepted'
    or (accepted_by is not null and accepted_at is not null)
  ),
  check (
    status = 'accepted'
    or (accepted_by is null and accepted_at is null)
  )
);

insert into public.plan_catalog (plan_id, label, description)
values
  ('FOUNDING', 'Founding', 'Full access to registered and future features unless explicitly disabled.'),
  ('CORE', 'Core', 'Core PuckNexus workspace features.'),
  ('COACH', 'Coach', 'Coaching and development workspace features.'),
  ('ELITE', 'Elite', 'Advanced hockey operations and analysis features.'),
  ('ORGANIZATION', 'Organization', 'Organization-wide workspace entitlement.')
on conflict (plan_id) do nothing;

insert into public.feature_catalog (feature_key, label, description)
values
  ('dashboard', 'Dashboard', 'Workspace dashboard access.'),
  ('schedule', 'Schedule', 'Schedule and calendar access.'),
  ('stats', 'Stats', 'Team and player statistics access.'),
  ('players', 'Players', 'Roster and player development access.'),
  ('games', 'Games', 'Game center and game management access.'),
  ('scouting', 'Scouting', 'Scouting and evaluation access.'),
  ('reports', 'Reports', 'Coach report access.'),
  ('goalie_analytics', 'Goalie analytics', 'Goalie analytics access.'),
  ('admin', 'Administration', 'Workspace administration access.'),
  ('backup_restore', 'Backup and restore', 'Backup and restore access.'),
  ('release_management', 'Release management', 'Release management access.'),
  ('seasons', 'Seasons', 'Season administration access.'),
  ('film', 'Film', 'Film workspace entitlement.'),
  ('clips', 'Clips', 'Clip workflow entitlement.'),
  ('playlists', 'Playlists', 'Playlist workflow entitlement.'),
  ('chat', 'Chat', 'Workspace chat entitlement.'),
  ('notifications', 'Notifications', 'Workspace notification entitlement.'),
  ('ai_analytics', 'AI analytics', 'Future AI analytics entitlement.')
on conflict (feature_key) do nothing;

-- Normal plans use explicit feature rows. FOUNDING intentionally has no
-- default rows: the resolver treats every active catalog feature as enabled
-- unless an explicit FOUNDING row disables it.
insert into public.plan_feature_entitlements (plan_id, feature_key, enabled)
select 'CORE', feature_key, true
from public.feature_catalog
where feature_key in ('dashboard', 'schedule', 'stats', 'players', 'games')
on conflict (plan_id, feature_key) do nothing;

insert into public.plan_feature_entitlements (plan_id, feature_key, enabled)
select 'COACH', feature_key, true
from public.feature_catalog
where feature_key in (
  'dashboard', 'schedule', 'stats', 'players', 'games',
  'scouting', 'reports', 'goalie_analytics'
)
on conflict (plan_id, feature_key) do nothing;

insert into public.plan_feature_entitlements (plan_id, feature_key, enabled)
select 'ELITE', feature_key, true
from public.feature_catalog
where feature_key in (
  'dashboard', 'schedule', 'stats', 'players', 'games',
  'scouting', 'reports', 'goalie_analytics', 'film', 'clips',
  'playlists', 'chat', 'notifications', 'ai_analytics'
)
on conflict (plan_id, feature_key) do nothing;

insert into public.plan_feature_entitlements (plan_id, feature_key, enabled)
select 'ORGANIZATION', feature_key, true
from public.feature_catalog
on conflict (plan_id, feature_key) do nothing;

create index organization_entitlements_org_status_idx
  on public.organization_entitlements(organization_id, status, starts_at, ends_at);

create index organization_entitlements_plan_idx
  on public.organization_entitlements(plan_id);

create index team_membership_entitlements_team_user_status_idx
  on public.team_membership_entitlements(team_id, user_id, status, starts_at, ends_at);

create index team_membership_entitlements_user_status_idx
  on public.team_membership_entitlements(user_id, status, starts_at, ends_at);

create index team_membership_entitlements_plan_idx
  on public.team_membership_entitlements(plan_id);

create index workspace_invites_org_status_idx
  on public.workspace_invites(organization_id, status);

create index workspace_invites_team_status_idx
  on public.workspace_invites(team_id, status);

create index workspace_invites_invited_by_idx
  on public.workspace_invites(invited_by);

create index workspace_invites_plan_idx
  on public.workspace_invites(plan_id);

create index workspace_invites_expiry_idx
  on public.workspace_invites(expires_at, status);

create index workspace_invites_token_hash_idx
  on public.workspace_invites(token_hash);

create or replace function public.validate_workspace_invite_target()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_team_organization_id uuid;
  target_season_team_id uuid;
begin
  if new.team_id is not null then
    select team.organization_id
    into target_team_organization_id
    from public.teams team
    where team.id = new.team_id;

    if target_team_organization_id is distinct from new.organization_id then
      raise exception 'Invite team must belong to the invited organization.';
    end if;
  end if;

  if new.season_id is not null then
    select season.team_id
    into target_season_team_id
    from public.seasons season
    where season.id = new.season_id;

    if new.team_id is null
       or target_season_team_id is distinct from new.team_id then
      raise exception 'Invite season must belong to the invited team.';
    end if;
  end if;

  return new;
end;
$$;

create trigger workspace_invites_validate_target
before insert or update of organization_id, team_id, season_id
on public.workspace_invites
for each row execute function public.validate_workspace_invite_target();

create or replace function public.resolve_workspace_plan(target_team_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select entitlement.plan_id
      from public.team_membership_entitlements entitlement
      where entitlement.team_id = target_team_id
        and entitlement.user_id = (select auth.uid())
        and entitlement.status = 'active'
        and entitlement.starts_at <= now()
        and (entitlement.ends_at is null or entitlement.ends_at > now())
      order by entitlement.starts_at desc, entitlement.created_at desc
      limit 1
    ),
    (
      select entitlement.plan_id
      from public.organization_entitlements entitlement
      join public.teams team on team.organization_id = entitlement.organization_id
      where team.id = target_team_id
        and entitlement.status = 'active'
        and entitlement.starts_at <= now()
        and (entitlement.ends_at is null or entitlement.ends_at > now())
      order by entitlement.starts_at desc, entitlement.created_at desc
      limit 1
    )
  )
  where exists (
    select 1
    from public.team_memberships membership
    where membership.team_id = target_team_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
  );
$$;

create or replace function public.plan_feature_enabled(
  target_plan_id text,
  target_feature_key text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when target_plan_id is null or target_feature_key is null then false
    when not exists (
      select 1
      from public.plan_catalog plan
      where plan.plan_id = target_plan_id
        and plan.status = 'active'
    ) then false
    when exists (
      select 1
      from public.plan_feature_entitlements entitlement
      where entitlement.plan_id = target_plan_id
        and entitlement.feature_key = target_feature_key
    ) then (
      select entitlement.enabled
      from public.plan_feature_entitlements entitlement
      where entitlement.plan_id = target_plan_id
        and entitlement.feature_key = target_feature_key
    )
    when target_plan_id = 'FOUNDING' then exists (
      select 1
      from public.feature_catalog feature
      where feature.feature_key = target_feature_key
        and feature.status = 'active'
    )
    else false
  end;
$$;

create or replace function public.has_workspace_feature_access(
  target_team_id uuid,
  requested_capability text,
  requested_feature_key text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.has_team_capability(target_team_id, requested_capability)
    and public.plan_feature_enabled(
      public.resolve_workspace_plan(target_team_id),
      requested_feature_key
    );
$$;

alter table public.plan_catalog enable row level security;
alter table public.feature_catalog enable row level security;
alter table public.plan_feature_entitlements enable row level security;
alter table public.organization_entitlements enable row level security;
alter table public.team_membership_entitlements enable row level security;
alter table public.workspace_invites enable row level security;

create policy plan_catalog_select_for_authenticated
on public.plan_catalog for select
to authenticated
using (status = 'active');

create policy feature_catalog_select_for_authenticated
on public.feature_catalog for select
to authenticated
using (status = 'active');

create policy plan_feature_entitlements_select_for_authenticated
on public.plan_feature_entitlements for select
to authenticated
using (
  exists (
    select 1
    from public.plan_catalog plan
    where plan.plan_id = plan_feature_entitlements.plan_id
      and plan.status = 'active'
  )
);

create policy organization_entitlements_select_for_org_members
on public.organization_entitlements for select
to authenticated
using (public.is_org_member(organization_id));

create policy organization_entitlements_insert_for_org_admins
on public.organization_entitlements for insert
to authenticated
with check (
  public.has_org_role(organization_id, 'org_owner')
  or public.has_org_role(organization_id, 'org_admin')
);

create policy organization_entitlements_update_for_org_admins
on public.organization_entitlements for update
to authenticated
using (
  public.has_org_role(organization_id, 'org_owner')
  or public.has_org_role(organization_id, 'org_admin')
)
with check (
  public.has_org_role(organization_id, 'org_owner')
  or public.has_org_role(organization_id, 'org_admin')
);

create policy organization_entitlements_delete_for_org_admins
on public.organization_entitlements for delete
to authenticated
using (
  public.has_org_role(organization_id, 'org_owner')
  or public.has_org_role(organization_id, 'org_admin')
);

create policy team_membership_entitlements_select_for_team_members
on public.team_membership_entitlements for select
to authenticated
using (public.is_team_member(team_id));

create policy team_membership_entitlements_insert_for_team_owners
on public.team_membership_entitlements for insert
to authenticated
with check (public.is_team_owner(team_id));

create policy team_membership_entitlements_update_for_team_owners
on public.team_membership_entitlements for update
to authenticated
using (public.is_team_owner(team_id))
with check (public.is_team_owner(team_id));

create policy team_membership_entitlements_delete_for_team_owners
on public.team_membership_entitlements for delete
to authenticated
using (public.is_team_owner(team_id));

create policy workspace_invites_select_for_authorized_admins
on public.workspace_invites for select
to authenticated
using (
  (
    team_id is not null
    and public.has_team_capability(team_id, 'admin.users')
  )
  or (
    team_id is null
    and (
      public.has_org_role(organization_id, 'org_owner')
      or public.has_org_role(organization_id, 'org_admin')
    )
  )
);

create policy workspace_invites_insert_for_authorized_admins
on public.workspace_invites for insert
to authenticated
with check (
  invited_by = (select auth.uid())
  and (
    (
      team_id is not null
      and public.has_team_capability(team_id, 'admin.users')
    )
    or (
      team_id is null
      and (
        public.has_org_role(organization_id, 'org_owner')
        or public.has_org_role(organization_id, 'org_admin')
      )
    )
  )
);

revoke all on public.plan_catalog,
  public.feature_catalog,
  public.plan_feature_entitlements,
  public.organization_entitlements,
  public.team_membership_entitlements,
  public.workspace_invites
from anon;

grant select on public.plan_catalog,
  public.feature_catalog,
  public.plan_feature_entitlements
to authenticated;

grant select, insert, update, delete on public.organization_entitlements to authenticated;
grant select, insert, update, delete on public.team_membership_entitlements to authenticated;
grant select, insert on public.workspace_invites to authenticated;

revoke all on function public.resolve_workspace_plan(uuid) from public, anon;
revoke all on function public.plan_feature_enabled(text, text) from public, anon;
revoke all on function public.has_workspace_feature_access(uuid, text, text) from public, anon;
revoke all on function public.validate_workspace_invite_target() from public, anon, authenticated;

grant execute on function public.resolve_workspace_plan(uuid) to authenticated;
grant execute on function public.plan_feature_enabled(text, text) to authenticated;
grant execute on function public.has_workspace_feature_access(uuid, text, text) to authenticated;

-- Runtime assertions protect the existing Stage 1A security boundary and
-- prove that this migration did not recreate or alter the current workspace.
do $$
declare
  existing_team_id uuid;
  existing_season_id uuid;
begin
  select id into existing_team_id
  from public.teams
  where slug = 'arctic-foxes-12u-aa';

  select id into existing_season_id
  from public.seasons
  where team_id = existing_team_id
    and season_key = '2026-2027';

  if existing_team_id is distinct from '2570ad07-af6b-44c0-92aa-25ea45697e5e'::uuid then
    raise exception 'Existing Arctic Foxes team UUID changed unexpectedly.';
  end if;

  if existing_season_id is distinct from 'af046a03-235e-4d97-8134-3601f1c0da10'::uuid then
    raise exception 'Existing Arctic Foxes season UUID changed unexpectedly.';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.team_memberships'::regclass
      and tgname = 'team_memberships_prevent_final_owner_update'
      and not tgisinternal
  ) or not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.team_memberships'::regclass
      and tgname = 'team_memberships_prevent_final_owner_delete'
      and not tgisinternal
  ) then
    raise exception 'Final-owner triggers are not attached.';
  end if;

  if has_table_privilege('anon', 'public.plan_catalog', 'select')
     or has_table_privilege('anon', 'public.feature_catalog', 'select')
     or has_table_privilege('anon', 'public.workspace_invites', 'select') then
    raise exception 'Anonymous access remains granted to Stage B tables.';
  end if;

  if has_function_privilege('anon', 'public.resolve_workspace_plan(uuid)', 'execute')
     or has_function_privilege('anon', 'public.plan_feature_enabled(text,text)', 'execute')
     or has_function_privilege('anon', 'public.has_workspace_feature_access(uuid,text,text)', 'execute') then
    raise exception 'Anonymous execution remains granted to Stage B helpers.';
  end if;
end;
$$;
