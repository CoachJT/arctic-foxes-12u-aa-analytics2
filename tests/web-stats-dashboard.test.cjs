const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync('web/app.js', 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name} to exist`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];
    if (character === '{') depth += 1;
    if (character === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract function ${name}`);
}

const EMPTY_RECORD = { games_played: 0, wins: 0, losses: 0, ties: 0, goals_for: 0, goals_against: 0 };

function renderStats(phase1Data, now = '2026-09-08T12:00:00', sort = {}) {
  const source = `
    const PLATFORM = { name: 'PuckNexus' };
    let currentWorkspace = { branding: { display_name: 'Arctic Foxes' }, team_name: '12U AA', season_name: '2026-27' };
    let authTeam = { team_name: '12U AA' };
    let activeStaff = { role: 'Head Coach' };
    let phase1Data = ${JSON.stringify({ roster: [], games: [], playerStats: [], teamStats: [], seasonRecord: EMPTY_RECORD, ...phase1Data })};
    const seasonContext = { branding: { display_name: 'Arctic Foxes' }, selectedSeason: { name: '2026-27' } };
    let statsSortKey = ${JSON.stringify(sort.key || 'pts')};
    let statsSortDir = ${JSON.stringify(sort.dir || 'desc')};
    ${extractFunction(app, 'tenantName')}
    ${extractFunction(app, 'tenantSeasonName')}
    ${extractFunction(app, 'shell')}
    ${extractFunction(app, 'phase1DateKey')}
    ${extractFunction(app, 'phase1Record')}
    ${extractFunction(app, 'isGoalie')}
    ${extractFunction(app, 'activeRosterPlayers')}
    ${extractFunction(app, 'escapeHtml')}
    ${extractFunction(app, 'statsNumber')}
    ${extractFunction(app, 'statsValue')}
    ${extractFunction(app, 'statsAccumulate')}
    ${extractFunction(app, 'statsPercent')}
    ${extractFunction(app, 'statsFormat')}
    ${extractFunction(app, 'statsCompare')}
    ${extractFunction(app, 'statsDescendingCompare')}
    ${extractFunction(app, 'statsRankedRows')}
    ${extractFunction(app, 'statsRows')}
    ${extractFunction(app, 'goalieRows')}
    ${extractFunction(app, 'stats')}
    this.rows = statsRows();
    this.goalies = goalieRows();
    this.renderedStats = stats();
  `;
  const rendered = { Date: class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return new Date(now).getTime(); } } };
  vm.runInNewContext(source, rendered);
  return rendered;
}

function skaterTableSection(renderedStats) {
  const match = renderedStats.match(/<section class="card skater-table-shell">([\s\S]*?)<\/section>/);
  assert.ok(match, 'expected skater table section');
  return match[1];
}

