-- Stage F continuation: private media metadata, quotas, and support reports.
-- Additive only. Buckets are private and no production data is created here.

insert into storage.buckets (id, name, public)
values
  ('game-film', 'game-film', false),
  ('branding', 'branding', false),
  ('support-attachments', 'support-attachments', false),
  ('reports', 'reports', false),
  ('player-media', 'player-media', false),
  ('clips', 'clips', false)
on conflict (id) do update set public = false;
create table public.support_reports (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  season_id uuid references public.seasons(id) on delete set null,
  report_type text not null check (report_type in ('bug', 'feature_request', 'question')),
  subject text not null check (length(trim(subject)) between 1 and 200),
  description text not null check (length(trim(description)) between 1 and 10000),
  status text not null default 'new' check (status in ('new', 'investigating', 'fixed', 'closed')),
  priority text check (priority is null or priority in ('low', 'normal', 'high', 'urgent')),
  page_route text,
  app_version text,
  browser_name text,
  browser_version text,
  os_name text,
  device_type text,
  diagnostics jsonb check (diagnostics is null or jsonb_typeof(diagnostics) = 'object'),
  screenshot_asset_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null
);
create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  season_id uuid references public.seasons(id) on delete set null,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  asset_type text not null check (asset_type in ('game_film', 'clip', 'branding', 'support_attachment', 'report', 'player_media', 'export', 'chat_attachment')),
  bucket_name text not null,
  object_path text not null unique,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  status text not null default 'pending' check (status in ('pending', 'uploaded', 'failed', 'deleted')),
  game_id uuid,
  player_id uuid,
  support_report_id uuid references public.support_reports(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table public.support_reports
  add constraint support_reports_screenshot_asset_fk
  foreign key (screenshot_asset_id) references public.media_assets(id) on delete set null;
create or replace function public.normalize_support_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.created_by := (select auth.uid());
  new.subject := trim(new.subject);
  new.description := trim(new.description);
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists support_reports_normalize on public.support_reports;
create trigger support_reports_normalize
before insert on public.support_reports
for each row execute function public.normalize_support_report();
create table public.plan_storage_quotas (
  plan_id text primary key references public.plan_catalog(plan_id) on delete cascade,
  quota_bytes bigint check (quota_bytes is null or quota_bytes >= 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  updated_at timestamptz not null default now()
);
create index media_assets_workspace_idx
  on public.media_assets(organization_id, team_id, season_id, asset_type, status);
create index media_assets_uploaded_by_idx on public.media_assets(uploaded_by, created_at desc);
create index media_assets_support_report_idx on public.media_assets(support_report_id);
create index support_reports_created_by_idx on public.support_reports(created_by, created_at desc);
create index support_reports_workspace_idx on public.support_reports(organization_id, team_id, season_id);
create view public.media_storage_usage as
select organization_id, team_id, season_id, asset_type,
       coalesce(sum(size_bytes) filter (where status <> 'deleted' and deleted_at is null), 0)::bigint as bytes_used,
       count(*) filter (where status <> 'deleted' and deleted_at is null)::bigint as asset_count
from public.media_assets
group by organization_id, team_id, season_id, asset_type;
create or replace function public.create_media_asset(
  target_organization_id uuid,
  target_team_id uuid,
  target_season_id uuid,
  requested_asset_type text,
  requested_filename text,
  requested_mime_type text,
  requested_size_bytes bigint,
  target_game_id uuid default null,
  target_player_id uuid default null,
  target_support_report_id uuid default null
)
returns table (asset_id uuid, bucket_name text, object_path text)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid := gen_random_uuid();
  safe_filename text := regexp_replace(coalesce(requested_filename, 'upload'), '[^A-Za-z0-9._-]+', '_', 'g');
  target_bucket text;
  current_usage bigint;
  quota bigint;
begin
  if requested_size_bytes is null or requested_size_bytes < 0 then
    raise exception 'A valid upload size is required.';
  end if;
  if target_team_id is null
     or not exists (
       select 1 from public.teams team
       where team.id = target_team_id
         and team.organization_id = target_organization_id
     )
     or not public.can_access_team_season(target_team_id, target_season_id) then
    raise exception 'The selected team and season are not authorized.';
  end if;
  if not public.has_workspace_feature_access(
    target_team_id,
    case when requested_asset_type in ('game_film', 'clip') then 'games.view' else 'players.view' end,
    case when requested_asset_type in ('game_film', 'clip') then 'film' else 'players' end
  ) then
    raise exception 'The current workspace cannot upload this asset type.';
  end if;
  target_bucket := case requested_asset_type
    when 'game_film' then 'game-film'
    when 'clip' then 'clips'
    when 'branding' then 'branding'
    when 'support_attachment' then 'support-attachments'
    when 'report' then 'reports'
    when 'player_media' then 'player-media'
    when 'export' then 'reports'
    when 'chat_attachment' then 'clips'
    else null
  end;
  if target_bucket is null then raise exception 'Unsupported media asset type.'; end if;
  select coalesce(sum(size_bytes), 0) into current_usage
  from public.media_assets
  where organization_id = target_organization_id and status <> 'deleted' and deleted_at is null;
  select quota_bytes into quota
  from public.plan_storage_quotas
  where plan_id = public.resolve_workspace_plan(target_team_id);
  if quota is not null and current_usage + requested_size_bytes > quota then
    raise exception 'Storage limit reached';
  end if;
  insert into public.media_assets (
    id, organization_id, team_id, season_id, uploaded_by, asset_type,
    bucket_name, object_path, original_filename, mime_type, size_bytes,
    game_id, player_id, support_report_id
  )
  values (
    new_id, target_organization_id, target_team_id, target_season_id,
    (select auth.uid()), requested_asset_type, target_bucket,
    case when requested_asset_type = 'support_attachment'
      then 'support/' || new_id::text || '/' || safe_filename
      else target_organization_id::text || '/' || target_team_id::text || '/' ||
        coalesce(target_season_id::text, 'unseasoned') || '/' || requested_asset_type ||
        '/' || coalesce(target_game_id::text, coalesce(target_player_id::text, new_id::text)) ||
        '/' || safe_filename
    end,
    coalesce(requested_filename, safe_filename), requested_mime_type, requested_size_bytes,
    target_game_id, target_player_id, target_support_report_id
  );
  return query select id, media_assets.bucket_name, media_assets.object_path
  from public.media_assets where id = new_id;
end;
$$;
create or replace function public.set_media_asset_status(target_asset_id uuid, next_status text)
returns boolean
language sql
security definer
set search_path = public
as $$
  update public.media_assets
  set status = next_status,
      updated_at = now(),
      deleted_at = case when next_status = 'deleted' then now() else null end
  where id = target_asset_id
    and uploaded_by = (select auth.uid())
    and next_status in ('uploaded', 'failed', 'deleted')
  returning true;
$$;
alter table public.media_assets enable row level security;
alter table public.support_reports enable row level security;
alter table public.plan_storage_quotas enable row level security;
create policy media_assets_select
on public.media_assets for select to authenticated
using (
  uploaded_by = (select auth.uid())
  or (
    team_id is not null
    and public.can_access_team_season(team_id, season_id)
    and public.has_workspace_feature_access(
      team_id,
      case when asset_type in ('game_film', 'clip') then 'games.view' else 'players.view' end,
      case when asset_type in ('game_film', 'clip') then 'film' else 'players' end
    )
  )
);
create policy support_reports_insert
on public.support_reports for insert to authenticated
with check (created_by = (select auth.uid()));
create policy support_reports_select_own
on public.support_reports for select to authenticated
using (created_by = (select auth.uid()));
create policy plan_storage_quotas_select
on public.plan_storage_quotas for select to authenticated
using (exists (
  select 1
  from public.team_memberships membership
  where membership.user_id = (select auth.uid())
    and membership.status = 'active'
));
revoke all on public.media_assets, public.support_reports, public.plan_storage_quotas from anon;
grant select on public.media_assets, public.support_reports, public.plan_storage_quotas to authenticated;
grant execute on function public.create_media_asset(uuid, uuid, uuid, text, text, text, bigint, uuid, uuid, uuid) to authenticated;
grant execute on function public.set_media_asset_status(uuid, text) to authenticated;
create policy storage_objects_select_private_media
on storage.objects for select to authenticated
using (exists (
  select 1 from public.media_assets asset
  where asset.bucket_name = bucket_id
    and asset.object_path = name
    and asset.status <> 'deleted'
));
create policy storage_objects_insert_private_media
on storage.objects for insert to authenticated
with check (exists (
  select 1 from public.media_assets asset
  where asset.bucket_name = bucket_id
    and asset.object_path = name
    and asset.uploaded_by = (select auth.uid())
));
