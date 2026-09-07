(function attachOrganizationContext(global) {
  function createOrganizationContext({ storage = global.sessionStorage }) {
    const context = {
      organizations: [],
      selectedOrganizationId: '',
      selectedOrganization: null,
      loading: false,
      error: ''
    };

    function load(workspaces) {
      const byId = new Map();
      (workspaces || []).forEach(workspace => {
        if (!byId.has(workspace.organization_id)) {
          byId.set(workspace.organization_id, {
            id: workspace.organization_id,
            name: workspace.organization_name,
            workspaces: []
          });
        }
        byId.get(workspace.organization_id).workspaces.push(workspace);
      });
      context.organizations = Array.from(byId.values());
      const rememberedId = storage?.getItem('pucknexus-selected-organization-id');
      const selected = context.organizations.find(item => item.id === rememberedId)
        || context.organizations[0]
        || null;
      context.selectedOrganizationId = selected?.id || '';
      context.selectedOrganization = selected;
      if (selected) storage?.setItem('pucknexus-selected-organization-id', selected.id);
      return context;
    }

    function select(organizationId) {
      const organization = context.organizations.find(item => item.id === organizationId);
      if (!organization) throw new Error('That organization is not authorized.');
      context.selectedOrganizationId = organization.id;
      context.selectedOrganization = organization;
      storage?.setItem('pucknexus-selected-organization-id', organization.id);
      return organization;
    }

    function teamsForSelectedOrganization(workspaces) {
      return (workspaces || []).filter(workspace =>
        workspace.organization_id === context.selectedOrganizationId
      );
    }

    function clear() {
      context.selectedOrganizationId = '';
      context.selectedOrganization = null;
      context.organizations = [];
    }

    return { context, load, select, teamsForSelectedOrganization, clear };
  }

  global.FoxesOrganizationContext = { createOrganizationContext };
}(window));
