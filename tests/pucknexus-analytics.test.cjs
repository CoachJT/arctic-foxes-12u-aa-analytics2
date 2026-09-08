const { test } = require('node:test');
const assert = require('node:assert/strict');
const A = require('../pucknexus-analytics');

const scope = { team_id: 'team-a', season_id: 'season-a' };
const skater = (id, overrides = {}) => ({
  ...scope,
  source_game_id: 'game-a',
  source_player_id: id,
  player_type: 'skater',
  position: 'F',
  gp: 1,
  goals: 1,
  assists: 1,
  shots: 4,
  plus_minus: 1,
  blocks: 1,
  penalty_minutes: 0,
  ...overrides
});
const goalie = (id, overrides = {}) => ({
  ...scope,
  source_game_id: 'game-a',
  source_player_id: id,
  player_type: 'goalie',
  position: 'G',
  gp: 1,
  saves: 30,
  goals_against: 2,
  wins: 1,
  ...overrides
});

test('Impact is deterministic, transparent, position-aware, and normalized to 0-100', () => {
  const forward = A.calculateImpact(skater('p1', { goals: 2, assists: 1, blocks: 4 }));
  const defense = A.calculateImpact(skater('p1', {
    position: 'D', goals: 2, assists: 1, blocks: 4
  }));
  assert.equal(forward.model_version, 'pnx-impact-v1');
  assert.equal(forward.position, 'forward');
  assert.equal(defense.position, 'defense');
  assert.notEqual(forward.impact_score, defense.impact_score);
  assert.ok(Object.values(forward.breakdown).every(component =>
    Number.isFinite(component.score) && Number.isFinite(component.contribution)));
  for (const result of [
    forward,
    defense,
    A.calculateImpact(skater('low', { goals: -100, plus_minus: -100, penalty_minutes: 100 })),
    A.calculateImpact(skater('high', { goals: 100, assists: 100, shots: 100 }))
  ]) assert.ok(result.impact_score >= 0 && result.impact_score <= 100);
  assert.deepEqual(forward, A.calculateImpact(skater('p1', { goals: 2, assists: 1, blocks: 4 })));
});

test('Impact fails safely on nonparticipants, unknown skater positions, and goalies without shots', () => {
  assert.equal(A.calculateImpact(skater('bench', { gp: 0, goals: 0, assists: 0, shots: 0,
    plus_minus: 0, blocks: 0 })).qualification, 'insufficient_data');
  assert.equal(A.calculateImpact(skater('unknown', { position: '' })).qualification, 'insufficient_data');
  assert.equal(A.calculateImpact(goalie('g0', { saves: 0, goals_against: 0 })).qualification,
    'insufficient_data');
  assert.equal(A.calculateImpact(goalie('g0', { saves: 0, goals_against: 0 })).impact_score, 0);
});

test('goalie normalization rewards elite high-volume performances across positions', () => {
  const elite = A.calculateImpact(goalie('g1', {
    saves: 45, goals_against: 2, team_shots_for: 19
  }));
  const multiPointForward = A.calculateImpact(skater('f1', {
    goals: 2, assists: 1, shots: 5, plus_minus: 1
  }));
  assert.equal(elite.inputs.shots_against, 47);
  assert.equal(elite.inputs.save_percentage, 45 / 47);
  assert.ok(elite.impact_score > multiPointForward.impact_score);
});

test('MVP has one deterministic official winner while retaining tie metadata', () => {
  const result = A.rankGameMvp([
    skater('z-player'),
    skater('a-player'),
    skater('bench', { gp: 0, goals: 0, assists: 0, shots: 0, plus_minus: 0, blocks: 0 })
  ]);
  assert.equal(result.winner_id, 'a-player');
  assert.deepEqual(result.winner_ids, ['a-player']);
  assert.deepEqual(result.tie_candidate_ids, ['a-player', 'z-player']);
  assert.equal(result.is_tie, true);
  assert.equal(result.rankings.filter(row => row.is_mvp).length, 1);
  assert.deepEqual(result.rankings.map(row => row.rank), [1, 1]);
});

test('goalie signature awards use centralized, guarded game-context thresholds', () => {
  assert.deepEqual(A.goalieAwards(goalie('g1', {
    saves: 30, goals_against: 0, team_shots_for: 22
  })).map(row => row.award_key), [
    'GOALIE_SHUTOUT', 'GOALIE_30_SAVE_WIN', 'GOALIE_HELD_THE_FORT'
  ]);
  const forty = A.goalieAwards(goalie('g2', {
    saves: 45, goals_against: 2, team_shots_for: 19
  })).map(row => row.award_key);
  for (const code of ['GOALIE_30_SAVE_WIN', 'GOALIE_40_SAVE_WIN', 'GOALIE_HELD_THE_FORT',
    'GOALIE_STOLE_THE_GAME', 'GOALIE_ROBBERY']) assert.ok(forty.includes(code), code);
  assert.equal(A.goalieAwards(goalie('g3', {
    saves: 45, goals_against: 2
  })).some(row => ['GOALIE_HELD_THE_FORT', 'GOALIE_STOLE_THE_GAME', 'GOALIE_ROBBERY']
    .includes(row.award_key)), false);
});

