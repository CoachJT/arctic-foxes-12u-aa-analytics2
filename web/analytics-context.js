(function attachPuckNexusAnalyticsContext(global) {
  'use strict';

  const TABLES = Object.freeze({
    impact: 'team_game_impact_results',
    trends: 'team_player_trend_results',
    mvp: 'team_game_mvp_results',
    awards: 'team_season_awards',
    feedback: 'team_player_feedback',
    reviews: 'team_analytics_reviews',
    audit: 'team_analytics_audit_log'
  });

  function createAnalyticsContext({ client, getWorkspace }) {
    if (!client || typeof client.from !== 'function') throw new TypeError('A Supabase client is required.');
    if (typeof getWorkspace !== 'function') throw new TypeError('getWorkspace must provide the selected team and season.');

    const context = {
      impact: [],
      trends: [],
      mvp: [],
      awards: [],
      loading: false,
      error: ''
    };

    function scope() {
      const workspace = getWorkspace() || {};
      const teamId = String(workspace.team_id || workspace.teamId || '').trim();
      const seasonId = String(workspace.season_id || workspace.seasonId || '').trim();
      if (!teamId || !seasonId) throw new Error('A selected team and season are required for analytics.');
      return { team_id: teamId, season_id: seasonId };
    }

    function query(table, columns = '*') {
      const tenant = scope();
      return client.from(table).select(columns)
        .eq('team_id', tenant.team_id)
        .eq('season_id', tenant.season_id);
    }

    async function load() {
      context.loading = true;
      context.error = '';
      const requests = ['impact', 'trends', 'mvp', 'awards'].map(key => query(TABLES[key]));
      const responses = await Promise.all(requests);
      const failed = responses.find(response => response.error);
      if (failed) {
        context.loading = false;
        context.error = failed.error.message || 'Analytics could not be loaded.';
        throw new Error(context.error);
      }
      ['impact', 'trends', 'mvp', 'awards'].forEach((key, index) => {
        context[key] = responses[index].data || [];
      });
      context.loading = false;
      return context;
    }

    function clear() {
      context.impact = [];
      context.trends = [];
      context.mvp = [];
      context.awards = [];
      context.loading = false;
      context.error = '';
    }

    return Object.freeze({ context, scope, query, load, clear, TABLES });
  }

  global.PuckNexusAnalyticsContext = Object.freeze({ createAnalyticsContext, TABLES });
}(window));
