const test = require('node:test');
const assert = require('node:assert/strict');
const shots = require('../shot-intelligence');

test('coordinates preserve raw values and normalize attack direction deterministically', () => {
  assert.deepEqual(shots.normalizeCoordinates({ x: -50, y: 10, attackingDirection: -1 }), {
    rawX: -50, rawY: 10, normalizedX: 50, normalizedY: 10
  });
  assert.throws(() => shots.normalizeCoordinates({ x: 101, y: 0 }), /outside/);
  assert.throws(() => shots.normalizeCoordinates({ x: 0, y: 43 }), /outside/);
});

test('result semantics count only goals and saves as SOG', () => {
  assert.equal(shots.isSog('GOAL'), true);
  assert.equal(shots.isSog('SAVE'), true);
  assert.equal(shots.isSog('MISS'), false);
  assert.equal(shots.isSog('BLOCK'), false);
});

test('zone classification and player aggregation are deterministic', () => {
  assert.equal(shots.classifyZone(70, 0), 'LOW_SLOT');
  assert.equal(shots.classifyZone(50, -25), 'LEFT_CIRCLE');
  const result = shots.aggregate([
    { shooterPlayerId: 'p1', normalizedX: 70, normalizedY: 0, result: 'GOAL' },
    { shooterPlayerId: 'p1', normalizedX: 50, normalizedY: -25, result: 'SAVE' },
    { shooterPlayerId: 'p1', normalizedX: 0, normalizedY: 0, result: 'MISS' },
    { shooterPlayerId: 'p2', normalizedX: 70, normalizedY: 0, result: 'GOAL' }
  ], { playerId: 'p1' });
  assert.equal(result.attempts, 3);
  assert.equal(result.sog, 2);
  assert.equal(result.goals, 1);
  assert.equal(result.shootingPercentage, 50);
});

test('goalie aggregation supports saves, goals against, and null-safe percentages', () => {
  const result = shots.aggregate([
    { goaliePlayerId: 'g1', normalizedX: 70, normalizedY: 0, result: 'SAVE' },
    { goaliePlayerId: 'g1', normalizedX: 70, normalizedY: 0, result: 'GOAL' },
    { goaliePlayerId: 'g2', normalizedX: 70, normalizedY: 0, result: 'GOAL' }
  ], { goalieId: 'g1' });
  assert.equal(result.attempts, 2);
  assert.equal(result.shotsAgainst, 2);
  assert.equal(result.saves, 1);
  assert.equal(result.goals, 1);
  assert.equal(result.goalsAgainst, 1);
  assert.equal(result.savePercentage, 50);
  assert.equal(result.shootingPercentage, 50);
  assert.equal(shots.percentage(0, 0), null);
});

test('opponent events retain external identity without requiring a roster player', () => {
  const result = shots.aggregate([
    { opponentTeamName: 'Ravens', shooterDisplayName: 'Unknown 17', shooterPlayerId: null, normalizedX: 0, normalizedY: 0, result: 'BLOCK' }
  ], { opponent: 'Ravens' });
  assert.equal(result.attempts, 1);
  assert.equal(result.sog, 0);
});

test('client submissions cannot forge the automated source; manual and film remain allowed', () => {
  assert.equal(shots.assertClientSource('manual'), 'manual');
  assert.equal(shots.assertClientSource('film'), 'film');
  assert.throws(() => shots.assertClientSource('automated'), /automated source cannot be set/);
  assert.throws(() => shots.assertClientSource('trusted'), /unsupported shot source/);
});

test('idempotency key is scoped to team and omitted keys never dedupe', () => {
  assert.equal(shots.idempotencyScopeKey('team-a', 'key-1'), 'team-a:key-1');
  assert.notEqual(shots.idempotencyScopeKey('team-a', 'key-1'), shots.idempotencyScopeKey('team-b', 'key-1'));
  assert.equal(shots.idempotencyScopeKey('team-a', undefined), null);
  assert.throws(() => shots.idempotencyScopeKey(null, 'key-1'), /teamId is required/);
});

