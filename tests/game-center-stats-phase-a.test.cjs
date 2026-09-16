const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const migrationPath = path.join(
  repoRoot,
  'supabase',
  'migrations',
  '20260916090000_game_center_stats_phase_a_team_stats_contract.sql'
);
const docPath = path.join(repoRoot, 'docs', 'game-center-stats-phase-b-contract.md');
const migrationSql = fs.readFileSync(migrationPath, 'utf8');
const contractDoc = fs.readFileSync(docPath, 'utf8');

const acceptedKeys = new Set([
  'shots_for',
  'shots_against',
  'shots_for_p1',
  'shots_for_p2',
  'shots_for_p3',
  'shots_for_ot',
  'shots_against_p1',
  'shots_against_p2',
  'shots_against_p3',
  'shots_against_ot',
  'power_play_chances',
  'power_play_success',
  'penalty_kill_chances',
  'penalty_kill_success',
  'faceoff_wins',
  'faceoff_losses'
]);

const forbiddenGoalKeys = [
  'goals_for',
  'goals_against',
  'goals_for_p1',
  'goals_for_p2',
  'goals_for_p3',
  'goals_for_ot',
  'goals_against_p1',
  'goals_against_p2',
  'goals_against_p3',
  'goals_against_ot'
];

function assertStaticSafety(sql) {
  assert.match(sql, /set search_path = ''/i, 'SECURITY DEFINER RPC must use an empty search path');
  assert.match(sql, /jsonb_typeof\(payload\) <> 'object'/i, 'payload must be required to be a JSON object');
  assert.match(sql, /payload = '\{\}'::jsonb/i, 'empty payloads must be rejected');
  assert.match(sql, /payload \?\| array\[/i, 'score and period-goal keys must be rejected as a group');
  assert.match(sql, /for update/i, 'game/stat/schedule rows must be locked for atomic season/preservation behavior');
  assert.match(sql, /has_workspace_feature_access\(target_team_id, target_season_id, 'stats\.edit', 'stats'\) is not true/i);
  assert.match(sql, /revoke all on function public\.save_game_team_stats\(uuid, uuid, text, jsonb\) from public, anon/i);
  assert.match(sql, /grant execute on function public\.save_game_team_stats\(uuid, uuid, text, jsonb\) to authenticated/i);
  assert.match(sql, /revoke all on function public\.require_jsonb_nonnegative_integer\(jsonb, text\) from public, anon, authenticated/i);
  assert.match(sql, /ot_applicability', 'unresolved'/i);

  assert.doesNotMatch(sql, /disable\s+row\s+level\s+security/i, 'migration must not disable RLS');
  assert.doesNotMatch(sql, /drop\s+table/i, 'migration must not drop tables');
  assert.doesNotMatch(sql, /truncate\s+table/i, 'migration must not truncate tables');
  assert.doesNotMatch(sql, /grant\s+(?:select|insert|update|delete|all)[\s\S]*on\s+public\.team_game_team_stats[\s\S]*to\s+authenticated/i);
  assert.doesNotMatch(sql, /\bgoals_for\s*=/i, 'new RPC must not assign goals_for');
  assert.doesNotMatch(sql, /\bgoals_against\s*=/i, 'new RPC must not assign goals_against');
  assert.doesNotMatch(sql, /team_game_player_stats[\s\S]*(insert|update|delete)/i, 'new RPC must not write player/goalie rows');
  assert.doesNotMatch(sql, /team_season_records[\s\S]*(insert|update|delete)/i, 'new RPC must not write season rollups');
  assert.doesNotMatch(sql, /RLS remains the existing boundary|does not bypass it/i, 'docs/comments must not claim definer functions cannot bypass RLS');
}

function parseNonnegativeInteger(value, field) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  if (typeof value === 'boolean' || Array.isArray(value) || typeof value === 'object') {
    throw new Error(`${field} must be a nonnegative whole number or null`);
  }
  const raw = String(value).trim();
  if (!/^[0-9]+$/.test(raw)) throw new Error(`${field} must be a nonnegative whole number or null`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed > 2147483647) {
    throw new Error(`${field} must be a nonnegative whole number or null`);
  }
  return parsed;
}

function saveTeamStatsModel({
  authorized = true,
  userId = 'user-1',
  today = '2026-09-16',
  game = { team_id: 'team-1', season_id: 'season-1', source_game_id: 'game-1', date: '2026-09-01' },
  schedule = { team_id: 'team-1', season_id: 'season-1', linked_game_source_id: 'game-1' },
  existing = null,
  targetTeamId = 'team-1',
  targetSeasonId = 'season-1',
  targetGameId = 'game-1',
  payload
}) {
  if (!userId) throw new Error('Authentication is required');
  if (!targetTeamId || !targetSeasonId) throw new Error('A team and season are required');
  if (!targetGameId || !String(targetGameId).trim()) throw new Error('A game is required');
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
    throw new Error('Team stats payload must be a JSON object');
  }
  if (Object.keys(payload).length === 0) throw new Error('include at least one editable field');
  for (const key of Object.keys(payload)) {
    if (forbiddenGoalKeys.includes(key)) throw new Error('may not write goal fields');
    if (!acceptedKeys.has(key)) throw new Error(`Unsupported team stat field: ${key}`);
  }
  if (authorized !== true) throw new Error('not authorized');
  if (!game || game.team_id !== targetTeamId || game.source_game_id !== targetGameId) {
    throw new Error('does not belong to this team');
  }
  if (game.date > today) throw new Error('not eligible');
  if (game.season_id && game.season_id !== targetSeasonId) throw new Error('game already belongs');
  if (schedule && schedule.season_id && schedule.season_id !== targetSeasonId) {
    throw new Error('schedule entry belongs');
  }
  if (existing) {
    if (!existing.season_id) throw new Error('stats have no season');
    if (existing.season_id !== targetSeasonId) throw new Error('stats belong to a different season');
  }
  if (!game.season_id && existing) throw new Error('game has no season while stats already exist');

  const next = { ...(existing || { team_id: targetTeamId, source_game_id: targetGameId, season_id: targetSeasonId }) };
  for (const key of acceptedKeys) {
    if (Object.prototype.hasOwnProperty.call(payload, key) && key !== 'shots_for' && key !== 'shots_against') {
      next[key] = parseNonnegativeInteger(payload[key], key);
    }
  }

  const legacyShotsFor = Object.prototype.hasOwnProperty.call(payload, 'shots_for')
    ? parseNonnegativeInteger(payload.shots_for, 'shots_for')
    : null;
  const legacyShotsAgainst = Object.prototype.hasOwnProperty.call(payload, 'shots_against')
    ? parseNonnegativeInteger(payload.shots_against, 'shots_against')
    : null;

  const hasForReg = ['shots_for_p1', 'shots_for_p2', 'shots_for_p3'].every(key => next[key] !== null && next[key] !== undefined);
  const hasAgainstReg = ['shots_against_p1', 'shots_against_p2', 'shots_against_p3'].every(key => next[key] !== null && next[key] !== undefined);
  const derivedFor = hasForReg ? next.shots_for_p1 + next.shots_for_p2 + next.shots_for_p3 : undefined;
  const derivedAgainst = hasAgainstReg ? next.shots_against_p1 + next.shots_against_p2 + next.shots_against_p3 : undefined;

  if (derivedFor !== undefined) next.shots_for = derivedFor;
  if (derivedAgainst !== undefined) next.shots_against = derivedAgainst;
  if (legacyShotsFor !== null && next.shots_for !== null && next.shots_for !== undefined && legacyShotsFor !== next.shots_for) {
    throw new Error('shots_for must match');
  }
  if (legacyShotsAgainst !== null && next.shots_against !== null && next.shots_against !== undefined && legacyShotsAgainst !== next.shots_against) {
    throw new Error('shots_against must match');
  }
  if (legacyShotsFor !== null && (next.shots_for === null || next.shots_for === undefined)) next.shots_for = legacyShotsFor;
  if (legacyShotsAgainst !== null && (next.shots_against === null || next.shots_against === undefined)) next.shots_against = legacyShotsAgainst;

  for (const [attempts, success, label] of [
    ['power_play_chances', 'power_play_success', 'Power play'],
    ['penalty_kill_chances', 'penalty_kill_success', 'Penalty kill']
  ]) {
    if ((next[attempts] === null || next[attempts] === undefined) !== (next[success] === null || next[success] === undefined)) {
      throw new Error(`${label} chances and successes must both be null or both be recorded`);
    }
    if (next[success] !== null && next[success] !== undefined && next[success] > next[attempts]) {
      throw new Error(`${label} success cannot exceed`);
    }
  }

  return {
    row: next,
    adoptedGameSeason: game.season_id === null ? targetSeasonId : game.season_id,
    adoptedScheduleSeason: schedule && schedule.season_id === null ? targetSeasonId : schedule?.season_id,
    ot_applicability: 'unresolved'
  };
}

