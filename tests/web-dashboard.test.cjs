const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const dashboardSource = fs.readFileSync('web/dashboard.js', 'utf8');
const appSource = fs.readFileSync('web/app.js', 'utf8');
const indexSource = fs.readFileSync('web/index.html', 'utf8');
const stylesSource = fs.readFileSync('web/styles.css', 'utf8');

function loadDashboard() {
  const context = { window: {} };
  vm.runInNewContext(dashboardSource, context);
  return context.window.FoxesDashboard;
}

const D = loadDashboard();

const games = [
  { source_game_id: 'g1', date: '2026-09-01', opponent: 'A' },
  { source_game_id: 'g2', date: '2026-09-03', opponent: 'B' },
  { source_game_id: 'g3', date: '2026-09-05', opponent: 'C' },
  { source_game_id: 'g4', date: '2026-09-07', opponent: 'D' },
  { source_game_id: 'g5', date: '2026-09-09', opponent: 'E' },
  { source_game_id: 'g6', date: '2026-09-11', opponent: 'F' },
  { source_game_id: 'g7', date: '2026-09-13', opponent: 'G' } // unscored
];
const teamStats = [
  { source_game_id: 'g1', goals_for: 3, goals_against: 1, shots_for: 20, faceoff_wins: 20, faceoff_losses: 10 },
  { source_game_id: 'g2', goals_for: 2, goals_against: 4, shots_for: 18, faceoff_wins: 12, faceoff_losses: 18 },
  { source_game_id: 'g3', goals_for: 5, goals_against: 2, shots_for: 30, faceoff_wins: 22, faceoff_losses: 14 },
  { source_game_id: 'g4', goals_for: 1, goals_against: 1, shots_for: 15, faceoff_wins: 10, faceoff_losses: 10 },
  { source_game_id: 'g5', goals_for: 4, goals_against: 0, shots_for: 25, faceoff_wins: 25, faceoff_losses: 9 },
  { source_game_id: 'g6', goals_for: 6, goals_against: 2, shots_for: 28, faceoff_wins: 18, faceoff_losses: 12 }
];
const byGame = new Map(teamStats.map(row => [row.source_game_id, row]));

const roster = [
  { source_player_id: 'p7', jersey_number: '7', name: 'Jane Smith', position: 'F' },
  { source_player_id: 'p22', jersey_number: '22', name: 'Bryson Doe', position: 'D' },
  { source_player_id: 'p30', jersey_number: '30', name: 'Sam Ray', position: 'G' }
];
const playerStats = games.slice(0, 6).flatMap((game, index) => [
  { source_game_id: game.source_game_id, source_player_id: 'p7', player_type: 'skater', gp: 1, goals: index < 3 ? 0 : 2, assists: 1, shots: 4, penalty_minutes: 0, plus_minus: 1, blocks: 0, faceoff_wins: 6, faceoff_losses: 4 },
  { source_game_id: game.source_game_id, source_player_id: 'p22', player_type: 'skater', gp: 1, goals: 0, assists: index < 3 ? 1 : 0, shots: 2, penalty_minutes: 2, plus_minus: 0, blocks: 3, faceoff_wins: 0, faceoff_losses: 0 },
  { source_game_id: game.source_game_id, source_player_id: 'p30', player_type: 'goalie', gp: 1, minutes: 36, saves: 15 + index, goals_against: index % 3, wins: index % 2 === 0 ? 1 : 0, losses: index % 2 === 1 ? 1 : 0, ties: 0, shutouts: index === 4 ? 1 : 0 }
]);

test('team snapshot derives GP, record, GF/GA, differential, and shooting % from real rows', () => {
  const snap = D.snapshot(games, byGame, null);
  assert.equal(snap.gp, 6);
  assert.equal(snap.w, 4);
  assert.equal(snap.l, 1);
  assert.equal(snap.t, 1);
  assert.equal(snap.gf, 21);
  assert.equal(snap.ga, 10);
  assert.equal(snap.diff, 11);
  assert.ok(Math.abs(snap.shootingPct - 21 / 136) < 1e-9);
});

test('synced season record is authoritative for the record when present', () => {
  const snap = D.snapshot(games, byGame, { games_played: 12, wins: 8, losses: 3, ties: 1, goals_for: 40, goals_against: 25 });
  assert.equal(snap.gp, 12);
  assert.equal(snap.w, 8);
  assert.equal(snap.diff, 15);
});

