-- Onboarding 2.0 stage 1: additive shared-database preparation.
--
-- This migration deliberately does NOT alter current_step, completed_at, or
-- any legacy onboarding RPC. The currently deployed site therefore keeps its
-- review -> finish path exactly as it was before this migration. The V2 UI
-- uses the separate onboarding_v2_step and onboarding2_* RPCs below.

alter table public.onboarding_progress
  add column if not exists onboarding_v2_step text,
  add column if not exists first_game_complete boolean not null default false,
  add column if not exists first_stats_complete boolean not null default false,
  add constraint onboarding_progress_onboarding_v2_step_check
    check (onboarding_v2_step is null or onboarding_v2_step in (
      'organization', 'team', 'season', 'roster', 'staff', 'branding',
      'first_game', 'first_stats', 'review'
    ));

-- New accounts opt into V2 only when no legacy setup exists. Existing
-- incomplete accounts are returned unchanged.
create function public.onboarding2_ensure()
returns public.onboarding_progress
language plpgsql security definer set search_path = public
as $$
declare progress public.onboarding_progress%rowtype;
begin
  perform public.onboarding_ensure();
  select * into progress from public.onboarding_progress
  where user_id = (select auth.uid()) for update;
  if progress.completed_at is null
     and progress.onboarding_v2_step is null
     and progress.current_step = 'organization'
     and progress.organization_id is null and progress.team_id is null
     and progress.season_id is null then
    update public.onboarding_progress
    set onboarding_v2_step = 'organization', updated_at = now()
    where user_id = (select auth.uid())
    returning * into progress;
  end if;
  return progress;
end;
$$;