function skaterTableNames(renderedStats) {
  return [...skaterTableSection(renderedStats).matchAll(/<tr><td class="team-number">#[^<]*<\/td><td><div class="player-cell"><span class="player-photo">[^<]*<\/span><strong>([^<]+)<\/strong>/g)].map(match => match[1]);
}

function skaterTableJerseys(renderedStats) {
  return [...skaterTableSection(renderedStats).matchAll(/<tr><td class="team-number">#([^<]*)<\/td><td><div class="player-cell">/g)].map(match => match[1]);
}

test('Stats Dashboard preserves tracked zeroes and keeps unavailable categories out of leaderboards', () => {
  const rendered = renderStats({
    roster: [
      { source_player_id: 's1', jersey_number: '9', name: 'Zero Goal Zoe', position: 'F', status: 'active' },
      { source_player_id: 's2', jersey_number: '4', name: 'Assist Ace', position: 'F', status: 'active' }
    ],
    playerStats: [
      { source_player_id: 's1', gp: 2, goals: 0, assists: 2 },
      { source_player_id: 's2', gp: 2, goals: 1, assists: 0 }
    ]
  });

  assert.equal(rendered.rows.find(row => row.name === 'Zero Goal Zoe').g, 0);
  assert.equal(rendered.rows.find(row => row.name === 'Zero Goal Zoe').pts, 2);
  assert.equal(rendered.rows.find(row => row.name === 'Zero Goal Zoe').sog, null);
  assert.match(rendered.renderedStats, /<h2>Shots<\/h2><span class="tag">Unavailable<\/span>[\s\S]*?<li class="leaderboard-empty">Unavailable — not tracked<\/li>/);
  assert.doesNotMatch(rendered.renderedStats, /NaN|Infinity/);
});

test('Stats Dashboard aggregates goalie season rows and season save percentage from totals', () => {
  const rendered = renderStats({
    roster: [
      { source_player_id: 'g1', jersey_number: '31', name: 'Hudson Bouchard', position: 'G', status: 'active', player_type: 'goalie' }
    ],
    playerStats: [
      { source_player_id: 'g1', player_type: 'goalie', gp: 1, wins: 1, saves: 10, goals_against: 1, shots_against: 11, minutes: 20 },
      { source_player_id: 'g1', player_type: 'goalie', gp: 1, losses: 1, saves: 15, goals_against: 2, shots_against: 17, minutes: 28 }
    ]
  });

  assert.equal(rendered.goalies.length, 1);
  assert.equal(rendered.goalies[0].gp, 2);
  assert.equal(rendered.goalies[0].wins, 1);
  assert.equal(rendered.goalies[0].losses, 1);
  assert.equal(rendered.goalies[0].saves, 25);
  assert.equal(rendered.goalies[0].goalsAgainst, 3);
  assert.equal(rendered.goalies[0].shotsAgainst, 28);
  assert.equal(rendered.goalies[0].savePct, 25 / 28);
  assert.equal(rendered.goalies[0].gaa, 3 / (48 / 60));
  assert.match(rendered.renderedStats, /Hudson Bouchard[\s\S]*?<td>2<\/td><td>1<\/td><td>1<\/td><td>0<\/td><td>28<\/td><td>25<\/td><td>3<\/td><td>89\.3%<\/td><td>3\.8<\/td>/);
  assert.doesNotMatch(rendered.renderedStats, /NaN|Infinity/);
});

test('Stats Dashboard active players metric includes active goalies and excludes inactive roster rows', () => {
  const rendered = renderStats({
    roster: [
      { source_player_id: 's1', jersey_number: '9', name: 'Active Skater', position: 'F', status: 'active' },
      { source_player_id: 'g1', jersey_number: '31', name: 'Active Goalie', position: 'G', status: 'active', player_type: 'goalie' },
      { source_player_id: 's2', jersey_number: '4', name: 'Inactive Skater', position: 'D', status: 'inactive' },
      { source_player_id: 's3', jersey_number: '7', name: 'Legacy Skater', position: 'F' }
    ]
  });

  assert.match(rendered.renderedStats, /Active Players<\/div><strong>3<\/strong><span>Synced season data<\/span>/);
});

test('Stats Dashboard team trends use only completed canonical games and preserve chronological order', () => {
  const rendered = renderStats({
    games: [
      { source_game_id: 'g1', date: '2026-09-01', opponent: 'Older' },
      { source_game_id: 'g2', date: '2026-09-03', opponent: 'Newer' },
      { source_game_id: 'g3', date: '2026-09-20', opponent: 'Future' }
    ],
    teamStats: [
      { source_game_id: 'g3', goals_for: 7, goals_against: 0 },
      { source_game_id: 'g2', goals_for: 4, goals_against: 2 },
      { source_game_id: 'orphan', goals_for: 9, goals_against: 1 },
      { source_game_id: 'g1', goals_for: 2, goals_against: 3 }
    ]
  });

  const trendSection = rendered.renderedStats.match(/<h2>Team Trends<\/h2><\/section><section class="card trend-shell">([\s\S]*?)<\/section><\/div>$/);
  assert.ok(trendSection, 'expected Team Trends section');
  assert.ok(trendSection[1].indexOf('09-01') < trendSection[1].indexOf('09-03'));
  assert.equal((trendSection[1].match(/09-01/g) || []).length, 2);
  assert.equal((trendSection[1].match(/09-03/g) || []).length, 2);
  assert.equal((trendSection[1].match(/09-20/g) || []).length, 0);
});

test('Stats Dashboard season leaders indicate ties instead of implying a sole leader', () => {
  const rendered = renderStats({
    roster: [
      { source_player_id: 's1', jersey_number: '9', name: 'Playmaker Pat', position: 'F', status: 'active' },
      { source_player_id: 's2', jersey_number: '4', name: 'Sniper Sam', position: 'D', status: 'active' }
    ],
    playerStats: [
      { source_player_id: 's1', gp: 2, goals: 1, assists: 2 },
      { source_player_id: 's2', gp: 2, goals: 2, assists: 1 }
    ]
  });

  const pointsLeader = rendered.renderedStats.match(/POINTS LEADER[\s\S]*?<\/article>/);
  assert.ok(pointsLeader, 'expected points leader card');
  assert.match(pointsLeader[0], /Playmaker Pat/);
  assert.match(pointsLeader[0], /Sniper Sam/);
  assert.match(pointsLeader[0], /Tied leader/);
  assert.doesNotMatch(rendered.renderedStats, /NaN|Infinity/);
});

test('Stats Dashboard skater table sorts names, jerseys, and numeric stats in the displayed direction', () => {
  const phase1Data = {
    roster: [
      { source_player_id: 's1', jersey_number: '12', name: 'Bravo Ben', position: 'F', status: 'active' },
      { source_player_id: 's2', jersey_number: '3', name: 'Alpha Amy', position: 'D', status: 'active' },
      { source_player_id: 's3', jersey_number: '27', name: 'Charlie Cam', position: 'F', status: 'active' }
    ],
    playerStats: [
      { source_player_id: 's1', gp: 1, goals: 2, assists: 0 },
      { source_player_id: 's2', gp: 1, goals: 5, assists: 0 },
      { source_player_id: 's3', gp: 1, goals: 1, assists: 0 }
    ]
  };

  const nameAsc = renderStats(phase1Data, '2026-09-08T12:00:00', { key: 'name', dir: 'asc' });
  const nameDesc = renderStats(phase1Data, '2026-09-08T12:00:00', { key: 'name', dir: 'desc' });
  const jerseyAsc = renderStats(phase1Data, '2026-09-08T12:00:00', { key: 'jersey_number', dir: 'asc' });
  const jerseyDesc = renderStats(phase1Data, '2026-09-08T12:00:00', { key: 'jersey_number', dir: 'desc' });
  const goalsAsc = renderStats(phase1Data, '2026-09-08T12:00:00', { key: 'g', dir: 'asc' });
  const goalsDesc = renderStats(phase1Data, '2026-09-08T12:00:00', { key: 'g', dir: 'desc' });

  assert.deepEqual(skaterTableNames(nameAsc.renderedStats), ['Alpha Amy', 'Bravo Ben', 'Charlie Cam']);
  assert.deepEqual(skaterTableNames(nameDesc.renderedStats), ['Charlie Cam', 'Bravo Ben', 'Alpha Amy']);
  assert.deepEqual(skaterTableJerseys(jerseyAsc.renderedStats), ['3', '12', '27']);
  assert.deepEqual(skaterTableJerseys(jerseyDesc.renderedStats), ['27', '12', '3']);
  assert.deepEqual(skaterTableNames(goalsAsc.renderedStats), ['Charlie Cam', 'Bravo Ben', 'Alpha Amy']);
  assert.deepEqual(skaterTableNames(goalsDesc.renderedStats), ['Alpha Amy', 'Bravo Ben', 'Charlie Cam']);
});
