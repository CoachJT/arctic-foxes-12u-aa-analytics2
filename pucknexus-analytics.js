/* PuckNexus analytics data contract v1. Shared by Node services and browser adapters. */
(function attachPuckNexusAnalytics(root, factory) {
  const api = factory(
    typeof module === 'object' && module.exports ? require('./analytics') : root.FoxesAnalytics
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PuckNexusAnalytics = api;
}(globalThis, function createPuckNexusAnalytics(legacyAnalytics) {
  'use strict';

  const CONTRACT_VERSION = '1';
  const IMPACT_MODEL_VERSION = 'pnx-impact-v1';
  const AWARD_RULE_VERSION = 'pnx-awards-v1';
  const TREND_MODEL_VERSION = 'trend-v1';
  const number = value => value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : 0;
  const round = (value, places = 2) => {
    const factor = 10 ** places;
    return Math.round((number(value) + Number.EPSILON) * factor) / factor;
  };
  const value = (row, canonical, aliases = []) => {
    for (const key of [canonical, ...aliases]) {
      if (row?.[key] !== undefined && row[key] !== null && row[key] !== '') return number(row[key]);
    }
    return 0;
  };
  const text = (value, name) => {
    const normalized = String(value || '').trim();
    if (!normalized) throw new TypeError(`${name} is required.`);
    return normalized;
  };
  const clamp = score => Math.max(0, Math.min(100, number(score)));
  const hasValue = (row, keys) => keys.some(key =>
    row?.[key] !== undefined && row[key] !== null && row[key] !== '');
  const scoreComponent = (score, weight, evidence) => Object.freeze({
    score: round(clamp(score), 1),
    weight,
    contribution: 0,
    evidence: Object.freeze(evidence)
  });
  const GOALIE_AWARD_THRESHOLDS = Object.freeze({
    held_the_fort: Object.freeze({ shot_disadvantage: 8, saves: 20, save_percentage: 0.9, max_goals_against: 3 }),
    stole_the_game: Object.freeze({ shot_disadvantage: 15, saves: 30, save_percentage: 0.93, max_goals_against: 2 }),
    robbery: Object.freeze({ shot_disadvantage: 20, saves: 40, save_percentage: 0.95, max_goals_against: 2 })
  });
  const TEAM_AWARD_THRESHOLDS = Object.freeze({
    tilted_ice_differential: 15,
    weathered_storm_differential: 10,
    everybody_eats_ratio: 0.6,
    everybody_eats_minimum_skaters: 5
  });
  const MODEL_LIMITATIONS = Object.freeze([
    'v1 uses canonical box-score statistics only; it does not infer possession, expected goals, or key moments.',
    'Missing optional categories are excluded from the weighted denominator rather than treated as observed zeroes.',
    'Situational goalie and shot-differential team awards require both team shots and goalie shots against.'
  ]);

  function canonicalPlayerStat(input = {}) {
    const suppliedPosition = String(input.position || input.pos || input.p?.pos || '').trim().toUpperCase();
    const playerType = String(input.player_type || input.type || input.playerType || '').toLowerCase()
      || (['G', 'GOALIE'].includes(suppliedPosition) ? 'goalie' : 'skater');
    if (!['skater', 'goalie'].includes(playerType)) throw new TypeError('player_type must be skater or goalie.');
    const goals = value(input, 'goals', ['g']);
    const assists = value(input, 'assists', ['a']);
    const faceoffWins = value(input, 'faceoff_wins', ['fow']);
    const faceoffLosses = value(input, 'faceoff_losses', ['fol']);
    const faceoffAttempts = value(input, 'faceoff_attempts', ['fo']) || faceoffWins + faceoffLosses;
    const saves = value(input, 'saves');
    const goalsAgainst = value(input, 'goals_against', ['ga']);
    const shotsAgainst = value(input, 'shots_against', ['sa']) || saves + goalsAgainst;
    const minutes = value(input, 'minutes', ['min']);
    const gp = value(input, 'gp');
    const suppliedPoints = input.points ?? input.pts;
    const rawPosition = suppliedPosition;
    const position = playerType === 'goalie' || rawPosition === 'G'
      ? 'goalie'
      : rawPosition === 'D' || rawPosition === 'DEFENSE' || rawPosition === 'DEFENCE'
        ? 'defense'
        : ['F', 'C', 'LW', 'RW', 'FORWARD'].includes(rawPosition) ? 'forward' : null;
    const row = {
      team_id: input.team_id || input.teamId || '',
      season_id: input.season_id || input.seasonId || '',
      source_game_id: input.source_game_id || input.game_id || input.gameId || '',
      source_player_id: input.source_player_id || input.player_id || input.playerId || input.p?.id || '',
      player_type: playerType,
      position,
      gp,
      goals,
      assists,
      points: suppliedPoints !== undefined && suppliedPoints !== null && suppliedPoints !== ''
        ? number(suppliedPoints)
        : goals + assists,
      shots: value(input, 'shots'),
      penalty_minutes: value(input, 'penalty_minutes', ['pim']),
      plus_minus: value(input, 'plus_minus', ['plusMinus', 'pm']),
      blocks: value(input, 'blocks'),
      faceoff_wins: faceoffWins,
      faceoff_losses: faceoffLosses,
      faceoff_attempts: faceoffAttempts,
      power_play_goals: value(input, 'power_play_goals', ['ppg']),
      power_play_assists: value(input, 'power_play_assists', ['ppa']),
      power_play_points: value(input, 'power_play_points', ['ppp']),
      short_handed_goals: value(input, 'short_handed_goals', ['shg']),
      short_handed_assists: value(input, 'short_handed_assists', ['sha']),
      short_handed_points: value(input, 'short_handed_points', ['shp']),
      game_winning_goals: value(input, 'game_winning_goals', ['gwg']),
      game_tying_goals: value(input, 'game_tying_goals', ['gtg']),
      takeaways: value(input, 'takeaways', ['tk']),
      giveaways: value(input, 'giveaways', ['gv']),
      chances: value(input, 'chances', ['ch']),
      toi_minutes: value(input, 'toi_minutes', ['toiMin']) || value(input, 'toi') / 60,
      minutes,
      saves,
      shots_against: shotsAgainst,
      goals_against: goalsAgainst,
      wins: value(input, 'wins', ['w']),
      losses: value(input, 'losses', ['l']),
      ties: value(input, 'ties', ['t']),
      shutouts: value(input, 'shutouts', ['so']),
      available: Object.freeze({
        shots: hasValue(input, ['shots', 's', 'sog']),
        penalty_minutes: hasValue(input, ['penalty_minutes', 'pim']),
        plus_minus: hasValue(input, ['plus_minus', 'plusMinus', 'pm']),
        blocks: hasValue(input, ['blocks', 'blk']),
        faceoffs: hasValue(input, ['faceoff_attempts', 'fo', 'faceoff_wins', 'fow', 'faceoff_losses', 'fol']),
        special_teams: hasValue(input, ['power_play_goals', 'ppg', 'power_play_points', 'ppp',
          'short_handed_goals', 'shg', 'short_handed_points', 'shp']),
        result: hasValue(input, ['wins', 'w', 'losses', 'l', 'ties', 't']),
        minutes: hasValue(input, ['minutes', 'min'])
      })
    };
    row.save_percentage = shotsAgainst > 0 ? saves / shotsAgainst : 0;
    const hasExplicitGp = input.gp !== undefined && input.gp !== null && input.gp !== '';
    row.played = input.played !== undefined
      ? input.played === true
      : hasExplicitGp ? gp > 0 : Object.entries(row).some(([key, item]) =>
        !['gp', 'player_type', 'team_id', 'season_id', 'source_game_id', 'source_player_id',
          'save_percentage', 'played'].includes(key) && typeof item === 'number' && item !== 0);
    return Object.freeze(row);
  }

  function calculateImpact(input, options = {}) {
    const stat = canonicalPlayerStat(input);
    const qualified = stat.played
      && (stat.position === 'goalie' ? stat.shots_against > 0 : Boolean(stat.position));
    if (!qualified) {
      return { contract_version: CONTRACT_VERSION, model_version: IMPACT_MODEL_VERSION,
        player_type: stat.player_type, position: stat.position, impact_score: 0,
        ranking_score: 0, qualification: 'insufficient_data', breakdown: {}, inputs: stat };
    }
    let components;
    if (stat.position === 'goalie') {
      const teamShots = hasValue(input, ['team_shots_for', 'teamShotsFor'])
        ? value(input, 'team_shots_for', ['teamShotsFor']) : null;
      const disadvantage = teamShots === null ? null : stat.shots_against - teamShots;
      components = {
        save_performance: scoreComponent(50 + (stat.save_percentage - 0.85) * 300, 40,
          { saves: stat.saves, shots_against: stat.shots_against, save_percentage: round(stat.save_percentage, 4) }),
        shot_volume: scoreComponent(35 + stat.saves * 1.5, 15, { saves: stat.saves }),
        goals_against: scoreComponent(80 - stat.goals_against * 15, 15, { goals_against: stat.goals_against }),
        game_result: scoreComponent(stat.wins ? 85 : stat.ties ? 55 : stat.losses ? 25 : 50, 15,
          { wins: stat.wins, losses: stat.losses, ties: stat.ties }),
        shutout: scoreComponent(stat.goals_against === 0 ? 100 : 50, 5,
          { shutout: stat.goals_against === 0 }),
      };
      if (disadvantage !== null) components.game_situation = scoreComponent(50 + disadvantage * 2, 10,
        { team_shots_for: teamShots, shot_disadvantage: disadvantage });
    } else {
      const faceoffRate = stat.faceoff_attempts ? stat.faceoff_wins / stat.faceoff_attempts : 0;
      const isDefense = stat.position === 'defense';
      components = {
        offensive_production: scoreComponent(50 + stat.goals * (isDefense ? 16 : 14)
          + stat.assists * (isDefense ? 10 : 8), isDefense ? 25 : 30,
        { goals: stat.goals, assists: stat.assists, points: stat.points })
      };
      if (stat.available.shots) components.shot_generation =
        scoreComponent(50 + (stat.shots - 2) * (isDefense ? 6 : 8), isDefense ? 10 : 15,
          { shots: stat.shots });
      if (stat.available.plus_minus || stat.available.blocks) {
        components.two_way = scoreComponent(50 + stat.plus_minus * (isDefense ? 12 : 8)
          + stat.blocks * (isDefense ? 10 : 7), isDefense ? 35 : 20,
        { plus_minus: stat.plus_minus, blocks: stat.blocks });
      }
      if (stat.available.special_teams) components.special_teams =
        scoreComponent(50 + stat.power_play_goals * 10 + stat.power_play_points * 6
          + stat.short_handed_goals * 15 + stat.short_handed_points * 8, 15,
        { power_play_goals: stat.power_play_goals, power_play_points: stat.power_play_points,
          short_handed_goals: stat.short_handed_goals, short_handed_points: stat.short_handed_points });
      if (!isDefense && stat.faceoff_attempts > 0) components.faceoffs =
        scoreComponent(50 + (faceoffRate - 0.5) * 80 * Math.min(1, stat.faceoff_attempts / 10), 10,
          { wins: stat.faceoff_wins, attempts: stat.faceoff_attempts, percentage: round(faceoffRate, 4) });
      if (stat.available.penalty_minutes) components.discipline =
        scoreComponent(70 - stat.penalty_minutes * 8, isDefense ? 15 : 10,
          { penalty_minutes: stat.penalty_minutes });
    }
    const weight = Object.values(components).reduce((sum, component) => sum + component.weight, 0);
    const normalized = weight
      ? Object.values(components).reduce((sum, component) => sum + component.score * component.weight, 0) / weight
      : 0;
    const breakdown = Object.freeze(Object.fromEntries(Object.entries(components).map(([key, component]) =>
      [key, Object.freeze({ ...component, contribution: round(component.score * component.weight / weight, 1) })])));
    return {
      contract_version: CONTRACT_VERSION,
      model_version: IMPACT_MODEL_VERSION,
      player_type: stat.player_type,
      position: stat.position,
      impact_score: Math.round(clamp(normalized)),
      ranking_score: round(clamp(normalized), 4),
      qualification: 'qualified',
      breakdown,
      inputs: stat
    };
  }

  function rankImpact(rows = [], options = {}) {
    const epsilon = Math.max(0, number(options.tieEpsilon ?? 1e-8));
    const ranked = rows
      .map((row, sourceIndex) => ({ row, sourceIndex, impact: calculateImpact(row, options) }))
      .filter(entry => entry.impact.qualification === 'qualified')
      .sort((a, b) => b.impact.ranking_score - a.impact.ranking_score
        || String(a.impact.inputs.source_player_id).localeCompare(String(b.impact.inputs.source_player_id))
        || a.sourceIndex - b.sourceIndex);
    let rank = 0;
    return ranked.map((entry, index) => {
      if (index === 0
        || Math.abs(entry.impact.ranking_score - ranked[index - 1].impact.ranking_score) > epsilon) rank = index + 1;
      return Object.freeze({ rank, tied_for_first: rank === 1, is_mvp: index === 0, ...entry.impact });
    });
  }

  function rankGameMvp(rows = [], options = {}) {
    const rankings = rankImpact(rows, options);
    const tied = rankings.filter(result => result.tied_for_first);
    const official = rankings[0] || null;
    return Object.freeze({
      contract_version: CONTRACT_VERSION,
      model_version: IMPACT_MODEL_VERSION,
      winner_id: official?.inputs.source_player_id || null,
      winner_ids: official ? [official.inputs.source_player_id] : [],
      tie_candidate_ids: tied.map(result => result.inputs.source_player_id),
      is_tie: tied.length > 1,
      rankings
    });
  }

  function aggregateSeason(rows = [], options = {}) {
    const byPlayer = new Map();
    rows.forEach(input => {
      const stat = canonicalPlayerStat(input);
      const impact = calculateImpact(input, options);
      if (impact.qualification !== 'qualified') return;
      const key = stat.source_player_id || String(input.jersey_number || input.number || '');
      if (!key) throw new TypeError('source_player_id is required for season aggregation.');
      if (!byPlayer.has(key)) byPlayer.set(key, {
        source_player_id: key, player_type: stat.player_type, position: stat.position, gp: 0, impact_total: 0,
        goals: 0, assists: 0, points: 0, blocks: 0, plus_minus: 0,
        faceoff_wins: 0, faceoff_attempts: 0, saves: 0, shots_against: 0,
        goals_against: 0, wins: 0, shutouts: 0, minutes: 0
      });
      const total = byPlayer.get(key);
      total.gp += stat.gp || 1;
      total.impact_total += impact.impact_score;
      for (const field of ['goals', 'assists', 'points', 'blocks', 'plus_minus',
        'faceoff_wins', 'faceoff_attempts', 'saves', 'shots_against', 'goals_against',
        'wins', 'shutouts', 'minutes']) total[field] += stat[field];
    });
    return [...byPlayer.values()].map(row => Object.freeze({
      ...row,
      impact_total: round(row.impact_total),
      impact_average: round(row.gp ? row.impact_total / row.gp : 0),
      faceoff_percentage: row.faceoff_attempts ? row.faceoff_wins / row.faceoff_attempts : 0,
      save_percentage: row.shots_against ? row.saves / row.shots_against : 0
    }));
  }

  function seasonAwards(rows = [], options = {}) {
    const totals = aggregateSeason(rows, options);
    const skaters = totals.filter(row => row.player_type === 'skater' && row.gp >= number(options.minimumGames || 1));
    const goalies = totals.filter(row => row.player_type === 'goalie'
      && row.gp >= number(options.minimumGoalieGames || 1)
      && row.shots_against >= number(options.minimumGoalieShots || 1));
    const eligible = [...skaters, ...goalies];
    const rules = [
      ['PNX_SEASON_MVP', 'impact_total', eligible],
      ['PLAYER_SCORING_LEADER', 'points', skaters],
      ['PLAYER_GOAL_LEADER', 'goals', skaters],
      ['PLAYER_ASSIST_LEADER', 'assists', skaters],
      ['PLAYER_DEFENSIVE_IMPACT', row => row.blocks * 2 + row.plus_minus, skaters],
      ['PLAYER_FACEOFF_LEADER', 'faceoff_percentage', skaters.filter(row => row.faceoff_attempts >= number(options.minimumFaceoffs || 1))],
      ['GOALIE_OF_THE_YEAR', 'save_percentage', goalies]
    ];
    return rules.flatMap(([awardKey, metric, candidates]) => {
      if (!candidates.length) return [];
      const read = typeof metric === 'function' ? metric : row => row[metric];
      const best = Math.max(...candidates.map(read));
      const winners = candidates.filter(row => Math.abs(read(row) - best) <= 1e-8)
        .sort((a, b) => a.source_player_id.localeCompare(b.source_player_id))
        .map(row => ({ source_player_id: row.source_player_id, metric_value: round(read(row), 4) }));
      return [Object.freeze({
        contract_version: CONTRACT_VERSION,
        model_version: IMPACT_MODEL_VERSION,
        award_key: awardKey,
        award_scope: candidates[0]?.player_type === 'goalie' ? 'goalie' : 'player',
        rule_version: AWARD_RULE_VERSION,
        metric: typeof metric === 'string' ? metric : 'defensive_impact',
        is_tie: winners.length > 1,
        winners
      })];
    });
  }

  function goalieAwards(input = {}) {
    const stat = canonicalPlayerStat({ ...input, player_type: 'goalie', position: 'G' });
    if (!stat.played || stat.shots_against <= 0) return [];
    const teamShots = hasValue(input, ['team_shots_for', 'teamShotsFor'])
      ? value(input, 'team_shots_for', ['teamShotsFor']) : null;
    const disadvantage = teamShots === null ? null : stat.shots_against - teamShots;
    const won = stat.wins > 0;
    const awards = [];
    const add = (awardKey, evidence) => awards.push(Object.freeze({
      contract_version: CONTRACT_VERSION,
      rule_version: AWARD_RULE_VERSION,
      award_key: awardKey,
      award_scope: 'goalie',
      source_player_id: stat.source_player_id,
      evidence: Object.freeze(evidence)
    }));
    const evidence = {
      saves: stat.saves,
      shots_against: stat.shots_against,
      goals_against: stat.goals_against,
      save_percentage: round(stat.save_percentage, 4),
      win: won
    };
    if (stat.goals_against === 0) add('GOALIE_SHUTOUT', evidence);
    if (won && stat.saves >= 30) add('GOALIE_30_SAVE_WIN', evidence);
    if (won && stat.saves >= 40) add('GOALIE_40_SAVE_WIN', evidence);
    if (teamShots !== null) {
      for (const [name, threshold] of Object.entries(GOALIE_AWARD_THRESHOLDS)) {
        const qualifies = disadvantage >= threshold.shot_disadvantage
          && stat.saves >= threshold.saves
          && stat.save_percentage >= threshold.save_percentage
          && stat.goals_against <= threshold.max_goals_against
          && (name === 'held_the_fort' ? !stat.losses : won);
        if (qualifies) add(`GOALIE_${name.toUpperCase()}`, {
          ...evidence,
          team_shots_for: teamShots,
          shot_disadvantage: disadvantage,
          threshold
        });
      }
    }
    return awards;
  }

  function teamAwards(team = {}, playerRows = []) {
    const read = (canonical, aliases = []) =>
      hasValue(team, [canonical, ...aliases]) ? value(team, canonical, aliases) : null;
    const goalsFor = read('goals_for', ['goalsFor', 'gf']);
    const goalsAgainst = read('goals_against', ['goalsAgainst', 'ga']);
    const shotsFor = read('shots_for', ['shotsFor', 'sf']);
    const shotsAgainst = read('shots_against', ['shotsAgainst', 'sa']);
    const won = team.won === true || String(team.result || '').toUpperCase() === 'W'
      || (goalsFor !== null && goalsAgainst !== null && goalsFor > goalsAgainst);
    const awards = [];
    const add = (awardKey, evidence) => awards.push(Object.freeze({
      contract_version: CONTRACT_VERSION,
      rule_version: AWARD_RULE_VERSION,
      award_key: awardKey,
      award_scope: 'team',
      source_player_id: null,
      evidence: Object.freeze(evidence)
    }));
    if (goalsAgainst !== null && goalsAgainst <= 1) add('TEAM_LOCKDOWN', { goals_against: goalsAgainst });
    if (goalsAgainst === 0) add('TEAM_CLEAN_SHEET', { goals_against: 0 });
    if (goalsFor !== null && goalsFor >= 6) add('TEAM_OFFENSIVE_EXPLOSION', { goals_for: goalsFor });
    if (shotsFor !== null && shotsFor >= 35) add('TEAM_PUCKS_TO_THE_NET', { shots_for: shotsFor });
    if (goalsFor !== null && shotsFor > 0 && goalsFor >= 4 && goalsFor / shotsFor >= 0.15) {
      add('TEAM_SHARPSHOOTERS', { goals_for: goalsFor, shots_for: shotsFor,
        shooting_percentage: round(goalsFor / shotsFor, 4) });
    }
    if (shotsFor !== null && shotsAgainst !== null
      && shotsFor - shotsAgainst >= TEAM_AWARD_THRESHOLDS.tilted_ice_differential) {
      add('TEAM_TILTED_ICE', { shots_for: shotsFor, shots_against: shotsAgainst,
        shot_differential: shotsFor - shotsAgainst,
        required_differential: TEAM_AWARD_THRESHOLDS.tilted_ice_differential });
    }
    if (won && shotsFor !== null && shotsAgainst !== null
      && shotsAgainst - shotsFor >= TEAM_AWARD_THRESHOLDS.weathered_storm_differential) {
      add('TEAM_WEATHERED_THE_STORM', { shots_for: shotsFor, shots_against: shotsAgainst,
        shot_disadvantage: shotsAgainst - shotsFor,
        required_disadvantage: TEAM_AWARD_THRESHOLDS.weathered_storm_differential });
    }
    const participating = playerRows.filter(row => {
      const stat = canonicalPlayerStat(row);
      return stat.played && stat.position !== 'goalie';
    });
    const pointProducers = participating.filter(row => {
      if (!hasValue(row, ['points', 'pts', 'goals', 'g', 'assists', 'a'])) return false;
      return canonicalPlayerStat(row).points > 0;
    });
    const requiredProducers = Math.max(3,
      Math.ceil(participating.length * TEAM_AWARD_THRESHOLDS.everybody_eats_ratio));
    if (goalsFor !== null && goalsFor >= 2
      && participating.length >= TEAM_AWARD_THRESHOLDS.everybody_eats_minimum_skaters
      && pointProducers.length >= requiredProducers) {
      add('TEAM_EVERYBODY_EATS', {
        participating_skaters: participating.length,
        point_producers: pointProducers.length,
        producer_ratio: round(pointProducers.length / participating.length, 4),
        required_producers: requiredProducers,
        team_goals: goalsFor
      });
    }
    const teamPpGoals = read('power_play_goals', ['ppGoals', 'ppg']);
    if (teamPpGoals !== null && teamPpGoals >= 2) {
      add('TEAM_SPECIAL_TEAMS_TAKEOVER', { power_play_goals: teamPpGoals });
    }
    return awards;
  }

  function calculateTrend(samples = [], options = {}) {
    const windowSize = Math.max(2, Math.trunc(number(options.windowSize || 5)));
    const minimumSamples = Math.max(3, Math.trunc(number(options.minimumSamples || 3)));
    const threshold = Math.max(0, number(options.threshold ?? 0.25));
    const ordered = samples.map((sample, index) => ({
      index,
      date: sample && typeof sample === 'object' ? sample.date || sample.computed_at || '' : '',
      score: sample && typeof sample === 'object'
        ? number(sample.impact_score ?? sample.rating ?? sample.value)
        : number(sample)
    })).sort((a, b) => a.date && b.date ? a.date.localeCompare(b.date) || a.index - b.index : a.index - b.index)
      .slice(-windowSize);
    const count = ordered.length;
    if (count < minimumSamples) return Object.freeze({
      contract_version: CONTRACT_VERSION, model_version: TREND_MODEL_VERSION,
      direction: 'insufficient_data', sample_size: count, slope: 0, delta: 0,
      average: round(count ? ordered[0].score : 0)
    });
    const xMean = (count - 1) / 2;
    const average = ordered.reduce((sum, sample) => sum + sample.score, 0) / count;
    const denominator = ordered.reduce((sum, _sample, index) => sum + (index - xMean) ** 2, 0);
    const slope = denominator
      ? ordered.reduce((sum, sample, index) => sum + (index - xMean) * (sample.score - average), 0) / denominator
      : 0;
    return Object.freeze({
      contract_version: CONTRACT_VERSION,
      model_version: TREND_MODEL_VERSION,
      direction: slope > threshold ? 'improving' : slope < -threshold ? 'declining' : 'stable',
      sample_size: count,
      slope: round(slope, 4),
      delta: round(ordered[count - 1].score - ordered[0].score),
      average: round(average),
      first: ordered[0].score,
      latest: ordered[count - 1].score
    });
  }

  function requireTenantScope(scope = {}) {
    return Object.freeze({
      team_id: text(scope.team_id || scope.teamId, 'team_id'),
      season_id: text(scope.season_id || scope.seasonId, 'season_id')
    });
  }

  function assertTenantRows(scope, rows = []) {
    const required = requireTenantScope(scope);
    rows.forEach((row, index) => {
      if (row.team_id !== required.team_id || row.season_id !== required.season_id) {
        throw new Error(`Tenant scope mismatch at row ${index}.`);
      }
    });
    return required;
  }

  function feedbackRecord(scope, input = {}) {
    const tenant = requireTenantScope(scope);
    const reasons = ['offensive_impact', 'defensive_impact', 'goaltending', 'special_teams',
      'key_moments', 'statistics_incomplete', 'stats_limited', 'other'];
    const feedbackType = input.feedback_type || 'review';
    if (!['agreement', 'review'].includes(feedbackType)) {
      throw new RangeError('feedback_type is not supported.');
    }
    const reason = feedbackType === 'review'
      ? text(input.reason_code || input.reason, 'reason_code').toLowerCase()
      : null;
    if (reason !== null && !reasons.includes(reason)) throw new RangeError('reason_code is not supported.');
    const severity = input.severity || 'review';
    if (!['review', 'obvious_miss'].includes(severity)) throw new RangeError('severity is not supported.');
    if (feedbackType === 'agreement' && severity !== 'review') {
      throw new RangeError('agreement feedback cannot be an obvious miss.');
    }
    const comment = String(input.comment ?? input.body ?? '').trim();
    if (comment.length > 4000) throw new RangeError('comment cannot exceed 4000 characters.');
    const original = input.original_prediction;
    if (!original || typeof original !== 'object' || Array.isArray(original)
      || !String(original.source_player_id || '').trim()
      || !Number.isFinite(Number(original.impact_score))
      || !String(original.model_version || '').trim()) {
      throw new TypeError('original_prediction must preserve player, impact score, and model version.');
    }
    return Object.freeze({
      ...tenant,
      source_player_id: text(input.source_player_id || original.source_player_id, 'source_player_id'),
      source_game_id: text(input.source_game_id || input.gameId, 'source_game_id'),
      mvp_result_id: text(input.mvp_result_id || input.mvpResultId, 'mvp_result_id'),
      feedback_type: feedbackType,
      coach_nominee_player_id: input.coach_nominee_player_id || input.coachNomineePlayerId || null,
      reason_code: reason,
      severity,
      comment,
      review_state: 'pending',
      original_prediction: Object.freeze({ ...original }),
      contract_version: CONTRACT_VERSION
    });
  }

  function adminReviewRecord(scope, input = {}) {
    const tenant = requireTenantScope(scope);
    const state = text(input.review_state || input.state, 'review_state').toLowerCase();
    if (!['pnx_correct', 'overridden', 'model_review'].includes(state)) {
      throw new RangeError('review_state is not supported.');
    }
    const original = input.original_prediction;
    if (!original || typeof original !== 'object' || Array.isArray(original)
      || !String(original.source_player_id || '').trim()
      || !Number.isFinite(Number(original.impact_score))
      || !String(original.model_version || '').trim()) {
      throw new TypeError('original_prediction must preserve player, impact score, and model version.');
    }
    const overridePlayerId = input.override_player_id || input.overridePlayerId || null;
    if ((state === 'overridden') !== Boolean(overridePlayerId)) {
      throw new RangeError('overridden reviews require override_player_id and other states forbid it.');
    }
    return Object.freeze({
      ...tenant,
      feedback_id: text(input.feedback_id || input.feedbackId, 'feedback_id'),
      source_game_id: text(input.source_game_id || input.gameId, 'source_game_id'),
      review_state: state,
      override_player_id: overridePlayerId,
      model_review_flag: state === 'model_review' || input.model_review_flag === true,
      rationale: String(input.rationale || '').trim(),
      original_prediction: Object.freeze({ ...original }),
      reviewed_at: input.reviewed_at || new Date().toISOString(),
      reviewed_by: text(input.reviewed_by || input.reviewedBy, 'reviewed_by'),
      contract_version: CONTRACT_VERSION
    });
  }

  function auditRecord(scope, input = {}) {
    const tenant = requireTenantScope(scope);
    if (input.metadata !== undefined
      && (!input.metadata || typeof input.metadata !== 'object' || Array.isArray(input.metadata))) {
      throw new TypeError('metadata must be an object.');
    }
    for (const [name, state] of [['before_state', input.before_state ?? input.before],
      ['after_state', input.after_state ?? input.after]]) {
      if (state !== undefined && state !== null
        && (typeof state !== 'object' || Array.isArray(state))) {
        throw new TypeError(`${name} must be an object or null.`);
      }
    }
    return Object.freeze({
      ...tenant,
      actor_id: input.actor_id || input.actorId || null,
      action: text(input.action, 'action'),
      resource_type: text(input.resource_type || input.resourceType, 'resource_type'),
      resource_id: input.resource_id || input.resourceId || null,
      correlation_id: input.correlation_id || input.correlationId || null,
      idempotency_key: input.idempotency_key || input.idempotencyKey || null,
      before_state: input.before_state ?? input.before ?? null,
      after_state: input.after_state ?? input.after ?? null,
      metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
      contract_version: CONTRACT_VERSION
    });
  }

  function gameRows(game = {}) {
    if (!legacyAnalytics?.records) throw new Error('analytics.js is required to normalize desktop games.');
    return legacyAnalytics.records(game).map(record => canonicalPlayerStat({
      ...record,
      source_game_id: game.id,
      source_player_id: record.p?.id || record.playerId
    }));
  }

  return Object.freeze({
    CONTRACT_VERSION,
    IMPACT_MODEL_VERSION,
    AWARD_RULE_VERSION,
    TREND_MODEL_VERSION,
    GOALIE_AWARD_THRESHOLDS,
    TEAM_AWARD_THRESHOLDS,
    MODEL_LIMITATIONS,
    canonicalPlayerStat,
    calculateImpact,
    rankImpact,
    rankGameMvp,
    aggregateSeason,
    seasonAwards,
    goalieAwards,
    teamAwards,
    calculateTrend,
    requireTenantScope,
    assertTenantRows,
    feedbackRecord,
    adminReviewRecord,
    auditRecord,
    gameRows
  });
}));