test('unscored games never count toward record or trends', () => {
  const snap = D.snapshot(games, byGame, null);
  assert.equal(snap.scoredGames, 6);
  const recent = D.recentGames(games, byGame, 5);
  assert.equal(recent.length, 5);
  assert.ok(recent.every(game => game.id !== 'g7'));
  assert.equal(recent[0].id, 'g6');
  assert.equal(recent[0].result, 'W');
  assert.equal(recent[0].score, '6–2');
});

test('last 5 record only appears with real scored games', () => {
  const record = D.lastFive(games, byGame);
  assert.equal(record.count, 5);
  assert.deepEqual([record.w, record.l, record.t], [3, 1, 1]);
  assert.equal(D.lastFive([], new Map()).count, 0);
});

test('upcoming game picks the soonest future scheduled game', () => {
  const next = D.upcomingGame([
    { date: '2026-09-01', opponent: 'Past' },
    { date: '2026-09-20', time: '18:00', opponent: 'Later' },
    { date: '2026-09-15', time: '12:00', opponent: 'Next' }
  ], '2026-09-10');
  assert.equal(next.opponent, 'Next');
  assert.equal(D.upcomingGame([], '2026-09-10'), null);
});

test('points are goals plus assists and leaders rank correctly per category', () => {
  const rows = D.playerTotals(roster, playerStats);
  const jane = rows.find(row => row.player.source_player_id === 'p7');
  assert.equal(jane.goals, 6);
  assert.equal(jane.assists, 6);
  assert.equal(jane.points, 12);
  const goalLeaders = D.leaders(rows, 'goals');
  assert.equal(goalLeaders[0].player.name, 'Jane Smith');
  assert.equal(goalLeaders[0].value, 6);
  const blockLeaders = D.leaders(rows, 'blocks');
  assert.equal(blockLeaders[0].player.name, 'Bryson Doe');
  const pimLeaders = D.leaders(rows, 'pim');
  assert.equal(pimLeaders[0].value, 12);
});

test('faceoff % requires a 10-draw minimum and handles zero safely', () => {
  const rows = D.playerTotals(roster, playerStats);
  const leaders = D.leaders(rows, 'faceoffPct');
  assert.equal(leaders.length, 1);
  assert.equal(leaders[0].player.name, 'Jane Smith');
  assert.equal(leaders[0].display, '60.0%');
  assert.equal(D.LEADER_CATEGORIES.faceoffPct.note, 'Minimum 10 faceoffs');
  const smallSample = D.leaders([
    { player: roster[0], goals: 0, assists: 0, points: 0, shots: 0, pim: 0, plusMinus: 0, blocks: 0, fow: 1, fol: 0, faceoffs: 1, byGame: [] }
  ], 'faceoffPct');
  assert.equal(smallSample.length, 0);
});

test('shooting and save percentages handle zero denominators without NaN', () => {
  const snap = D.snapshot([], new Map(), null);
  assert.equal(snap.shootingPct, null);
  const goalie = D.goalieTotals(roster, [])[0];
  assert.equal(goalie.savePct, null);
  assert.equal(goalie.shotsAgainst, 0);
});

test('goalie snapshot derives SA from saves plus GA and tracks W/L/T/SO', () => {
  const goalies = D.goalieTotals(roster, playerStats);
  assert.equal(goalies.length, 1);
  const sam = goalies[0];
  assert.equal(sam.gp, 6);
  assert.equal(sam.saves, 15 + 16 + 17 + 18 + 19 + 20);
  assert.equal(sam.ga, 0 + 1 + 2 + 0 + 1 + 2);
  assert.equal(sam.shotsAgainst, sam.saves + sam.ga);
  assert.equal(sam.w, 3);
  assert.equal(sam.l, 3);
  assert.equal(sam.so, 1);
});

test('trend compares last 3 to previous 3 and hides arrows on small samples', () => {
  const rows = D.playerTotals(roster, playerStats);
  const order = new Map(games.map((game, index) => [game.source_game_id, index]));
  const jane = rows.find(row => row.player.source_player_id === 'p7');
  assert.equal(D.trendFor(jane.byGame, order), 'improving');
  const bryson = rows.find(row => row.player.source_player_id === 'p22');
  assert.equal(D.trendFor(bryson.byGame, order), 'declining');
  assert.equal(D.trendFor(jane.byGame.slice(0, 4), order), null);
});

