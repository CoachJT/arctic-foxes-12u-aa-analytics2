-- Migration 026: guarded team resolution for the staff invite path.
--
-- PRODUCTION OUTAGE CONTEXT
-- -------------------------
-- Commit 66d81f0 changed invite-staff's getOwnerContext() from resolving the
-- team through the *caller's* client to resolving it through the *service-role*
-- client, so that a platform admin with zero team memberships could still
-- manage invites (public.teams RLS is `teams_select_for_members`, which hides
-- the row from a non-member).
--
-- That change assumed the service role bypasses everything. It does not: RLS is
-- bypassed, but table-level privileges still apply, and migration 002 granted
-- service_role SELECT on only `profiles` and `team_memberships`. `teams` was
-- never granted. Every invite-staff invocation therefore failed with
--   42501 permission denied for table teams
-- before doing any work, breaking `list`, `invite` and `resend` for every team.
--
-- This is the same defect class as migration 025 (an RLS policy without the
-- matching GRANT).
--
-- FIX POSTURE
-- -----------
-- We deliberately do NOT `grant select on public.teams to service_role`. That
-- would restore the feature but hand the invite function unrestricted read
-- access to every team on the platform, which is broader than the operation
-- requires. Instead this migration adds a narrowly-scoped SECURITY DEFINER
-- resolver that performs the lookup *and* the authorization in one step, under
-- the caller's own identity.
--
-- Properties:
--   * Runs as the function owner, so it can read `teams` without the caller
--     needing membership -- which is exactly the platform-admin case that
--     motivated 66d81f0.
--   * Returns rows only when the caller holds `admin.users` on that team or is
--     a platform admin. An unauthorized caller and a non-existent team are
--     indistinguishable (both return zero rows), so this cannot be used to
--     enumerate teams or probe slugs.
--   * Returns the authorization flags alongside the team, so the Edge Function
--     has a single authoritative source for `canManageTeam` / `isPlatformAdmin`
--     instead of three separate round trips that could drift apart.
--   * Read-only. It cannot create, mutate, or delete anything.
--
-- This migration is additive and forward-only. It does not alter existing
-- tables, policies, grants, or the workspace_invites lifecycle.

create or replace function public.resolve_invite_team(
  target_team_slug text default null,
  target_team_id uuid default null
)
returns table (
  team_id uuid,
  team_name text,
  team_slug text,
  organization_id uuid,
  can_manage_team boolean,
  is_platform_admin boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  found_team public.teams%rowtype;
  caller_manages boolean := false;
  caller_is_platform_admin boolean := false;
  normalized_slug text := nullif(btrim(coalesce(target_team_slug, '')), '');
begin
  if caller_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if normalized_slug is null and target_team_id is null then
    raise exception 'A valid team is required.' using errcode = '22023';
  end if;

  -- Prefer the explicit id when both are supplied.
  if target_team_id is not null then
    select * into found_team from public.teams t where t.id = target_team_id;
  else
    select * into found_team from public.teams t where t.slug = lower(normalized_slug);
  end if;

  if found_team.id is null then
    -- Unknown team. Return no rows rather than raising, so that a missing team
    -- and an unauthorized team look identical to the caller.
    return;
  end if;

  caller_is_platform_admin := coalesce(public.is_platform_admin(), false);
  caller_manages := coalesce(
    public.has_team_capability(found_team.id, 'admin.users'),
    false
  );

  if not (caller_manages or caller_is_platform_admin) then
    return;
  end if;

  return query
    select
      found_team.id,
      found_team.name,
      found_team.slug,
      found_team.organization_id,
      caller_manages,
      caller_is_platform_admin;
end;
$$;

comment on function public.resolve_invite_team(text, uuid) is
  'Resolves a team for the staff invite path and authorizes the caller in one '
  'step. Returns a row only when the caller holds admin.users on the team or is '
  'a platform admin; returns zero rows for both unknown and unauthorized teams '
  'so teams cannot be enumerated. Read-only. Exists so invite-staff never needs '
  'service_role SELECT on public.teams.';

revoke all on function public.resolve_invite_team(text, uuid) from public;
revoke all on function public.resolve_invite_team(text, uuid) from anon;
grant execute on function public.resolve_invite_team(text, uuid) to authenticated;
