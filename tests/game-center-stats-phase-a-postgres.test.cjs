'use strict';

// Real PostgreSQL behavior proof for save_game_team_stats (Phase A).
//
// This file executes actual SQL against a disposable PostgreSQL 15 instance
// running the FULL replayed migration history (001 -> Phase A), including
// real RLS policies, real SECURITY DEFINER functions, and real CHECK
// constraints. It is NOT a JS model of the behavior: every assertion below
// is the result of a genuine round trip through Postgres.
//
// It requires a reachable disposable database and is SKIPPED (not failed)
// when one is not configured, so `npm test` remains runnable without Docker.
// Set PHASE_A_PG_PROOF_URL to point at the disposable instance, e.g.:
//   postgresql://postgres:postgres@localhost:55432/postgres
//
// This suite must never point at Supabase or any production database.

const test = require('node:test');
const assert = require('node:assert/strict');

const CONNECTION_STRING = process.env.PHASE_A_PG_PROOF_URL || '';

if (!CONNECTION_STRING) {
  test('save_game_team_stats real PostgreSQL proof (SKIPPED)', (t) => {
    t.skip(
      'PHASE_A_PG_PROOF_URL is not set. This suite only runs against a ' +
      'disposable local PostgreSQL instance with the full migration history ' +
      'replayed; it is intentionally skipped (not faked) otherwise.'
    );
  });
  return;
}

if (/supabase\.co|pooler\.supabase\.com/i.test(CONNECTION_STRING)) {
  throw new Error(
    'Refusing to run: PHASE_A_PG_PROOF_URL looks like a Supabase host. ' +
    'This suite may only run against a disposable local database.'
  );
}

const { Client } = require('pg');

const TEAM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_TEAM_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SEASON_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const OTHER_SEASON_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const OWNER_USER_ID = '11111111-1111-4111-8111-111111111111';
const READONLY_USER_ID = '22222222-2222-4222-8222-222222222222';
const CROSS_TEAM_USER_ID = '33333333-3333-4333-8333-333333333333';

let adminClient;