test('static migration checks catch score overwrite and RLS-disable mutations', () => {
  assertStaticSafety(migrationSql);
  assert.throws(() => assertStaticSafety(`${migrationSql}\nalter table public.team_game_team_stats disable row level security;`), /disable RLS|row level security/i);
  assert.throws(() => assertStaticSafety(`${migrationSql}\nupdate public.team_game_team_stats set goals_for = 9;`), /goals_for/);
});

test('migration is additive and defines only the intended new period-shot columns', () => {
  for (const col of [
    'shots_for_p1',
    'shots_for_p2',
    'shots_for_p3',
    'shots_for_ot',
    'shots_against_p1',
    'shots_against_p2',
    'shots_against_p3',
    'shots_against_ot'
  ]) {
    assert.match(migrationSql, new RegExp(`add column if not exists ${col} integer`, 'i'), `missing ${col}`);
    assert.match(migrationSql, new RegExp(`${col} is null or ${col} >= 0`, 'i'), `missing nonnegative guard for ${col}`);
  }
  assert.doesNotMatch(migrationSql, /default\s+0/i, 'period columns must not zero-backfill through defaults');
});

test('payload contract rejects malformed JSON, empty patches, unknown keys, and goal keys', () => {
  for (const payload of [null, [], 'x', 1, true, {}]) {
    assert.throws(() => saveTeamStatsModel({ payload }), /JSON object|include at least one/);
  }
  assert.throws(() => saveTeamStatsModel({ payload: { unknown: 1 } }), /Unsupported/);
  assert.throws(() => saveTeamStatsModel({ payload: { goals_for: 3 } }), /goal fields/);
  assert.throws(() => saveTeamStatsModel({ payload: { goals_against_p1: 1 } }), /goal fields/);
});

