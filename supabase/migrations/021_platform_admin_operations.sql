-- PuckNexus Platform Admin / no-AI operations foundation.
-- Additive only. This migration does not create users or production data.

create table public.badge_catalog (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  code text not null unique check (code = upper(code) and code ~ '^[A-Z0-9_]+$'),
  display_name text not null check (length(trim(display_name)) > 0),
  description text not null default '',
  category text not null default 'achievement',
  artwork_ref text,
  scope text not null default 'global' check (scope in ('global', 'organization')),
  award_mode text not null default 'manual' check (award_mode in ('manual', 'automatic')),
  rarity text not null default 'standard',
  active boolean not null default true,
  printable boolean not null default false,
  rule_version text,
  qualification_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(qualification_metadata) = 'object'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.player_badge_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete restrict,
  player_id text not null,
  badge_id uuid not null references public.badge_catalog(id) on delete restrict,
  source text not null check (source in ('manual', 'automatic')),
  game_id uuid references public.team_games(id) on delete set null,
  awarded_at timestamptz not null default now(),
  awarded_by uuid references auth.users(id) on delete set null,
  rule_version text,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  created_at timestamptz not null default now(),
  unique (team_id, season_id, player_id, badge_id, game_id)
);

create index player_badge_assignments_scope_idx
  on public.player_badge_assignments(organization_id, team_id, season_id);