test('recent form sequences points over the last 5 games in game order', () => {
  const rows = D.playerTotals(roster, playerStats);
  const forms = D.recentForm(rows, games);
  const jane = forms.find(entry => entry.player.source_player_id === 'p7');
  assert.deepEqual(Array.from(jane.form), [1, 1, 3, 3, 3]);
});

test('team trend series respects last 5 / last 10 / season windows and skips unsupported metrics', () => {
  const season = D.teamTrendSeries(games, byGame, 'goalsFor', 'season');
  assert.equal(season.points.length, 6);
  const last5 = D.teamTrendSeries(games, byGame, 'goalsFor', '5');
  assert.equal(last5.points.length, 5);
  assert.deepEqual(last5.points.map(point => point.value), [2, 5, 1, 4, 6]);
  const pct = D.teamTrendSeries(games, byGame, 'shootingPct', 'season');
  assert.ok(pct.points.every(point => point.value !== null));
  const pim = D.teamTrendSeries(games, byGame, 'pim', 'season');
  assert.ok(pim.points.every(point => point.value === null && point.unsupported));
});

test('recent performance compares against the team season average, not a league benchmark', () => {
  const comparison = D.compareToAverage(games, byGame);
  assert.ok(Math.abs(comparison.season - 21 / 6) < 1e-9);
  assert.ok(Math.abs(comparison.recent - 18 / 5) < 1e-9);
  assert.equal(comparison.direction, 'up');
  assert.equal(D.compareToAverage([], new Map()), null);
});

test('dashboard state reports empty kinds for new teams without fabricating metrics', () => {
  assert.equal(D.dashboardState({ roster: [], schedule: [], games: [], playerStats: [], teamStats: [] }).emptyKind, 'no_roster');
  assert.equal(D.dashboardState({ roster, schedule: [], games: [], playerStats: [], teamStats: [] }).emptyKind, 'no_games');
  assert.equal(D.dashboardState({ roster, schedule: [{ date: '2026-09-20' }], games: [], playerStats: [], teamStats: [] }).emptyKind, 'no_stats');
  assert.equal(D.dashboardState({ roster, schedule: [], games, playerStats, teamStats }).emptyKind, null);
});

test('dashboard consumes only the phase1 datasets and no new privileged reads', () => {
  assert.doesNotMatch(dashboardSource, /rpc\(|\.insert\(|\.update\(|\.delete\(|service_role/i);
  assert.match(appSource, /window\.FoxesDashboard/);
  assert.match(appSource, /D\.snapshot\(/);
  assert.match(appSource, /D\.leaders\(/);
  assert.match(appSource, /D\.goalieTotals\(/);
  assert.match(appSource, /D\.teamTrendSeries\(/);
  assert.match(appSource, /data-leader-cat/);
  assert.match(appSource, /data-trend-window/);
  assert.match(indexSource, /dashboard\.js\?v=stage7-dashboard-1/);
  assert.ok(indexSource.indexOf('dashboard.js') < indexSource.indexOf('app.js'));
});

test('quick actions are capability-gated and empty states guide the coach', () => {
  assert.match(appSource, /canEditSchedule \? \['schedule', 'Add Game'\] : null/);
  assert.match(appSource, /canEditStats \? \['games', 'Enter Stats'\] : null/);
  assert.match(appSource, /canEditRoster \? \['players', 'Manage Roster'\] : null/);
  assert.match(appSource, /Add your roster to begin tracking players/);
  assert.match(appSource, /Add your first game to start building team trends/);
  assert.match(appSource, /no stats have been entered yet/);
});

test('season record reads are scoped to the selected season', () => {
  assert.match(appSource, /\.eq\('team_id', teamId\)\.eq\('season_key', seasonKey\)/);
});

test('dashboard help bubbles and mobile layouts follow the Stage 6 system', () => {
  assert.match(appSource, /helpBubble\(/);
  assert.match(appSource, /Completed, scored games only/);
  assert.match(stylesSource, /\.leader-tab\.active/);
  assert.match(stylesSource, /\.goalie-row/);
  assert.match(stylesSource, /@media\(max-width:700px\)[\s\S]{0,300}\.leader-tabs\{overflow-x:auto/);
  assert.match(stylesSource, /\.sparkline\{width:100%[^}]*\}/);
});
