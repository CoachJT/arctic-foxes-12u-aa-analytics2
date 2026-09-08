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

function extractConst(source, name) {
  const start = source.indexOf(`const ${name} = `);
  assert.notEqual(start, -1, `Expected const ${name} to exist`);
  const bodyStart = source.indexOf('[', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];
    if (character === '[') depth += 1;
    if (character === ']') depth -= 1;
    if (depth === 0) return source.slice(start, index + 2);
  }
  throw new Error(`Could not extract const ${name}`);
}

function createFixedDate(isoValue) {
  const RealDate = Date;
  return class FixedDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [isoValue]));
    }

    static now() {
      return new RealDate(isoValue).getTime();
    }

    static parse(value) {
      return RealDate.parse(value);
    }

    static UTC(...args) {
      return RealDate.UTC(...args);
    }
  };
}

function renderShellHarness(phase1Data, now = '2026-09-08T12:00:00') {
  const source = `
    const PLATFORM = { name: 'PuckNexus' };
    const PERMISSIONS = { PLAYERS_EVALUATE: 'players.evaluate' };
    let currentWorkspace = { authorized: true, branding: { display_name: 'Arctic Foxes' }, team_name: '12U AA', season_name: '2026-27', plan_id: 'FOUNDING' };
    let authTeam = { team_name: '12U AA' };
    let activeStaff = { role: 'Head Coach', capabilities: ['players.evaluate'] };
    let phase1Data = ${JSON.stringify(phase1Data)};
    const seasonContext = { branding: { display_name: 'Arctic Foxes' }, selectedSeason: { name: '2026-27' } };
    const entitlements = { isFeatureEnabled: () => true };
    const can = () => true;
    let rosterFilter = 'active';
    let rosterSearch = '';
    ${extractFunction(app, 'cardTitle')}
    ${extractFunction(app, 'tenantName')}
    ${extractFunction(app, 'tenantSeasonName')}
    ${extractFunction(app, 'shell')}
    ${extractFunction(app, 'phase1Number')}
    ${extractFunction(app, 'phase1Date')}
    ${extractFunction(app, 'phase1Record')}
    ${extractFunction(app, 'phase1DateKey')}
    ${extractFunction(app, 'phase1TimeValue')}
    ${extractFunction(app, 'phase1ScheduleSort')}
    ${extractFunction(app, 'phase1NextScheduledGame')}
    ${extractFunction(app, 'phase1LatestCompletedGame')}
    ${extractFunction(app, 'playerStatTotals')}
    ${extractFunction(app, 'rosterDisplayName')}
    ${extractFunction(app, 'isGoalie')}
    ${extractFunction(app, 'activeRosterPlayers')}
    ${extractFunction(app, 'leaders')}
    ${extractFunction(app, 'recent')}
    ${extractFunction(app, 'escapeHtml')}
    ${extractFunction(app, 'rosterCanManage')}
    function playerForm() { return '<form id="playerForm"></form>'; }
    ${extractFunction(app, 'command')}
    ${extractFunction(app, 'players')}
    this.renderedCommand = command();
    this.renderedPlayers = players();
  `;
  const rendered = { Date: createFixedDate(now) };
  vm.runInNewContext(source, rendered);
  return rendered;
}

const STAGE_1_1_VIEWS = ['command', 'team', 'schedule', 'games', 'players', 'stats', 'film', 'scouting', 'reports', 'development', 'coaching', 'management', 'support', 'settings'];

test('sidebar exposes all Stage 1 module buttons with section grouping', () => {
  for (const view of STAGE_1_1_VIEWS) {
    assert.match(index, new RegExp(`data-view="${view}"`), `Expected nav button for ${view}`);
  }
  for (const section of ['overview', 'analytics', 'coaching', 'system']) {
    assert.match(index, new RegExp(`class="nav-label" data-section="${section}"`));
  }
});

test('navigation model hides unauthorized items and empty section headers', () => {
  const source = `
    ${extractConst(app, 'NAV_SECTIONS')}
    ${extractFunction(app, 'navigationModel')}
    this.allAuthorized = navigationModel(() => true);
    this.coachLimited = navigationModel(view => ['command', 'schedule'].includes(view));
    this.noneAuthorized = navigationModel(() => false);
  `;
  const context = {};
  vm.runInNewContext(source, context);

  assert.equal(context.allAuthorized.every(section => section.visible), true);
  assert.equal(context.allAuthorized.flatMap(section => section.items).length, 15);

  const overview = context.coachLimited.find(section => section.id === 'overview');
  assert.equal(overview.visible, true);
  assert.deepEqual(Array.from(overview.items.filter(item => item.allowed).map(item => item.view)), ['command', 'schedule']);
  assert.equal(context.coachLimited.find(section => section.id === 'analytics').visible, false);
  assert.equal(context.coachLimited.find(section => section.id === 'coaching').visible, false);
  assert.equal(context.coachLimited.find(section => section.id === 'system').visible, false);

  assert.equal(context.noneAuthorized.every(section => !section.visible), true);
});

