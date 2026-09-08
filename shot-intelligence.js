'use strict';

const RESULTS = Object.freeze(['GOAL', 'SAVE', 'MISS', 'BLOCK']);
const SOURCES = Object.freeze(['manual', 'film', 'automated']);
const ZONES = Object.freeze([
  'CREASE', 'LOW_SLOT', 'LEFT_CIRCLE', 'RIGHT_CIRCLE',
  'LEFT_POINT', 'RIGHT_POINT', 'LEFT_LOW', 'RIGHT_LOW', 'OTHER'
]);

function finite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
}

function normalizeCoordinates({ x, y, attackingDirection = 1 }) {
  finite(x, 'x');
  finite(y, 'y');
  if (x < -100 || x > 100 || y < -42.5 || y > 42.5) {
    throw new RangeError('coordinates are outside the rink contract');
  }
  if (attackingDirection !== 1 && attackingDirection !== -1) {
    throw new RangeError('attackingDirection must be 1 or -1');
  }
  return { rawX: x, rawY: y, normalizedX: x * attackingDirection, normalizedY: y };
}

function classifyZone(x, y) {
  finite(x, 'normalizedX');
  finite(y, 'normalizedY');
  if (x < -100 || x > 100 || y < -42.5 || y > 42.5) throw new RangeError('coordinates are outside the rink contract');
  if (x >= 80 && Math.abs(y) <= 8) return 'CREASE';
  if (x >= 60 && Math.abs(y) <= 18) return 'LOW_SLOT';
  if (x >= 35 && y < -18) return 'LEFT_CIRCLE';
  if (x >= 35 && y > 18) return 'RIGHT_CIRCLE';
  if (x < 35 && y < -18) return 'LEFT_POINT';
  if (x < 35 && y > 18) return 'RIGHT_POINT';
  if (x < 35 && y < 0) return 'LEFT_LOW';
  if (x < 35 && y >= 0) return 'RIGHT_LOW';
  return 'OTHER';
}

function isSog(result) {
  if (!RESULTS.includes(result)) throw new RangeError(`unsupported shot result: ${result}`);
  return result === 'GOAL' || result === 'SAVE';
}

// Defense-in-depth mirror of the shot_events_insert/update RLS policies: a
// client-submitted payload must never be allowed to claim the trusted
// 'automated' source, regardless of what the browser sends. Only a
// service-role automated pipeline may write that source (enforced again,
// authoritatively, by the database trigger).
function assertClientSource(source) {
  if (!SOURCES.includes(source)) throw new RangeError(`unsupported shot source: ${source}`);
  if (source === 'automated') {
    throw new RangeError('automated source cannot be set by a client submission');
  }
  return source;
}

// Idempotency is scoped to (team_id, idempotency_key) and excludes voided
// events, matching the shot_events_idempotency_idx partial unique index.
// A caller must supply both a stable team scope and a client-generated key;
// omitting the key means the shot is never deduplicated (legitimate rapid
// consecutive shots stay separate by default).
function idempotencyScopeKey(teamId, idempotencyKey) {
  if (!teamId) throw new TypeError('teamId is required to scope an idempotency key');
  if (!idempotencyKey) return null;
  return `${teamId}:${idempotencyKey}`;
}

function percentage(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator < 0) {
    throw new TypeError('percentage inputs must be finite and non-negative');
  }
  return denominator === 0 ? null : (numerator / denominator) * 100;
}

function aggregate(events, { playerId, goalieId, opponent } = {}) {
  const filtered = events.filter(event =>
    !event.voidedAt &&
    (!playerId || event.shooterPlayerId === playerId) &&
    (!goalieId || event.goaliePlayerId === goalieId) &&
    (!opponent || event.opponentTeamName === opponent)
  );
  const byZone = new Map();
  for (const event of filtered) {
    const zone = event.zone || classifyZone(event.normalizedX, event.normalizedY);
    const row = byZone.get(zone) || { zone, attempts: 0, sog: 0, goals: 0, saves: 0 };
    row.attempts += 1;
    if (isSog(event.result)) row.sog += 1;
    if (event.result === 'GOAL') row.goals += 1;
    if (event.result === 'SAVE') row.saves += 1;
    byZone.set(zone, row);
  }
  const totals = [...byZone.values()];
  const attempts = filtered.length;
  const sog = totals.reduce((sum, row) => sum + row.sog, 0);
  const goals = totals.reduce((sum, row) => sum + row.goals, 0);
  const saves = totals.reduce((sum, row) => sum + row.saves, 0);
  return {
    attempts,
    shotsAgainst: attempts,
    sog,
    goals,
    goalsAgainst: goals,
    saves,
    shootingPercentage: percentage(goals, sog),
    savePercentage: percentage(saves, saves + goals),
    zones: totals.map(row => ({ ...row, shootingPercentage: percentage(row.goals, row.sog) }))
  };
}

function reconciliation({ recordedShotsFor, recordedShotsAgainst, shotsFor = null, shotsAgainst = null }) {
  const known = shotsFor !== null || shotsAgainst !== null;
  const forExceeds = shotsFor !== null && recordedShotsFor > shotsFor;
  const againstExceeds = shotsAgainst !== null && recordedShotsAgainst > shotsAgainst;
  const forMatches = shotsFor === null || shotsFor === recordedShotsFor;
  const againstMatches = shotsAgainst === null || shotsAgainst === recordedShotsAgainst;
  let completeness;
  if (!known) {
    completeness = 'UNKNOWN';
  } else if (forExceeds || againstExceeds) {
    // Recorded events outnumber the canonical total: a contradiction, not an
    // ordinary undercount. Always surfaced distinctly so it is never
    // presented to a coach as routine partial coverage.
    completeness = 'MISMATCH';
  } else if (forMatches && againstMatches) {
    completeness = 'COMPLETE';
  } else {
    completeness = 'PARTIAL';
  }
  return {
    completeness,
    mismatch: completeness === 'MISMATCH',
    recordedShotsFor,
    recordedShotsAgainst,
    shotsFor,
    shotsAgainst
  };
}

module.exports = {
  RESULTS, SOURCES, ZONES, normalizeCoordinates, classifyZone, isSog, percentage, aggregate,
  reconciliation, assertClientSource, idempotencyScopeKey
};
