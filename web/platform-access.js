(function attachPlatformAccess(global) {
  // Platform access is resolved exclusively by the production authorization
  // function backed by platform_admins. Browser state is never authoritative.
  // A platform admin is valid with zero team memberships.
  function createPlatformAccess({ client }) {
    const context = {
      roles: [],
      isFounder: false,
      isPlatformAdmin: false,
      loading: false,
      error: ''
    };

    function apply(adminFlag, founderFlag = false) {
      context.roles = founderFlag === true
        ? ['founder']
        : adminFlag === true ? ['platform_admin'] : [];
      context.isFounder = founderFlag === true;
      context.isPlatformAdmin = adminFlag === true;
    }

    async function load() {
      context.loading = true;
      context.error = '';
      apply(false);
      const [{ data: adminFlag, error: adminError }, { data: founderFlag, error: founderError }] = await Promise.all([
        client.rpc('is_platform_admin'),
        client.rpc('is_platform_founder')
      ]);
      if (adminError || founderError) {
        context.loading = false;
        context.error = adminError?.message || founderError?.message || 'Platform access could not be resolved.';
        return context;
      }
      apply(adminFlag, founderFlag);
      context.loading = false;
      return context;
    }

    function clear() {
      apply(false);
      context.loading = false;
      context.error = '';
    }

    return { context, load, clear };
  }

  global.FoxesPlatformAccess = { createPlatformAccess };
}(window));
