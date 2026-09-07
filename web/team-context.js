(function attachTeamContext(global) {
  function createTeamContext({ client, storage = global.sessionStorage, preferredTeamSlug = 'arctic-foxes-12u-aa' }) {
    const context = {
      memberships: [],
      workspaces: [],
      selectedTeamId: '',
      selectedMembership: null,
      loading: false,
      error: ''
    };

    function rememberedTeamId() {
      return storage?.getItem('foxes-selected-team-id') || '';
    }

    function chooseMembership(memberships) {
      const remembered = memberships.find(membership => membership.team_id === rememberedTeamId());
      return remembered
        || memberships.find(membership => membership.teams?.slug === preferredTeamSlug)
        || memberships[0]
        || null;
    }

    function setAuthorizedWorkspaces(workspaces) {
      context.workspaces = Array.isArray(workspaces) ? workspaces.slice() : [];
      context.memberships = context.workspaces.map(workspace => ({
        team_id: workspace.team_id,
        role_id: workspace.role_id,
        status: workspace.membership_status,
        teams: {
          id: workspace.team_id,
          name: workspace.team_name,
          organization_id: workspace.organization_id
        },
        roles: { label: workspace.role_label },
        workspace
      }));
      const selected = chooseMembership(context.memberships);
      context.selectedTeamId = selected?.team_id || '';
      context.selectedMembership = selected || null;
      if (selected) storage?.setItem('pucknexus-selected-team-id', selected.team_id);
      return context;
    }

    async function load(userIdOrWorkspaces) {
      context.loading = true;
      context.error = '';
      if (Array.isArray(userIdOrWorkspaces)) {
        setAuthorizedWorkspaces(userIdOrWorkspaces);
        context.loading = false;
        return context;
      }
      if (client?.rpc) {
        const { data, error } = await client.rpc('list_authorized_workspaces');
        if (error) {
          context.loading = false;
          context.error = error.message || 'Authorized workspaces could not be loaded.';
          throw new Error(context.error);
        }
        setAuthorizedWorkspaces(data);
        context.loading = false;
        return context;
      }
      const { data, error } = await client
        .from('team_memberships')
        .select('team_id,role_id,status,teams(id,name,slug,organization_id),roles(label)')
        .eq('user_id', userIdOrWorkspaces)
        .eq('status', 'active');
      if (error) {
        context.loading = false;
        context.error = error.message || 'Team memberships could not be loaded.';
        throw new Error(context.error);
      }
      context.memberships = data || [];
      const selected = chooseMembership(context.memberships);
      context.selectedTeamId = selected?.team_id || '';
      context.selectedMembership = selected;
      if (selected) storage?.setItem('foxes-selected-team-id', selected.team_id);
      context.loading = false;
      return context;
    }

    function selectWorkspace(workspace) {
      if (!workspace || !context.workspaces.some(item => item.team_id === workspace.team_id)) {
        throw new Error('That team is not an active membership.');
      }
      setAuthorizedWorkspaces(context.workspaces);
      const membership = context.memberships.find(item => item.team_id === workspace.team_id);
      context.selectedTeamId = membership.team_id;
      context.selectedMembership = membership;
      storage?.setItem('pucknexus-selected-team-id', membership.team_id);
      return membership;
    }

    function select(teamId) {
      const membership = context.memberships.find(item => item.team_id === teamId);
      if (!membership) throw new Error('That team is not an active membership.');
      context.selectedTeamId = membership.team_id;
      context.selectedMembership = membership;
      storage?.setItem('foxes-selected-team-id', membership.team_id);
      return membership;
    }

    function clearSelection() {
      context.selectedTeamId = '';
      context.selectedMembership = null;
    }

    return { context, load, select, selectWorkspace, setAuthorizedWorkspaces, clearSelection };
  }

  global.FoxesTeamContext = { createTeamContext };
}(window));
