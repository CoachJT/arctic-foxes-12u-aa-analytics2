-- PuckNexus Impact, MVP, awards, feedback, review, and audit contract v1.
-- Additive only. Migration 017 is the current authoritative predecessor.
-- Migration 018 is reserved by the parallel First Coach Onboarding branch.
-- Rollback implication: this migration owns only the new analytics contract
-- objects below; reverting it should drop those 019-created tables/functions
-- and their generated analytics records, never edit historical migrations or
-- canonical game-stat tables from migration 016.

create table public.team_game_impact_results (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  source_game_id text not null,
  source_player_id text not null,
  player_type text not null check (player_type in ('skater', 'goalie')),
  position text not null check (position in ('forward', 'defense', 'goalie')),
  impact_score numeric not null check (impact_score between 0 and 100),
  ranking_score numeric not null check (ranking_score between 0 and 100),
  rank integer not null check (rank > 0),
  model_version text not null default 'pnx-impact-v1',
  contract_version text not null default '1',
  inputs jsonb not null default '{}'::jsonb check (jsonb_typeof(inputs) = 'object'),
  breakdown jsonb not null default '{}'::jsonb check (jsonb_typeof(breakdown) = 'object'),
  computed_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, season_id, source_game_id, source_player_id, model_version)
);

create index team_game_impact_results_scope_idx
  on public.team_game_impact_results(team_id, season_id, source_game_id, rank);
create index team_game_impact_results_player_idx
  on public.team_game_impact_results(team_id, season_id, source_player_id, computed_at desc);

create table public.team_player_trend_results (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  source_game_id text,
  source_player_id text not null,
  direction text not null check (direction in ('improving', 'stable', 'declining', 'insufficient_data')),
  sample_size integer not null check (sample_size >= 0),
  slope numeric not null,
  delta numeric not null,
  average numeric not null,
  first_value numeric,
  latest_value numeric,
  window_starts_at timestamptz,
  window_ends_at timestamptz not null,
  model_version text not null default 'trend-v1',
  contract_version text not null default '1',
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, season_id, source_player_id, model_version, window_ends_at),
  check (window_starts_at is null or window_ends_at >= window_starts_at)
);

create index team_player_trend_results_scope_idx
  on public.team_player_trend_results(team_id, season_id, source_player_id, window_ends_at desc);

create table public.team_game_mvp_results (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  source_game_id text not null,
  source_player_id text not null,
  predicted_source_player_id text not null,
  position text not null check (position in ('forward', 'defense', 'goalie')),
  impact_score numeric not null check (impact_score between 0 and 100),
  breakdown jsonb not null default '{}'::jsonb check (jsonb_typeof(breakdown) = 'object'),
  tie_candidate_ids text[] not null default '{}',
  calculated_at timestamptz not null,
  selection_type text not null default 'automatic'
    check (selection_type in ('automatic', 'confirmed', 'override')),
  is_tie boolean not null default false,
  model_version text not null default 'pnx-impact-v1',
  contract_version text not null default '1',
  rationale text not null default '' check (length(rationale) <= 4000),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, season_id, source_game_id)
);

create index team_game_mvp_results_scope_idx
  on public.team_game_mvp_results(team_id, season_id, source_game_id);

create table public.team_season_awards (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  source_game_id text not null default '',
  source_player_id text,
  award_scope text not null check (award_scope in ('player', 'goalie', 'team')),
  subject_key text not null,
  award_key text not null check (award_key ~ '^[A-Z0-9]+(?:_[A-Z0-9]+)*$'),
  metric_name text not null,
  metric_value numeric not null,
  rank integer not null default 1 check (rank > 0),
  is_tie boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'final', 'revoked')),
  rule_version text not null default 'pnx-awards-v1',
  contract_version text not null default '1',
  rationale text not null default '' check (length(rationale) <= 4000),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, season_id, source_game_id, award_key, award_scope, subject_key),
  check (
    (award_scope = 'team' and source_player_id is null and subject_key = 'team')
    or (award_scope in ('player', 'goalie') and source_player_id is not null and subject_key = source_player_id)
  )
);