test('integer parser preserves NULL and explicit zero while rejecting fractions, negatives, nonfinite, and composites', () => {
  assert.equal(parseNonnegativeInteger(null, 'field'), null);
  assert.equal(parseNonnegativeInteger('', 'field'), null);
  assert.equal(parseNonnegativeInteger(' 0 ', 'field'), 0);
  assert.equal(parseNonnegativeInteger(12, 'field'), 12);
  for (const value of [-1, 1.5, '8.5', 'NaN', 'Infinity', {}, [], false, 2147483648]) {
    assert.throws(() => parseNonnegativeInteger(value, 'field'), /nonnegative whole number/);
  }
});

test('complete regulation period shots derive totals and reject inconsistent legacy totals', () => {
  const saved = saveTeamStatsModel({
    payload: {
      shots_for_p1: 8,
      shots_for_p2: 11,
      shots_for_p3: 9,
      shots_against_p1: 7,
      shots_against_p2: 8,
      shots_against_p3: 8,
      shots_for: 28,
      shots_against: 23
    }
  });
  assert.equal(saved.row.shots_for, 28);
  assert.equal(saved.row.shots_against, 23);
  assert.throws(() => saveTeamStatsModel({
    payload: { shots_for_p1: 8, shots_for_p2: 11, shots_for_p3: 9, shots_for: 999 }
  }), /shots_for must match/);
});

