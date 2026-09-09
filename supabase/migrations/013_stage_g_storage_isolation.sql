-- Stage G production-readiness correction.
-- Keep private storage access tied to the authorized workspace or uploader.

drop policy if exists storage_objects_select_private_media on storage.objects;
create policy storage_objects_select_private_media
on storage.objects for select
to authenticated
using (
  exists (
    select 1
    from public.media_assets asset
    where asset.bucket_name = bucket_id
      and asset.object_path = name
      and asset.status <> 'deleted'
      and (
        asset.uploaded_by = (select auth.uid())
        or (
          asset.team_id is not null
          and public.can_access_team_season(asset.team_id, asset.season_id)
          and public.has_workspace_feature_access(
            asset.team_id,
            case
              when asset.asset_type in ('game_film', 'clip')
                then 'games.view'
              else 'players.view'
            end,
            case
              when asset.asset_type in ('game_film', 'clip')
                then 'film'
              else 'players'
            end
          )
        )
      )
  )
);
drop policy if exists support_reports_insert on public.support_reports;
create policy support_reports_insert
on public.support_reports for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and (
    (
      team_id is not null
      and exists (
        select 1
        from public.teams team
        where team.id = support_reports.team_id
          and team.organization_id = support_reports.organization_id
      )
      and public.is_team_member(team_id)
      and (
        season_id is null
        or public.can_access_team_season(team_id, season_id)
      )
    )
    or (
      team_id is null
      and (
        organization_id is null
        or public.is_org_member(organization_id)
      )
    )
  )
);
create or replace function public.validate_support_report_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.created_by := (select auth.uid());

  if new.team_id is not null then
    if not exists (
      select 1
      from public.teams team
      where team.id = new.team_id
        and team.organization_id = new.organization_id
    ) then
      raise exception 'Support report team must belong to its organization.';
    end if;

    if new.season_id is not null
       and not exists (
         select 1
         from public.seasons season
         where season.id = new.season_id
           and season.team_id = new.team_id
       ) then
      raise exception 'Support report season must belong to its team.';
    end if;
  elsif new.season_id is not null then
    raise exception 'A support report season requires a team.';
  end if;

  return new;
end;
$$;
drop trigger if exists support_reports_validate_scope on public.support_reports;
create trigger support_reports_validate_scope
before insert or update of organization_id, team_id, season_id
on public.support_reports
for each row execute function public.validate_support_report_scope();
revoke all on function public.validate_support_report_scope() from public, anon, authenticated;
do $$
begin
  if exists (
    select 1
    from pg_policies policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
      and policy.policyname = 'storage_objects_select_private_media'
      and policy.qual not like '%can_access_team_season%'
  ) then
    raise exception 'Private media policy does not enforce workspace access.';
  end if;
end;
$$;
