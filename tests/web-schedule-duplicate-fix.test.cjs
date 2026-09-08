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

// Renders the real gameCenter() from web/app.js against a fabricated
// phase1Data payload, so the schedule/completed dedup logic is exercised
// exactly as shipped rather than re-implemented in the test.
function renderGameCenter(phase1Data) {
  const context = { PLATFORM: { name: 'PuckNexus' }, currentWorkspace: { authorized: true }, phase1Data };
  const source = `
    const PLATFORM = ${JSON.stringify(context.PLATFORM)};
    let currentWorkspace = ${JSON.stringify(context.currentWorkspace)};
    let phase1Data = ${JSON.stringify(context.phase1Data)};
    let statsEntryGameId = null;
    function canEnterGameStats() { return false; }
    function tenantName() { return 'Arctic Foxes 12U AA'; }
    ${extractFunction(app, 'escapeHtml')}
    ${extractFunction(app, 'shell')}
    ${extractFunction(app, 'phase1Number')}
    ${extractFunction(app, 'phase1Date')}
    ${extractFunction(app, 'phase1DateKey')}
    ${extractFunction(app, 'phase1ScheduleSort')}
    ${extractFunction(app, 'statsEntryGames')}
    ${extractFunction(app, 'scheduleGameKey')}
    ${extractFunction(app, 'scheduleMatchesCompletedGame')}
    ${extractFunction(app, 'gameCenter')}
    this.rendered = gameCenter();
  `;
  const sandbox = {};
  vm.runInNewContext(source, sandbox);
  return sandbox.rendered;
}

test('gameCenter exists and dedups scheduled entries via a shared id-first matcher', () => {
  assert.match(app, /function scheduleMatchesCompletedGame\(item, game\)/);
  assert.match(app, /const scheduled = \(phase1Data\?\.schedule \|\| \[\]\)\.filter\(item => !games\.some\(game => scheduleMatchesCompletedGame\(item, game\)\)\);/);
});

test('a completed game with a correctly linked schedule row renders exactly once', () => {
  const phase1Data = {
    games: [{ source_game_id: 'game-1', date: '2026-08-23', opponent: 'South Pittsburgh Rebellion BY 2' }],
    teamStats: [], playerStats: [],
    schedule: [{ source_schedule_id: 'sched-1', date: '2026-08-23', opponent: 'South Pittsburgh Rebellion BY 2', home_away: 'Home', location: 'Home Rink', linked_game_source_id: 'game-1' }]
  };
  const html = renderGameCenter(phase1Data);
  assert.match(html, /South Pittsburgh Rebellion BY 2/);
  assert.equal((html.match(/South Pittsburgh Rebellion BY 2/g) || []).length, 1, 'the opponent name must appear exactly once (one card, not a Completed card plus a Scheduled card)');
  assert.doesNotMatch(html, /<span class="tag">Scheduled<\/span>/);
});

test('a completed game whose schedule row is missing linked_game_source_id still collapses to one card (real production gap)', () => {
  // This mirrors the actual production data found for PHA Icemen 2014's and
  // Beaver Badgers 2015's: team_games has a completed row, but the matching
  // team_schedule_games row never had linked_game_source_id backfilled.
  const phase1Data = {
    games: [{ source_game_id: 'game-2', date: '2026-08-15', opponent: "PHA Icemen 2014's" }],
    teamStats: [], playerStats: [],
    schedule: [{ source_schedule_id: 'sched-2', date: '2026-08-15', opponent: "PHA Icemen 2014's", home_away: 'Home', location: 'Home Rink', linked_game_source_id: null }]
  };
  const html = renderGameCenter(phase1Data);
  assert.equal((html.match(/PHA Icemen 2014&#39;s/g) || []).length, 1, 'unlinked-but-matching schedule rows must not duplicate the completed card');
  assert.doesNotMatch(html, /<span class="tag">Scheduled<\/span>/);
});

test('a genuinely future scheduled game with no completed counterpart still renders as Scheduled', () => {
  const phase1Data = {
    games: [],
    teamStats: [], playerStats: [],
    schedule: [{ source_schedule_id: 'sched-3', date: '2026-08-29', opponent: 'Gilmour Academy Game 1', home_away: 'Away', location: 'Gilmour Rink', linked_game_source_id: null }]
  };
  const html = renderGameCenter(phase1Data);
  assert.match(html, /Gilmour Academy Game 1/);
  assert.match(html, /<span class="tag">Scheduled<\/span>/);
});

test('same-day different-opponent schedule rows are never conflated by the date/opponent fallback', () => {
  const phase1Data = {
    games: [{ source_game_id: 'game-3', date: '2026-08-29', opponent: 'Gilmour Academy Game 1' }],
    teamStats: [], playerStats: [],
    schedule: [
      { source_schedule_id: 'sched-4', date: '2026-08-29', opponent: 'Gilmour Academy Game 1', home_away: 'Away', location: 'Gilmour Rink', linked_game_source_id: null },
      { source_schedule_id: 'sched-5', date: '2026-08-29', opponent: 'Gilmour Academy Game 2', home_away: 'Away', location: 'Gilmour Rink', linked_game_source_id: null }
    ]
  };
  const html = renderGameCenter(phase1Data);
  assert.equal((html.match(/Gilmour Academy Game 1/g) || []).length, 1);
  assert.equal((html.match(/Gilmour Academy Game 2/g) || []).length, 1);
  assert.match(html, /<span class="tag">Scheduled<\/span>\s*<\/div><\/article>/);
});
