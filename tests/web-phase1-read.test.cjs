const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync('web/app.js', 'utf8');
const index = fs.readFileSync('web/index.html', 'utf8');
const styles = fs.readFileSync('web/styles.css', 'utf8');

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

test('Stage 1 dashboard and team overview render canonical season record fields', () => {
  const context = {
    PLATFORM: { name: 'PuckNexus' },
    currentWorkspace: {
      branding: { display_name: 'Arctic Foxes' },
      team_name: '12U AA',
      season_name: '2026-27'
    },
    authTeam: { team_name: '12U AA' },
    activeStaff: { role: 'Head Coach' },
    seasonContext: { branding: { display_name: 'Arctic Foxes' }, selectedSeason: { name: '2026-27' } },
    phase1Data: {
      roster: [{ position: 'F' }, { position: 'G', is_goalie: true }],
      schedule: [{ opponent: 'Falcons', date: '2026-10-01', time: '7:00 PM' }],
      seasonRecord: {
        games_played: 18,
        wins: 11,
        losses: 5,
        ties: 2,
        goals_for: 64,
        goals_against: 41,
        gp: 999,
        w: 999,
        l: 999,
        t: 999,
        gf: 999,
        ga: 999
      }
    }
  };
  const source = `
    const PLATFORM = ${JSON.stringify(context.PLATFORM)};
    let currentWorkspace = ${JSON.stringify(context.currentWorkspace)};
    let authTeam = ${JSON.stringify(context.authTeam)};
    let activeStaff = ${JSON.stringify(context.activeStaff)};
    let phase1Data = ${JSON.stringify(context.phase1Data)};
    const seasonContext = ${JSON.stringify(context.seasonContext)};
    ${extractFunction(app, 'cardTitle')}
    ${extractFunction(app, 'tenantName')}
    ${extractFunction(app, 'tenantSeasonName')}
    ${extractFunction(app, 'shell')}
    ${extractFunction(app, 'phase1Record')}
    ${extractFunction(app, 'escapeHtml')}
    ${extractFunction(app, 'command')}
    ${extractFunction(app, 'team')}
    this.renderedCommand = command();
    this.renderedTeam = team();
  `;
  const rendered = {};
  vm.runInNewContext(source, rendered);

  assert.match(rendered.renderedCommand, />18<\/strong>/);
  assert.match(rendered.renderedCommand, /11-5-2 Record/);
  assert.match(rendered.renderedCommand, />64<\/strong>/);
  assert.match(rendered.renderedCommand, />41<\/strong>/);
  assert.match(rendered.renderedTeam, />11-5-2<\/strong>/);
  assert.match(rendered.renderedTeam, /18 GP/);
  assert.doesNotMatch(rendered.renderedCommand, />999<\/strong>/);
  assert.doesNotMatch(rendered.renderedTeam, /999-999-999/);
});

test('Stage 1 dashboard metric classes have stylesheet coverage', () => {
  for (const className of ['metrics-grid', 'metric-card', 'metric-label', 'metric-value', 'metric-meta']) {
    assert.match(styles, new RegExp(`\\.${className}\\b`));
  }
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
  assert.match(app, /FoxesTeamContext\.createTeamContext/);
  assert.match(fs.readFileSync('web/team-context.js', 'utf8'), /team_memberships/);
  assert.match(fs.readFileSync('web/team-context.js', 'utf8'), /sessionStorage/);
  assert.match(app, /function selectTeam\(teamId\)/);
  assert.match(index, /id="teamSwitcher"/);
});

test('season context is team-scoped and branding remains structured', () => {
  const season = fs.readFileSync('web/season-context.js', 'utf8');
  assert.match(app, /FoxesSeasonContext\.createSeasonContext/);
  assert.match(season, /from\('seasons'\)/);
  assert.match(season, /\.eq\('team_id', teamId\)/);
  assert.match(season, /from\('team_branding'\)/);
  assert.match(index, /id="seasonSwitcher"/);
});

test('Phase 2A web integration remains read-only', () => {
  assert.doesNotMatch(app, /phase2_opponent_profiles[\s\S]{0,300}\.(insert|update|upsert|delete)\(/);
  assert.doesNotMatch(app, /phase2_opponent_players[\s\S]{0,300}\.(insert|update|upsert|delete)\(/);
});
