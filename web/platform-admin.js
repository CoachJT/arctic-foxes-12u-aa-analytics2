// Secure client boundary for Platform Admin operations.
(function attachPlatformAdmin(global) {
  function requiredClient(client) {
    if (!client || typeof client.rpc !== 'function') throw new Error('A Supabase client is required.');
    return client;
  }

  async function rpc(client, name, args) {
    const { data, error } = await requiredClient(client).rpc(name, args);
    if (error) throw error;
    return data;
  }

  function createPlatformAdmin({ client }) {
    return {
      createOrganization: input => rpc(client, 'admin_create_organization', input),
      createTeam: input => rpc(client, 'admin_create_team', input),
      createSeason: input => rpc(client, 'admin_create_season', input),
      createInvite: input => rpc(client, 'admin_create_workspace_invite', input),
      revokeInvite: input => rpc(client, 'admin_revoke_workspace_invite', input),
      listUsers: input => rpc(client, 'admin_list_users', input || {}),
      listInvites: input => rpc(client, 'admin_list_invites', input || {}),
      listWorkspaceDetails: input => rpc(client, 'admin_list_workspace_details', input || {}),
      listTeamStats: input => rpc(client, 'admin_list_team_stats', input),
      searchPlayers: input => rpc(client, 'admin_search_players', input),
      createBadge: input => rpc(client, 'admin_create_badge', input),
      updateBadge: input => rpc(client, 'admin_update_badge', input),
      awardBadge: input => rpc(client, 'admin_award_badge', input),
      correctPlayerStat: input => rpc(client, 'admin_correct_player_stat', input),
      correctTeamStat: input => rpc(client, 'admin_correct_team_stat', input),
      updateBetaFeedback: input => rpc(client, 'admin_update_beta_feedback', input),
      requireAuthorization: () => rpc(client, 'platform_admin_required', {})
    };
  }

  global.FoxesPlatformAdmin = { createPlatformAdmin };
}(window));
