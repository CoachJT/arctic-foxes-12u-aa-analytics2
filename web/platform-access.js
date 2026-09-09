(function attachPlatformAccess(global) {
  // Platform access is resolved exclusively from the database: the caller's own
  // platform_roles rows plus the authoritative is_platform_admin() RPC. Browser
  // storage, URL parameters, and editable client state are never consulted.
  // A platform admin is valid with zero team memberships.
  function createPlatformAccess({ client }) {
    const context = {
      roles: [],
      isFounder: false,
      isPlatformAdmin: false,
      loading: false,
      error: ''
    };

    function apply(roles, adminFlag) {
      context.roles = roles;
      context.isFounder = roles.includes('founder');
      context.isPlatformAdmin = adminFlag === true;
    }

    async function load() {
      context.loading = true;
      context.error = '';
      apply([], false);
      const [{ data: rows, error: rolesError }, { data: adminFlag, error: adminError }] = await Promise.all([
        client.from('platform_roles').select('role,status'),
        client.rpc('is_platform_admin')
      ]);
      if (rolesError || adminError) {
        context.loading = false;
        context.error = rolesError?.message || adminError?.message || 'Platform access could not be resolved.';
        return context;
      }
      const roles = (rows || [])
        .filter(row => row.status === 'active')
        .map(row => row.role);
      apply(roles, adminFlag);
      context.loading = false;
      return context;
    }

    function clear() {
      apply([], false);
      context.loading = false;
      context.error = '';
    }

    return { context, load, clear };
  }

  global.FoxesPlatformAccess = { createPlatformAccess };
}(window));
