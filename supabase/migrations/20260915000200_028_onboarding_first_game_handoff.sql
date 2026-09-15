-- Onboarding 2.0 final handoff: first game, first result, then dashboard.
-- Existing completed onboarding rows remain completed. Incomplete rows that
-- had reached review resume at the new first-game step.

alter table public.onboarding_progress
  add column if not exists first_game_complete boolean not null default false,
  add column if not exists first_stats_complete boolean not null default false;

alter table public.onboarding_progress
  drop constraint if exists onboarding_progress_current_step_check;

alter table public.onboarding_progress
  add constraint onboarding_progress_current_step_check
  check (current_step in (
    'organization', 'team', 'season', 'roster', 'staff', 'branding',
    'first_game', 'first_stats', 'review'
  ));

update public.onboarding_progress
set current_step = 'first_game', updated_at = now()
where completed_at is null and current_step = 'review';

-- A confirmed self-service account needs both a profile and progress row
-- before the destination resolver can route it into setup. Profile metadata is
-- display-only; no authorization decision relies on user-editable metadata.
create or replace function public.onboarding_ensure()
returns public.onboarding_progress
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := (select auth.uid());
  progress public.onboarding_progress%rowtype;
  profile_name text;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  profile_name := coalesce(
    nullif(trim(auth.jwt() -> 'user_metadata' ->> 'display_name'), ''),
    nullif(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1), ''),
    'PuckNexus Coach'
  );
  insert into public.profiles (id, display_name)
  values (caller_id, left(profile_name, 120))
  on conflict (id) do nothing;

  select * into progress from public.onboarding_progress where user_id = caller_id;
  if found then return progress; end if;

  insert into public.onboarding_progress (user_id)
  values (caller_id)
  on conflict (user_id) do nothing
  returning * into progress;
  if not found then
    select * into progress from public.onboarding_progress where user_id = caller_id;
  end if;
  return progress;
end;
$$;

