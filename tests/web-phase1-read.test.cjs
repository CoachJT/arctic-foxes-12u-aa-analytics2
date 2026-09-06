const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('web/app.js', 'utf8');
const index = fs.readFileSync('web/index.html', 'utf8');

test('web Phase 1 dashboard reads the synced team datasets', () => {
  for (const table of [
    'team_roster_players',
    'team_schedule_games',
    'team_games',
    'team_game_player_stats',
    'team_game_team_stats',
    'team_season_records'
  ]) {
    assert.match(app, new RegExp(`'${table}'`));
  }
  assert.match(app, /supabaseClient\.from\(table\)/);
  assert.match(app, /async function loadPhase1Data/);
  assert.match(app, /source_player_id/);
  assert.match(app, /source_game_id/);
  assert.match(app, /seasonRecord/);
});

test('web Phase 1 dashboard does not write to Supabase', () => {
  assert.doesNotMatch(app, /\.insert\(/);
  assert.doesNotMatch(app, /\.update\(/);
  assert.doesNotMatch(app, /\.upsert\(/);
  assert.doesNotMatch(app, /\.delete\(/);
});

test('authenticated Phase 1 surfaces no longer contain prototype dashboard values', () => {
  assert.doesNotMatch(app, /Mia Chen|Sofia Park|Riverside Ravens|10–3–1|Sample roster view|Prototype view/);
  assert.match(index, /id="seasonPill"/);
});
