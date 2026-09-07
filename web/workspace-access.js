(function attachWorkspaceAccess(global) {
  function firstRow(data) {
    return Array.isArray(data) ? data[0] || null : data || null;
  }

  function normalizeWorkspace(row) {
    if (!row) return null;
    return {
      organization_id: row.organization_id || '',
      organization_name: row.organization_name || '',
      team_id: row.team_id || '',
      team_name: row.team_name || '',
      season_id: row.season_id || '',
      season_name: row.season_name || '',
      membership_status: row.membership_status || '',
      role_id: row.role_id || '',
      role_label: row.role_label || row.role_id || '',
      effective_capabilities: Array.isArray(row.effective_capabilities) ? row.effective_capabilities : [],
      plan_id: row.plan_id || null,
      effective_features: Array.isArray(row.effective_features) ? row.effective_features : [],
      branding: {
        display_name: row.branding_display_name || row.team_name || 'Selected Team',
        short_name: row.branding_short_name || 'PN',
        logo_url: row.branding_logo_url || '',
        primary_color: row.branding_primary_color || '',
        secondary_color: row.branding_secondary_color || '',
        accent_color: row.branding_accent_color || ''
      },
      authorized: row.authorized === true
    };
  }

  function createWorkspaceAccess({ client, storage = global.sessionStorage }) {
    const context = {
      workspaces: [],
      currentWorkspace: null,
      loading: false,
      error: ''
    };

    function authorizedWorkspaces(data) {
      return (Array.isArray(data) ? data : [])
        .map(normalizeWorkspace)
        .filter(workspace => workspace.authorized && workspace.organization_id && workspace.team_id);
    }

    async function loadAuthorizedWorkspaces() {
      context.loading = true;
      context.error = '';
      const { data, error } = await client.rpc('list_authorized_workspaces');
      if (error) {
        context.loading = false;
        context.error = error.message || 'Authorized workspaces could not be loaded.';
        throw new Error(context.error);
      }
      context.workspaces = authorizedWorkspaces(data);
      context.loading = false;
      return context.workspaces.slice();
    }

    function remembered(key) {
      return storage?.getItem(key) || '';
    }

    function chooseWorkspace() {
      const workspaces = context.workspaces;
      const rememberedOrganization = remembered('pucknexus-selected-organization-id');
      const rememberedTeam = remembered('pucknexus-selected-team-id') || remembered('foxes-selected-team-id');
      const rememberedSeason = remembered('pucknexus-selected-season-id') || remembered('foxes-selected-season-id');
      return workspaces.find(workspace =>
        workspace.organization_id === rememberedOrganization
        && workspace.team_id === rememberedTeam
        && (!rememberedSeason || workspace.season_id === rememberedSeason)
      ) || workspaces.find(workspace =>
        workspace.organization_id === rememberedOrganization
        && workspace.team_id === rememberedTeam
      ) || workspaces.find(workspace => workspace.team_id === rememberedTeam)
        || workspaces[0]
        || null;
    }

    async function resolveWorkspace(organizationId, teamId, seasonId = null) {
      context.error = '';
      const { data, error } = await client.rpc('resolve_workspace_access', {
        target_organization_id: organizationId,
        target_team_id: teamId,
        target_season_id: seasonId || null
      });
      const workspace = normalizeWorkspace(firstRow(data));
      if (error || !workspace?.authorized) {
        context.error = error?.message || 'That workspace is not authorized.';
        context.currentWorkspace = null;
        throw new Error(context.error);
      }
      context.currentWorkspace = workspace;
      return workspace;
    }

    function persistPreference(workspace) {
      if (!workspace) return;
      storage?.setItem('pucknexus-selected-organization-id', workspace.organization_id);
      storage?.setItem('pucknexus-selected-team-id', workspace.team_id);
      if (workspace.season_id) storage?.setItem('pucknexus-selected-season-id', workspace.season_id);
    }

    function clearWorkspace() {
      context.currentWorkspace = null;
    }

    function getCurrentWorkspace() {
      return context.currentWorkspace;
    }

    function hasFeature(featureKey) {
      return Boolean(context.currentWorkspace?.effective_features?.includes(featureKey));
    }

    function hasCapability(capabilityKey) {
      return Boolean(context.currentWorkspace?.effective_capabilities?.includes(capabilityKey));
    }

    return {
      context,
      loadAuthorizedWorkspaces,
      chooseWorkspace,
      resolveWorkspace,
      persistPreference,
      clearWorkspace,
      getCurrentWorkspace,
      hasFeature,
      hasCapability,
      normalizeWorkspace
    };
  }

  global.FoxesWorkspaceAccess = { createWorkspaceAccess, normalizeWorkspace };
}(window));