-- V2 advances only its additive state track. It never changes legacy
-- current_step, so the current live UI remains safe throughout this stage.
create function public.onboarding2_mark_step(step text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare progress public.onboarding_progress%rowtype; next_step text;
begin
  if (select auth.uid()) is null then raise exception 'Authentication is required.'; end if;
  if step not in ('organization','team','season','roster','staff','branding','first_game','first_stats') then
    raise exception 'Unsupported onboarding step.';
  end if;
  select * into progress from public.onboarding_progress
  where user_id = (select auth.uid()) for update;
  if progress.completed_at is not null then raise exception 'Onboarding is already complete.'; end if;
  if progress.onboarding_v2_step is null then raise exception 'This is a legacy onboarding session.'; end if;
  if progress.team_id is not null and not exists (
    select 1 from public.team_memberships membership
    where membership.team_id = progress.team_id and membership.user_id = progress.user_id
      and membership.role_id = 'owner' and membership.status = 'active'
  ) then raise exception 'The onboarding team is not owned by this account.'; end if;
  if step = 'organization' then
    if progress.organization_id is null then raise exception 'Create your organization first.'; end if;
    next_step := 'team';
  elsif step = 'team' then
    if progress.team_id is null then raise exception 'Create your team first.'; end if;
    next_step := 'season';
  elsif step = 'season' then
    if progress.season_id is null then raise exception 'Create a season first.'; end if;
    next_step := 'roster';
  elsif step = 'roster' then
    if not exists (select 1 from public.team_roster_players p where p.team_id = progress.team_id and p.status = 'active') then raise exception 'Add at least one active roster player before continuing.'; end if;
    update public.onboarding_progress set roster_complete = true where user_id = progress.user_id;
    next_step := 'staff';
  elsif step = 'staff' then
    update public.onboarding_progress set staff_complete = true where user_id = progress.user_id;
    next_step := 'branding';
  elsif step = 'branding' then
    update public.onboarding_progress set branding_complete = true where user_id = progress.user_id;
    next_step := 'first_game';
  elsif step = 'first_game' then
    if not exists (select 1 from public.team_schedule_games g where g.team_id = progress.team_id and g.season_id = progress.season_id) then raise exception 'Add your first game before continuing.'; end if;
    update public.onboarding_progress set first_game_complete = true where user_id = progress.user_id;
    next_step := 'first_stats';
  else
    update public.onboarding_progress set first_stats_complete = true where user_id = progress.user_id;
    next_step := 'review';
  end if;
  update public.onboarding_progress set onboarding_v2_step = next_step, updated_at = now() where user_id = progress.user_id;
  return jsonb_build_object('next', next_step);
end;
$$;

-- V2 adds an idempotent game without changing the legacy state track.
create function public.onboarding2_add_first_game(
  game_date date, opponent_name text, game_time time default null,
  game_home_away text default 'Home', game_type_name text default 'League',
  game_location text default ''
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare progress public.onboarding_progress%rowtype; schedule_id uuid; linked_id text; source_id text;
begin
  if (select auth.uid()) is null then raise exception 'Authentication is required.'; end if;
  if game_date is null or nullif(trim(opponent_name), '') is null then raise exception 'Choose a date and opponent.'; end if;
  if game_home_away not in ('Home','Away') then raise exception 'Home / Away must be Home or Away.'; end if;
  if game_type_name not in ('League','Exhibition','Tournament','Playoff') then raise exception 'Choose a supported game type.'; end if;
  select * into progress from public.onboarding_progress where user_id = (select auth.uid()) for update;
  if progress.onboarding_v2_step is null or progress.team_id is null or progress.season_id is null then raise exception 'Team and season setup are incomplete.'; end if;
  if not exists (
    select 1 from public.team_memberships membership
    where membership.team_id = progress.team_id and membership.user_id = progress.user_id
      and membership.role_id = 'owner' and membership.status = 'active'
  ) then raise exception 'The onboarding team is not owned by this account.'; end if;
  source_id := 'onboarding-v2-' || progress.user_id::text || '-' || progress.season_id::text;
  insert into public.team_schedule_games (team_id, source_schedule_id, season_id, date, time, opponent, home_away, game_type, location, notes, source_created_at, source_updated_at)
  values (progress.team_id, source_id, progress.season_id, game_date, game_time, trim(opponent_name), game_home_away, game_type_name, trim(coalesce(game_location,'')), '', now(), now())
  on conflict (team_id, source_schedule_id) do update set season_id = excluded.season_id, date = excluded.date, time = excluded.time, opponent = excluded.opponent, home_away = excluded.home_away, game_type = excluded.game_type, location = excluded.location, source_updated_at = now(), updated_at = now()
  returning id into schedule_id;
  perform public.save_schedule_game(schedule_id, game_date, trim(opponent_name), game_time, game_home_away, game_type_name, trim(coalesce(game_location,'')), '', progress.season_id);
  linked_id := public.ensure_schedule_game_shell(schedule_id);
  update public.onboarding_progress set first_game_complete = true, onboarding_v2_step = 'first_stats', updated_at = now() where user_id = progress.user_id;
  return jsonb_build_object('schedule_id', schedule_id, 'source_game_id', linked_id, 'date', game_date, 'opponent', trim(opponent_name));
end;
$$;

-- Reuse legacy owner-validated branding. Its legacy review state stays valid;
-- V2 records its own handoff separately.
create function public.onboarding2_save_branding(primary_color_input text, secondary_color_input text, accent_color_input text, display_name_input text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare result jsonb;
begin
  result := public.onboarding_save_branding(primary_color_input, secondary_color_input, accent_color_input, display_name_input);
  update public.onboarding_progress set onboarding_v2_step = 'first_game', updated_at = now()
  where user_id = (select auth.uid()) and onboarding_v2_step is not null and completed_at is null;
  return result;
end;
$$;

-- Only V2 enforces the first-game gate. Legacy onboarding_complete remains
-- unchanged until a later activation migration after the UI is live everywhere.
create function public.onboarding2_complete()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare progress public.onboarding_progress%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Authentication is required.'; end if;
  select * into progress from public.onboarding_progress where user_id = (select auth.uid()) for update;
  if progress.completed_at is not null then return jsonb_build_object('status','already_complete','team_id',progress.team_id); end if;
  if progress.onboarding_v2_step is null then raise exception 'This is a legacy onboarding session.'; end if;
  if not exists (
    select 1 from public.team_memberships membership
    where membership.team_id = progress.team_id and membership.user_id = progress.user_id
      and membership.role_id = 'owner' and membership.status = 'active'
  ) then raise exception 'The onboarding team is not owned by this account.'; end if;
  if not progress.organization_complete or progress.organization_id is null or not progress.team_complete or progress.team_id is null or not progress.season_complete or progress.season_id is null or not progress.roster_complete then raise exception 'Organization, team, season, and roster setup must be complete.'; end if;
  if not progress.first_game_complete then raise exception 'Add your first game before finishing setup.'; end if;
  update public.onboarding_progress set review_complete = true, onboarding_v2_step = 'review', completed_at = now(), updated_at = now() where user_id = progress.user_id;
  return jsonb_build_object('status','completed','team_id',progress.team_id);
end;
$$;

revoke all on function public.onboarding2_ensure() from public, anon;
revoke all on function public.onboarding2_mark_step(text) from public, anon;
revoke all on function public.onboarding2_add_first_game(date, text, time, text, text, text) from public, anon;
revoke all on function public.onboarding2_save_branding(text, text, text, text) from public, anon;
revoke all on function public.onboarding2_complete() from public, anon;
grant execute on function public.onboarding2_ensure() to authenticated;
grant execute on function public.onboarding2_mark_step(text) to authenticated;
grant execute on function public.onboarding2_add_first_game(date, text, time, text, text, text) to authenticated;
grant execute on function public.onboarding2_save_branding(text, text, text, text) to authenticated;
grant execute on function public.onboarding2_complete() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.onboarding2_complete()', 'execute') then raise exception 'Anonymous execution remains granted for onboarding2_complete.'; end if;
end;
$$;