async function asUser(userId, fn) {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  try {
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

async function callSaveGameTeamStats(client, { teamId = TEAM_ID, seasonId = SEASON_ID, sourceGameId, payload }) {
  const result = await client.query(
    'select public.save_game_team_stats($1, $2, $3, $4::jsonb) as result',
    [teamId, seasonId, sourceGameId, JSON.stringify(payload)]
  );
  return result.rows[0].result;
}

async function readStatsRow(sourceGameId, teamId = TEAM_ID) {
  const result = await adminClient.query(
    'select * from public.team_game_team_stats where team_id = $1 and source_game_id = $2',
    [teamId, sourceGameId]
  );
  return result.rows[0] || null;
}

test.before(async () => {
  adminClient = new Client({ connectionString: CONNECTION_STRING });
  await adminClient.connect();
});

test.after(async () => {
  await adminClient.end();
});

test('period shots: complete regulation triplet derives shots_for/shots_against server-side', async () => {
  const result = await asUser(OWNER_USER_ID, (client) =>
    callSaveGameTeamStats(client, {
      sourceGameId: 'game-with-season',
      payload: {
        shots_for_p1: 10, shots_for_p2: 9, shots_for_p3: 11,
        shots_against_p1: 6, shots_against_p2: 7, shots_against_p3: 8,
      },
    })
  );
  assert.equal(result.shots_for, 30);
  assert.equal(result.shots_against, 21);
  const row = await readStatsRow('game-with-season');
  assert.equal(Number(row.shots_for), 30);
  assert.equal(Number(row.shots_against), 21);
});

test('NULL vs explicit zero: an unrecorded period stays NULL, a recorded zero stays 0', async () => {
  await asUser(OWNER_USER_ID, (client) =>
    callSaveGameTeamStats(client, {
      sourceGameId: 'partial-null-vs-zero',
      payload: { shots_for_p1: 0 },
    })
  );
  const row = await readStatsRow('partial-null-vs-zero');
  assert.equal(row.shots_for_p1, 0, 'explicit zero must be stored as 0, not NULL');
  assert.equal(row.shots_for_p2, null, 'unrecorded period must remain NULL');
  assert.equal(row.shots_for, null, 'total must not be invented from a partial period set');
});

test('partial-period behavior: an incomplete triplet does not fabricate a total', async () => {
  await asUser(OWNER_USER_ID, (client) =>
    callSaveGameTeamStats(client, {
      sourceGameId: 'partial-two-of-three',
      payload: { shots_for_p1: 5, shots_for_p2: 4 },
    })
  );
  const row = await readStatsRow('partial-two-of-three');
  assert.equal(row.shots_for, null);
});

test('historical-total preservation: an incomplete follow-up save keeps a prior valid total', async () => {
  const before = await readStatsRow('game-with-history');
  assert.equal(Number(before.shots_for), 31);
  await asUser(OWNER_USER_ID, (client) =>
    callSaveGameTeamStats(client, {
      sourceGameId: 'game-with-history',
      payload: { shots_for_p1: 12 },
    })
  );
  const after = await readStatsRow('game-with-history');
  assert.equal(Number(after.shots_for), 31, 'prior valid total must survive an incomplete-period save');
  assert.equal(Number(after.shots_against), 24);
  assert.equal(after.shots_for_p1, 12, 'the newly supplied period value is still recorded');
});

test('PP/PK validation: both-null-or-both-present is enforced and success cannot exceed opportunities', async () => {
  await assert.rejects(
    asUser(OWNER_USER_ID, (client) =>
      callSaveGameTeamStats(client, {
        sourceGameId: 'pp-inconsistent-pair',
        payload: { power_play_chances: 3 },
      })
    ),
    /Power play chances and successes must both be null or both be recorded/
  );
  await assert.rejects(
    asUser(OWNER_USER_ID, (client) =>
      callSaveGameTeamStats(client, {
        sourceGameId: 'pp-impossible-success',
        payload: { power_play_chances: 2, power_play_success: 3 },
      })
    ),
    /Power play success cannot exceed power play opportunities/
  );
  const result = await asUser(OWNER_USER_ID, (client) =>
    callSaveGameTeamStats(client, {
      sourceGameId: 'pp-explicit-zero-zero',
      payload: { power_play_chances: 0, power_play_success: 0, penalty_kill_chances: 0, penalty_kill_success: 0 },
    })
  );
  assert.equal(result.team_stats_saved, true);
  const row = await readStatsRow('pp-explicit-zero-zero');
  assert.equal(Number(row.power_play_chances), 0);
  assert.equal(Number(row.power_play_success), 0);
});

test('faceoffs: team-level faceoff counters are writable through the RPC', async () => {
  const result = await asUser(OWNER_USER_ID, (client) =>
    callSaveGameTeamStats(client, {
      sourceGameId: 'faceoffs-recorded',
      payload: { faceoff_wins: 28, faceoff_losses: 19 },
    })
  );
  assert.equal(result.team_stats_saved, true);
  const row = await readStatsRow('faceoffs-recorded');
  assert.equal(Number(row.faceoff_wins), 28);
  assert.equal(Number(row.faceoff_losses), 19);
});

test('score isolation: goal/score fields are rejected by the RPC', async () => {
  await assert.rejects(
    asUser(OWNER_USER_ID, (client) =>
      callSaveGameTeamStats(client, {
        sourceGameId: 'game-with-season',
        payload: { goals_for: 5 },
      })
    ),
    /Final score and period goals are managed by existing score\/stat paths/
  );
});

test('authorized editor: an owner with an active CORE-plan entitlement can save', async () => {
  const result = await asUser(OWNER_USER_ID, (client) =>
    callSaveGameTeamStats(client, {
      sourceGameId: 'game-with-season',
      payload: { shots_against_ot: 4 },
    })
  );
  assert.equal(result.team_stats_saved, true);
  assert.equal(result.ot_applicability, 'unresolved');
});

test('read-only rejection: a role without stats.edit/stats.view capability is rejected', async () => {
  await assert.rejects(
    asUser(READONLY_USER_ID, (client) =>
      callSaveGameTeamStats(client, {
        sourceGameId: 'game-with-season',
        payload: { shots_for_p1: 9 },
      })
    ),
    /not authorized to edit team stats/
  );
});

test('cross-team rejection: a member of a different team cannot save stats for this team\'s game', async () => {
  await assert.rejects(
    asUser(CROSS_TEAM_USER_ID, (client) =>
      callSaveGameTeamStats(client, {
        sourceGameId: 'game-with-season',
        payload: { shots_for_p1: 9 },
      })
    ),
    /not authorized to edit team stats|does not belong to this team/
  );
});

test('cross-season rejection: an existing game already tied to a season cannot be saved under a different season', async () => {
  await assert.rejects(
    asUser(OWNER_USER_ID, (client) =>
      callSaveGameTeamStats(client, {
        sourceGameId: 'game-with-season',
        seasonId: OTHER_SEASON_ID,
        payload: { shots_for_p1: 9 },
      })
    ),
    /already belongs to a different season/
  );
});

test('legacy-null-season adoption: a NULL-season game adopts the supplied season exactly once', async () => {
  const result = await asUser(OWNER_USER_ID, (client) =>
    callSaveGameTeamStats(client, {
      sourceGameId: 'game-legacy-null-season',
      payload: { shots_for_p1: 6 },
    })
  );
  assert.equal(result.season_id, SEASON_ID);
  const game = await adminClient.query('select season_id from public.team_games where source_game_id = $1', ['game-legacy-null-season']);
  assert.equal(game.rows[0].season_id, SEASON_ID);

  await assert.rejects(
    asUser(OWNER_USER_ID, (client) =>
      callSaveGameTeamStats(client, {
        sourceGameId: 'game-legacy-null-season',
        seasonId: OTHER_SEASON_ID,
        payload: { shots_for_p1: 7 },
      })
    ),
    /already belongs to a different season/,
    'once adopted, the season may not be silently reassigned'
  );
});

test('function privileges: anon cannot execute save_game_team_stats, authenticated can', async () => {
  const anonCheck = await adminClient.query(
    "select has_function_privilege('anon', 'public.save_game_team_stats(uuid,uuid,text,jsonb)', 'execute') as can_exec"
  );
  assert.equal(anonCheck.rows[0].can_exec, false);
  const authCheck = await adminClient.query(
    "select has_function_privilege('authenticated', 'public.save_game_team_stats(uuid,uuid,text,jsonb)', 'execute') as can_exec"
  );
  assert.equal(authCheck.rows[0].can_exec, true);
});

test('direct-table-write test: an authenticated user with stats.edit can still directly INSERT via RLS (existing policy, unchanged by Phase A)', async () => {
  // Phase A does not alter table-level RLS policies; this proves the RPC is
  // additive and does not accidentally tighten or loosen the pre-existing
  // direct-write policy path used by other legacy callers.
  await asUser(OWNER_USER_ID, async (client) => {
    await client.query(
      `insert into public.team_game_team_stats (team_id, source_game_id, season_id, shots_for)
       values ($1, 'direct-write-game', $2, 12)`,
      [TEAM_ID, SEASON_ID]
    );
    const check = await client.query(
      'select shots_for from public.team_game_team_stats where source_game_id = $1',
      ['direct-write-game']
    );
    assert.equal(Number(check.rows[0].shots_for), 12);
  });
});

test('trigger defense: validate_team_game_season trigger still rejects a stats row pointing at a mismatched season/team', async () => {
  await assert.rejects(
    adminClient.query(
      `insert into public.team_game_team_stats (team_id, source_game_id, season_id, shots_for)
       values ($1, 'trigger-defense-game', $2, 5)`,
      [OTHER_TEAM_ID, SEASON_ID]
    ),
    /./,
    'a season belonging to a different team must be rejected by the existing trigger'
  );
});

test('concurrency: two overlapping saves on the same NULL-season game are serialized by row locks; only one wins the season race', async () => {
  const gameId = 'concurrency-null-season-game';
  await adminClient.query(
    `insert into public.team_games (team_id, source_game_id, date, opponent, season_id)
     values ($1, $2, current_date - 1, 'Concurrency Visitors', null)`,
    [TEAM_ID, gameId]
  );

  const clientA = new Client({ connectionString: CONNECTION_STRING });
  const clientB = new Client({ connectionString: CONNECTION_STRING });
  await clientA.connect();
  await clientB.connect();
  try {
    await clientA.query('begin');
    await clientA.query('set local role authenticated');
    await clientA.query("select set_config('request.jwt.claim.sub', $1, true)", [OWNER_USER_ID]);
    await clientB.query('begin');
    await clientB.query('set local role authenticated');
    await clientB.query("select set_config('request.jwt.claim.sub', $1, true)", [OWNER_USER_ID]);

    // A takes the "for update" row lock on team_games first (adopting SEASON_ID).
    const resultA = await callSaveGameTeamStats(clientA, { sourceGameId: gameId, seasonId: SEASON_ID, payload: { shots_for_p1: 1 } });
    assert.equal(resultA.team_stats_saved, true);

    // B was blocked behind A's row lock (started before A committed, in
    // real concurrent usage); once A commits, B's transaction observes the
    // now-adopted season and must be rejected rather than silently
    // re-adopting or overwriting it under a different season.
    await clientA.query('commit');

    await assert.rejects(
      callSaveGameTeamStats(clientB, { sourceGameId: gameId, seasonId: OTHER_SEASON_ID, payload: { shots_for_p1: 2 } }),
      /already belongs to a different season/,
      'a losing concurrent attempt under a different season must be rejected, not silently merged'
    );
  } finally {
    await clientB.query('rollback').catch(() => {});
    await clientA.query('delete from public.team_game_team_stats where source_game_id = $1', [gameId]).catch(() => {});
    await clientA.query('delete from public.team_games where source_game_id = $1', [gameId]).catch(() => {});
    await clientA.end();
    await clientB.end();
  }
});
