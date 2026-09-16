-- Game Center + Stats 2.0 Phase A corrected review artifact.
-- Local preparation only. Do not apply to Supabase without a separate
-- design/security approval, read-only production preflight, and apply window.

alter table public.team_game_team_stats
  add column if not exists shots_for_p1 integer,
  add column if not exists shots_for_p2 integer,
  add column if not exists shots_for_p3 integer,
  add column if not exists shots_for_ot integer,
  add column if not exists shots_against_p1 integer,
  add column if not exists shots_against_p2 integer,
  add column if not exists shots_against_p3 integer,
  add column if not exists shots_against_ot integer;

-- New nullable period-shot columns can be constrained immediately because this
-- migration does not backfill them. NULL means not recorded or, for OT only,
-- not applicable after OT occurrence is resolved by a future approved design.
alter table public.team_game_team_stats
  add constraint team_game_team_stats_period_shots_nonnegative_chk
  check (
    (shots_for_p1 is null or shots_for_p1 >= 0) and
    (shots_for_p2 is null or shots_for_p2 >= 0) and
    (shots_for_p3 is null or shots_for_p3 >= 0) and
    (shots_for_ot is null or shots_for_ot >= 0) and
    (shots_against_p1 is null or shots_against_p1 >= 0) and
    (shots_against_p2 is null or shots_against_p2 >= 0) and
    (shots_against_p3 is null or shots_against_p3 >= 0) and
    (shots_against_ot is null or shots_against_ot >= 0)
  );

-- Existing PP/PK columns are numeric and have legacy/direct-write paths. This
-- reviewed artifact deliberately does not add a stricter immediate table CHECK
-- for those columns until the prepared read-only preflight proves historical
-- rows and remaining write paths are compatible. The RPC below enforces the
-- stricter Phase A write contract for this new Game Center path.

create or replace function public.require_jsonb_nonnegative_integer(
  raw_value jsonb,
  field_label text
)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  raw_text text;
  parsed integer;