test('reconciliation reports unknown, complete, and undercount as partial without mismatch', () => {
  assert.equal(shots.reconciliation({ recordedShotsFor: 2, recordedShotsAgainst: 1 }).completeness, 'UNKNOWN');
  assert.equal(shots.reconciliation({ recordedShotsFor: 2, recordedShotsAgainst: 1, shotsFor: 2, shotsAgainst: 1 }).completeness, 'COMPLETE');
  const undercount = shots.reconciliation({ recordedShotsFor: 2, recordedShotsAgainst: 1, shotsFor: 3, shotsAgainst: 1 });
  assert.equal(undercount.completeness, 'PARTIAL');
  assert.equal(undercount.mismatch, false);
  assert.equal(undercount.shotsFor, 3);
});

test('reconciliation flags excess recorded events as an explicit MISMATCH, distinct from PARTIAL', () => {
  const excess = shots.reconciliation({ recordedShotsFor: 4, recordedShotsAgainst: 1, shotsFor: 3, shotsAgainst: 1 });
  assert.equal(excess.completeness, 'MISMATCH');
  assert.equal(excess.mismatch, true);
  const excessAgainst = shots.reconciliation({ recordedShotsFor: 2, recordedShotsAgainst: 5, shotsFor: 2, shotsAgainst: 4 });
  assert.equal(excessAgainst.completeness, 'MISMATCH');
  // Mismatch takes priority even when the other metric independently undercounts.
  const mixed = shots.reconciliation({ recordedShotsFor: 4, recordedShotsAgainst: 1, shotsFor: 3, shotsAgainst: 5 });
  assert.equal(mixed.completeness, 'MISMATCH');
});

test('zone classification is deterministic at exact rink boundaries and corners', () => {
  assert.equal(shots.classifyZone(80, 0), 'CREASE');
  assert.equal(shots.classifyZone(80, 8), 'CREASE');
  assert.equal(shots.classifyZone(80, 8.01), 'LOW_SLOT');
  assert.equal(shots.classifyZone(79.99, 8), 'LOW_SLOT');
  assert.equal(shots.classifyZone(60, 18), 'LOW_SLOT');
  assert.equal(shots.classifyZone(60, 18.01), 'RIGHT_CIRCLE');
  assert.equal(shots.classifyZone(59.99, 18), 'OTHER');
  assert.equal(shots.classifyZone(35, -18.01), 'LEFT_CIRCLE');
  assert.equal(shots.classifyZone(34.99, -18.01), 'LEFT_POINT');
  assert.equal(shots.classifyZone(34.99, -17.99), 'LEFT_LOW');
  assert.equal(shots.classifyZone(0, 0), 'RIGHT_LOW');
  assert.equal(shots.classifyZone(0, -0.01), 'LEFT_LOW');
  assert.equal(shots.classifyZone(100, 42.5), 'RIGHT_CIRCLE');
  assert.equal(shots.classifyZone(-100, -42.5), 'LEFT_POINT');
  // Every valid coordinate is deterministic and repeatable, including the
  // dead strip between the point/circle boundary and the low-slot boundary.
  assert.equal(shots.classifyZone(35, 0), shots.classifyZone(35, 0));
  assert.equal(shots.classifyZone(35, 0), 'OTHER');
  assert.throws(() => shots.classifyZone(100.01, 0), /outside/);
  assert.throws(() => shots.classifyZone(0, 42.51), /outside/);
});

test('coordinate normalization is deterministic at rink center and exact boundaries', () => {
  assert.deepEqual(shots.normalizeCoordinates({ x: 0, y: 0, attackingDirection: 1 }), { rawX: 0, rawY: 0, normalizedX: 0, normalizedY: 0 });
  const centerFlipped = shots.normalizeCoordinates({ x: 0, y: 0, attackingDirection: -1 });
  assert.equal(centerFlipped.normalizedX === 0, true);
  assert.deepEqual(shots.normalizeCoordinates({ x: 100, y: 42.5, attackingDirection: 1 }), { rawX: 100, rawY: 42.5, normalizedX: 100, normalizedY: 42.5 });
  assert.deepEqual(shots.normalizeCoordinates({ x: -100, y: -42.5, attackingDirection: -1 }), { rawX: -100, rawY: -42.5, normalizedX: 100, normalizedY: -42.5 });
  assert.throws(() => shots.normalizeCoordinates({ x: 0, y: -42.51 }), /outside/);
  assert.throws(() => shots.normalizeCoordinates({ x: 0, y: 0, attackingDirection: 2 }), /attackingDirection/);
});
