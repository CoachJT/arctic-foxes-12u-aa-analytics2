(function attachDestinationResolver(global) {
  // Central post-auth destination resolver for PuckNexus.
  //
  // The resolver consumes only authoritative, server-resolved state:
  //   - the Supabase auth user (session)
  //   - database-backed platform access (web/platform-access.js)
  //   - database-backed team memberships (web/team-context.js)
  //
  // It never reads browser storage, URL parameters, or editable client state,
  // and route/destination names are never treated as permissions.
  //
  // Onboarding definition (Stage 5): an account routes to onboarding only when
  // a real, incomplete onboarding_progress row exists, or when the account has
  // invited (not yet active) memberships and no active membership — the
  // pre-onboarding invited path. Progress is database-backed; browser-only
  // flags are never authoritative.
  const DESTINATIONS = Object.freeze({
    SIGNED_OUT: 'signed_out',
    PLATFORM_ADMIN: 'platform_admin',
    TEAM_WORKSPACE: 'team_workspace',
    ONBOARDING: 'onboarding',
    NO_ACCESS: 'no_access'
  });

  function activeMemberships(memberships) {
    return (memberships || []).filter(membership => membership.status === 'active');
  }

  function pendingMemberships(memberships) {
    return (memberships || []).filter(membership => membership.status === 'invited');
  }

  function onboardingIncomplete(progress) {
    return Boolean(progress && !progress.completed_at);
  }

  function resolveDestination({ user, platformAccess, memberships, pendingMemberships: pending, onboardingProgress = null } = {}) {
    if (!user) return { state: DESTINATIONS.SIGNED_OUT };
    const active = activeMemberships(memberships);
    // Platform authorization is global and never depends on team membership.
    if (platformAccess?.isPlatformAdmin) {
      return { state: DESTINATIONS.PLATFORM_ADMIN, roles: platformAccess.roles || [], memberships: active };
    }
    if (onboardingIncomplete(onboardingProgress)) {
      return { state: DESTINATIONS.ONBOARDING, progress: onboardingProgress, memberships: active };
    }
    if (active.length) return { state: DESTINATIONS.TEAM_WORKSPACE, memberships: active };
    const invited = pendingMemberships(pending);
    if (invited.length) return { state: DESTINATIONS.ONBOARDING, pending: invited };
    return { state: DESTINATIONS.NO_ACCESS };
  }

  global.FoxesDestinationResolver = { DESTINATIONS, resolveDestination, activeMemberships, pendingMemberships, onboardingIncomplete };
}(window));
