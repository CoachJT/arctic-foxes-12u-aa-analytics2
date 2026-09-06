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

test('Phase 2A Scouting reads only the verified opponent tables and scopes both queries by team', () => {
  assert.match(app, /phase2_opponent_profiles/);
  assert.match(app, /phase2_opponent_players/);
  assert.match(app, /select\('source_profile_key,opponent_name'\)\.eq\('team_id', teamId\)/);
  assert.match(app, /select\('source_player_key,source_game_id,opponent_profile_key,jersey_number,player_name,position,source_kind'\)\.eq\('team_id', teamId\)/);
  assert.match(app, /position \|\| 'Unknown'/);
  assert.doesNotMatch(app, /phase2_scouting_reports/);
  assert.doesNotMatch(app, /phase2_player_evaluations/);
});

test('authenticated workspace exposes a reusable membership-backed team context', () => {
  assert.match(app, /let teamContext = \{ memberships: \[\], selectedTeamId: '', selectedMembership: null \}/);
  assert.match(app, /team_memberships'\)\.select\('team_id,role_id,status,teams\(id,name,slug\),roles\(label\)'\)/);
  assert.match(app, /sessionStorage\.getItem\('foxes-selected-team-id'\)/);
  assert.match(app, /function selectTeam\(teamId\)/);
  assert.match(index, /id="teamSwitcher"/);
});

test('Phase 2A web integration remains read-only', () => {
  assert.doesNotMatch(app, /phase2_opponent_profiles[\s\S]{0,300}\.(insert|update|upsert|delete)\(/);
  assert.doesNotMatch(app, /phase2_opponent_players[\s\S]{0,300}\.(insert|update|upsert|delete)\(/);
});
