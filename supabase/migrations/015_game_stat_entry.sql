-- Game Stat Entry v1: authorized coach write path for skater, goalie, and
-- team-game stats. Additive only — no historical migration files are edited.
-- Existing team_games / team_game_player_stats / team_game_team_stats rows,
-- identifiers, and RLS predicates from 003_team_data_sync.sql remain intact.

alter table public.team_games
  add column if not exists season_id uuid references public.seasons(id) on delete set null;
alter table public.team_game_player_stats
  add column if not exists season_id uuid references public.seasons(id) on delete set null;
alter table public.team_game_team_stats
  add column if not exists season_id uuid references public.seasons(id) on delete set null;

-- Best-effort backfill only: associates existing synced rows with the team's
-- current default season. Historical rows with no resolvable season keep
-- season_id null and remain editable (see save_game_stats below).
update public.team_games game
set season_id = team.default_season_id
from public.teams team
where team.id = game.team_id
  and game.season_id is null
  and team.default_season_id is not null;

update public.team_game_player_stats stat
set season_id = team.default_season_id
from public.teams team
where team.id = stat.team_id
  and stat.season_id is null
  and team.default_season_id is not null;

update public.team_game_team_stats stat
set season_id = team.default_season_id
from public.teams team
where team.id = stat.team_id
  and stat.season_id is null
  and team.default_season_id is not null;

create index if not exists team_games_team_season_idx
  on public.team_games(team_id, season_id);
create index if not exists team_game_player_stats_team_season_idx
  on public.team_game_player_stats(team_id, season_id);
create index if not exists team_game_team_stats_team_season_idx
  on public.team_game_team_stats(team_id, season_id);

-- Defense in depth: even direct table writes cannot attach a game/stat row to a
-- season that does not belong to its team, regardless of the RPC below.
create or replace function public.validate_team_game_season()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.season_id is not null and not exists (
    select 1 from public.seasons season
    where season.id = new.season_id
      and season.team_id = new.team_id
  ) then
    raise exception 'The selected season does not belong to this team.';
  end if;
  return new;
end;
$$;

drop trigger if exists team_games_validate_season on public.team_games;
create trigger team_games_validate_season
before insert or update of season_id, team_id on public.team_games
for each row execute function public.validate_team_game_season();

drop trigger if exists team_game_player_stats_validate_season on public.team_game_player_stats;
create trigger team_game_player_stats_validate_season
before insert or update of season_id, team_id on public.team_game_player_stats
for each row execute function public.validate_team_game_season();

drop trigger if exists team_game_team_stats_validate_season on public.team_game_team_stats;
create trigger team_game_team_stats_validate_season
before insert or update of season_id, team_id on public.team_game_team_stats
for each row execute function public.validate_team_game_season();