test('incomplete period shots preserve historical totals and omitted fields do not erase unrelated stats', () => {
  const existing = {
    team_id: 'team-1',
    source_game_id: 'game-1',
    season_id: 'season-1',
    shots_for: 28,
    shots_against: 23,
    faceoff_wins: 15,
    faceoff_losses: 11,
    power_play_chances: 2,
    power_play_success: 1,
    penalty_kill_chances: 3,
    penalty_kill_success: 2
  };
  const saved = saveTeamStatsModel({
    existing,
    payload: { shots_for_p1: 8, shots_for_p2: 11, faceoff_wins: 16 }
  });
  assert.equal(saved.row.shots_for, 28);
  assert.equal(saved.row.shots_against, 23);
  assert.equal(saved.row.shots_for_p3, undefined);
  assert.equal(saved.row.faceoff_wins, 16);
  assert.equal(saved.row.faceoff_losses, 11);
  assert.equal(saved.row.power_play_chances, 2);
  assert.equal(saved.row.power_play_success, 1);
});

test('explicit zero period values derive zero totals without confusing zero and null', () => {
  const saved = saveTeamStatsModel({
    payload: {
      shots_for_p1: 0,
      shots_for_p2: 0,
      shots_for_p3: 0,
      shots_against_p1: 0,
      shots_against_p2: 0,
      shots_against_p3: 0
    }
  });
  assert.equal(saved.row.shots_for, 0);
  assert.equal(saved.row.shots_against, 0);
});

test('OT is stored as unresolved applicability and is not invented as total authority', () => {
  const saved = saveTeamStatsModel({
    payload: { shots_for_p1: 8, shots_for_p2: 8, shots_for_p3: 8, shots_for_ot: 4 }
  });
  assert.equal(saved.row.shots_for, 24);
  assert.equal(saved.row.shots_for_ot, 4);
  assert.equal(saved.ot_applicability, 'unresolved');
  assert.match(contractDoc, /no identified canonical OT-occurrence field/i);
  assert.match(contractDoc, /must not treat this contract as\s+complete/i);
});

test('season integrity rejects missing seasons, reparenting, cross-team games, and conflicting schedule links', () => {
  assert.throws(() => saveTeamStatsModel({ targetSeasonId: null, payload: { faceoff_wins: 1 } }), /team and season/);
  assert.throws(() => saveTeamStatsModel({
    game: { team_id: 'team-1', season_id: 'season-2', source_game_id: 'game-1', date: '2026-09-01' },
    payload: { faceoff_wins: 1 }
  }), /game already belongs/);
  assert.throws(() => saveTeamStatsModel({
    game: { team_id: 'team-2', season_id: 'season-1', source_game_id: 'game-1', date: '2026-09-01' },
    payload: { faceoff_wins: 1 }
  }), /does not belong/);
  assert.throws(() => saveTeamStatsModel({
    schedule: { team_id: 'team-1', season_id: 'season-2', linked_game_source_id: 'game-1' },
    payload: { faceoff_wins: 1 }
  }), /schedule entry belongs/);
  assert.throws(() => saveTeamStatsModel({
    existing: { team_id: 'team-1', source_game_id: 'game-1', season_id: 'season-2' },
    payload: { faceoff_wins: 1 }
  }), /stats belong/);
  assert.throws(() => saveTeamStatsModel({
    existing: { team_id: 'team-1', source_game_id: 'game-1', season_id: null },
    payload: { faceoff_wins: 1 }
  }), /stats have no season/);
});

