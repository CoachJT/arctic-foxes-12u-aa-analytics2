-- Forward-only self-service onboarding reconciliation after production ledger 019.
-- Browser clients may read only their own progress. All state changes are made
-- through narrowly scoped SECURITY DEFINER functions below.

create table public.onboarding_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  season_id uuid references public.seasons(id) on delete set null,
  current_step text not null default 'organization'
    check (current_step in ('organization', 'team', 'season', 'roster', 'staff', 'branding', 'review')),
  organization_complete boolean not null default false,
  team_complete boolean not null default false,
  season_complete boolean not null default false,
  roster_complete boolean not null default false,
  staff_complete boolean not null default false,
  branding_complete boolean not null default false,
  review_complete boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (organization_id is not null or not organization_complete)
    and (team_id is not null or not team_complete)
    and (season_id is not null or not season_complete)
  )
);

alter table public.onboarding_progress enable row level security;

create policy onboarding_progress_select_self
on public.onboarding_progress for select
to authenticated
using (user_id = (select auth.uid()));

revoke all on public.onboarding_progress from public, anon, authenticated;
grant select on public.onboarding_progress to authenticated;
grant select, insert, update, delete on public.onboarding_progress to service_role;

create index onboarding_progress_team_updated_idx
  on public.onboarding_progress(team_id, updated_at desc);

create or replace function public.prevent_final_org_owner_loss()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role_id = 'org_owner'
     and old.status = 'active'
     and (new.role_id <> 'org_owner' or new.status <> 'active') then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(old.organization_id::text));

    if not exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = old.organization_id
        and membership.user_id <> old.user_id
        and membership.role_id = 'org_owner'
        and membership.status = 'active'
    ) then
      raise exception 'An organization must retain at least one active owner.';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.prevent_final_org_owner_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role_id = 'org_owner' and old.status = 'active' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(old.organization_id::text));

    if not exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = old.organization_id
        and membership.user_id <> old.user_id
        and membership.role_id = 'org_owner'
        and membership.status = 'active'
    ) then
      raise exception 'An organization must retain at least one active owner.';
    end if;
  end if;

  return old;
end;
$$;

drop trigger if exists organization_memberships_prevent_final_org_owner_update on public.organization_memberships;
create trigger organization_memberships_prevent_final_org_owner_update
before update of role_id, status on public.organization_memberships
for each row execute function public.prevent_final_org_owner_loss();

drop trigger if exists organization_memberships_prevent_final_org_owner_delete on public.organization_memberships;
create trigger organization_memberships_prevent_final_org_owner_delete
before delete on public.organization_memberships
for each row execute function public.prevent_final_org_owner_delete();

create or replace function public.onboarding_ensure()
returns public.onboarding_progress
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := (select auth.uid());
  progress public.onboarding_progress%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;

  select *
  into progress
  from public.onboarding_progress
  where user_id = caller_id;

  if found then
    return progress;
  end if;

  insert into public.onboarding_progress (user_id)
  values (caller_id)
  on conflict (user_id) do nothing
  returning * into progress;

  if not found then
    select *
    into progress
    from public.onboarding_progress
    where user_id = caller_id;
  end if;

  return progress;
end;
$$;