-- Atomic save: skater stats, goalie stats, and team-game stats are written in a
-- single SECURITY DEFINER transaction. Any failure raises an exception, which
-- rolls back every insert/update made earlier in this call — there is no
-- partial-write path. Re-saving the same game upserts existing rows (keyed by
-- team_id + source_game_id + source_player_id + player_type, or team_id +
-- source_game_id for team stats) instead of inserting duplicates.
create or replace function public.save_game_stats(
  target_team_id uuid,
  target_season_id uuid,
  target_source_game_id text,
  skater_stats jsonb default '[]'::jsonb,
  goalie_stats jsonb default '[]'::jsonb,
  team_stats jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  skater_row jsonb;
  goalie_row jsonb;
  saved_skaters integer := 0;
  saved_goalies integer := 0;
  saved_team_stats boolean := false;
begin
  if target_team_id is null then
    raise exception 'A team is required.';
  end if;
  if target_source_game_id is null or length(trim(target_source_game_id)) = 0 then
    raise exception 'A game is required.';
  end if;

  -- Server-side authorization: re-validated here regardless of what the
  -- client claims. The caller must hold stats.edit for this team/season/plan.
  if not public.has_workspace_feature_access(target_team_id, target_season_id, 'stats.edit', 'stats') then
    raise exception 'The current workspace is not authorized to edit stats for this team and season.';
  end if;

  -- The game must belong to the caller's team, and — when the game already
  -- carries a season — to the caller's target season. Games synced before
  -- season tagging existed (season_id is null) are adopted into the caller's
  -- season below rather than rejected outright.
  if not exists (
    select 1 from public.team_games game
    where game.team_id = target_team_id
      and game.source_game_id = target_source_game_id
      and (game.season_id is null or game.season_id = target_season_id)
  ) then
    raise exception 'The selected game does not belong to the authorized team and season.';
  end if;

  update public.team_games
  set season_id = coalesce(season_id, target_season_id),
      updated_at = now()
  where team_id = target_team_id
    and source_game_id = target_source_game_id;

  for skater_row in select * from jsonb_array_elements(coalesce(skater_stats, '[]'::jsonb))
  loop
    if coalesce(skater_row ->> 'source_player_id', '') = '' then
      raise exception 'Each skater stat row requires a source_player_id.';
    end if;
    insert into public.team_game_player_stats (
      team_id, season_id, source_game_id, source_player_id, player_type,
      gp, goals, assists, shots, penalty_minutes, plus_minus, blocks,
      faceoff_wins, faceoff_losses, power_play_goals, power_play_points,
      short_handed_goals, short_handed_points, source_updated_at, updated_at
    ) values (
      target_team_id, target_season_id, target_source_game_id,
      skater_row ->> 'source_player_id', 'skater',
      (skater_row ->> 'gp')::numeric, (skater_row ->> 'goals')::numeric,
      (skater_row ->> 'assists')::numeric, (skater_row ->> 'shots')::numeric,
      (skater_row ->> 'penalty_minutes')::numeric, (skater_row ->> 'plus_minus')::numeric,
      (skater_row ->> 'blocks')::numeric, (skater_row ->> 'faceoff_wins')::numeric,
      (skater_row ->> 'faceoff_losses')::numeric, (skater_row ->> 'power_play_goals')::numeric,
      (skater_row ->> 'power_play_points')::numeric, (skater_row ->> 'short_handed_goals')::numeric,
      (skater_row ->> 'short_handed_points')::numeric, now(), now()
    )
    on conflict (team_id, source_game_id, source_player_id, player_type)
    do update set
      season_id = excluded.season_id,
      gp = excluded.gp, goals = excluded.goals, assists = excluded.assists, shots = excluded.shots,
      penalty_minutes = excluded.penalty_minutes, plus_minus = excluded.plus_minus, blocks = excluded.blocks,
      faceoff_wins = excluded.faceoff_wins, faceoff_losses = excluded.faceoff_losses,
      power_play_goals = excluded.power_play_goals, power_play_points = excluded.power_play_points,
      short_handed_goals = excluded.short_handed_goals, short_handed_points = excluded.short_handed_points,
      source_updated_at = now(), updated_at = now();
    saved_skaters := saved_skaters + 1;
  end loop;

  for goalie_row in select * from jsonb_array_elements(coalesce(goalie_stats, '[]'::jsonb))
  loop
    if coalesce(goalie_row ->> 'source_player_id', '') = '' then
      raise exception 'Each goalie stat row requires a source_player_id.';
    end if;
    insert into public.team_game_player_stats (
      team_id, season_id, source_game_id, source_player_id, player_type,
      gp, wins, losses, ties, saves, goals_against, minutes, shutouts,
      source_updated_at, updated_at
    ) values (
      target_team_id, target_season_id, target_source_game_id,
      goalie_row ->> 'source_player_id', 'goalie',
      (goalie_row ->> 'gp')::numeric, (goalie_row ->> 'wins')::numeric,
      (goalie_row ->> 'losses')::numeric, (goalie_row ->> 'ties')::numeric,
      (goalie_row ->> 'saves')::numeric, (goalie_row ->> 'goals_against')::numeric,
      (goalie_row ->> 'minutes')::numeric, (goalie_row ->> 'shutouts')::numeric,
      now(), now()
    )
    on conflict (team_id, source_game_id, source_player_id, player_type)
    do update set
      season_id = excluded.season_id,
      gp = excluded.gp, wins = excluded.wins, losses = excluded.losses, ties = excluded.ties,
      saves = excluded.saves, goals_against = excluded.goals_against, minutes = excluded.minutes,
      shutouts = excluded.shutouts, source_updated_at = now(), updated_at = now();
    saved_goalies := saved_goalies + 1;
  end loop;

  if team_stats is not null then
    insert into public.team_game_team_stats (
      team_id, season_id, source_game_id, goals_for, goals_against, shots_for, shots_against,
      source_updated_at, updated_at
    ) values (
      target_team_id, target_season_id, target_source_game_id,
      (team_stats ->> 'goals_for')::numeric, (team_stats ->> 'goals_against')::numeric,
      (team_stats ->> 'shots_for')::numeric, (team_stats ->> 'shots_against')::numeric,
      now(), now()
    )
    on conflict (team_id, source_game_id)
    do update set
      season_id = excluded.season_id,
      goals_for = excluded.goals_for, goals_against = excluded.goals_against,
      shots_for = excluded.shots_for, shots_against = excluded.shots_against,
      source_updated_at = now(), updated_at = now();
    saved_team_stats := true;
  end if;

  return jsonb_build_object(
    'source_game_id', target_source_game_id,
    'skaters_saved', saved_skaters,
    'goalies_saved', saved_goalies,
    'team_stats_saved', saved_team_stats
  );
end;
$$;

revoke all on function public.save_game_stats(uuid, uuid, text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_game_stats(uuid, uuid, text, jsonb, jsonb, jsonb) to authenticated;

revoke all on function public.validate_team_game_season() from public, anon, authenticated;

-- Runtime assertions preserve the existing security boundary and prove this
-- migration did not weaken anonymous/authenticated grants.
do $$
begin
  if has_function_privilege('anon', 'public.save_game_stats(uuid,uuid,text,jsonb,jsonb,jsonb)', 'execute') then
    raise exception 'Anonymous execution is granted for save_game_stats.';
  end if;
  if not has_function_privilege('authenticated', 'public.save_game_stats(uuid,uuid,text,jsonb,jsonb,jsonb)', 'execute') then
    raise exception 'Authenticated execution is missing for save_game_stats.';
  end if;
end;
$$;