create index team_season_awards_scope_idx
  on public.team_season_awards(team_id, season_id, status, award_key);

create table public.team_player_feedback (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  source_game_id text not null,
  source_player_id text not null,
  mvp_result_id uuid not null references public.team_game_mvp_results(id) on delete restrict,
  coach_nominee_player_id text,
  feedback_type text not null check (feedback_type in ('agreement', 'review')),
  reason_code text check (reason_code in (
    'offensive_impact', 'defensive_impact', 'goaltending', 'special_teams',
    'key_moments', 'statistics_incomplete', 'stats_limited', 'other'
  )),
  severity text not null default 'review' check (severity in ('review', 'obvious_miss')),
  comment text not null default '' check (length(comment) <= 4000),
  review_state text not null default 'pending'
    check (review_state in ('pending', 'pnx_correct', 'overridden', 'model_review')),
  original_prediction jsonb not null check (
    jsonb_typeof(original_prediction) = 'object'
    and original_prediction ?& array['source_player_id', 'impact_score', 'model_version']
  ),
  check (
    (feedback_type = 'agreement' and reason_code is null and severity = 'review')
    or (feedback_type = 'review' and reason_code is not null)
  ),
  contract_version text not null default '1',
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index team_player_feedback_scope_idx
  on public.team_player_feedback(team_id, season_id, review_state, created_at);

create table public.team_analytics_reviews (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  source_game_id text not null,
  feedback_id uuid not null references public.team_player_feedback(id) on delete restrict,
  review_state text not null check (review_state in ('pnx_correct', 'overridden', 'model_review')),
  override_player_id text,
  model_review_flag boolean not null default false,
  rationale text not null default '' check (length(rationale) <= 4000),
  original_prediction jsonb not null check (
    jsonb_typeof(original_prediction) = 'object'
    and original_prediction ?& array['source_player_id', 'impact_score', 'model_version']
  ),
  reviewed_at timestamptz not null default now(),
  reviewed_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  contract_version text not null default '1',
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (feedback_id),
  check ((review_state = 'overridden') = (override_player_id is not null))
);

create index team_analytics_reviews_scope_idx
  on public.team_analytics_reviews(team_id, season_id, review_state, reviewed_at);

create table public.team_analytics_audit_log (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  source_game_id text,
  source_player_id text,
  actor_id uuid references auth.users(id) on delete set null default auth.uid(),
  action text not null check (length(trim(action)) > 0),
  resource_type text not null check (length(trim(resource_type)) > 0),
  resource_id text,
  correlation_id uuid not null default gen_random_uuid(),
  idempotency_key text,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  contract_version text not null default '1',
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (before_state is null or jsonb_typeof(before_state) = 'object'),
  check (after_state is null or jsonb_typeof(after_state) = 'object')
);

create index team_analytics_audit_log_scope_idx
  on public.team_analytics_audit_log(team_id, season_id, created_at desc);
create index team_analytics_audit_log_correlation_idx
  on public.team_analytics_audit_log(correlation_id);
create unique index team_analytics_audit_log_idempotency_idx
  on public.team_analytics_audit_log(team_id, season_id, action, idempotency_key)
  where idempotency_key is not null;

create or replace function public.validate_pucknexus_analytics_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and (new.team_id <> old.team_id or new.season_id <> old.season_id) then
    raise exception 'Analytics records cannot be moved between tenant scopes.';
  end if;

  if not exists (
    select 1
    from public.seasons season
    where season.id = new.season_id
      and season.team_id = new.team_id
  ) then
    raise exception 'Analytics season must belong to its team.';
  end if;

  if new.source_game_id is not null and new.source_game_id <> '' and not exists (
    select 1
    from public.team_games game
    where game.team_id = new.team_id
      and game.source_game_id = new.source_game_id
  ) then
    raise exception 'Analytics game must belong to its team.';
  end if;

  if new.source_player_id is not null and not exists (
    select 1
    from public.team_roster_players player
    where player.team_id = new.team_id
      and player.source_player_id = new.source_player_id
  ) then
    raise exception 'Analytics player must belong to its team.';
  end if;

  if nullif(to_jsonb(new)->>'predicted_source_player_id', '') is not null and not exists (
    select 1 from public.team_roster_players player
    where player.team_id = new.team_id
      and player.source_player_id = to_jsonb(new)->>'predicted_source_player_id'
  ) then
    raise exception 'Predicted analytics player must belong to its team.';
  end if;

  if nullif(to_jsonb(new)->>'coach_nominee_player_id', '') is not null and not exists (
    select 1 from public.team_roster_players player
    where player.team_id = new.team_id
      and player.source_player_id = to_jsonb(new)->>'coach_nominee_player_id'
  ) then
    raise exception 'Coach nominee must belong to the analytics team.';
  end if;

  if nullif(to_jsonb(new)->>'override_player_id', '') is not null and not exists (
    select 1 from public.team_roster_players player
    where player.team_id = new.team_id
      and player.source_player_id = to_jsonb(new)->>'override_player_id'
  ) then
    raise exception 'Override player must belong to the analytics team.';
  end if;

  if nullif(to_jsonb(new)->>'mvp_result_id', '') is not null and not exists (
    select 1 from public.team_game_mvp_results mvp
    where mvp.id = (to_jsonb(new)->>'mvp_result_id')::uuid
      and mvp.team_id = new.team_id and mvp.season_id = new.season_id
      and mvp.source_game_id = new.source_game_id
      and mvp.predicted_source_player_id = to_jsonb(new)->'original_prediction'->>'source_player_id'
      and mvp.impact_score = (to_jsonb(new)->'original_prediction'->>'impact_score')::numeric
      and mvp.model_version = to_jsonb(new)->'original_prediction'->>'model_version'
  ) then
    raise exception 'MVP feedback subject must belong to its tenant scope.';
  end if;

  if nullif(to_jsonb(new)->>'feedback_id', '') is not null and not exists (
    select 1 from public.team_player_feedback feedback
    where feedback.id = (to_jsonb(new)->>'feedback_id')::uuid
      and feedback.team_id = new.team_id and feedback.season_id = new.season_id
      and feedback.source_game_id = new.source_game_id
      and feedback.original_prediction = to_jsonb(new)->'original_prediction'
  ) then
    raise exception 'Analytics review feedback must belong to its tenant scope.';
  end if;

  if tg_op = 'UPDATE'
     and to_jsonb(new) ? 'original_prediction'
     and to_jsonb(new)->'original_prediction' is distinct from to_jsonb(old)->'original_prediction' then
    raise exception 'Original PuckNexus prediction is immutable.';
  end if;

  if tg_table_name = 'team_game_mvp_results' and tg_op = 'UPDATE' then
    if public.is_platform_admin()
       and (
         to_jsonb(new)->'predicted_source_player_id' is distinct from to_jsonb(old)->'predicted_source_player_id'
         or to_jsonb(new)->'impact_score' is distinct from to_jsonb(old)->'impact_score'
         or to_jsonb(new)->'model_version' is distinct from to_jsonb(old)->'model_version'
         or to_jsonb(new)->'breakdown' is distinct from to_jsonb(old)->'breakdown'
         or to_jsonb(new)->'calculated_at' is distinct from to_jsonb(old)->'calculated_at'
       ) then
      raise exception 'Admin review cannot alter the original model result.';
    end if;
    if public.is_platform_admin()
       and to_jsonb(new)->>'source_player_id' is distinct from to_jsonb(old)->>'source_player_id'
       and to_jsonb(new)->>'selection_type' <> 'override' then
      raise exception 'Admin MVP changes must be recorded as overrides.';
    end if;
    if not public.is_platform_admin()
       and to_jsonb(old)->>'selection_type' = 'override' then
      new.source_player_id := old.source_player_id;
      new.selection_type := old.selection_type;
      new.rationale := old.rationale;
    end if;
  end if;

  new.updated_at := now();
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  if tg_op = 'INSERT' then
    new.created_by := coalesce((select auth.uid()), new.created_by);
  end if;
  return new;
end;
$$;

create trigger team_game_impact_results_validate_scope
before insert or update on public.team_game_impact_results
for each row execute function public.validate_pucknexus_analytics_scope();
create trigger team_player_trend_results_validate_scope
before insert or update on public.team_player_trend_results
for each row execute function public.validate_pucknexus_analytics_scope();
create trigger team_game_mvp_results_validate_scope
before insert or update on public.team_game_mvp_results
for each row execute function public.validate_pucknexus_analytics_scope();
create trigger team_season_awards_validate_scope
before insert or update on public.team_season_awards
for each row execute function public.validate_pucknexus_analytics_scope();
create trigger team_player_feedback_validate_scope
before insert or update on public.team_player_feedback
for each row execute function public.validate_pucknexus_analytics_scope();
create trigger team_analytics_reviews_validate_scope
before insert or update on public.team_analytics_reviews
for each row execute function public.validate_pucknexus_analytics_scope();
create trigger team_analytics_audit_log_validate_scope
before insert on public.team_analytics_audit_log
for each row execute function public.validate_pucknexus_analytics_scope();

revoke all on function public.validate_pucknexus_analytics_scope()
  from public, anon, authenticated;

create or replace function public.replace_pucknexus_game_analytics_v1(
  target_team_id uuid,
  target_season_id uuid,
  target_source_game_id text,
  target_idempotency_key text,
  target_impacts jsonb,
  target_mvp jsonb,
  target_awards jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_state jsonb;
begin
  if length(trim(coalesce(target_source_game_id, ''))) = 0
     or length(trim(coalesce(target_idempotency_key, ''))) = 0
     or jsonb_typeof(target_impacts) is distinct from 'array'
     or (target_mvp is not null and jsonb_typeof(target_mvp) is distinct from 'object')
     or jsonb_typeof(target_awards) is distinct from 'array' then
    raise exception 'A complete analytics replacement payload is required.';
  end if;

  if target_mvp is not null and not exists (
    select 1 from jsonb_array_elements(target_impacts) impact
    where impact->>'source_player_id' = target_mvp->>'predicted_source_player_id'
  ) then
    raise exception 'The predicted MVP must have a qualified Impact result.';
  end if;

  if exists (
    select 1 from public.team_analytics_audit_log
    where team_id = target_team_id
      and season_id = target_season_id
      and action = 'game_analytics.recalculated'
      and idempotency_key = target_idempotency_key
  ) then
    return false;
  end if;

  select jsonb_build_object(
    'impacts', coalesce((
      select jsonb_agg(to_jsonb(impact) order by impact.rank, impact.source_player_id)
      from public.team_game_impact_results impact
      where impact.team_id = target_team_id and impact.season_id = target_season_id
        and impact.source_game_id = target_source_game_id
        and impact.model_version = 'pnx-impact-v1'
    ), '[]'::jsonb),
    'mvp', (
      select to_jsonb(mvp) from public.team_game_mvp_results mvp
      where mvp.team_id = target_team_id and mvp.season_id = target_season_id
        and mvp.source_game_id = target_source_game_id
    ),
    'awards', coalesce((
      select jsonb_agg(to_jsonb(award) order by award.award_key, award.subject_key)
      from public.team_season_awards award
      where award.team_id = target_team_id and award.season_id = target_season_id
        and award.source_game_id = target_source_game_id
        and award.rule_version = 'pnx-awards-v1'
    ), '[]'::jsonb)
  ) into previous_state;

  delete from public.team_game_impact_results
  where team_id = target_team_id and season_id = target_season_id
    and source_game_id = target_source_game_id and model_version = 'pnx-impact-v1';

  insert into public.team_game_impact_results (
    team_id, season_id, source_game_id, source_player_id, player_type, position,
    impact_score, ranking_score, rank, model_version, contract_version,
    inputs, breakdown, computed_at
  )
  select target_team_id, target_season_id, target_source_game_id,
    row.source_player_id, row.player_type, row.position, row.impact_score,
    row.ranking_score, row.rank, 'pnx-impact-v1', '1',
    row.inputs, row.breakdown, row.computed_at
  from jsonb_to_recordset(target_impacts) as row(
    source_player_id text, player_type text, position text, impact_score numeric,
    ranking_score numeric, rank integer, inputs jsonb, breakdown jsonb,
    computed_at timestamptz
  );

  delete from public.team_game_mvp_results
  where team_id = target_team_id
    and season_id = target_season_id
    and source_game_id = target_source_game_id;

  insert into public.team_game_mvp_results (
    team_id, season_id, source_game_id, source_player_id,
    predicted_source_player_id, position, impact_score, breakdown,
    tie_candidate_ids, calculated_at, selection_type, is_tie,
    model_version, contract_version
  ) select
    target_team_id, target_season_id, target_source_game_id,
    target_mvp->>'source_player_id', target_mvp->>'predicted_source_player_id',
    target_mvp->>'position', (target_mvp->>'impact_score')::numeric,
    target_mvp->'breakdown',
    array(select jsonb_array_elements_text(target_mvp->'tie_candidate_ids')),
    (target_mvp->>'calculated_at')::timestamptz, 'automatic',
    coalesce((target_mvp->>'is_tie')::boolean, false), 'pnx-impact-v1', '1'
  where target_mvp is not null
  )
  on conflict (team_id, season_id, source_game_id) do update set
    source_player_id = excluded.source_player_id,
    predicted_source_player_id = excluded.predicted_source_player_id,
    position = excluded.position,
    impact_score = excluded.impact_score,
    breakdown = excluded.breakdown,
    tie_candidate_ids = excluded.tie_candidate_ids,
    calculated_at = excluded.calculated_at,
    selection_type = excluded.selection_type,
    is_tie = excluded.is_tie,
    model_version = excluded.model_version,
    contract_version = excluded.contract_version;

  delete from public.team_season_awards
  where team_id = target_team_id and season_id = target_season_id
    and source_game_id = target_source_game_id and rule_version = 'pnx-awards-v1';

  insert into public.team_season_awards (
    team_id, season_id, source_game_id, source_player_id, award_scope,
    subject_key, award_key, metric_name, metric_value, rank, is_tie,
    status, rule_version, contract_version, evidence
  )
  select target_team_id, target_season_id, target_source_game_id,
    row.source_player_id, row.award_scope, row.subject_key, row.award_key,
    row.metric_name, row.metric_value, row.rank, row.is_tie, row.status,
    'pnx-awards-v1', '1', row.evidence
  from jsonb_to_recordset(target_awards) as row(
    source_player_id text, award_scope text, subject_key text, award_key text,
    metric_name text, metric_value numeric, rank integer, is_tie boolean,
    status text, evidence jsonb
  );

  insert into public.team_analytics_audit_log (
    team_id, season_id, source_game_id, action, resource_type, resource_id,
    idempotency_key, before_state, after_state, metadata
  ) values (
    target_team_id, target_season_id, target_source_game_id,
    'game_analytics.recalculated', 'game', target_source_game_id,
    target_idempotency_key, previous_state,
    jsonb_build_object(
      'impacts', target_impacts,
      'mvp', target_mvp,
      'awards', target_awards
    ),
    jsonb_build_object(
      'impact_model_version', 'pnx-impact-v1',
      'award_rule_version', 'pnx-awards-v1'
    )
  );

  return true;
end;
$$;

revoke all on function public.replace_pucknexus_game_analytics_v1(
  uuid, uuid, text, text, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.replace_pucknexus_game_analytics_v1(
  uuid, uuid, text, text, jsonb, jsonb, jsonb
) to service_role;

alter table public.team_game_impact_results enable row level security;
alter table public.team_player_trend_results enable row level security;
alter table public.team_game_mvp_results enable row level security;
alter table public.team_season_awards enable row level security;
alter table public.team_player_feedback enable row level security;
alter table public.team_analytics_reviews enable row level security;
alter table public.team_analytics_audit_log enable row level security;

create policy team_game_impact_results_select
on public.team_game_impact_results for select to authenticated
using (
  public.can_access_team_season(team_id, season_id)
  and public.has_workspace_feature_access(team_id, season_id, 'stats.view', 'stats')
);
create policy team_player_trend_results_select
on public.team_player_trend_results for select to authenticated
using (
  public.can_access_team_season(team_id, season_id)
  and public.has_workspace_feature_access(team_id, season_id, 'stats.view', 'stats')
);
create policy team_game_mvp_results_select
on public.team_game_mvp_results for select to authenticated
using (
  public.can_access_team_season(team_id, season_id)
  and public.has_workspace_feature_access(team_id, season_id, 'stats.view', 'stats')
);
create policy team_game_mvp_results_update
on public.team_game_mvp_results for update to authenticated
using (
  public.is_platform_admin()
)
with check (
  public.is_platform_admin()
);

create policy team_season_awards_select
on public.team_season_awards for select to authenticated
using (
  public.can_access_team_season(team_id, season_id)
  and public.has_workspace_feature_access(team_id, season_id, 'reports.view', 'reports')
);
create policy team_player_feedback_select
on public.team_player_feedback for select to authenticated
using (
  (created_by = (select auth.uid())
   and public.can_access_team_season(team_id, season_id))
  or public.is_platform_admin()
);
create policy team_player_feedback_insert
on public.team_player_feedback for insert to authenticated
with check (
  created_by = (select auth.uid())
  and public.can_access_team_season(team_id, season_id)
  and public.has_workspace_feature_access(team_id, season_id, 'players.evaluate', 'players')
);
create policy team_player_feedback_update_by_platform_admin
on public.team_player_feedback for update to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());
create policy team_analytics_reviews_select
on public.team_analytics_reviews for select to authenticated
using (
  public.is_platform_admin()
);
create policy team_analytics_reviews_insert
on public.team_analytics_reviews for insert to authenticated
with check (
  created_by = (select auth.uid())
  and reviewed_by = (select auth.uid())
  and public.is_platform_admin()
);
create policy team_analytics_reviews_update
on public.team_analytics_reviews for update to authenticated
using (public.is_platform_admin())
with check (
  reviewed_by = (select auth.uid())
  and public.is_platform_admin()
);

create policy team_analytics_audit_log_select
on public.team_analytics_audit_log for select to authenticated
using (
  public.is_platform_admin()
);

revoke all on
  public.team_game_impact_results,
  public.team_player_trend_results,
  public.team_game_mvp_results,
  public.team_season_awards,
  public.team_player_feedback,
  public.team_analytics_reviews,
  public.team_analytics_audit_log
from anon;

grant select on
  public.team_game_impact_results,
  public.team_player_trend_results,
  public.team_game_mvp_results,
  public.team_season_awards
to authenticated;
grant select, insert, update on public.team_player_feedback to authenticated;
grant update on public.team_game_mvp_results to authenticated;
grant select, insert, update on public.team_analytics_reviews to authenticated;
grant select on public.team_analytics_audit_log to authenticated;
revoke insert, update, delete on
  public.team_game_impact_results,
  public.team_player_trend_results,
  public.team_season_awards
from authenticated;
revoke insert, delete on public.team_game_mvp_results from authenticated;
