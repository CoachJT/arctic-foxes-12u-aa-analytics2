-- Coach QOL write support for PuckNexus 2.0 Stage 6 (web-first).
-- Additive only: no schema rewrites, no destructive changes, no data loss.
-- Provides one atomic, idempotent, team-scoped bulk save for game stats so a
-- coach's single "Save game stats" action can never double-count or
-- half-persist a game.

-- Bulk-save every skater/goalie stat row for one game in one transaction.
-- Rows are keyed by (team_id, source_game_id, source_player_id, player_type),
-- so saving the same game twice replaces values instead of adding them again.
create or replace function public.coach_save_game_stats(
  target_team_id uuid,
  target_game_source_id text,
  skater_rows jsonb default '[]'::jsonb,
  goalie_rows jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_count int := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;
  if not public.has_team_capability(target_team_id, 'stats.edit') then
    raise exception 'You do not have stats.edit access to this team.';
  end if;
  if target_game_source_id is null or length(trim(target_game_source_id)) = 0 then
    raise exception 'A game is required before stats can be saved.';
  end if;

  -- Skaters.
  insert into public.team_game_player_stats (
    team_id, source_game_id, source_player_id, player_type,
    gp, goals, assists, shots, penalty_minutes, plus_minus, blocks,
    faceoff_wins, faceoff_losses, faceoff_attempts,
    power_play_goals, power_play_points,
    short_handed_goals, short_handed_points,
    game_winning_goals, game_tying_goals
  )
  select
    target_team_id,
    target_game_source_id,
    r.player_id,
    'skater',
    r.gp, r.g, r.a, r.shots, r.pim, r.plus_minus, r.blocks,
    r.fow, r.fol, r.fow + r.fol,
    r.ppg, r.ppp, r.shg, r.shp, r.gwg, r.gtg
  from jsonb_to_recordset(coalesce(skater_rows, '[]'::jsonb)) as r(
    player_id text, gp numeric, g numeric, a numeric, shots numeric,
    pim numeric, plus_minus numeric, blocks numeric,
    fow numeric, fol numeric,
    ppg numeric, ppp numeric, shg numeric, shp numeric, gwg numeric, gtg numeric
  )
  on conflict (team_id, source_game_id, source_player_id, player_type) do update set
    gp = excluded.gp,
    goals = excluded.goals,
    assists = excluded.assists,
    shots = excluded.shots,
    penalty_minutes = excluded.penalty_minutes,
    plus_minus = excluded.plus_minus,
    blocks = excluded.blocks,
    faceoff_wins = excluded.faceoff_wins,
    faceoff_losses = excluded.faceoff_losses,
    faceoff_attempts = excluded.faceoff_attempts,
    power_play_goals = excluded.power_play_goals,
    power_play_points = excluded.power_play_points,
    short_handed_goals = excluded.short_handed_goals,
    short_handed_points = excluded.short_handed_points,
    game_winning_goals = excluded.game_winning_goals,
    game_tying_goals = excluded.game_tying_goals,
    updated_at = now();
  get diagnostics row_count = row_count;

  -- Goalies. Saves are entered; shots against is derived (saves + GA) so
  -- coaches never enter a value the platform can compute.
  insert into public.team_game_player_stats (
    team_id, source_game_id, source_player_id, player_type,
    gp, minutes, saves, goals_against, wins, losses, ties, shutouts
  )
  select
    target_team_id,
    target_game_source_id,
    r.player_id,
    'goalie',
    r.gp, r.minutes, r.saves, r.ga, r.w, r.l, r.t, r.so
  from jsonb_to_recordset(coalesce(goalie_rows, '[]'::jsonb)) as r(
    player_id text, gp numeric, minutes numeric, saves numeric, ga numeric,
    w numeric, l numeric, t numeric, so numeric
  )
  on conflict (team_id, source_game_id, source_player_id, player_type) do update set
    gp = excluded.gp,
    minutes = excluded.minutes,
    saves = excluded.saves,
    goals_against = excluded.goals_against,
    wins = excluded.wins,
    losses = excluded.losses,
    ties = excluded.ties,
    shutouts = excluded.shutouts,
    updated_at = now();

  return jsonb_build_object(
    'team_id', target_team_id,
    'source_game_id', target_game_source_id,
    'skaters_saved', row_count
  );
end;
$$;

revoke all on function public.coach_save_game_stats(uuid, text, jsonb, jsonb) from public;
grant execute on function public.coach_save_game_stats(uuid, text, jsonb, jsonb) to authenticated;