test('team awards enforce required-data guards and scale Everybody Eats to participants', () => {
  const lineup = Array.from({ length: 10 }, (_, index) =>
    skater(`p${index}`, { points: index < 6 ? 1 : 0, goals: 0, assists: 0 }));
  const awards = A.teamAwards({
    goals_for: 5, goals_against: 2, shots_for: 36, shots_against: 17
  }, lineup);
  assert.ok(awards.some(row => row.award_key === 'TEAM_EVERYBODY_EATS'));
  assert.ok(awards.some(row => row.award_key === 'TEAM_TILTED_ICE'));
  assert.equal(awards.some(row => row.award_key === 'TEAM_WEATHERED_THE_STORM'), false);
  const weathered = A.teamAwards({
    goals_for: 3, goals_against: 2, shots_for: 19, shots_against: 36
  }, lineup);
  assert.ok(weathered.some(row => row.award_key === 'TEAM_WEATHERED_THE_STORM'));
  assert.equal(A.teamAwards({ goals_for: 3, goals_against: 2 }, lineup)
    .some(row => ['TEAM_TILTED_ICE', 'TEAM_WEATHERED_THE_STORM'].includes(row.award_key)), false);
  assert.equal(A.teamAwards({ shots_for: 36, shots_against: 17 }, lineup)
    .some(row => row.award_key === 'TEAM_EVERYBODY_EATS'), false);
});

test('season awards aggregate qualified games and preserve player/goalie scope', () => {
  const rows = [
    skater('p1', { goals: 2, assists: 0 }),
    skater('p1', { source_game_id: 'game-b', goals: 0, assists: 1 }),
    goalie('g1', { saves: 20, goals_against: 1 })
  ];
  const awards = A.seasonAwards(rows, { minimumGames: 2 });
  assert.equal(awards.find(row => row.award_key === 'PLAYER_SCORING_LEADER').award_scope, 'player');
  assert.equal(awards.find(row => row.award_key === 'GOALIE_OF_THE_YEAR').award_scope, 'goalie');
});

test('trend requires three samples and compares a player against their own bounded history', () => {
  assert.equal(A.calculateTrend([1, 2]).direction, 'insufficient_data');
  assert.equal(A.calculateTrend([1, 2, 3, 4]).direction, 'improving');
  assert.equal(A.calculateTrend([4, 3, 2, 1]).direction, 'declining');
  assert.equal(A.calculateTrend([4, 4.1, 4]).direction, 'stable');
  assert.equal(A.calculateTrend([100, 100, 1, 2, 3, 4, 5], { windowSize: 5 }).slope, 1);
});

test('feedback and admin review preserve original prediction with explicit reason and severity', () => {
  const original = { source_player_id: 'p1', impact_score: 86, model_version: 'pnx-impact-v1' };
  const feedback = A.feedbackRecord(scope, {
    source_game_id: 'game-a',
    mvp_result_id: 'mvp-a',
    source_player_id: 'p1',
    coach_nominee_player_id: 'g1',
    reason_code: 'goaltending',
    severity: 'obvious_miss',
    comment: 'High-volume win',
    original_prediction: original
  });
  assert.equal(feedback.review_state, 'pending');
  assert.deepEqual(feedback.original_prediction, original);
  assert.throws(() => A.feedbackRecord(scope, {
    source_game_id: 'game-a', mvp_result_id: 'mvp-a', original_prediction: original
  }), /reason_code/);
  assert.equal(A.feedbackRecord(scope, {
    source_game_id: 'game-a',
    mvp_result_id: 'mvp-a',
    feedback_type: 'agreement',
    original_prediction: original
  }).reason_code, null);
  const review = A.adminReviewRecord(scope, {
    feedback_id: 'feedback-a',
    source_game_id: 'game-a',
    review_state: 'overridden',
    override_player_id: 'g1',
    model_review_flag: true,
    original_prediction: original,
    reviewed_by: 'admin-a'
  });
  assert.equal(review.override_player_id, 'g1');
  assert.equal(review.model_review_flag, true);
  assert.deepEqual(review.original_prediction, original);
  assert.throws(() => A.adminReviewRecord(scope, {
    feedback_id: 'feedback-a', source_game_id: 'game-a', review_state: 'overridden', original_prediction: original,
    reviewed_by: 'admin-a'
  }), /override_player_id/);
});

test('tenant and idempotent audit contracts fail closed', () => {
  assert.throws(() => A.requireTenantScope({ team_id: 'x' }), /season_id/);
  assert.throws(() => A.assertTenantRows(scope, [{ ...scope, team_id: 'team-b' }]), /scope mismatch/);
  const audit = A.auditRecord(scope, {
    action: 'impact.recomputed',
    resource_type: 'game',
    idempotency_key: 'game-a:stats-revision-2'
  });
  assert.equal(audit.idempotency_key, 'game-a:stats-revision-2');
  assert.throws(() => A.auditRecord(scope, {
    action: 'bad', resource_type: 'game', metadata: []
  }), /metadata/);
});
