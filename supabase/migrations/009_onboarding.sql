-- Onboarding 2.0 data model and secure setup RPCs for PuckNexus 2.0 Stage 5.
-- Additive only. Replaces the Stage 3 transitional "invited membership only"
-- onboarding definition with a persistent, user-scoped, resume-safe model.
-- Creates no users and no production identities.

-- 1. Onboarding progress: one row per user. Required-step flags are derived
-- from real created records by the RPCs; the client never self-certifies.
create table public.onboarding_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  season_id uuid references public.seasons(id) on delete set null,
  current_step text not null default 'organization'
    check (current_step in ('organization', 'team', 'season', 'roster', 'staff', 'branding', 'review', 'complete')),
  organization_complete boolean not null default false,
  team_complete boolean not null default false,
  season_complete boolean not null default false,
  roster_complete boolean not null default false,
  staff_complete boolean not null default false,
  branding_complete boolean not null default false,
  review_complete boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.onboarding_progress enable row level security;

create policy onboarding_progress_select_self_or_platform_admin
on public.onboarding_progress for select
to authenticated
using (user_id = (select auth.uid()) or public.is_platform_admin());

create policy onboarding_progress_insert_self
on public.onboarding_progress for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy onboarding_progress_update_self
on public.onboarding_progress for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy onboarding_progress_delete_for_platform_admins
on public.onboarding_progress for delete
to authenticated
using (public.is_platform_admin());

revoke all on public.onboarding_progress from anon;
grant select, insert, update on public.onboarding_progress to authenticated;
grant select, insert, update, delete on public.onboarding_progress to service_role;

-- Ensure exactly one owner membership per organization and team regardless of
-- retry timing, so double-submits can never duplicate rows.
create unique index if not exists organization_memberships_org_user_unique
  on public.organization_memberships(organization_id, user_id);

-- 2. Resume helper: returns the caller's progress row, creating a fresh one
-- for brand-new accounts. Existing configured users have no row and are never
-- forced through onboarding; this only runs when routing asks for it.
create or replace function public.onboarding_ensure()
returns public.onboarding_progress
language plpgsql
security definer
set search_path = public
as $$
declare
  progress public.onboarding_progress;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;
  select * into progress
  from public.onboarding_progress
  where user_id = (select auth.uid());
  if found then
    return progress;
  end if;
  insert into public.onboarding_progress (user_id)
  values ((select auth.uid()))
  on conflict (user_id) do nothing
  returning * into progress;
  if not found then
    select * into progress
    from public.onboarding_progress
    where user_id = (select auth.uid());
  end if;
  return progress;
end;
$$;