begin
  if raw_value is null or raw_value = 'null'::jsonb then
    return null;
  end if;

  if pg_catalog.jsonb_typeof(raw_value) not in ('number', 'string') then
    raise exception 'The value for % must be a nonnegative whole number or null.', field_label;
  end if;

  raw_text := case
    when pg_catalog.jsonb_typeof(raw_value) = 'string' then pg_catalog.btrim(raw_value #>> '{}')
    else raw_value #>> '{}'
  end;

  if raw_text is null or pg_catalog.length(raw_text) = 0 then
    return null;
  end if;

  if raw_text !~ '^[0-9]+$' then
    raise exception 'The value for % must be a nonnegative whole number or null.', field_label;
  end if;

  begin
    parsed := raw_text::integer;
  exception when others then
    raise exception 'The value for % must be a nonnegative whole number or null.', field_label;
  end;

  return parsed;
end;
$$;

revoke all on function public.require_jsonb_nonnegative_integer(jsonb, text) from public, anon, authenticated;

create or replace function public.save_game_team_stats(
  target_team_id uuid,
  target_season_id uuid,
  target_source_game_id text,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_game public.team_games%rowtype;
  selected_schedule public.team_schedule_games%rowtype;
  existing_stats public.team_game_team_stats%rowtype;
  allowed_keys text[] := array[
    'shots_for',
    'shots_against',
    'shots_for_p1',
    'shots_for_p2',
    'shots_for_p3',
    'shots_for_ot',
    'shots_against_p1',
    'shots_against_p2',
    'shots_against_p3',
    'shots_against_ot',
    'power_play_chances',
    'power_play_success',
    'penalty_kill_chances',
    'penalty_kill_success',
    'faceoff_wins',
    'faceoff_losses'
  ];
  payload_key text;
  new_shots_for_p1 integer;
  new_shots_for_p2 integer;
  new_shots_for_p3 integer;
  new_shots_for_ot integer;
  new_shots_against_p1 integer;
  new_shots_against_p2 integer;
  new_shots_against_p3 integer;
  new_shots_against_ot integer;
  new_shots_for numeric;
  new_shots_against numeric;
  payload_shots_for integer;
  payload_shots_against integer;
  new_power_play_chances numeric;
  new_power_play_success numeric;
  new_penalty_kill_chances numeric;
  new_penalty_kill_success numeric;
  new_faceoff_wins numeric;
  new_faceoff_losses numeric;
  saved_row public.team_game_team_stats%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;

  if target_team_id is null or target_season_id is null then
    raise exception 'A team and season are required.';
  end if;

  if length(pg_catalog.btrim(pg_catalog.coalesce(target_source_game_id, ''))) = 0 then
    raise exception 'A game is required.';
  end if;

  if payload is null or pg_catalog.jsonb_typeof(payload) <> 'object' then
    raise exception 'Team stats payload must be a JSON object.';
  end if;

  if payload = '{}'::jsonb then
    raise exception 'Team stats payload must include at least one editable field.';
  end if;

  if payload ?| array[
    'goals_for',
    'goals_against',
    'goals_for_p1',
    'goals_for_p2',
    'goals_for_p3',
    'goals_for_ot',
    'goals_against_p1',
    'goals_against_p2',
    'goals_against_p3',
    'goals_against_ot'
  ] then
    raise exception 'Final score and period goals are managed by existing score/stat paths; team stats may not write goal fields.';
  end if;

  for payload_key in select key from pg_catalog.jsonb_object_keys(payload) as keys(key)
  loop
    if not payload_key = any (allowed_keys) then
      raise exception 'Unsupported team stat field: %.', payload_key;
    end if;
  end loop;

  if public.has_workspace_feature_access(target_team_id, target_season_id, 'stats.edit', 'stats') is not true then
    raise exception 'The current workspace is not authorized to edit team stats for this team and season.';
  end if;

  select * into selected_game
  from public.team_games game
  where game.team_id = target_team_id
    and game.source_game_id = target_source_game_id
  for update;

  if not found then
    raise exception 'The selected game does not belong to this team.';
  end if;

  if selected_game.date > current_date then
    raise exception 'The selected game is not eligible for team stat entry.';
  end if;

  if selected_game.season_id is not null and selected_game.season_id <> target_season_id then
    raise exception 'The selected game already belongs to a different season.';
  end if;

  select * into selected_schedule
  from public.team_schedule_games schedule
  where schedule.team_id = target_team_id
    and schedule.linked_game_source_id = target_source_game_id
  for update;

  if found then
    if selected_schedule.season_id is not null and selected_schedule.season_id <> target_season_id then
      raise exception 'The linked schedule entry belongs to a different season.';
    end if;
  end if;

  select * into existing_stats
  from public.team_game_team_stats stats
  where stats.team_id = target_team_id
    and stats.source_game_id = target_source_game_id
  for update;

  if found then
    if existing_stats.season_id is null then
      raise exception 'Existing team stats have no season; resolve the legacy season before saving team stats.';
    end if;
    if existing_stats.season_id <> target_season_id then
      raise exception 'Existing team stats belong to a different season.';
    end if;
  end if;

  if selected_game.season_id is null then
    if found then
      raise exception 'The game has no season while stats already exist; resolve the legacy season before saving team stats.';
    end if;
    update public.team_games
    set season_id = target_season_id,
        updated_at = now()
    where id = selected_game.id
      and season_id is null;
    if not found then
      raise exception 'The game season changed concurrently. Refresh and try again.';
    end if;
  end if;

  if selected_schedule.id is not null and selected_schedule.season_id is null then
    update public.team_schedule_games
    set season_id = target_season_id,
        updated_at = now()
    where id = selected_schedule.id
      and season_id is null;
    if not found then
      raise exception 'The schedule season changed concurrently. Refresh and try again.';
    end if;
  end if;

  new_shots_for_p1 := case when payload ? 'shots_for_p1' then public.require_jsonb_nonnegative_integer(payload -> 'shots_for_p1', 'shots_for_p1') else existing_stats.shots_for_p1 end;
  new_shots_for_p2 := case when payload ? 'shots_for_p2' then public.require_jsonb_nonnegative_integer(payload -> 'shots_for_p2', 'shots_for_p2') else existing_stats.shots_for_p2 end;
  new_shots_for_p3 := case when payload ? 'shots_for_p3' then public.require_jsonb_nonnegative_integer(payload -> 'shots_for_p3', 'shots_for_p3') else existing_stats.shots_for_p3 end;
  new_shots_for_ot := case when payload ? 'shots_for_ot' then public.require_jsonb_nonnegative_integer(payload -> 'shots_for_ot', 'shots_for_ot') else existing_stats.shots_for_ot end;
  new_shots_against_p1 := case when payload ? 'shots_against_p1' then public.require_jsonb_nonnegative_integer(payload -> 'shots_against_p1', 'shots_against_p1') else existing_stats.shots_against_p1 end;
  new_shots_against_p2 := case when payload ? 'shots_against_p2' then public.require_jsonb_nonnegative_integer(payload -> 'shots_against_p2', 'shots_against_p2') else existing_stats.shots_against_p2 end;
  new_shots_against_p3 := case when payload ? 'shots_against_p3' then public.require_jsonb_nonnegative_integer(payload -> 'shots_against_p3', 'shots_against_p3') else existing_stats.shots_against_p3 end;
  new_shots_against_ot := case when payload ? 'shots_against_ot' then public.require_jsonb_nonnegative_integer(payload -> 'shots_against_ot', 'shots_against_ot') else existing_stats.shots_against_ot end;

  payload_shots_for := case when payload ? 'shots_for' then public.require_jsonb_nonnegative_integer(payload -> 'shots_for', 'shots_for') else null end;
  payload_shots_against := case when payload ? 'shots_against' then public.require_jsonb_nonnegative_integer(payload -> 'shots_against', 'shots_against') else null end;

  -- OT occurrence has no current authoritative field in team_games or
  -- team_schedule_games. Until that design gap is resolved, OT periods are not
  -- counted toward derived totals. If OT values are supplied, legacy total
  -- inputs must match regulation totals only; the OT fields are stored but do
  -- not make an unknown-applicability total authoritative.
  if new_shots_for_p1 is not null and new_shots_for_p2 is not null and new_shots_for_p3 is not null then
    new_shots_for := new_shots_for_p1 + new_shots_for_p2 + new_shots_for_p3;
  else
    new_shots_for := existing_stats.shots_for;
  end if;

  if new_shots_against_p1 is not null and new_shots_against_p2 is not null and new_shots_against_p3 is not null then
    new_shots_against := new_shots_against_p1 + new_shots_against_p2 + new_shots_against_p3;
  else
    new_shots_against := existing_stats.shots_against;
  end if;

  if payload_shots_for is not null and new_shots_for is not null and payload_shots_for <> new_shots_for then
    raise exception 'shots_for must match the server-derived applicable period total.';
  end if;
  if payload_shots_against is not null and new_shots_against is not null and payload_shots_against <> new_shots_against then
    raise exception 'shots_against must match the server-derived applicable period total.';
  end if;
  if payload_shots_for is not null and new_shots_for is null then
    new_shots_for := payload_shots_for;
  end if;
  if payload_shots_against is not null and new_shots_against is null then
    new_shots_against := payload_shots_against;
  end if;

  new_power_play_chances := case when payload ? 'power_play_chances' then public.require_jsonb_nonnegative_integer(payload -> 'power_play_chances', 'power_play_chances') else existing_stats.power_play_chances end;
  new_power_play_success := case when payload ? 'power_play_success' then public.require_jsonb_nonnegative_integer(payload -> 'power_play_success', 'power_play_success') else existing_stats.power_play_success end;
  new_penalty_kill_chances := case when payload ? 'penalty_kill_chances' then public.require_jsonb_nonnegative_integer(payload -> 'penalty_kill_chances', 'penalty_kill_chances') else existing_stats.penalty_kill_chances end;
  new_penalty_kill_success := case when payload ? 'penalty_kill_success' then public.require_jsonb_nonnegative_integer(payload -> 'penalty_kill_success', 'penalty_kill_success') else existing_stats.penalty_kill_success end;

  if (new_power_play_chances is null) <> (new_power_play_success is null) then
    raise exception 'Power play chances and successes must both be null or both be recorded.';
  end if;
  if new_power_play_success is not null and new_power_play_success > new_power_play_chances then
    raise exception 'Power play success cannot exceed power play opportunities.';
  end if;
  if (new_penalty_kill_chances is null) <> (new_penalty_kill_success is null) then
    raise exception 'Penalty kill chances and successes must both be null or both be recorded.';
  end if;
  if new_penalty_kill_success is not null and new_penalty_kill_success > new_penalty_kill_chances then
    raise exception 'Penalty kill success cannot exceed times shorthanded.';
  end if;

  new_faceoff_wins := case when payload ? 'faceoff_wins' then public.require_jsonb_nonnegative_integer(payload -> 'faceoff_wins', 'faceoff_wins') else existing_stats.faceoff_wins end;
  new_faceoff_losses := case when payload ? 'faceoff_losses' then public.require_jsonb_nonnegative_integer(payload -> 'faceoff_losses', 'faceoff_losses') else existing_stats.faceoff_losses end;

  insert into public.team_game_team_stats (
    team_id,
    season_id,
    source_game_id,
    shots_for,
    shots_against,
    shots_for_p1,
    shots_for_p2,
    shots_for_p3,
    shots_for_ot,
    shots_against_p1,
    shots_against_p2,
    shots_against_p3,
    shots_against_ot,
    power_play_chances,
    power_play_success,
    penalty_kill_chances,
    penalty_kill_success,
    faceoff_wins,
    faceoff_losses,
    source_updated_at,
    updated_at
  ) values (
    target_team_id,
    target_season_id,
    target_source_game_id,
    new_shots_for,
    new_shots_against,
    new_shots_for_p1,
    new_shots_for_p2,
    new_shots_for_p3,
    new_shots_for_ot,
    new_shots_against_p1,
    new_shots_against_p2,
    new_shots_against_p3,
    new_shots_against_ot,
    new_power_play_chances,
    new_power_play_success,
    new_penalty_kill_chances,
    new_penalty_kill_success,
    new_faceoff_wins,
    new_faceoff_losses,
    now(),
    now()
  )
  on conflict (team_id, source_game_id) do update set
    shots_for = excluded.shots_for,
    shots_against = excluded.shots_against,
    shots_for_p1 = excluded.shots_for_p1,
    shots_for_p2 = excluded.shots_for_p2,
    shots_for_p3 = excluded.shots_for_p3,
    shots_for_ot = excluded.shots_for_ot,
    shots_against_p1 = excluded.shots_against_p1,
    shots_against_p2 = excluded.shots_against_p2,
    shots_against_p3 = excluded.shots_against_p3,
    shots_against_ot = excluded.shots_against_ot,
    power_play_chances = excluded.power_play_chances,
    power_play_success = excluded.power_play_success,
    penalty_kill_chances = excluded.penalty_kill_chances,
    penalty_kill_success = excluded.penalty_kill_success,
    faceoff_wins = excluded.faceoff_wins,
    faceoff_losses = excluded.faceoff_losses,
    source_updated_at = now(),
    updated_at = now()
  where public.team_game_team_stats.team_id = target_team_id
    and public.team_game_team_stats.source_game_id = target_source_game_id
    and public.team_game_team_stats.season_id = target_season_id
  returning * into saved_row;

  if saved_row.id is null then
    raise exception 'Team stats changed concurrently or belong to a different season. Refresh and try again.';
  end if;

  return pg_catalog.jsonb_build_object(
    'source_game_id', target_source_game_id,
    'team_id', target_team_id,
    'season_id', target_season_id,
    'team_stats_saved', true,
    'shots_for', saved_row.shots_for,
    'shots_against', saved_row.shots_against,
    'ot_applicability', 'unresolved'
  );
end;
$$;

revoke all on function public.save_game_team_stats(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.save_game_team_stats(uuid, uuid, text, jsonb) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.save_game_team_stats(uuid,uuid,text,jsonb)', 'execute') then
    raise exception 'Anonymous execution is granted for save_game_team_stats.';
  end if;
  if not has_function_privilege('authenticated', 'public.save_game_team_stats(uuid,uuid,text,jsonb)', 'execute') then
    raise exception 'Authenticated execution is missing for save_game_team_stats.';
  end if;
end;
$$;