create or replace function public.onboarding_add_first_game(
  game_date date,
  opponent_name text,
  game_time time default null,
  game_home_away text default 'Home',
  game_type_name text default 'League',
  game_location text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := (select auth.uid());
  progress public.onboarding_progress%rowtype;
  schedule_row public.team_schedule_games%rowtype;
  source_id text;
  linked_id text;
begin
  if caller_id is null then
    raise exception 'Authentication is required.';
  end if;
  if game_date is null then
    raise exception 'Choose the game date.';
  end if;
  if opponent_name is null or length(trim(opponent_name)) = 0
     or length(trim(opponent_name)) > 120 then
    raise exception 'Enter a valid opponent.';
  end if;
  if game_home_away not in ('Home', 'Away') then
    raise exception 'Home / Away must be Home or Away.';
  end if;
  if game_type_name not in ('League', 'Exhibition', 'Tournament', 'Playoff') then
    raise exception 'Choose a supported game type.';
  end if;

  perform public.onboarding_ensure();
  select * into progress
  from public.onboarding_progress
  where user_id = caller_id
  for update;

  if progress.completed_at is not null then
    raise exception 'Onboarding is already complete.';
  end if;
  if progress.team_id is null or progress.season_id is null then
    raise exception 'Create your team and season before adding a game.';
  end if;
  if not exists (
    select 1 from public.team_memberships membership
    where membership.team_id = progress.team_id
      and membership.user_id = caller_id
      and membership.role_id = 'owner'
      and membership.status = 'active'
  ) then
    raise exception 'The onboarding team is not owned by this account.';
  end if;

  source_id := 'onboarding-' || caller_id::text || '-' || progress.season_id::text;
  insert into public.team_schedule_games (
    team_id, source_schedule_id, season_id, date, time, opponent,
    home_away, game_type, location, notes, source_created_at, source_updated_at
  ) values (
    progress.team_id, source_id, progress.season_id, game_date, game_time,
    trim(opponent_name), game_home_away, game_type_name,
    trim(coalesce(game_location, '')), '', now(), now()
  )
  on conflict (team_id, source_schedule_id) do update set
    season_id = excluded.season_id,
    date = excluded.date,
    time = excluded.time,
    opponent = excluded.opponent,
    home_away = excluded.home_away,
    game_type = excluded.game_type,
    location = excluded.location,
    source_updated_at = now(),
    updated_at = now()
  returning * into schedule_row;

  -- Reuse the canonical transactional edit path so a retry that changes the
  -- date or opponent also updates an already-linked Game Center shell.
  perform public.save_schedule_game(
    schedule_row.id, game_date, trim(opponent_name), game_time,
    game_home_away, game_type_name, trim(coalesce(game_location, '')), '',
    progress.season_id
  );
  linked_id := public.ensure_schedule_game_shell(schedule_row.id);

  update public.onboarding_progress
  set first_game_complete = true,
      current_step = 'first_stats',
      updated_at = now()
  where user_id = caller_id;

  return jsonb_build_object(
    'schedule_id', schedule_row.id,
    'source_game_id', linked_id,
    'date', schedule_row.date,
    'opponent', schedule_row.opponent
  );
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
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if step not in ('roster', 'staff', 'branding', 'first_game', 'first_stats', 'review') then
    raise exception 'Unsupported onboarding step.';
  end if;

  perform public.onboarding_ensure();
  select * into progress from public.onboarding_progress
  where user_id = caller_id for update;

  if progress.completed_at is not null then raise exception 'Onboarding is already complete.'; end if;
  if progress.team_id is null or progress.season_id is null then
    raise exception 'Team and season setup are incomplete.';
  end if;
  if not exists (
    select 1 from public.team_memberships membership
    where membership.team_id = progress.team_id
      and membership.user_id = caller_id
      and membership.role_id = 'owner'
      and membership.status = 'active'
  ) then
    raise exception 'The onboarding team is not owned by this account.';
  end if;

  if step = 'roster' then
    if not exists (
      select 1 from public.team_roster_players player
      where player.team_id = progress.team_id and player.status = 'active'
    ) then
      raise exception 'Add at least one active roster player before continuing.';
    end if;
    update public.onboarding_progress set roster_complete = true,
      current_step = 'staff', updated_at = now() where user_id = caller_id;
    next_step := 'staff';
  elsif step = 'staff' then
    update public.onboarding_progress set staff_complete = true,
      current_step = 'branding', updated_at = now() where user_id = caller_id;
    next_step := 'branding';
  elsif step = 'branding' then
    update public.onboarding_progress set branding_complete = true,
      current_step = 'first_game', updated_at = now() where user_id = caller_id;
    next_step := 'first_game';
  elsif step = 'first_game' then
    if not exists (
      select 1 from public.team_schedule_games game
      where game.team_id = progress.team_id and game.season_id = progress.season_id
    ) then
      raise exception 'Add your first game before continuing.';
    end if;
    update public.onboarding_progress set first_game_complete = true,
      current_step = 'first_stats', updated_at = now() where user_id = caller_id;
    next_step := 'first_stats';
  elsif step = 'first_stats' then
    update public.onboarding_progress
    set first_stats_complete = exists (
          select 1
          from public.team_schedule_games schedule
          join public.team_game_team_stats stats
            on stats.team_id = schedule.team_id
           and stats.source_game_id = schedule.linked_game_source_id
          where schedule.team_id = progress.team_id
            and schedule.season_id = progress.season_id
        ),
        current_step = 'review', updated_at = now()
    where user_id = caller_id;
    next_step := 'review';
  else
    update public.onboarding_progress set review_complete = true,
      current_step = 'review', updated_at = now() where user_id = caller_id;
    next_step := 'review';
  end if;

  return jsonb_build_object('next', next_step);
end;
$$;

-- Branding now hands off to the first-game step rather than jumping to review.
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
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  if coalesce(primary_color_input, '') !~ '^#[0-9a-fA-F]{6}$'
     or coalesce(secondary_color_input, '') !~ '^#[0-9a-fA-F]{6}$'
     or coalesce(accent_color_input, '') !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'Colors must be hex values like #d71920.';
  end if;

  perform public.onboarding_ensure();
  select * into progress from public.onboarding_progress
  where user_id = caller_id for update;
  if progress.completed_at is not null then raise exception 'Onboarding is already complete.'; end if;
  if progress.team_id is null or not progress.team_complete then
    raise exception 'Create your team before setting branding.';
  end if;
  if not exists (
    select 1 from public.team_memberships membership
    where membership.team_id = progress.team_id
      and membership.user_id = caller_id
      and membership.role_id = 'owner'
      and membership.status = 'active'
  ) then
    raise exception 'The onboarding team is not owned by this account.';
  end if;

  select coalesce(nullif(trim(display_name_input), ''), team.name)
  into resolved_display_name from public.teams team where team.id = progress.team_id;
  if resolved_display_name is null or length(resolved_display_name) > 120 then
    raise exception 'A valid team display name is required.';
  end if;
  resolved_short_name := upper(left(regexp_replace(resolved_display_name, '[^A-Za-z0-9]', '', 'g'), 12));
  if resolved_short_name = '' then resolved_short_name := 'TEAM'; end if;

  update public.team_branding
  set display_name = resolved_display_name,
      short_name = resolved_short_name,
      primary_color = upper(primary_color_input),
      secondary_color = upper(secondary_color_input),
      accent_color = upper(accent_color_input),
      updated_by = caller_id, updated_at = now()
  where team_id = progress.team_id;
  if not found then raise exception 'The onboarding team branding record is missing.'; end if;

  update public.onboarding_progress
  set branding_complete = true, current_step = 'first_game', updated_at = now()
  where user_id = caller_id;
  return jsonb_build_object('team_id', progress.team_id, 'display_name', resolved_display_name);
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
  result_entered boolean;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  perform public.onboarding_ensure();
  select * into progress from public.onboarding_progress
  where user_id = caller_id for update;
  if progress.completed_at is not null then
    return jsonb_build_object('status', 'already_complete', 'team_id', progress.team_id);
  end if;
  if not progress.organization_complete or progress.organization_id is null
     or not progress.team_complete or progress.team_id is null
     or not progress.season_complete or progress.season_id is null then
    raise exception 'Organization, team, and season setup must be complete.';
  end if;
  if not exists (
    select 1 from public.teams team
    join public.seasons season on season.id = progress.season_id
    join public.organization_memberships om on om.organization_id = team.organization_id
    join public.team_memberships tm on tm.team_id = team.id
    where team.id = progress.team_id
      and team.organization_id = progress.organization_id
      and season.team_id = team.id
      and om.user_id = caller_id and om.role_id = 'org_owner' and om.status = 'active'
      and tm.user_id = caller_id and tm.role_id = 'owner' and tm.status = 'active'
  ) then
    raise exception 'The onboarding workspace is not owned by this account.';
  end if;
  if not exists (
    select 1 from public.team_roster_players player
    where player.team_id = progress.team_id and player.status = 'active'
  ) then
    raise exception 'Add at least one active roster player before finishing setup.';
  end if;
  if not exists (
    select 1 from public.team_schedule_games game
    where game.team_id = progress.team_id and game.season_id = progress.season_id
  ) then
    raise exception 'Add your first game before finishing setup.';
  end if;

  select exists (
    select 1
    from public.team_schedule_games schedule
    join public.team_game_team_stats stats
      on stats.team_id = schedule.team_id
     and stats.source_game_id = schedule.linked_game_source_id
    where schedule.team_id = progress.team_id
      and schedule.season_id = progress.season_id
  ) into result_entered;

  update public.onboarding_progress
  set roster_complete = true, first_game_complete = true,
      first_stats_complete = result_entered, review_complete = true,
      current_step = 'review', completed_at = now(), updated_at = now()
  where user_id = caller_id;
  return jsonb_build_object('status', 'completed', 'team_id', progress.team_id);
end;
$$;

revoke all on function public.onboarding_add_first_game(date, text, time, text, text, text) from public, anon;
revoke all on function public.onboarding_ensure() from public, anon;
revoke all on function public.onboarding_mark_step(text) from public, anon;
revoke all on function public.onboarding_save_branding(text, text, text, text) from public, anon;
revoke all on function public.onboarding_complete() from public, anon;
grant execute on function public.onboarding_add_first_game(date, text, time, text, text, text) to authenticated;
grant execute on function public.onboarding_ensure() to authenticated;
grant execute on function public.onboarding_mark_step(text) to authenticated;
grant execute on function public.onboarding_save_branding(text, text, text, text) to authenticated;
grant execute on function public.onboarding_complete() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.onboarding_add_first_game(date,text,time,text,text,text)', 'execute') then
    raise exception 'Anonymous execution remains granted for onboarding_add_first_game.';
  end if;
end;
$$;