create unique index player_badge_assignments_idempotency_idx
  on public.player_badge_assignments(
    team_id, season_id, player_id, badge_id,
    coalesce(game_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create table public.platform_admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete restrict,
  operation text not null,
  organization_id uuid references public.organizations(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  season_id uuid references public.seasons(id) on delete set null,
  game_id uuid references public.team_games(id) on delete set null,
  player_id text,
  before_snapshot jsonb,
  after_snapshot jsonb,
  reason text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index platform_admin_audit_scope_idx
  on public.platform_admin_audit_log(organization_id, team_id, created_at desc);

create table public.beta_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  coach_id uuid references auth.users(id) on delete set null,
  category text not null default 'general',
  message text not null check (length(trim(message)) > 0),
  status text not null default 'NEW' check (status in ('NEW', 'REVIEWING', 'RESOLVED')),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object')
);

alter table public.badge_catalog enable row level security;
alter table public.player_badge_assignments enable row level security;
alter table public.platform_admin_audit_log enable row level security;
alter table public.beta_feedback enable row level security;

create policy badge_catalog_select_for_authenticated
on public.badge_catalog for select to authenticated
using (active and (scope = 'global' or public.is_platform_admin() or public.is_org_member(organization_id)));

create policy badge_assignments_select_for_team_members
on public.player_badge_assignments for select to authenticated
using (public.is_platform_admin() or public.is_org_member(organization_id));

create policy beta_feedback_insert_for_authenticated
on public.beta_feedback for insert to authenticated
with check (coach_id = (select auth.uid()) and public.is_org_member(organization_id));

create policy beta_feedback_select_for_platform_admin
on public.beta_feedback for select to authenticated
using (public.is_platform_admin());

create policy beta_feedback_update_for_platform_admin
on public.beta_feedback for update to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

revoke all on public.badge_catalog, public.player_badge_assignments,
  public.platform_admin_audit_log, public.beta_feedback from anon;
grant select on public.badge_catalog, public.player_badge_assignments to authenticated;
grant insert on public.beta_feedback to authenticated;
grant select, update on public.beta_feedback to authenticated;

create or replace function public.platform_admin_required()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Platform Admin authorization is required.';
  end if;
end;
$$;

create or replace function public.write_platform_admin_audit(
  target_operation text,
  target_organization_id uuid default null,
  target_team_id uuid default null,
  target_season_id uuid default null,
  target_game_id uuid default null,
  target_player_id text default null,
  target_before_snapshot jsonb default null,
  target_after_snapshot jsonb default null,
  target_reason text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare audit_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;
  if not public.is_platform_admin() and not (
    (target_organization_id is not null and (
      public.has_org_role(target_organization_id, 'org_owner')
      or public.has_org_role(target_organization_id, 'org_admin')
    ))
    or (target_team_id is not null and public.is_team_owner(target_team_id))
  ) then
    raise exception 'Authorized operational access is required.';
  end if;
  if target_operation is null or length(trim(target_operation)) = 0
     or target_reason is null or length(trim(target_reason)) = 0 then
    raise exception 'An operation and reason are required.';
  end if;
  insert into public.platform_admin_audit_log (
    actor_id, operation, organization_id, team_id, season_id, game_id,
    player_id, before_snapshot, after_snapshot, reason, metadata
  ) values (
    auth.uid(), trim(target_operation), target_organization_id, target_team_id,
    target_season_id, target_game_id, target_player_id, target_before_snapshot,
    target_after_snapshot, trim(target_reason), coalesce(target_metadata, '{}'::jsonb)
  ) returning id into audit_id;
  return audit_id;
end;
$$;

create or replace function public.admin_create_organization(
  target_name text,
  target_slug text,
  target_brand_display_name text,
  target_brand_short_name text,
  target_primary_color text,
  target_secondary_color text,
  target_accent_color text,
  target_plan_id text,
  target_recognition text,
  target_team_name text,
  target_team_slug text,
  target_season_name text,
  target_season_key text,
  target_season_starts_on date,
  target_season_ends_on date
)
returns table (organization_id uuid, team_id uuid, season_id uuid, plan_id text)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org public.organizations%rowtype;
  new_team public.teams%rowtype;
  new_season public.seasons%rowtype;
  normalized_plan text := upper(trim(target_plan_id));
begin
  perform public.platform_admin_required();
  if target_name is null or length(trim(target_name)) not between 1 and 120
     or target_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     or target_team_name is null or length(trim(target_team_name)) not between 1 and 120
     or target_team_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     or target_season_name is null or length(trim(target_season_name)) not between 1 and 120
     or target_season_key is null or length(trim(target_season_key)) not between 1 and 80
     or target_season_starts_on is null or target_season_ends_on < target_season_starts_on
     or target_brand_display_name is null or target_brand_short_name is null
     or target_primary_color !~ '^#[0-9A-Fa-f]{6}$'
     or target_secondary_color !~ '^#[0-9A-Fa-f]{6}$'
     or target_accent_color !~ '^#[0-9A-Fa-f]{6}$'
     or target_recognition is null then
    raise exception 'Valid organization, team, season, and branding details are required.';
  end if;
  if not exists (select 1 from public.plan_catalog where plan_id = normalized_plan and status = 'active') then
    raise exception 'The requested plan is not active.';
  end if;
  insert into public.organizations(name, slug) values (trim(target_name), lower(trim(target_slug)))
    returning * into new_org;
  insert into public.organization_entitlements(organization_id, plan_id, metadata)
    values (new_org.id, normalized_plan, jsonb_build_object('recognition', trim(target_recognition), 'source', 'platform_admin'));
  insert into public.teams(name, slug, organization_id) values
    (trim(target_team_name), lower(trim(target_team_slug)), new_org.id) returning * into new_team;
  insert into public.seasons(team_id, name, season_key, status, starts_on, ends_on)
    values (new_team.id, trim(target_season_name), trim(target_season_key), 'planned',
      target_season_starts_on, target_season_ends_on) returning * into new_season;
  update public.teams set default_season_id = new_season.id where id = new_team.id;
  insert into public.team_branding(
    team_id, display_name, short_name, primary_color, secondary_color, accent_color, updated_by
  ) values (
    new_team.id, trim(target_brand_display_name), trim(target_brand_short_name),
    upper(target_primary_color), upper(target_secondary_color), upper(target_accent_color), auth.uid()
  );
  perform public.write_platform_admin_audit(
    'organization.create', new_org.id, new_team.id, new_season.id, null, null,
    null, jsonb_build_object('plan_id', normalized_plan, 'recognition', trim(target_recognition)),
    'Create organization through Platform Admin'
  );
  return query select new_org.id, new_team.id, new_season.id, normalized_plan;
end;
$$;

create or replace function public.admin_create_team(
  target_organization_id uuid,
  target_team_name text,
  target_team_slug text,
  target_season_name text,
  target_season_key text,
  target_season_starts_on date,
  target_season_ends_on date,
  target_primary_color text default null,
  target_secondary_color text default null,
  target_accent_color text default null
)
returns table (team_id uuid, season_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_team public.teams%rowtype;
  new_season public.seasons%rowtype;
  inherited public.team_branding%rowtype;
  platform boolean := public.is_platform_admin();
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  if not platform and not (
    public.has_org_role(target_organization_id, 'org_owner')
    or public.has_org_role(target_organization_id, 'org_admin')
  ) then raise exception 'Organization owner or admin permission is required.'; end if;
  if not platform
     and not exists (
       select 1
       from public.organization_entitlements entitlement
       join public.plan_feature_entitlements feature
         on feature.plan_id = entitlement.plan_id
        and feature.feature_key = 'teams.create'
        and feature.enabled
       where entitlement.organization_id = target_organization_id
         and entitlement.status = 'active'
         and (entitlement.ends_at is null or entitlement.ends_at > now())
     ) then
    raise exception 'The organization plan does not allow additional teams.';
  end if;
  if not exists (select 1 from public.organizations where id = target_organization_id and status = 'active') then
    raise exception 'The target organization is not active.';
  end if;
  if target_team_name is null or target_team_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     or target_season_name is null or target_season_key is null
     or target_season_starts_on is null or target_season_ends_on < target_season_starts_on then
    raise exception 'Valid team and season details are required.';
  end if;
  select branding.* into inherited from public.team_branding branding
    join public.teams team on team.id = branding.team_id
    where team.organization_id = target_organization_id limit 1;
  insert into public.teams(name, slug, organization_id) values
    (trim(target_team_name), lower(trim(target_team_slug)), target_organization_id) returning * into new_team;
  insert into public.seasons(team_id, name, season_key, starts_on, ends_on)
    values (new_team.id, trim(target_season_name), trim(target_season_key),
      target_season_starts_on, target_season_ends_on) returning * into new_season;
  update public.teams set default_season_id = new_season.id where id = new_team.id;
  insert into public.team_branding(
    team_id, display_name, short_name, primary_color, secondary_color, accent_color, updated_by
  ) values (
    new_team.id, coalesce(target_team_name, inherited.display_name),
    coalesce(inherited.short_name, left(target_team_name, 32)),
    coalesce(target_primary_color, inherited.primary_color, '#2A2E34'),
    coalesce(target_secondary_color, inherited.secondary_color, '#171B20'),
    coalesce(target_accent_color, inherited.accent_color, '#61D4F5'),
    auth.uid()
  );
  perform public.write_platform_admin_audit(
    'team.create', target_organization_id, new_team.id, new_season.id, null, null,
    null, jsonb_build_object('team_name', new_team.name), 'Create team through authorized operations'
  );
  return query select new_team.id, new_season.id;
end;
$$;

create or replace function public.admin_create_workspace_invite(
  target_organization_id uuid,
  target_team_id uuid,
  target_season_id uuid,
  target_email_normalized text,
  target_display_name text,
  target_role_id text,
  target_plan_id text,
  target_token_hash text,
  target_expires_at timestamptz default null
)
returns table (invite_id uuid, invite_status text, invite_expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare created public.workspace_invites%rowtype;
begin
  perform public.platform_admin_required();
  if target_token_hash is null or target_token_hash !~ '^[0-9a-f]{64}$'
     or target_email_normalized !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     or target_display_name is null
     or target_role_id not in ('owner', 'assistant_goalie', 'assistant')
     or target_plan_id is null
     or not exists (
       select 1 from public.plan_catalog
       where plan_id = upper(target_plan_id) and status = 'active'
     )
     or target_expires_at is not null and target_expires_at <= now() then
    raise exception 'Valid invite details are required.';
  end if;
  if not exists (select 1 from public.teams where id = target_team_id and organization_id = target_organization_id) then
    raise exception 'Invite team must belong to the target organization.';
  end if;
  if exists (
    select 1 from public.workspace_invites
    where organization_id = target_organization_id
      and team_id = target_team_id
      and email_normalized = lower(trim(target_email_normalized))
      and status = 'pending'
      and (expires_at is null or expires_at > now())
  ) then
    raise exception 'A pending invite already exists for this email and team.';
  end if;
  if target_season_id is not null and not exists (select 1 from public.seasons where id = target_season_id and team_id = target_team_id) then
    raise exception 'Invite season must belong to the invite team.';
  end if;
  insert into public.workspace_invites(
    organization_id, team_id, season_id, role_id, plan_id, token_hash,
    email_normalized, display_name, invited_by, status, expires_at, metadata
  ) values (
    target_organization_id, target_team_id, target_season_id, target_role_id,
    upper(target_plan_id), target_token_hash, lower(trim(target_email_normalized)),
    trim(target_display_name), auth.uid(), 'pending',
    coalesce(target_expires_at, now() + interval '72 hours'),
    jsonb_build_object('source', 'platform_admin', 'delivery_state', 'pending_controlled_delivery')
  ) returning * into created;
  perform public.write_platform_admin_audit(
    'invite.create', target_organization_id, target_team_id, target_season_id,
    null, null, null, null, 'Create coach invite through Platform Admin'
  );
  return query select created.id, created.status, created.expires_at;
end;
$$;

create or replace function public.admin_create_badge(
  target_organization_id uuid,
  target_code text,
  target_display_name text,
  target_description text,
  target_category text,
  target_artwork_ref text,
  target_scope text,
  target_award_mode text,
  target_rarity text,
  target_printable boolean,
  target_rule_version text,
  target_qualification_metadata jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare badge_id uuid;
begin
  perform public.platform_admin_required();
  if (target_scope = 'global' and target_organization_id is not null)
     or (target_scope = 'organization' and target_organization_id is null)
     or target_code is null or target_code !~ '^[A-Z0-9_]+$'
     or target_display_name is null or target_scope not in ('global', 'organization')
     or target_award_mode not in ('manual', 'automatic') then
    raise exception 'Valid badge catalog details are required.';
  end if;
  if target_organization_id is not null and not exists (
    select 1 from public.organizations where id = target_organization_id and status = 'active'
  ) then
    raise exception 'The badge organization is not active.';
  end if;
  insert into public.badge_catalog(
    organization_id, code, display_name, description, category, artwork_ref, scope, award_mode,
    rarity, printable, rule_version, qualification_metadata, created_by
  ) values (
    target_organization_id, upper(trim(target_code)), trim(target_display_name), coalesce(target_description, ''),
    coalesce(target_category, 'achievement'), nullif(trim(target_artwork_ref), ''),
    target_scope, target_award_mode, coalesce(target_rarity, 'standard'),
    coalesce(target_printable, false), nullif(trim(target_rule_version), ''),
    coalesce(target_qualification_metadata, '{}'::jsonb), auth.uid()
  ) returning id into badge_id;
  perform public.write_platform_admin_audit(
    'badge.create', null, null, null, null, null, null,
    jsonb_build_object('badge_id', badge_id, 'code', upper(trim(target_code))),
    'Create badge catalog entry'
  );
  return badge_id;
end;
$$;

create or replace function public.admin_update_badge(
  target_badge_id uuid,
  target_active boolean,
  target_display_name text,
  target_description text,
  target_artwork_ref text,
  target_rarity text,
  target_printable boolean,
  target_rule_version text,
  target_qualification_metadata jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare badge public.badge_catalog%rowtype;
begin
  perform public.platform_admin_required();
  select * into badge from public.badge_catalog where id = target_badge_id for update;
  if not found then raise exception 'The badge was not found.'; end if;
  update public.badge_catalog
  set active = coalesce(target_active, active),
      display_name = coalesce(nullif(trim(target_display_name), ''), display_name),
      description = coalesce(target_description, description),
      artwork_ref = coalesce(nullif(trim(target_artwork_ref), ''), artwork_ref),
      rarity = coalesce(nullif(trim(target_rarity), ''), rarity),
      printable = coalesce(target_printable, printable),
      rule_version = coalesce(nullif(trim(target_rule_version), ''), rule_version),
      qualification_metadata = coalesce(target_qualification_metadata, qualification_metadata),
      updated_at = now()
  where id = target_badge_id;
  perform public.write_platform_admin_audit(
    'badge.update', badge.organization_id, null, null, null, null,
    to_jsonb(badge),
    (select to_jsonb(updated_badge) from public.badge_catalog updated_badge where id = target_badge_id),
    'Update badge catalog entry'
  );
  return true;
end;
$$;

create or replace function public.admin_award_badge(
  target_organization_id uuid,
  target_team_id uuid,
  target_season_id uuid,
  target_player_id text,
  target_badge_id uuid,
  target_source text,
  target_game_id uuid,
  target_rule_version text,
  target_evidence jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare badge public.badge_catalog%rowtype; assignment_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  select * into badge from public.badge_catalog where id = target_badge_id and active;
  if not found then raise exception 'The badge is not active.'; end if;
  if badge.scope = 'organization' and badge.organization_id is distinct from target_organization_id then
    raise exception 'The badge is not available to this organization.';
  end if;
  if target_source = 'automatic' then
    perform public.platform_admin_required();
  elsif target_source = 'manual' then
    if not (public.is_platform_admin() or public.has_team_capability(target_team_id, 'admin.users')) then
      raise exception 'Manual badge authority is required.';
    end if;
    if badge.award_mode <> 'manual' then raise exception 'Automatic badges cannot be manually forged.'; end if;
  else raise exception 'Invalid badge award source.'; end if;
  if not exists (select 1 from public.teams where id = target_team_id and organization_id = target_organization_id)
     or not exists (select 1 from public.seasons where id = target_season_id and team_id = target_team_id) then
    raise exception 'Badge assignment scope is invalid.';
  end if;
  if not exists (
    select 1 from public.team_roster_players
    where team_id = target_team_id and season_id = target_season_id
      and source_player_id = target_player_id
  ) then
    raise exception 'The badge player is not on the selected team season roster.';
  end if;
  if target_game_id is not null and not exists (
    select 1 from public.team_games
    where id = target_game_id and team_id = target_team_id and season_id = target_season_id
  ) then
    raise exception 'The badge game is not part of the selected team season.';
  end if;
  insert into public.player_badge_assignments(
    organization_id, team_id, season_id, player_id, badge_id, source, game_id,
    awarded_by, rule_version, evidence
  ) values (
    target_organization_id, target_team_id, target_season_id, target_player_id,
    target_badge_id, target_source, target_game_id,
    case when target_source = 'manual' then auth.uid() else null end,
    case when target_source = 'automatic' then badge.rule_version else target_rule_version end,
    coalesce(target_evidence, '{}'::jsonb)
  ) returning id into assignment_id;
  perform public.write_platform_admin_audit(
    'badge.assign', target_organization_id, target_team_id, target_season_id,
    target_game_id, target_player_id, null,
    jsonb_build_object('assignment_id', assignment_id, 'source', target_source),
    'Award badge through controlled authority'
  );
  return assignment_id;
end;
$$;

create or replace function public.admin_correct_player_stat(
  target_stat_id uuid,
  target_stat_category text,
  target_new_value numeric,
  target_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare stat public.team_game_player_stats%rowtype; before_value jsonb; after_value jsonb; audit_id uuid;
begin
  perform public.platform_admin_required();
  if target_stat_category not in (
    'gp','goals','assists','shots','penalty_minutes','plus_minus','blocks',
    'faceoff_wins','faceoff_losses','faceoff_attempts','power_play_goals',
    'power_play_assists','power_play_points','short_handed_goals',
    'short_handed_assists','short_handed_points','saves','goals_against',
    'wins','losses','ties','shutouts'
  ) or target_new_value is null or target_new_value::text ~* 'inf|nan'
    or target_reason is null or length(trim(target_reason)) = 0 then
    raise exception 'A supported stat and correction reason are required.';
  end if;
  select * into stat from public.team_game_player_stats where id = target_stat_id for update;
  if not found then raise exception 'The player stat record was not found.'; end if;
  if not exists (
    select 1
    from public.team_games game
    join public.seasons season on season.id = stat.season_id and season.team_id = stat.team_id
    join public.team_roster_players roster
      on roster.team_id = stat.team_id and roster.source_player_id = stat.source_player_id
    where game.team_id = stat.team_id
      and game.source_game_id = stat.source_game_id
      and game.season_id = stat.season_id
      and roster.player_type = stat.player_type
  ) then
    raise exception 'The player stat scope is not a valid team, season, game, and roster relationship.';
  end if;
  before_value := to_jsonb(stat);
  execute format('update public.team_game_player_stats set %I = $1, updated_at = now() where id = $2', target_stat_category)
    using target_new_value, target_stat_id;
  select to_jsonb(row) into after_value from public.team_game_player_stats row where id = target_stat_id;
  audit_id := public.write_platform_admin_audit(
    'stat.correct.player', (select organization_id from public.teams where id = stat.team_id),
    stat.team_id, stat.season_id, (select id from public.team_games where team_id = stat.team_id and source_game_id = stat.source_game_id limit 1),
    stat.source_player_id, before_value, after_value, target_reason,
    jsonb_build_object('stat_category', target_stat_category)
  );
  return audit_id;
end;
$$;

create or replace function public.admin_correct_team_stat(
  target_stat_id uuid,
  target_stat_category text,
  target_new_value numeric,
  target_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare stat public.team_game_team_stats%rowtype; before_value jsonb; after_value jsonb; audit_id uuid;
begin
  perform public.platform_admin_required();
  if target_stat_category not in (
    'goals_for','goals_against','shots_for','shots_against','power_play_chances',
    'power_play_success','penalty_kill_chances','penalty_kill_success',
    'faceoff_wins','faceoff_losses','goals_for_p1','goals_for_p2','goals_for_p3',
    'goals_for_ot','goals_against_p1','goals_against_p2','goals_against_p3','goals_against_ot'
  ) or target_new_value is null or target_new_value::text ~* 'inf|nan'
    or target_reason is null or length(trim(target_reason)) = 0 then
    raise exception 'A supported team stat and correction reason are required.';
  end if;
  select * into stat from public.team_game_team_stats where id = target_stat_id for update;
  if not found then raise exception 'The team stat record was not found.'; end if;
  if not exists (
    select 1
    from public.team_games game
    join public.seasons season on season.id = stat.season_id and season.team_id = stat.team_id
    where game.team_id = stat.team_id
      and game.source_game_id = stat.source_game_id
      and game.season_id = stat.season_id
  ) then
    raise exception 'The team stat scope is not a valid team, season, and game relationship.';
  end if;
  before_value := to_jsonb(stat);
  execute format('update public.team_game_team_stats set %I = $1, updated_at = now() where id = $2', target_stat_category)
    using target_new_value, target_stat_id;
  select to_jsonb(row) into after_value from public.team_game_team_stats row where id = target_stat_id;
  audit_id := public.write_platform_admin_audit(
    'stat.correct.team', (select organization_id from public.teams where id = stat.team_id),
    stat.team_id, stat.season_id, (select id from public.team_games where team_id = stat.team_id and source_game_id = stat.source_game_id limit 1),
    null, before_value, after_value, target_reason,
    jsonb_build_object('stat_category', target_stat_category)
  );
  return audit_id;
end;
$$;

create or replace function public.admin_update_beta_feedback(
  target_feedback_id uuid,
  target_status text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.platform_admin_required();
  if target_status not in ('NEW', 'REVIEWING', 'RESOLVED') then raise exception 'Invalid feedback status.'; end if;
  update public.beta_feedback set status = target_status, updated_at = now() where id = target_feedback_id;
  if not found then raise exception 'Beta feedback was not found.'; end if;
  perform public.write_platform_admin_audit(
    'beta_feedback.update', (select organization_id from public.beta_feedback where id = target_feedback_id),
    null, null, null, null, null, jsonb_build_object('status', target_status),
    'Update beta feedback status'
  );
  return true;
end;
$$;

create or replace function public.admin_create_season(
  target_team_id uuid,
  target_season_name text,
  target_season_key text,
  target_season_starts_on date,
  target_season_ends_on date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare season_id uuid; organization_id uuid;
begin
  perform public.platform_admin_required();
  select team.organization_id into organization_id from public.teams team where team.id = target_team_id;
  if organization_id is null then raise exception 'The target team was not found.'; end if;
  if target_season_name is null or target_season_key is null
     or target_season_starts_on is null or target_season_ends_on < target_season_starts_on then
    raise exception 'Valid season details are required.';
  end if;
  insert into public.seasons(team_id, name, season_key, status, starts_on, ends_on)
    values (target_team_id, trim(target_season_name), trim(target_season_key), 'planned',
      target_season_starts_on, target_season_ends_on)
    returning id into season_id;
  perform public.write_platform_admin_audit(
    'season.create', organization_id, target_team_id, season_id, null, null, null,
    jsonb_build_object('season_key', target_season_key), 'Create season through Platform Admin'
  );
  return season_id;
end;
$$;

create or replace function public.admin_revoke_workspace_invite(target_invite_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare invite public.workspace_invites%rowtype;
begin
  perform public.platform_admin_required();
  select * into invite from public.workspace_invites where id = target_invite_id for update;
  if not found or invite.status <> 'pending' then
    raise exception 'Only a pending invite can be revoked.';
  end if;
  update public.workspace_invites
  set status = 'revoked', updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('delivery_state', 'revoked')
  where id = target_invite_id and status = 'pending';
  perform public.write_platform_admin_audit(
    'invite.revoke', invite.organization_id, invite.team_id, invite.season_id,
    null, null, null, null, 'Revoke workspace invite through Platform Admin'
  );
  return true;
end;
$$;

create or replace function public.admin_list_users(target_search text default null)
returns table (user_id uuid, email text, display_name text, created_at timestamptz)
language sql
security definer
stable
set search_path = public
as $$
  select users.id, users.email, profiles.display_name, users.created_at
  from auth.users users
  left join public.profiles profiles on profiles.id = users.id
  where public.is_platform_admin()
    and (
      nullif(trim(target_search), '') is null
      or lower(coalesce(users.email, '')) like '%' || lower(trim(target_search)) || '%'
      or lower(coalesce(profiles.display_name, '')) like '%' || lower(trim(target_search)) || '%'
    )
  order by coalesce(profiles.display_name, users.email), users.created_at desc;
$$;

create or replace function public.admin_list_invites(
  target_organization_id uuid default null,
  target_status text default null
)
returns table (
  invite_id uuid, organization_id uuid, team_id uuid, season_id uuid,
  email text, display_name text, role_id text, plan_id text, status text,
  expires_at timestamptz, accepted_at timestamptz, created_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select id, organization_id, team_id, season_id, email_normalized, display_name,
    role_id, plan_id, status, expires_at, accepted_at, created_at
  from public.workspace_invites
  where public.is_platform_admin()
    and (target_organization_id is null or organization_id = target_organization_id)
    and (target_status is null or status = target_status)
  order by created_at desc;
$$;

create or replace function public.admin_list_workspace_details(target_organization_id uuid default null)
returns table (
  organization_id uuid, organization_name text, organization_status text,
  team_id uuid, team_name text, team_status text, season_id uuid, season_name text,
  plan_id text, entitlement_status text, entitlement_metadata jsonb,
  branding jsonb
)
language sql
security definer
stable
set search_path = public
as $$
  select organization.id, organization.name, organization.status,
    team.id, team.name, null::text, season.id, season.name,
    entitlement.plan_id, entitlement.status, entitlement.metadata,
    to_jsonb(branding)
  from public.organizations organization
  join public.teams team on team.organization_id = organization.id
  left join public.seasons season on season.id = team.default_season_id
  left join lateral (
    select current_entitlement.*
    from public.organization_entitlements current_entitlement
    where current_entitlement.organization_id = organization.id
    order by current_entitlement.created_at desc
    limit 1
  ) entitlement on true
  left join public.team_branding branding on branding.team_id = team.id
  where public.is_platform_admin()
    and (target_organization_id is null or organization.id = target_organization_id)
  order by organization.name, team.name;
$$;

create or replace function public.admin_list_team_stats(
  target_team_id uuid,
  target_season_id uuid default null
)
returns table (
  stat_kind text, stat_id uuid, source_game_id text, source_player_id text,
  player_type text, stats jsonb
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  perform public.platform_admin_required();
  if not exists (select 1 from public.teams where id = target_team_id) then
    raise exception 'The target team was not found.';
  end if;
  return query
    select 'player'::text, row.id, row.source_game_id, row.source_player_id,
      row.player_type, to_jsonb(row)
    from public.team_game_player_stats row
    where row.team_id = target_team_id
      and (target_season_id is null or row.season_id = target_season_id)
    union all
    select 'team'::text, row.id, row.source_game_id, null::text,
      null::text, to_jsonb(row)
    from public.team_game_team_stats row
    where row.team_id = target_team_id
      and (target_season_id is null or row.season_id = target_season_id)
    order by source_game_id, stat_kind, source_player_id;
end;
$$;

create or replace function public.admin_search_players(target_search text)
returns table (
  organization_id uuid, organization_name text, team_id uuid, team_name text,
  season_id uuid, season_name text, player_id text, player_name text,
  jersey_number text, position text, player_type text, roster_status text
)
language sql
security definer
stable
set search_path = public
as $$
  select organization.id, organization.name, team.id, team.name,
    season.id, season.name, roster.source_player_id, roster.name,
    roster.jersey_number, roster.position, roster.player_type, roster.status
  from public.team_roster_players roster
  join public.teams team on team.id = roster.team_id
  join public.organizations organization on organization.id = team.organization_id
  left join public.seasons season on season.id = roster.season_id
  where public.is_platform_admin()
    and target_search is not null
    and length(trim(target_search)) >= 2
    and (
      lower(roster.name) like '%' || lower(trim(target_search)) || '%'
      or roster.jersey_number = trim(target_search)
      or roster.source_player_id = trim(target_search)
    )
  order by roster.name, organization.name, team.name;
$$;

revoke all on public.platform_admin_audit_log from public, anon, authenticated;
revoke all on function public.platform_admin_required() from public, anon, authenticated;
revoke all on function public.write_platform_admin_audit(text, uuid, uuid, uuid, uuid, text, jsonb, jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public.admin_create_organization(text,text,text,text,text,text,text,text,text,text,text,text,text,date,date) from public, anon;
revoke all on function public.admin_create_team(uuid,text,text,text,text,date,date,text,text,text) from public, anon;
revoke all on function public.admin_create_workspace_invite(uuid,uuid,uuid,text,text,text,text,text,timestamptz) from public, anon;
revoke all on function public.admin_create_badge(uuid,text,text,text,text,text,text,text,text,boolean,text,jsonb) from public, anon;
revoke all on function public.admin_update_badge(uuid,boolean,text,text,text,text,boolean,text,jsonb) from public, anon;
revoke all on function public.admin_award_badge(uuid,uuid,uuid,text,uuid,text,uuid,text,jsonb) from public, anon;
revoke all on function public.admin_correct_player_stat(uuid,text,numeric,text) from public, anon;
revoke all on function public.admin_correct_team_stat(uuid,text,numeric,text) from public, anon;
revoke all on function public.admin_update_beta_feedback(uuid,text) from public, anon;
revoke all on function public.admin_create_season(uuid,text,text,date,date) from public, anon;
revoke all on function public.admin_revoke_workspace_invite(uuid) from public, anon;
revoke all on function public.admin_list_users(text) from public, anon;
revoke all on function public.admin_list_invites(uuid,text) from public, anon;
revoke all on function public.admin_list_workspace_details(uuid) from public, anon;
revoke all on function public.admin_list_team_stats(uuid,uuid) from public, anon;
revoke all on function public.admin_search_players(text) from public, anon;
grant execute on function public.platform_admin_required() to authenticated;
grant execute on function public.admin_create_organization(text,text,text,text,text,text,text,text,text,text,text,text,text,date,date) to authenticated;
grant execute on function public.admin_create_team(uuid,text,text,text,text,date,date,text,text,text) to authenticated;
grant execute on function public.admin_create_workspace_invite(uuid,uuid,uuid,text,text,text,text,text,timestamptz) to authenticated;
grant execute on function public.admin_create_badge(uuid,text,text,text,text,text,text,text,text,boolean,text,jsonb) to authenticated;
grant execute on function public.admin_update_badge(uuid,boolean,text,text,text,text,boolean,text,jsonb) to authenticated;
grant execute on function public.admin_award_badge(uuid,uuid,uuid,text,uuid,text,uuid,text,jsonb) to authenticated;
grant execute on function public.admin_correct_player_stat(uuid,text,numeric,text) to authenticated;
grant execute on function public.admin_correct_team_stat(uuid,text,numeric,text) to authenticated;
grant execute on function public.admin_update_beta_feedback(uuid,text) to authenticated;
grant execute on function public.admin_create_season(uuid,text,text,date,date) to authenticated;
grant execute on function public.admin_revoke_workspace_invite(uuid) to authenticated;
grant execute on function public.admin_list_users(text) to authenticated;
grant execute on function public.admin_list_invites(uuid,text) to authenticated;
grant execute on function public.admin_list_workspace_details(uuid) to authenticated;
grant execute on function public.admin_list_team_stats(uuid,uuid) to authenticated;
grant execute on function public.admin_search_players(text) to authenticated;

-- Audit rows are append-only. Only security-definer operations can insert them.
create policy platform_admin_audit_select
on public.platform_admin_audit_log for select to authenticated
using (public.is_platform_admin());
