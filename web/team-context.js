(function attachTeamContext(global) {
  function createTeamContext({ client, storage = global.sessionStorage, preferredTeamSlug = 'arctic-foxes-12u-aa' }) {
    const context = {
      memberships: [],
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

    async function load(userId) {
      context.loading = true;
      context.error = '';
      const { data, error } = await client
        .from('team_memberships')
        .select('team_id,role_id,status,teams(id,name,slug,organization_id),roles(label)')
        .eq('user_id', userId)
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

    return { context, load, select, clearSelection };
  }

  global.FoxesTeamContext = { createTeamContext };
}(window));
