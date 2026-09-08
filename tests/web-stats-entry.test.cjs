const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('web/stats-entry.js', 'utf8');
const appSource = fs.readFileSync('web/app.js', 'utf8');
const indexSource = fs.readFileSync('web/index.html', 'utf8');

function loadModule() {
  const context = { window: {} };
  vm.runInNewContext(source, context);
  return context.window.FoxesStatsEntry;
}

function rpcClient(response = { data: { source_game_id: 'g1', skaters_saved: 1, goalies_saved: 0, team_stats_saved: false }, error: null }) {
  const calls = [];
  return {
    client: { rpc: (name, args) => { calls.push([name, args]); return Promise.resolve(response); } },
    calls
  };
}

const workspace = { authorized: true, organization_id: 'org-a', team_id: 'team-a', season_id: 'season-a' };

test('parseStatValue preserves missing vs zero and ignores unparsable input', () => {
  const api = loadModule();
  assert.equal(api.parseStatValue(''), null);
  assert.equal(api.parseStatValue(undefined), null);
  assert.equal(api.parseStatValue(null), null);
  assert.equal(api.parseStatValue('   '), null);
  assert.equal(api.parseStatValue('0'), 0);
  assert.equal(api.parseStatValue(0), 0);
  assert.equal(api.parseStatValue('4'), 4);
  assert.equal(api.parseStatValue('abc'), null);
});

test('normalizeSkaterRow keeps every canonical field and never coerces blanks to 0', () => {
  const api = loadModule();
  const row = api.normalizeSkaterRow({ gp: '1', goals: '0', assists: '', shots: '3', penalty_minutes: undefined });
  assert.equal(row.gp, 1);
  assert.equal(row.goals, 0);
  assert.equal(row.assists, null);
  assert.equal(row.shots, 3);
  assert.equal(row.penalty_minutes, null);
  assert.deepEqual(Object.keys(row).sort(), [...api.SKATER_FIELDS].sort());
});

test('normalizeGoalieRow does not introduce a shots_against field on the player-stats schema', () => {
  const api = loadModule();
  assert.equal(api.GOALIE_FIELDS.includes('shots_against'), false);
  const row = api.normalizeGoalieRow({ saves: '10', goals_against: '2' });
  assert.equal(Object.hasOwn(row, 'shots_against'), false);
});

test('derivePoints only derives when both goals and assists are tracked', () => {
  const api = loadModule();
  assert.equal(api.derivePoints({ goals: 2, assists: 1 }), 3);
  assert.equal(api.derivePoints({ goals: 0, assists: 0 }), 0);
  assert.equal(api.derivePoints({ goals: null, assists: 1 }), null);
  assert.equal(api.derivePoints({ goals: 2, assists: null }), null);
});

test('deriveGoalieMetrics computes SA only from tracked Saves+GA, SV% only when SA>0, GAA only with tracked minutes', () => {
  const api = loadModule();
  const full = api.deriveGoalieMetrics({ saves: 25, goals_against: 3, minutes: 48 });
  assert.equal(full.shotsAgainst, 28);
  assert.equal(full.savePct, 25 / 28);
  assert.equal(full.gaa, 3 / (48 / 60));

  const missingSaves = api.deriveGoalieMetrics({ saves: null, goals_against: 1, minutes: 20 });
  assert.equal(missingSaves.shotsAgainst, null);
  assert.equal(missingSaves.savePct, null);

  const missingGa = api.deriveGoalieMetrics({ saves: 10, goals_against: null, minutes: 20 });
  assert.equal(missingGa.shotsAgainst, null);
  assert.equal(missingGa.savePct, null);

  const zeroShots = api.deriveGoalieMetrics({ saves: 0, goals_against: 0, minutes: 10 });
  assert.equal(zeroShots.shotsAgainst, 0);
  assert.equal(zeroShots.savePct, null); // guarded: SA is 0, never divide by zero

  const noMinutes = api.deriveGoalieMetrics({ saves: 5, goals_against: 1, minutes: null });
  assert.equal(noMinutes.gaa, null);

  assert.doesNotMatch(JSON.stringify(full), /NaN|Infinity/);
  assert.doesNotMatch(JSON.stringify(zeroShots), /NaN|Infinity/);
});

test('deriveFaceoffPct guards zero faceoff attempts and requires both wins and losses tracked', () => {
  const api = loadModule();
  assert.equal(api.deriveFaceoffPct({ faceoff_wins: 5, faceoff_losses: 3 }).faceoffPct, 62.5);
  assert.equal(api.deriveFaceoffPct({ faceoff_wins: 0, faceoff_losses: 0 }).faceoffPct, null);
  assert.equal(api.deriveFaceoffPct({ faceoff_wins: null, faceoff_losses: 3 }).faceoffPct, null);
});

test('existingSkaterStatsByPlayer/existingGoalieStatsByPlayer split rows by canonical player_type', () => {
  const api = loadModule();
  const rows = [
    { source_player_id: 's1', player_type: 'skater', goals: 1 },
    { source_player_id: 'g1', player_type: 'goalie', saves: 10 },
    { source_player_id: 's2', goals: 0 } // missing player_type defaults to skater
  ];
  const skaters = api.existingSkaterStatsByPlayer(rows);
  const goalies = api.existingGoalieStatsByPlayer(rows);
  assert.equal(skaters.size, 2);
  assert.equal(goalies.size, 1);
  assert.equal(goalies.get('g1').saves, 10);
});