test('render applies the navigation model and hides labels for sections without authorized items', () => {
  assert.match(app, /function syncNavigation\(view\)/);
  assert.match(app, /syncNavigation\(view\)/);
  assert.match(app, /nav-label\[data-section/);
  assert.match(app, /label\.hidden = !section\.visible/);
  assert.doesNotMatch(app, /item\.hidden = !allowed; item\.classList/);
});

test('unprovisioned workspace plans surface an honest notice instead of a broken shell', () => {
  assert.match(app, /active plan entitlement yet/);
  assert.match(app, /currentWorkspace\?\.authorized && !currentWorkspace\?\.plan_id/);
});

test('dashboard roster count uses active roster status while Players view keeps full roster visibility', () => {
  const roster = [
    { id: 'p1', source_player_id: 's1', jersey_number: '9', name: 'Ava Skater', position: 'F', player_type: 'skater', status: 'active' },
    { id: 'p2', source_player_id: 's2', jersey_number: '31', name: 'Gabe Goalie', position: 'G', player_type: 'goalie', status: 'active' },
    { id: 'p3', source_player_id: 's3', jersey_number: '4', name: 'Drew Defender', position: 'D', player_type: 'skater', status: 'inactive' }
  ];
  const rendered = renderShellHarness({
    roster,
    schedule: [],
    games: [],
    playerStats: [],
    teamStats: [],
    seasonRecord: { games_played: 3, wins: 2, losses: 1, ties: 0, goals_for: 9, goals_against: 7 }
  });

  assert.match(rendered.renderedCommand, /Roster Size<\/span>\s*<strong class="metric-value">2<\/strong>/);
  assert.match(rendered.renderedCommand, /1 Goalie<\/span>/);
  assert.match(rendered.renderedPlayers, /3 players<\/div>/);
  assert.match(rendered.renderedPlayers, /Ava Skater/);
  assert.match(rendered.renderedPlayers, /Gabe Goalie/);
});

test('dashboard roster count preserves legacy rows that do not include status', () => {
  const rendered = renderShellHarness({
    roster: [
      { id: 'p1', source_player_id: 's1', jersey_number: '9', name: 'Ava Skater', position: 'F', player_type: 'skater', status: 'active' },
      { id: 'p2', source_player_id: 's2', jersey_number: '31', name: 'Gabe Goalie', position: 'G', player_type: 'goalie' },
      { id: 'p3', source_player_id: 's3', jersey_number: '4', name: 'Drew Defender', position: 'D', player_type: 'skater', status: 'inactive' }
    ],
    schedule: [],
    games: [],
    playerStats: [],
    teamStats: [],
    seasonRecord: { games_played: 3, wins: 2, losses: 1, ties: 0, goals_for: 9, goals_against: 7 }
  });

  assert.match(rendered.renderedCommand, /Roster Size<\/span>\s*<strong class="metric-value">2<\/strong>/);
  assert.match(rendered.renderedCommand, /1 Goalie<\/span>/);
});

test('dashboard and roster views derive from phase1Data roster reads scoped by team', () => {
  assert.match(app, /read\('roster', 'team_roster_players'/);
  assert.match(app, /phase1Data = \{ roster: loaded\.roster \|\| \[\]/);
  assert.match(app, /const roster = phase1Data\?\.roster \|\| \[\]/);
  assert.match(app, /const allPlayers = phase1Data\?\.roster \|\| \[\]/);
});

test('context switching clears tenant-scoped roster before reloading', () => {
  const source = `
    let phase1Data = { roster: [{ id: 'leaked-player' }] };
    let phase1DataError = 'stale';
    let phase2AData = { profiles: [{}] };
    let phase2ADataError = 'stale';
    let authTeam = { team_id: 'previous-team' };
    let authCapabilities = ['players.view'];
    let currentWorkspace = { team_id: 'previous-team' };
    const calls = [];
    const entitlements = { clear: () => calls.push('entitlements.clear') };
    const workspaceAccessManager = { clearWorkspace: () => calls.push('workspace.clear') };
    const rosterManager = { clearWorkspace: () => calls.push('roster.clear') };
    const teamContextManager = { clearSelection: () => calls.push('team.clear') };
    const seasonContextManager = { clear: () => calls.push('season.clear') };
    const hiddenHosts = [];
    const document = { querySelector: selector => { hiddenHosts.push(selector); return null; } };
    const app = null;
    ${extractFunction(app, 'clearTenantState')}
    clearTenantState();
    this.state = { phase1Data, phase1DataError, phase2AData, phase2ADataError, authTeam, authCapabilities, currentWorkspace, calls, hiddenHosts };
  `;
  const context = {};
  vm.runInNewContext(source, context);

  assert.equal(context.state.phase1Data, null);
  assert.equal(context.state.phase1DataError, '');
  assert.equal(context.state.phase2AData, null);
  assert.equal(context.state.authTeam, null);
  assert.deepEqual(Array.from(context.state.authCapabilities), []);
  assert.equal(context.state.currentWorkspace, null);
  assert.deepEqual(Array.from(context.state.calls), ['entitlements.clear', 'workspace.clear', 'roster.clear', 'team.clear', 'season.clear']);
  assert.deepEqual(Array.from(context.state.hiddenHosts), ['#organizationSwitcher', '#teamSwitcher', '#seasonSwitcher']);
});

test('context selectors render premium labeled select shells with dropdown affordance', () => {
  const source = `
    ${extractFunction(app, 'escapeHtml')}
    ${extractFunction(app, 'switcherMarkup')}
    this.single = switcherMarkup('team-switcher', 'Team', null, '', [], '', 'Arctic Foxes 12U AA');
    this.multi = switcherMarkup('organization-switcher', 'Organization', 'organizationSelect', 'Selected organization', [
      { value: 'org-a', label: 'Arctic Foxes' },
      { value: 'org-b', label: 'Avonworth Hockey' }
    ], 'org-b');
  `;
  const context = {};
  vm.runInNewContext(source, context);

  assert.match(context.single, /team-switcher-label">Team<\/span>/);
  assert.match(context.single, /switcher-value/);
  assert.match(context.single, /Arctic Foxes 12U AA/);
  assert.doesNotMatch(context.single, /<select/);

  assert.match(context.multi, /organization-switcher-label">Organization<\/span>/);
  assert.match(context.multi, /<select id="organizationSelect" aria-label="Selected organization">/);
  assert.match(context.multi, /switcher-chevron/);
  assert.match(context.multi, /<option value="org-b" selected>Avonworth Hockey<\/option>/);
});

test('switcher hosts keep stable ids and authorized change handlers', () => {
  for (const host of ['organizationSwitcher', 'teamSwitcher', 'seasonSwitcher']) {
    assert.match(index, new RegExp(`id="${host}"`));
  }
  assert.match(app, /organizationSelect'\)\.addEventListener\('change', event => selectOrganization/);
  assert.match(app, /teamSelect'\)\.addEventListener\('change', event => selectTeam/);
  assert.match(app, /seasonSelect'\)\.addEventListener\('change', event => selectSeason/);
});

test('Next Game and Latest Result regressions remain correct after dashboard polish', () => {
  const rendered = renderShellHarness({
    roster: [],
    schedule: [
      { opponent: 'Past Game', date: '2026-09-07', time: '19:00' },
      { opponent: 'Next Opponent', date: '2026-09-09', time: '18:30' }
    ],
    games: [
      { source_game_id: 'g1', opponent: 'Completed Opponent', date: '2026-09-06' },
      { source_game_id: 'g2', opponent: 'Future Logged', date: '2026-09-10' }
    ],
    playerStats: [],
    teamStats: [
      { source_game_id: 'g1', goals_for: 5, goals_against: 3 },
      { source_game_id: 'g2', goals_for: 8, goals_against: 0 }
    ],
    seasonRecord: { games_played: 1, wins: 1, losses: 0, ties: 0, goals_for: 5, goals_against: 3 }
  }, '2026-09-08T12:00:00');

  assert.match(rendered.renderedCommand, /vs Next Opponent/);
  assert.doesNotMatch(rendered.renderedCommand, /vs Past Game/);
  assert.match(rendered.renderedCommand, /Completed Opponent \(W 5–3\)/);
  assert.doesNotMatch(rendered.renderedCommand, /Future Logged/);
  assert.match(rendered.renderedCommand, /Top Players/);
  assert.match(rendered.renderedCommand, /Recent Games/);
  assert.match(rendered.renderedCommand, /No roster performers are synced yet\./);
});

test('Stage 1.1 polish styles cover badges, switchers, and responsive reflow', () => {
  for (const selector of ['.beta-badge', '.beta-badge-inline', '.badge', '.brand-logo-img', '.switcher-select', '.switcher-chevron', '.switcher-value', '.empty-text']) {
    assert.match(styles, new RegExp(`\\${selector}\\b`), `Expected ${selector} styles`);
  }
  assert.match(styles, /\.switcher-select select:focus-visible/);
  assert.match(styles, /@media\(max-width:1250px\)\{\.workspace-indicator\{display:none\}\}/);
  assert.match(styles, /@media\(max-width:700px\)\{\.topbar\{height:auto/);
  assert.doesNotMatch(styles, /\.team-switcher\{position:absolute;top:69px/);
  assert.doesNotMatch(styles, /\.organization-switcher\{position:absolute;top:69px/);
});

test('changed Stage 1.1 assets are cache-busted', () => {
  assert.match(index, /styles\.css\?v=beta-stage-1-2/);
  assert.match(index, /app\.js\?v=beta-stage-1-2/);
  assert.match(index, /season-context\.js\?v=beta-stage-1-1/);
});