create or replace function public.onboarding_create_organization(
  org_name text,
  org_slug text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := (select auth.uid());
  progress public.onboarding_progress%rowtype;
  new_organization public.organizations%rowtype;
  resolved_slug text;
  base_slug text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;

  if org_name is null or length(trim(org_name)) = 0 or length(trim(org_name)) > 120 then
    raise exception 'A valid organization name is required.';
  end if;

  perform public.onboarding_ensure();
  select *
  into progress
  from public.onboarding_progress
  where user_id = caller_id
  for update;

  if progress.completed_at is not null then
    raise exception 'Onboarding is already complete.';
  end if;

  if progress.organization_id is not null then
    raise exception 'An organization was already created for this onboarding.';
  end if;

  base_slug := trim(both '-' from lower(regexp_replace(
    coalesce(nullif(trim(org_slug), ''), trim(org_name)),
    '[^a-z0-9]+',
    '-',
    'g'
  )));
  resolved_slug := case
    when length(base_slug) >= 2 then base_slug
    else 'org-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
  end;

  if exists (select 1 from public.organizations organization where organization.slug = resolved_slug) then
    resolved_slug := left(resolved_slug, 48)
      || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  end if;

  insert into public.organizations (name, slug)
  values (trim(org_name), resolved_slug)
  returning * into new_organization;

  insert into public.organization_memberships (
    organization_id,
    user_id,
    role_id,
    status
  )
  values (
    new_organization.id,
    caller_id,
    'org_owner',
    'active'
  );

  if not exists (
    select 1
    from public.plan_catalog plan
    where plan.plan_id = 'CORE'
      and plan.status = 'active'
  ) then
    raise exception 'The server-selected CORE plan is not active.';
  end if;

  insert into public.organization_entitlements (
    organization_id,
    plan_id,
    status,
    metadata
  )
  values (
    new_organization.id,
    'CORE',
    'active',
    jsonb_build_object('source', 'self_service_onboarding')
  );

  update public.onboarding_progress
  set organization_id = new_organization.id,
      organization_complete = true,
      current_step = 'team',
      updated_at = now()
  where user_id = caller_id;

  return jsonb_build_object(
    'id', new_organization.id,
    'name', new_organization.name,
    'slug', new_organization.slug
  );
end;
$$;

create or replace function public.onboarding_create_team(team_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := (select auth.uid());
  progress public.onboarding_progress%rowtype;
  new_team public.teams%rowtype;
  resolved_slug text;
  base_slug text;
  resolved_short_name text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;

  if team_name is null or length(trim(team_name)) = 0 or length(trim(team_name)) > 120 then
    raise exception 'A valid team name is required.';
  end if;

  perform public.onboarding_ensure();
  select *
  into progress
  from public.onboarding_progress
  where user_id = caller_id
  for update;

  if progress.completed_at is not null then
    raise exception 'Onboarding is already complete.';
  end if;

  if progress.organization_id is null or not progress.organization_complete then
    raise exception 'Create your organization before creating a team.';
  end if;

  if progress.team_id is not null then
    raise exception 'A team was already created for this onboarding.';
  end if;

  if not exists (
    select 1
    from public.organizations organization
    join public.organization_memberships membership
      on membership.organization_id = organization.id
    where organization.id = progress.organization_id
      and organization.status = 'active'
      and membership.user_id = caller_id
      and membership.role_id = 'org_owner'
      and membership.status = 'active'
  ) then
    raise exception 'The onboarding organization is not owned by this account.';
  end if;

  base_slug := trim(both '-' from lower(regexp_replace(trim(team_name), '[^a-z0-9]+', '-', 'g')));
  resolved_slug := case
    when length(base_slug) >= 2 then base_slug
    else 'team-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
  end;

  if exists (select 1 from public.teams team where team.slug = resolved_slug) then
    resolved_slug := left(resolved_slug, 48)
      || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  end if;

  resolved_short_name := upper(left(regexp_replace(trim(team_name), '[^A-Za-z0-9]', '', 'g'), 12));
  if resolved_short_name = '' then
    resolved_short_name := 'TEAM';
  end if;

  insert into public.teams (name, slug, organization_id)
  values (trim(team_name), resolved_slug, progress.organization_id)
  returning * into new_team;

  insert into public.team_memberships (team_id, user_id, role_id, status, invited_by)
  values (new_team.id, caller_id, 'owner', 'active', caller_id);

  insert into public.team_branding (
    team_id,
    display_name,
    short_name,
    primary_color,
    secondary_color,
    accent_color,
    settings,
    updated_by
  )
  values (
    new_team.id,
    new_team.name,
    resolved_short_name,
    '#D71920',
    '#0D0E10',
    '#F2F3F4',
    jsonb_build_object('onboarding', 'self_service'),
    caller_id
  );

  update public.onboarding_progress
  set team_id = new_team.id,
      team_complete = true,
      current_step = 'season',
      updated_at = now()
  where user_id = caller_id;

  return jsonb_build_object('id', new_team.id, 'name', new_team.name, 'slug', new_team.slug);
end;
$$;

create or replace function public.onboarding_create_season(
  season_label text,
  season_start_year int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := (select auth.uid());
  progress public.onboarding_progress%rowtype;
  new_season public.seasons%rowtype;
  resolved_key text;
  start_year int;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;

  perform public.onboarding_ensure();
  select *
  into progress
  from public.onboarding_progress
  where user_id = caller_id
  for update;

  if progress.completed_at is not null then
    raise exception 'Onboarding is already complete.';
  end if;

  if progress.team_id is null or not progress.team_complete then
    raise exception 'Create your team before setting up a season.';
  end if;

  if progress.season_id is not null then
    raise exception 'A season was already created for this onboarding.';
  end if;

  resolved_key := nullif(trim(coalesce(season_label, '')), '');
  if resolved_key is null then
    start_year := coalesce(season_start_year, extract(year from now())::int);
    resolved_key := start_year::text || '-' || (start_year + 1)::text;
  end if;

  if resolved_key !~ '^\d{4}-\d{4}$' then
    raise exception 'Season must look like 2026-2027.';
  end if;

  if not exists (
    select 1
    from public.teams team
    join public.organization_memberships organization_membership
      on organization_membership.organization_id = team.organization_id
    join public.team_memberships team_membership
      on team_membership.team_id = team.id
    where team.id = progress.team_id
      and team.organization_id = progress.organization_id
      and organization_membership.user_id = caller_id
      and organization_membership.role_id = 'org_owner'
      and organization_membership.status = 'active'
      and team_membership.user_id = caller_id
      and team_membership.role_id = 'owner'
      and team_membership.status = 'active'
  ) then
    raise exception 'The onboarding team is not owned by this account.';
  end if;

  insert into public.seasons (team_id, name, season_key, status)
  values (progress.team_id, resolved_key, resolved_key, 'active')
  on conflict (team_id, season_key) do update
    set name = excluded.name,
        status = excluded.status,
        updated_at = now()
  returning * into new_season;

  update public.teams
  set default_season_id = new_season.id
  where id = progress.team_id;

  update public.onboarding_progress
  set season_id = new_season.id,
      season_complete = true,
      current_step = 'roster',
      updated_at = now()
  where user_id = caller_id;

  return jsonb_build_object('id', new_season.id, 'season_key', new_season.season_key);
end;
$$;

create or replace function public.onboarding_add_player(
  player_name text,
  jersey text,
  player_position text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := (select auth.uid());
  progress public.onboarding_progress%rowtype;
  normalized_name text := trim(coalesce(player_name, ''));
  normalized_position text := upper(trim(coalesce(player_position, '')));
  normalized_jersey text := trim(coalesce(jersey, ''));
  first_name text;
  last_name text;
  player_type text;
  source_id text := gen_random_uuid()::text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;

  perform public.onboarding_ensure();
  select *
  into progress
  from public.onboarding_progress
  where user_id = caller_id
  for update;

  if progress.completed_at is not null then
    raise exception 'Onboarding is already complete.';
  end if;

  if progress.team_id is null or not progress.team_complete or progress.season_id is null then
    raise exception 'Create your team and season before adding players.';
  end if;

  if normalized_name = '' or length(normalized_name) > 120 or position(' ' in normalized_name) = 0 then
    raise exception 'A first and last name are required.';
  end if;

  if normalized_jersey !~ '^[0-9]{1,3}$' then
    raise exception 'Jersey number must be one to three digits.';
  end if;

  if normalized_position not in ('F', 'D', 'G') then
    raise exception 'Position must be F, D, or G.';
  end if;

  if not exists (
    select 1
    from public.team_memberships membership
    where membership.team_id = progress.team_id
      and membership.user_id = caller_id
      and membership.role_id = 'owner'
      and membership.status = 'active'
  ) then
    raise exception 'The onboarding team is not owned by this account.';
  end if;

  if exists (
    select 1
    from public.team_roster_players player
    where player.team_id = progress.team_id
      and player.jersey_number = normalized_jersey
      and player.status = 'active'
  ) then
    raise exception 'Jersey number % is already assigned to an active player on this team.', normalized_jersey;
  end if;

  first_name := split_part(normalized_name, ' ', 1);
  last_name := trim(regexp_replace(normalized_name, '^\S+\s+', ''));
  player_type := case when normalized_position = 'G' then 'goalie' else 'skater' end;

  insert into public.team_roster_players (
    team_id,
    season_id,
    source_player_id,
    jersey_number,
    name,
    first_name,
    last_name,
    position,
    player_type,
    shoots,
    notes,
    status,
    created_by,
    updated_by
  )
  values (
    progress.team_id,
    progress.season_id,
    source_id,
    normalized_jersey,
    normalized_name,
    first_name,
    last_name,
    normalized_position,
    player_type,
    'unknown',
    '',
    'active',
    caller_id,
    caller_id
  )
  returning source_player_id into source_id;

  return jsonb_build_object('source_player_id', source_id);
end;
$$;

create or replace function public.onboarding_mark_step(step text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := (select auth.uid());
  progress public.onboarding_progress%rowtype;
  next_step text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;

  if step not in ('roster', 'staff', 'branding', 'review') then
    raise exception 'Unsupported onboarding step.';
  end if;

  perform public.onboarding_ensure();
  select *
  into progress
  from public.onboarding_progress
  where user_id = caller_id
  for update;

  if progress.completed_at is not null then
    raise exception 'Onboarding is already complete.';
  end if;

  if progress.team_id is null or progress.season_id is null then
    raise exception 'Team and season setup are incomplete.';
  end if;

  if not exists (
    select 1
    from public.team_memberships membership
    where membership.team_id = progress.team_id
      and membership.user_id = caller_id
      and membership.role_id = 'owner'
      and membership.status = 'active'
  ) then
    raise exception 'The onboarding team is not owned by this account.';
  end if;

  if step = 'roster' then
    if not exists (
      select 1
      from public.team_roster_players player
      where player.team_id = progress.team_id
        and player.status = 'active'
    ) then
      raise exception 'Add at least one active roster player before continuing.';
    end if;

    update public.onboarding_progress
    set roster_complete = true,
        current_step = 'staff',
        updated_at = now()
    where user_id = caller_id;
    next_step := 'staff';
  elsif step = 'staff' then
    update public.onboarding_progress
    set staff_complete = true,
        current_step = 'branding',
        updated_at = now()
    where user_id = caller_id;
    next_step := 'branding';
  elsif step = 'branding' then
    update public.onboarding_progress
    set branding_complete = true,
        current_step = 'review',
        updated_at = now()
    where user_id = caller_id;
    next_step := 'review';
  else
    update public.onboarding_progress
    set review_complete = true,
        current_step = 'review',
        updated_at = now()
    where user_id = caller_id;
    next_step := 'review';
  end if;

  return jsonb_build_object('next', next_step);
end;
$$;

create or replace function public.onboarding_complete()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := (select auth.uid());
  progress public.onboarding_progress%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;

  perform public.onboarding_ensure();
  select *
  into progress
  from public.onboarding_progress
  where user_id = caller_id
  for update;

  if progress.completed_at is not null then
    return jsonb_build_object('status', 'already_complete', 'team_id', progress.team_id);
  end if;

  if not progress.organization_complete or progress.organization_id is null
     or not progress.team_complete or progress.team_id is null
     or not progress.season_complete or progress.season_id is null then
    raise exception 'Organization, team, and season setup must be complete.';
  end if;

  if not exists (
    select 1
    from public.teams team
    join public.seasons season on season.id = progress.season_id
    join public.organization_memberships organization_membership
      on organization_membership.organization_id = team.organization_id
    join public.team_memberships team_membership
      on team_membership.team_id = team.id
    where team.id = progress.team_id
      and team.organization_id = progress.organization_id
      and season.team_id = team.id
      and organization_membership.user_id = caller_id
      and organization_membership.role_id = 'org_owner'
      and organization_membership.status = 'active'
      and team_membership.user_id = caller_id
      and team_membership.role_id = 'owner'
      and team_membership.status = 'active'
  ) then
    raise exception 'The onboarding workspace is not owned by this account.';
  end if;

  if not exists (
    select 1
    from public.team_roster_players player
    where player.team_id = progress.team_id
      and player.status = 'active'
  ) then
    raise exception 'Add at least one active roster player before finishing setup.';
  end if;

  update public.onboarding_progress
  set roster_complete = true,
      review_complete = true,
      current_step = 'review',
      completed_at = now(),
      updated_at = now()
  where user_id = caller_id;

  return jsonb_build_object('status', 'completed', 'team_id', progress.team_id);
end;
$$;

create or replace function public.onboarding_save_branding(
  primary_color_input text,
  secondary_color_input text,
  accent_color_input text,
  display_name_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := (select auth.uid());
  progress public.onboarding_progress%rowtype;
  resolved_display_name text;
  resolved_short_name text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;

  if coalesce(primary_color_input, '') !~ '^#[0-9a-fA-F]{6}$'
     or coalesce(secondary_color_input, '') !~ '^#[0-9a-fA-F]{6}$'
     or coalesce(accent_color_input, '') !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'Colors must be hex values like #d71920.';
  end if;

  perform public.onboarding_ensure();
  select *
  into progress
  from public.onboarding_progress
  where user_id = caller_id
  for update;

  if progress.completed_at is not null then
    raise exception 'Onboarding is already complete.';
  end if;

  if progress.team_id is null or not progress.team_complete then
    raise exception 'Create your team before setting branding.';
  end if;

  if not exists (
    select 1
    from public.team_memberships membership
    where membership.team_id = progress.team_id
      and membership.user_id = caller_id
      and membership.role_id = 'owner'
      and membership.status = 'active'
  ) then
    raise exception 'The onboarding team is not owned by this account.';
  end if;

  select coalesce(nullif(trim(display_name_input), ''), team.name)
  into resolved_display_name
  from public.teams team
  where team.id = progress.team_id;

  if resolved_display_name is null or length(resolved_display_name) > 120 then
    raise exception 'A valid team display name is required.';
  end if;

  resolved_short_name := upper(left(regexp_replace(resolved_display_name, '[^A-Za-z0-9]', '', 'g'), 12));
  if resolved_short_name = '' then
    resolved_short_name := 'TEAM';
  end if;

  update public.team_branding
  set display_name = resolved_display_name,
      short_name = resolved_short_name,
      primary_color = upper(primary_color_input),
      secondary_color = upper(secondary_color_input),
      accent_color = upper(accent_color_input),
      updated_by = caller_id,
      updated_at = now()
  where team_id = progress.team_id;

  if not found then
    raise exception 'The onboarding team branding record is missing.';
  end if;

  update public.onboarding_progress
  set branding_complete = true,
      current_step = 'review',
      updated_at = now()
  where user_id = caller_id;

  return jsonb_build_object('team_id', progress.team_id, 'display_name', resolved_display_name);
end;
$$;

create or replace function public.onboarding_list_invites()
returns table (
  id uuid,
  email text,
  display_name text,
  role_id text,
  status text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := (select auth.uid());
  progress public.onboarding_progress%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;

  select *
  into progress
  from public.onboarding_progress
  where user_id = caller_id;

  if not found or progress.team_id is null then
    return;
  end if;

  if not exists (
    select 1
    from public.team_memberships membership
    where membership.team_id = progress.team_id
      and membership.user_id = caller_id
      and membership.role_id = 'owner'
      and membership.status = 'active'
  ) then
    raise exception 'The onboarding team is not owned by this account.';
  end if;

  return query
  select
    invite.id,
    invite.email_normalized,
    invite.display_name,
    invite.role_id,
    case
      when invite.status = 'pending'
       and invite.expires_at is not null
       and invite.expires_at <= now() then 'expired'
      else invite.status
    end,
    invite.expires_at
  from public.workspace_invites invite
  where invite.team_id = progress.team_id
  order by invite.created_at desc;
end;
$$;

create or replace function public.admin_list_onboarding()
returns table (
  user_id uuid,
  display_name text,
  organization_id uuid,
  organization_name text,
  team_id uuid,
  team_name text,
  current_step text,
  status text,
  updated_at timestamptz,
  completed_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    progress.user_id,
    profile.display_name,
    progress.organization_id,
    organization.name,
    progress.team_id,
    team.name,
    progress.current_step,
    case
      when progress.completed_at is not null then 'completed'
      when progress.organization_id is null and progress.team_id is null then 'not_started'
      else 'in_progress'
    end,
    progress.updated_at,
    progress.completed_at
  from public.onboarding_progress progress
  join public.profiles profile on profile.id = progress.user_id
  left join public.organizations organization on organization.id = progress.organization_id
  left join public.teams team on team.id = progress.team_id
  where (select auth.uid()) is not null
    and public.is_platform_admin()
  order by progress.updated_at desc;
$$;

revoke all on function public.prevent_final_org_owner_loss() from public, anon, authenticated;
revoke all on function public.prevent_final_org_owner_delete() from public, anon, authenticated;
revoke all on function public.onboarding_ensure() from public, anon;
revoke all on function public.onboarding_create_organization(text, text) from public, anon;
revoke all on function public.onboarding_create_team(text) from public, anon;
revoke all on function public.onboarding_create_season(text, int) from public, anon;
revoke all on function public.onboarding_add_player(text, text, text) from public, anon;
revoke all on function public.onboarding_mark_step(text) from public, anon;
revoke all on function public.onboarding_complete() from public, anon;
revoke all on function public.onboarding_save_branding(text, text, text, text) from public, anon;
revoke all on function public.onboarding_list_invites() from public, anon;
revoke all on function public.admin_list_onboarding() from public, anon;

grant execute on function public.onboarding_ensure() to authenticated;
grant execute on function public.onboarding_create_organization(text, text) to authenticated;
grant execute on function public.onboarding_create_team(text) to authenticated;
grant execute on function public.onboarding_create_season(text, int) to authenticated;
grant execute on function public.onboarding_add_player(text, text, text) to authenticated;
grant execute on function public.onboarding_mark_step(text) to authenticated;
grant execute on function public.onboarding_complete() to authenticated;
grant execute on function public.onboarding_save_branding(text, text, text, text) to authenticated;
grant execute on function public.onboarding_list_invites() to authenticated;
grant execute on function public.admin_list_onboarding() to authenticated;

do $$
begin
  if has_table_privilege('authenticated', 'public.onboarding_progress', 'insert, update, delete') then
    raise exception 'Onboarding progress writes must remain RPC-only.';
  end if;

  if has_table_privilege('authenticated', 'public.workspace_invites', 'select') then
    raise exception 'Direct workspace invite reads must remain unavailable to browser roles.';
  end if;

  if has_function_privilege('anon', 'public.onboarding_ensure()', 'execute')
     or has_function_privilege('anon', 'public.onboarding_create_organization(text,text)', 'execute')
     or has_function_privilege('anon', 'public.onboarding_create_team(text)', 'execute')
     or has_function_privilege('anon', 'public.onboarding_create_season(text,integer)', 'execute')
     or has_function_privilege('anon', 'public.onboarding_add_player(text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.onboarding_mark_step(text)', 'execute')
     or has_function_privilege('anon', 'public.onboarding_complete()', 'execute')
     or has_function_privilege('anon', 'public.onboarding_save_branding(text,text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.onboarding_list_invites()', 'execute')
     or has_function_privilege('anon', 'public.admin_list_onboarding()', 'execute') then
    raise exception 'Anonymous execution remains granted to an onboarding reconciliation RPC.';
  end if;
end;
$$;
