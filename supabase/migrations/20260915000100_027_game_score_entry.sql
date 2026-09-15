-- Quick Score v1: a narrow, atomic score-only write path for completed games.
-- It preserves all non-score team statistics and recomputes the selected
-- season record in the same transaction.

create or replace function public.save_game_score(
  target_team_id uuid,
  target_season_id uuid,
  target_source_game_id text,
  target_goals_for integer,
  target_goals_against integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_season_key text;
begin
  if target_team_id is null or target_season_id is null then
    raise exception 'A team and season are required.';
  end if;
  if length(trim(coalesce(target_source_game_id, ''))) = 0 then
    raise exception 'A game is required.';
  end if;
  if target_goals_for is null or target_goals_against is null
     or target_goals_for < 0 or target_goals_against < 0 then
    raise exception 'Scores must be non-negative whole numbers.';
  end if;
  if not public.has_workspace_feature_access(target_team_id, target_season_id, 'stats.edit', 'stats') then
    raise exception 'The current workspace is not authorized to edit scores for this team and season.';
  end if;

  select season.season_key into selected_season_key
  from public.seasons season
  where season.id = target_season_id and season.team_id = target_team_id;
  if selected_season_key is null then
    raise exception 'The selected season does not belong to this team.';
  end if;

  if not exists (
    select 1 from public.team_games game
    where game.team_id = target_team_id
      and game.source_game_id = target_source_game_id
      and (game.season_id is null or game.season_id = target_season_id)
      and game.date <= current_date
  ) then
    raise exception 'The selected game does not belong to this team and season, or is not completed yet.';
  end if;

  update public.team_games
  set season_id = coalesce(season_id, target_season_id), updated_at = now()
  where team_id = target_team_id and source_game_id = target_source_game_id;

  insert into public.team_game_team_stats (
    team_id, season_id, source_game_id, goals_for, goals_against,
    source_updated_at, updated_at
  ) values (
    target_team_id, target_season_id, target_source_game_id,
    target_goals_for, target_goals_against, now(), now()
  )
  on conflict (team_id, source_game_id) do update set
    season_id = excluded.season_id,
    goals_for = excluded.goals_for,
    goals_against = excluded.goals_against,
    source_updated_at = now(),
    updated_at = now();

  insert into public.team_season_records (
    team_id, season_key, games_played, wins, losses, ties,
    goals_for, goals_against, source_game_count, computed_at
  )
  select target_team_id, selected_season_key,
    count(*)::integer,
    count(*) filter (where stats.goals_for > stats.goals_against)::integer,
    count(*) filter (where stats.goals_for < stats.goals_against)::integer,
    count(*) filter (where stats.goals_for = stats.goals_against)::integer,
    coalesce(sum(stats.goals_for), 0)::integer,
    coalesce(sum(stats.goals_against), 0)::integer,
    count(*)::integer,
    now()
  from public.team_game_team_stats stats
  join public.team_games game
    on game.team_id = stats.team_id and game.source_game_id = stats.source_game_id
  where stats.team_id = target_team_id
    and game.season_id = target_season_id
    and stats.goals_for is not null
    and stats.goals_against is not null
  on conflict (team_id, season_key) do update set
    games_played = excluded.games_played,
    wins = excluded.wins,
    losses = excluded.losses,
    ties = excluded.ties,
    goals_for = excluded.goals_for,
    goals_against = excluded.goals_against,
    source_game_count = excluded.source_game_count,
    computed_at = excluded.computed_at;

  return jsonb_build_object(
    'source_game_id', target_source_game_id,
    'goals_for', target_goals_for,
    'goals_against', target_goals_against
  );
end;
$$;

revoke all on function public.save_game_score(uuid, uuid, text, integer, integer) from public, anon;
grant execute on function public.save_game_score(uuid, uuid, text, integer, integer) to authenticated;