test('buildSavePayload requires an authorized workspace and a game, and derives team/season from the workspace', () => {
  const api = loadModule();
  assert.throws(() => api.buildSavePayload({ workspace: null, sourceGameId: 'g1' }), /authorized team workspace/);
  assert.throws(() => api.buildSavePayload({ workspace, sourceGameId: '' }), /game is required/);
  const payload = api.buildSavePayload({
    workspace,
    sourceGameId: 'g1',
    skaterRows: [{ source_player_id: 's1', goals: '2', assists: '' }],
    goalieRows: [{ source_player_id: 'g1', saves: '10' }],
    teamStats: { goals_for: '3' }
  });
  assert.equal(payload.target_team_id, 'team-a');
  assert.equal(payload.target_season_id, 'season-a');
  assert.equal(payload.target_source_game_id, 'g1');
  assert.equal(payload.skater_stats[0].goals, 2);
  assert.equal(payload.skater_stats[0].assists, null);
  assert.equal(payload.goalie_stats[0].saves, 10);
  assert.equal(payload.team_stats.goals_for, 3);
});

test('buildSavePayload never sends client-computed derived stats (PTS/SV%/GAA/faceoff%) to the RPC', () => {
  const api = loadModule();
  const payload = api.buildSavePayload({
    workspace,
    sourceGameId: 'g1',
    skaterRows: [{ source_player_id: 's1', goals: '2', assists: '1', points: 999, pts: 999 }],
    goalieRows: [{ source_player_id: 'g1', saves: '10', goals_against: '2', save_pct: 0.9, sv_pct: 0.9, gaa: 1.5 }]
  });
  assert.equal(Object.hasOwn(payload.skater_stats[0], 'points'), false);
  assert.equal(Object.hasOwn(payload.skater_stats[0], 'pts'), false);
  assert.equal(Object.hasOwn(payload.goalie_stats[0], 'save_pct'), false);
  assert.equal(Object.hasOwn(payload.goalie_stats[0], 'sv_pct'), false);
  assert.equal(Object.hasOwn(payload.goalie_stats[0], 'gaa'), false);
});

test('buildSavePayload sends null team_stats when no team fields were touched (no fabricated zeroes)', () => {
  const api = loadModule();
  const payload = api.buildSavePayload({ workspace, sourceGameId: 'g1', teamStats: { goals_for: '', goals_against: null } });
  assert.equal(payload.team_stats, null);
});

test('buildSavePayload drops rows without a source_player_id and preserves real zero entries', () => {
  const api = loadModule();
  const payload = api.buildSavePayload({
    workspace,
    sourceGameId: 'g1',
    skaterRows: [{ source_player_id: '', goals: 5 }, { source_player_id: 's1', goals: '0', assists: '0' }]
  });
  assert.equal(payload.skater_stats.length, 1);
  assert.equal(payload.skater_stats[0].goals, 0);
  assert.equal(payload.skater_stats[0].assists, 0);
});

test('save() calls the save_game_stats RPC with the built payload and surfaces RPC errors', async () => {
  const api = loadModule();
  const { client, calls } = rpcClient();
  const manager = api.createStatsEntry({ client, getWorkspace: () => workspace });
  await manager.save('g1', { skaterRows: [{ source_player_id: 's1', goals: '1' }], goalieRows: [], teamStats: null });
  assert.equal(calls[0][0], 'save_game_stats');
  assert.equal(calls[0][1].target_team_id, 'team-a');
  assert.equal(calls[0][1].target_source_game_id, 'g1');
  assert.equal(calls[0][1].skater_stats[0].goals, 1);

  const { client: failingClient } = rpcClient({ data: null, error: { message: 'The current workspace is not authorized to edit stats for this team and season.' } });
  const failingManager = api.createStatsEntry({ client: failingClient, getWorkspace: () => workspace });
  await assert.rejects(
    () => failingManager.save('g1', { skaterRows: [], goalieRows: [], teamStats: null }),
    /not authorized to edit stats/
  );
});

test('setWorkspace/clearWorkspace scope save() the same way roster management scopes writes', async () => {
  const api = loadModule();
  const { client } = rpcClient();
  const manager = api.createStatsEntry({ client });
  manager.setWorkspace(workspace);
  await manager.save('g1', { skaterRows: [], goalieRows: [], teamStats: null });
  manager.clearWorkspace();
  await assert.rejects(() => manager.save('g1', { skaterRows: [], goalieRows: [], teamStats: null }), /authorized team workspace/);
});

test('Game Stat Entry wires the stats-entry module and RPC into the Game Center view', () => {
  assert.match(appSource, /window\.FoxesStatsEntry\.createStatsEntry/);
  assert.match(appSource, /statsEntryManager\.save\(/);
  assert.match(appSource, /statsEntryManager\.setWorkspace/);
  assert.match(appSource, /statsEntryManager\.clearWorkspace/);
  assert.match(appSource, /PERMISSIONS\.STATS_EDIT/);
  assert.match(appSource, /data-enter-stats/);
  assert.match(appSource, /Enter Stats|Edit Stats/);
  assert.match(indexSource, /stats-entry\.js/);
});

test('Game Center never lets a caller select a game outside the authorized team (client-side gating)', () => {
  // statsEntryGames() reads only from phase1Data.games, which loadPhase1Data
  // populates from a query already filtered with .eq('team_id', teamId).
  assert.match(appSource, /function statsEntryGames\(\) \{/);
  assert.match(appSource, /read\('games', 'team_games'.*PERMISSIONS\.GAMES_VIEW\)/);
});

test('Game Center excludes future-dated games from the enterable list client-side, mirroring the server-side eligibility guard', () => {
  assert.match(appSource, /function statsEntryGames\(\) \{\s*\n\s*const today = phase1DateKey\(\);\s*\n\s*return \(phase1Data\?\.games \|\| \[\]\)\s*\n\s*\.filter\(game => String\(game\.date \|\| ''\) <= today\)/);
});
