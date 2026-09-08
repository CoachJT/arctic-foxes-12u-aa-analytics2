/* Tenant-scoped persistence hooks for the PuckNexus analytics contract. */
(function attachAnalyticsRepository(root, factory) {
  const analytics = typeof module === 'object' && module.exports
    ? require('./pucknexus-analytics')
    : root.PuckNexusAnalytics;
  const api = factory(analytics);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PuckNexusAnalyticsRepository = api;
}(globalThis, function createAnalyticsRepositoryModule(analytics) {
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

  function createRepository(client, scopeProvider) {
    if (!client || typeof client.from !== 'function') throw new TypeError('A Supabase client is required.');

    function scope() {
      const current = typeof scopeProvider === 'function' ? scopeProvider() : scopeProvider;
      return analytics.requireTenantScope(current);
    }

    function read(table, columns = '*') {
      const tenant = scope();
      return client.from(table).select(columns)
        .eq('team_id', tenant.team_id)
        .eq('season_id', tenant.season_id);
    }

    function scopedPayload(payload) {
      const tenant = scope();
      const rows = (Array.isArray(payload) ? payload : [payload]).map((row, index) => {
        if ((row.team_id && row.team_id !== tenant.team_id)
          || (row.season_id && row.season_id !== tenant.season_id)) {
          throw new Error(`Tenant scope mismatch at row ${index}.`);
        }
        return { ...row, ...tenant };
      });
      analytics.assertTenantRows(tenant, rows);
      return { tenant, rows };
    }

    async function upsert(table, payload, onConflict) {
      const { rows } = scopedPayload(payload);
      if (!rows.length) return [];
      const { data, error } = await client.from(table).upsert(rows, { onConflict }).select();
      if (error) throw error;
      return data || [];
    }

    async function insert(table, payload) {
      const { rows } = scopedPayload(payload);
      const { data, error } = await client.from(table).insert(rows).select();
      if (error) throw error;
      return data || [];
    }

    function buildGameProjection(sourceGameId, stats, options = {}) {
      const tenant = scope();
      const gameId = String(sourceGameId || '').trim();
      if (!gameId) throw new TypeError('source_game_id is required.');
      const calculatedAt = options.calculatedAt || new Date().toISOString();
      const scopedStats = stats.map((row, index) => {
        if ((row.team_id && row.team_id !== tenant.team_id)
          || (row.season_id && row.season_id !== tenant.season_id)) {
          throw new Error(`Tenant scope mismatch at row ${index}.`);
        }
        return { ...row, ...tenant, source_game_id: gameId };
      });
      const result = analytics.rankGameMvp(scopedStats, options);
      const impacts = result.rankings.map(ranking => ({
        ...tenant,
        source_game_id: gameId,
        source_player_id: ranking.inputs.source_player_id,
        player_type: ranking.player_type,
        position: ranking.position,
        impact_score: ranking.impact_score,
        ranking_score: ranking.ranking_score,
        rank: ranking.rank,
        model_version: ranking.model_version,
        contract_version: ranking.contract_version,
        inputs: ranking.inputs,
        breakdown: ranking.breakdown,
        computed_at: calculatedAt
      }));
      const official = result.rankings[0] || null;
      const mvp = official ? Object.freeze({
          ...tenant,
          source_game_id: gameId,
          source_player_id: result.winner_id,
          predicted_source_player_id: result.winner_id,
          position: official.position,
          impact_score: official.impact_score,
          breakdown: official.breakdown,
          tie_candidate_ids: result.tie_candidate_ids,
          is_tie: result.is_tie,
          selection_type: 'automatic',
          model_version: result.model_version,
          contract_version: result.contract_version,
          calculated_at: calculatedAt
        }) : null;
      const awardResults = [
        ...scopedStats.flatMap(row => analytics.goalieAwards({ ...row, ...options.teamStats })),
        ...analytics.teamAwards(options.teamStats || {}, scopedStats)
      ];
      const awards = awardResults.map(award => Object.freeze({
        ...tenant,
        source_game_id: gameId,
        source_player_id: award.source_player_id,
        subject_key: award.source_player_id || 'team',
        award_key: award.award_key,
        award_scope: award.award_scope,
        metric_name: 'rule_match',
        metric_value: 1,
        rank: 1,
        is_tie: false,
        status: 'draft',
        rule_version: award.rule_version,
        contract_version: award.contract_version,
        evidence: award.evidence
      }));
      return Object.freeze({ impacts, mvp, awards });
    }

    function buildGameRecalculation(sourceGameId, stats, options = {}) {
      const revision = String(options.statsRevision || '').trim();
      if (!revision) throw new TypeError('statsRevision is required for idempotent recalculation.');
      const projection = buildGameProjection(sourceGameId, stats, options);
      const gameId = String(sourceGameId).trim();
      return Object.freeze({
        ...projection,
        replacement_scope: Object.freeze({
          ...scope(),
          source_game_id: gameId,
          impact_model_version: analytics.IMPACT_MODEL_VERSION,
          award_rule_version: analytics.AWARD_RULE_VERSION
        }),
        audit: analytics.auditRecord(scope(), {
          action: 'game_analytics.recalculated',
          resource_type: 'game',
          resource_id: gameId,
          idempotency_key: `${gameId}:${revision}:${analytics.IMPACT_MODEL_VERSION}:${analytics.AWARD_RULE_VERSION}`,
          before_state: options.beforeState || null,
          after_state: {
            impact_count: projection.impacts.length,
            official_mvp_player_id: projection.mvp?.source_player_id || null,
            predicted_mvp_player_id: projection.mvp?.predicted_source_player_id || null,
            award_codes: projection.awards.map(row => row.award_key).sort()
          },
          metadata: { stats_revision: revision }
        })
      });
    }

    async function saveGameRecalculation(calculation) {
      if (!calculation?.replacement_scope || !calculation?.audit) {
        throw new TypeError('A buildGameRecalculation result is required.');
      }
      const { replacement_scope: replacement, audit } = calculation;
      const { data, error } = await client.rpc('replace_pucknexus_game_analytics_v1', {
        target_team_id: replacement.team_id,
        target_season_id: replacement.season_id,
        target_source_game_id: replacement.source_game_id,
        target_idempotency_key: audit.idempotency_key,
        target_impacts: calculation.impacts,
        target_mvp: calculation.mvp,
        target_awards: calculation.awards
      });
      if (error) throw error;
      return data;
    }

    function buildTrendProjection(sourcePlayerId, samples, options = {}) {
      const tenant = scope();
      const playerId = String(sourcePlayerId || '').trim();
      if (!playerId) throw new TypeError('source_player_id is required.');
      const trend = analytics.calculateTrend(samples, options);
      const dated = samples.map(sample => sample && typeof sample === 'object'
        ? sample.computed_at || sample.date || ''
        : '').filter(Boolean).sort();
      const windowEndsAt = options.windowEndsAt || dated.at(-1);
      if (!windowEndsAt || Number.isNaN(new Date(windowEndsAt).getTime())) {
        throw new TypeError('A valid windowEndsAt or dated sample is required.');
      }
      return Object.freeze({
        ...tenant,
        source_game_id: options.sourceGameId || null,
        source_player_id: playerId,
        direction: trend.direction,
        sample_size: trend.sample_size,
        slope: trend.slope,
        delta: trend.delta,
        average: trend.average,
        first_value: trend.first ?? null,
        latest_value: trend.latest ?? null,
        window_starts_at: options.windowStartsAt || dated[0] || null,
        window_ends_at: windowEndsAt,
        model_version: trend.model_version,
        contract_version: trend.contract_version
      });
    }

    function buildAwardProjection(stats, options = {}) {
      const tenant = scope();
      return analytics.seasonAwards(stats.map((row, index) => {
        if ((row.team_id && row.team_id !== tenant.team_id)
          || (row.season_id && row.season_id !== tenant.season_id)) {
          throw new Error(`Tenant scope mismatch at row ${index}.`);
        }
        return { ...row, ...tenant };
      }), options).flatMap(award => award.winners.map(winner => Object.freeze({
        ...tenant,
        source_game_id: '',
        source_player_id: winner.source_player_id,
        subject_key: winner.source_player_id,
        award_key: award.award_key,
        award_scope: award.award_scope,
        metric_name: award.metric,
        metric_value: winner.metric_value,
        rank: 1,
        is_tie: award.is_tie,
        status: 'draft',
        rule_version: award.rule_version,
        contract_version: award.contract_version,
        evidence: {}
      })));
    }

    return Object.freeze({
      TABLES,
      scope,
      buildGameProjection,
      buildGameRecalculation,
      saveGameRecalculation,
      buildTrendProjection,
      buildAwardProjection,
      listImpact: columns => read(TABLES.impact, columns),
      listTrends: columns => read(TABLES.trends, columns),
      listMvp: columns => read(TABLES.mvp, columns),
      listAwards: columns => read(TABLES.awards, columns),
      listFeedback: columns => read(TABLES.feedback, columns),
      listReviews: columns => read(TABLES.reviews, columns),
      listAudit: columns => read(TABLES.audit, columns),
      saveImpact: rows => upsert(TABLES.impact, rows,
        'team_id,season_id,source_game_id,source_player_id,model_version'),
      saveTrends: rows => upsert(TABLES.trends, rows,
        'team_id,season_id,source_player_id,model_version,window_ends_at'),
      saveMvp: rows => upsert(TABLES.mvp, rows,
        'team_id,season_id,source_game_id'),
      saveAwards: rows => upsert(TABLES.awards, rows,
        'team_id,season_id,source_game_id,award_key,award_scope,subject_key'),
      submitFeedback: input => insert(TABLES.feedback, analytics.feedbackRecord(scope(), input)),
      submitReview: input => insert(TABLES.reviews, analytics.adminReviewRecord(scope(), input)),
      appendAudit: input => insert(TABLES.audit, analytics.auditRecord(scope(), input))
    });
  }

  return Object.freeze({ TABLES, createRepository });
}));