test('legacy null-season game and schedule adoption is explicit and rejects conflicting existing stats', () => {
  const saved = saveTeamStatsModel({
    game: { team_id: 'team-1', season_id: null, source_game_id: 'game-1', date: '2026-09-01' },
    schedule: { team_id: 'team-1', season_id: null, linked_game_source_id: 'game-1' },
    payload: { faceoff_wins: 1 }
  });
  assert.equal(saved.adoptedGameSeason, 'season-1');
  assert.equal(saved.adoptedScheduleSeason, 'season-1');
  assert.throws(() => saveTeamStatsModel({
    game: { team_id: 'team-1', season_id: null, source_game_id: 'game-1', date: '2026-09-01' },
    existing: { team_id: 'team-1', source_game_id: 'game-1', season_id: 'season-1' },
    payload: { faceoff_wins: 1 }
  }), /game has no season while stats already exist/);
});

test('PP and PK pairs require both-null or both-present whole nonnegative counts with success bounded by opportunities', () => {
  const recordedZero = saveTeamStatsModel({
    payload: {
      power_play_chances: 0,
      power_play_success: 0,
      penalty_kill_chances: 0,
      penalty_kill_success: 0
    }
  });
  assert.equal(recordedZero.row.power_play_chances, 0);
  assert.equal(recordedZero.row.penalty_kill_success, 0);

  const unrecorded = saveTeamStatsModel({
    existing: {
      team_id: 'team-1',
      source_game_id: 'game-1',
      season_id: 'season-1',
      power_play_chances: 1,
      power_play_success: 1,
      penalty_kill_chances: 2,
      penalty_kill_success: 2
    },
    payload: {
      power_play_chances: null,
      power_play_success: null,
      penalty_kill_chances: null,
      penalty_kill_success: null
    }
  });
  assert.equal(unrecorded.row.power_play_chances, null);
  assert.equal(unrecorded.row.penalty_kill_success, null);

  assert.throws(() => saveTeamStatsModel({ payload: { power_play_chances: 5 } }), /Power play chances/);
  assert.throws(() => saveTeamStatsModel({ payload: { power_play_chances: null, power_play_success: 0 } }), /Power play chances/);
  assert.throws(() => saveTeamStatsModel({ payload: { power_play_chances: 2, power_play_success: 3 } }), /Power play success/);
  assert.throws(() => saveTeamStatsModel({ payload: { penalty_kill_chances: 1, penalty_kill_success: 2 } }), /Penalty kill success/);
});

test('security, authorization, and scope isolation are reflected in SQL and model behavior', () => {
  assert.throws(() => saveTeamStatsModel({ userId: null, payload: { faceoff_wins: 1 } }), /Authentication/);
  assert.throws(() => saveTeamStatsModel({ authorized: false, payload: { faceoff_wins: 1 } }), /not authorized/);
  assert.throws(() => saveTeamStatsModel({
    game: { team_id: 'team-1', season_id: 'season-1', source_game_id: 'game-1', date: '2099-01-01' },
    payload: { faceoff_wins: 1 }
  }), /not eligible/);

  assert.match(migrationSql, /Final score and period goals are managed by existing score\/stat paths/i);
  assert.match(migrationSql, /team stats may not write goal fields/i);
  assert.match(contractDoc, /team faceoffs/i);
  assert.match(contractDoc, /does not write score, period\s+goals, player\/goalie rows, or season-record rollups/i);
});

test('Phase B contract documents NULL, zero, omissions, totals, OT, seasons, errors, and legacy compatibility', () => {
  for (const pattern of [
    /patch-style/i,
    /Omitted accepted keys preserve/i,
    /Explicit\s+JSON `null` clears/i,
    /Explicit `0` means/i,
    /Totals are derived server-side only/i,
    /legacy total inputs/i,
    /No existing authoritative OT-occurrence field/i,
    /requires `target_season_id`/i,
    /partial pairs/i,
    /SECURITY DEFINER.*bypass table RLS/is,
    /`save_game_stats` also writes\s+score fields/i,
    /must not be auto-repaired or zero-backfilled/i
  ]) {
    assert.match(contractDoc, pattern);
  }
});

test('PostgreSQL behavior tests are not executed by this static/model suite', () => {
  assert.ok(true, 'No local disposable PostgreSQL server is required or contacted by this file.');
});