-- 3. Organization creation. Atomic: organization + creator-as-owner membership
-- + progress, in one transaction. The server assigns all ownership; the client
-- cannot create memberships for arbitrary accounts.
create or replace function public.onboarding_create_organization(org_name text, org_slug text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  progress public.onboarding_progress;
  new_organization_id uuid;
  resolved_slug text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;
  if org_name is null or length(trim(org_name)) = 0 or length(trim(org_name)) > 120 then
    raise exception 'A valid organization name is required.';
  end if;
  select * into progress from public.onboarding_ensure();
  if progress.completed_at is not null then
    raise exception 'Onboarding is already complete.';
  end if;
  if progress.organization_id is not null and progress.organization_complete then
    raise exception 'An organization was already created for this account.';
  end if;
  resolved_slug := coalesce(
    nullif(lower(regexp_replace(coalesce(org_slug, ''), '[^a-z0-9]+', '-', 'g')), ''),
    lower(regexp_replace(trim(org_name), '[^a-z0-9]+', '-', 'g'))
  );
  resolved_slug := trim(both '-' from resolved_slug);
  if length(resolved_slug) < 2 then
    resolved_slug := 'org-' || substr(gen_random_uuid()::text, 1, 8);
  end if;
  if exists (select 1 from public.organizations where slug = resolved_slug) then
    resolved_slug := resolved_slug || '-' || substr(gen_random_uuid()::text, 1, 4);
  end if;

  insert into public.organizations (name, slug)
  values (trim(org_name), resolved_slug)
  returning id into new_organization_id;

  insert into public.organization_memberships (organization_id, user_id, role, status)
  values (new_organization_id, (select auth.uid()), 'owner', 'active')
  on conflict (organization_id, user_id) do nothing;

  update public.onboarding_progress
  set organization_id = new_organization_id,
      organization_complete = true,
      current_step = 'team',
      updated_at = now()
  where user_id = (select auth.uid());

  return jsonb_build_object('id', new_organization_id, 'name', trim(org_name), 'slug', resolved_slug);
end;
$$;

-- 4. Team creation. Requires org ownership; creates the team, the creator's
-- owner team membership, and progress in one transaction. Safe on retry.
create or replace function public.onboarding_create_team(team_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  progress public.onboarding_progress;
  new_team_id uuid;
  resolved_slug text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;
  if team_name is null or length(trim(team_name)) = 0 or length(trim(team_name)) > 120 then
    raise exception 'A valid team name is required.';
  end if;
  select * into progress from public.onboarding_ensure();
  if progress.completed_at is not null then
    raise exception 'Onboarding is already complete.';
  end if;
  if progress.organization_id is null or not progress.organization_complete then
    raise exception 'Create your organization before creating a team.';
  end if;
  if progress.team_id is not null and progress.team_complete then
    raise exception 'A team was already created for this account.';
  end if;
  resolved_slug := trim(both '-' from lower(regexp_replace(trim(team_name), '[^a-z0-9]+', '-', 'g')));
  if length(resolved_slug) < 2 then
    resolved_slug := 'team-' || substr(gen_random_uuid()::text, 1, 8);
  end if;
  if exists (select 1 from public.teams where slug = resolved_slug) then
    resolved_slug := resolved_slug || '-' || substr(gen_random_uuid()::text, 1, 4);
  end if;

  insert into public.teams (name, slug, organization_id)
  values (trim(team_name), resolved_slug, progress.organization_id)
  returning id into new_team_id;

  insert into public.team_memberships (team_id, user_id, role_id, status)
  values (new_team_id, (select auth.uid()), 'owner', 'active')
  on conflict (team_id, user_id) do nothing;

  insert into public.team_branding (team_id, display_name, short_name)
  values (new_team_id, trim(team_name), upper(substr(regexp_replace(trim(team_name), '[^A-Za-z]', '', 'g'), 1, 2)))
  on conflict (team_id) do nothing;

  update public.onboarding_progress
  set team_id = new_team_id,
      team_complete = true,
      current_step = 'season',
      updated_at = now()
  where user_id = (select auth.uid());

  return jsonb_build_object('id', new_team_id, 'name', trim(team_name), 'slug', resolved_slug);
end;
$$;

-- 5. Season creation. Requires ownership of the onboarding team; attaches the
-- season and marks it the team default.
create or replace function public.onboarding_create_season(season_label text, season_start_year int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  progress public.onboarding_progress;
  new_season_id uuid;
  resolved_key text;
  start_year int;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;
  select * into progress from public.onboarding_ensure();
  if progress.completed_at is not null then
    raise exception 'Onboarding is already complete.';
  end if;
  if progress.team_id is null or not progress.team_complete then
    raise exception 'Create your team before setting up a season.';
  end if;
  if progress.season_id is not null and progress.season_complete then
    raise exception 'A season was already created for this account.';
  end if;
  resolved_key := nullif(trim(coalesce(season_label, '')), '');
  if resolved_key is null then
    start_year := coalesce(season_start_year, extract(year from now())::int);
    resolved_key := start_year::text || '-' || (start_year + 1)::text;
  end if;
  if not (resolved_key ~ '^\d{4}-\d{4}$') then
    raise exception 'Season must look like 2026-2027.';
  end if;

  insert into public.seasons (team_id, name, season_key, status)
  values (progress.team_id, resolved_key, resolved_key, 'active')
  on conflict (team_id, season_key) do update
    set name = excluded.name, status = 'active'
  returning id into new_season_id;

  update public.teams
  set default_season_id = new_season_id
  where id = progress.team_id;

  update public.onboarding_progress
  set season_id = new_season_id,
      season_complete = true,
      current_step = 'roster',
      updated_at = now()
  where user_id = (select auth.uid());

  return jsonb_build_object('id', new_season_id, 'season_key', resolved_key);
end;
$$;

-- 6. Step advancement for steps that write through existing team-owner RLS
-- (roster, staff, branding). The server verifies the caller owns the
-- onboarding team and confirms real records exist before marking progress.
create or replace function public.onboarding_mark_step(step text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  progress public.onboarding_progress;
  next_step text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;
  if step not in ('roster', 'staff', 'branding', 'review') then
    raise exception 'Unsupported onboarding step.';
  end if;
  select * into progress from public.onboarding_ensure();
  if progress.completed_at is not null then
    raise exception 'Onboarding is already complete.';
  end if;
  if step = 'roster' then
    if not exists (select 1 from public.team_roster_players p where p.team_id = progress.team_id) then
      raise exception 'Add at least one player, or import a roster, before continuing.';
    end if;
    update public.onboarding_progress set roster_complete = true where user_id = (select auth.uid());
    next_step := 'staff';
  elsif step = 'staff' then
    -- Staff is optional: invited staff or skipped staff both count.
    update public.onboarding_progress set staff_complete = true where user_id = (select auth.uid());
    next_step := 'branding';
  elsif step = 'branding' then
    update public.onboarding_progress set branding_complete = true where user_id = (select auth.uid());
    next_step := 'review';
  else
    update public.onboarding_progress set review_complete = true where user_id = (select auth.uid());
    next_step := 'review';
  end if;
  update public.onboarding_progress
  set current_step = next_step, updated_at = now()
  where user_id = (select auth.uid());
  return jsonb_build_object('step', step, 'next', next_step);
end;
$$;

-- 7. Finish setup. Validates required items against real records and completes
-- exactly once; repeated calls after completion are idempotent no-ops.
create or replace function public.onboarding_complete()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  progress public.onboarding_progress;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;
  select * into progress from public.onboarding_ensure();
  if progress.completed_at is not null then
    return jsonb_build_object('status', 'already_complete', 'team_id', progress.team_id);
  end if;
  if not progress.organization_complete or progress.organization_id is null then
    raise exception 'Organization setup is incomplete.';
  end if;
  if not progress.team_complete or progress.team_id is null then
    raise exception 'Team setup is incomplete.';
  end if;
  if not progress.season_complete or progress.season_id is null then
    raise exception 'Season setup is incomplete.';
  end if;
  if not exists (select 1 from public.team_roster_players p where p.team_id = progress.team_id) then
    raise exception 'Add at least one roster player before finishing setup.';
  end if;
  if not exists (
    select 1 from public.team_memberships tm
    where tm.team_id = progress.team_id
      and tm.user_id = (select auth.uid())
      and tm.status = 'active'
  ) then
    raise exception 'Your team membership is not active.';
  end if;

  update public.onboarding_progress
  set completed_at = now(),
      current_step = 'complete',
      review_complete = true,
      roster_complete = true,
      staff_complete = true,
      branding_complete = true,
      updated_at = now()
  where user_id = (select auth.uid())
    and completed_at is null;

  return jsonb_build_object('status', 'complete', 'team_id', progress.team_id, 'organization_id', progress.organization_id);
end;
$$;

-- 8. Roster add through onboarding. Verifies the caller's active ownership of
-- the onboarding team, rejects duplicate jersey numbers within the team, and
-- lets the wizard stay on one screen (bulk add loops this call client-side).
create or replace function public.onboarding_add_player(player_name text, jersey text, player_position text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  progress public.onboarding_progress;
  normalized_position text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;
  select * into progress from public.onboarding_ensure();
  if progress.completed_at is not null then
    raise exception 'Onboarding is already complete.';
  end if;
  if progress.team_id is null or not progress.team_complete then
    raise exception 'Create your team before adding players.';
  end if;
  if player_name is null or length(trim(player_name)) = 0 or length(trim(player_name)) > 120 then
    raise exception 'A player name is required.';
  end if;
  normalized_position := upper(trim(coalesce(player_position, '')));
  if normalized_position not in ('F', 'D', 'G') then
    raise exception 'Position must be F, D, or G.';
  end if;
  if jersey is null or length(trim(jersey)) = 0 or length(trim(jersey)) > 4 then
    raise exception 'A jersey number is required.';
  end if;
  if exists (
    select 1 from public.team_roster_players p
    where p.team_id = progress.team_id and p.jersey_number = trim(jersey)
  ) then
    raise exception 'Jersey number % is already assigned on this team.', trim(jersey);
  end if;

  insert into public.team_roster_players (team_id, source_player_id, jersey_number, name, position)
  values (progress.team_id, 'onboarding-' || gen_random_uuid()::text, trim(jersey), trim(player_name), normalized_position);

  return jsonb_build_object('name', trim(player_name), 'jersey_number', trim(jersey), 'position', normalized_position);
end;
$$;

-- 9. Staff invite through onboarding: one consistent invitation lifecycle.
-- Creates the first-class team_invitations record and the pending membership
-- so the invited account routes correctly on first sign-in. Email delivery is
-- attempted by the existing invite-staff Edge Function afterwards; failure of
-- delivery never rolls back the invitation record.
create or replace function public.onboarding_invite_staff(staff_email text, staff_name text, staff_role_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  progress public.onboarding_progress;
  new_invitation_id uuid;
  normalized_email text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;
  select * into progress from public.onboarding_ensure();
  if progress.completed_at is not null then
    raise exception 'Onboarding is already complete.';
  end if;
  if progress.team_id is null or not progress.team_complete then
    raise exception 'Create your team before inviting staff.';
  end if;
  normalized_email := lower(trim(coalesce(staff_email, '')));
  if normalized_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'A valid staff email is required.';
  end if;
  if staff_role_id not in ('assistant_goalie', 'assistant') then
    raise exception 'Only assistant staff roles can be invited.';
  end if;
  if exists (
    select 1 from public.team_invitations i
    where i.team_id = progress.team_id
      and lower(i.email) = normalized_email
      and i.status = 'pending'
  ) then
    raise exception 'A pending invitation already exists for this email on this team.';
  end if;

  insert into public.team_invitations (team_id, email, display_name, role_id, invited_by)
  values (progress.team_id, normalized_email, left(trim(coalesce(staff_name, '')), 120), staff_role_id, (select auth.uid()))
  returning id into new_invitation_id;

  return jsonb_build_object('id', new_invitation_id, 'email', normalized_email, 'role_id', staff_role_id, 'status', 'pending');
end;
$$;

-- 10. Branding save through onboarding (team branding only; platform and
-- organization branding are separate concerns).
create or replace function public.onboarding_save_branding(primary_color_input text, secondary_color_input text, accent_color_input text, display_name_input text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  progress public.onboarding_progress;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;
  select * into progress from public.onboarding_ensure();
  if progress.completed_at is not null then
    raise exception 'Onboarding is already complete.';
  end if;
  if progress.team_id is null or not progress.team_complete then
    raise exception 'Create your team before setting branding.';
  end if;
  if coalesce(primary_color_input, '') !~ '^#[0-9a-fA-F]{6}$'
     or coalesce(secondary_color_input, '') !~ '^#[0-9a-fA-F]{6}$'
     or coalesce(accent_color_input, '') !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'Colors must be hex values like #d71920.';
  end if;

  insert into public.team_branding (team_id, display_name, short_name, primary_color, secondary_color, accent_color)
  values (
    progress.team_id,
    left(coalesce(nullif(trim(display_name_input), ''), 'My Team'), 120),
    upper(substr(regexp_replace(coalesce(nullif(trim(display_name_input), ''), 'MT'), '[^A-Za-z]', '', 'g'), 1, 2)),
    lower(primary_color_input), lower(secondary_color_input), lower(accent_color_input)
  )
  on conflict (team_id) do update
  set display_name = excluded.display_name,
      primary_color = excluded.primary_color,
      secondary_color = excluded.secondary_color,
      accent_color = excluded.accent_color,
      updated_at = now();

  update public.onboarding_progress
  set branding_complete = true, updated_at = now()
  where user_id = (select auth.uid());

  return jsonb_build_object('team_id', progress.team_id, 'primary_color', lower(primary_color_input));
end;
$$;

-- 11. Admin visibility: onboarding status per team for the Platform Admin
-- Dashboard. Replaces the transitional invite-only signal.
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
  select op.user_id, p.display_name, op.organization_id, o.name as organization_name,
         op.team_id, t.name as team_name, op.current_step,
         case
           when op.completed_at is not null then 'completed'
           when op.organization_id is null and op.team_id is null then 'not_started'
           else 'in_progress'
         end as status,
         op.updated_at, op.completed_at
  from public.onboarding_progress op
  join public.profiles p on p.id = op.user_id
  left join public.organizations o on o.id = op.organization_id
  left join public.teams t on t.id = op.team_id
  where public.is_platform_admin()
  order by op.updated_at desc;
$$;

revoke all on function public.onboarding_ensure() from public;
revoke all on function public.onboarding_create_organization(text, text) from public;
revoke all on function public.onboarding_create_team(text) from public;
revoke all on function public.onboarding_create_season(text, int) from public;
revoke all on function public.onboarding_mark_step(text) from public;
revoke all on function public.onboarding_complete() from public;
revoke all on function public.onboarding_add_player(text, text, text) from public;
revoke all on function public.onboarding_invite_staff(text, text, text) from public;
revoke all on function public.onboarding_save_branding(text, text, text, text) from public;
revoke all on function public.admin_list_onboarding() from public;

grant execute on function public.onboarding_ensure() to authenticated;
grant execute on function public.onboarding_create_organization(text, text) to authenticated;
grant execute on function public.onboarding_create_team(text) to authenticated;
grant execute on function public.onboarding_create_season(text, int) to authenticated;
grant execute on function public.onboarding_mark_step(text) to authenticated;
grant execute on function public.onboarding_complete() to authenticated;
grant execute on function public.onboarding_add_player(text, text, text) to authenticated;
grant execute on function public.onboarding_invite_staff(text, text, text) to authenticated;
grant execute on function public.onboarding_save_branding(text, text, text, text) to authenticated;
grant execute on function public.admin_list_onboarding() to authenticated;
