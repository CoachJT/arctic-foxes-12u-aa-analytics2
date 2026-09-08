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

function renderCommandHarness({ phase1Data, workspace = {}, staff = {}, team = {} }, now = '2026-09-08T12:00:00') {
  const source = `
    const PLATFORM = { name: 'PuckNexus' };
    let currentWorkspace = ${JSON.stringify({
      authorized: true,
      branding: { display_name: 'PuckNexus Demo Org', logo_url: '' },
      team_name: 'Demo Team',
      season_name: '2026-27',
      plan_id: 'FOUNDING',
      ...workspace
    })};
    let authTeam = ${JSON.stringify({ team_name: 'Demo Team', ...team })};
    let activeStaff = ${JSON.stringify({ role: 'Head Coach', capabilities: ['players.evaluate'], ...staff })};
    let phase1Data = ${JSON.stringify(phase1Data)};
    const seasonContext = { branding: { display_name: 'PuckNexus Demo Org' }, selectedSeason: { name: '2026-27' } };
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
    ${extractFunction(app, 'command')}
    this.rendered = command();
  `;
  const rendered = { Date: createFixedDate(now) };
  vm.runInNewContext(source, rendered);
  return rendered.rendered;
}

const EMPTY_RECORD = { games_played: 0, wins: 0, losses: 0, ties: 0, goals_for: 0, goals_against: 0 };

test('Stage 1.2 hero renders tenant identity from workspace branding, never hard-coded', () => {
  const rendered = renderCommandHarness({
    phase1Data: { roster: [], schedule: [], games: [], playerStats: [], teamStats: [], seasonRecord: EMPTY_RECORD },
    workspace: { branding: { display_name: 'Avonworth Hockey', logo_url: 'https://cdn.example/logo.png' }, team_name: '14U A' },
    staff: { name: 'Dave Coach', role: 'Head Coach' },
    team: { team_name: '14U A' }
  });

  assert.match(rendered, /class="hero card command-hero"/);
  assert.match(rendered, /<img class="identity-logo" src="https:\/\/cdn\.example\/logo\.png" alt="Avonworth Hockey logo">/);
  assert.match(rendered, /<span class="eyebrow">Welcome back,<\/span>/);
  assert.match(rendered, /<h1 class="welcome-title">Dave Coach\.<\/h1>/);
  assert.match(rendered, /Head Coach <b>·<\/b> 14U A <b>·<\/b> 2026-27/);
  assert.match(rendered, /View Latest Game Film/);

  const commandSource = extractFunction(app, 'command');
  assert.doesNotMatch(commandSource, /Arctic Foxes|Avonworth|#d71920/);
});

test('Stage 1.2 hero falls back to a branded monogram mark when no logo is synced', () => {
  const rendered = renderCommandHarness({
    phase1Data: { roster: [], schedule: [], games: [], playerStats: [], teamStats: [], seasonRecord: EMPTY_RECORD },
    workspace: { branding: { display_name: 'Steel City Selects', logo_url: '' } }
  });

  assert.doesNotMatch(rendered, /identity-logo/);
  assert.match(rendered, /<span class="identity-mark" aria-hidden="true">SC<\/span>/);
  assert.match(rendered, /<h1 class="welcome-title">Head Coach\.<\/h1>/);
});

test('Stage 1.2 Next Game is prominent, future-only, and shows full game identity', () => {
  const rendered = renderCommandHarness({
    phase1Data: {
      roster: [],
      schedule: [
        { opponent: 'Past Opponent', date: '2026-09-07', time: '19:00', location: 'Old Rink', home_away: 'Away' },
        { opponent: 'Next Opponent', date: '2026-09-09', time: '18:30', location: 'Frozen Pond Arena', home_away: 'Home', game_type: 'League', notes: 'Division seeding game.' }
      ],
      games: [],
      playerStats: [],
      teamStats: [],
      seasonRecord: EMPTY_RECORD
    }
  });

  assert.match(rendered, /class="card next-game dashboard-feature"/);
  assert.match(rendered, /vs Next Opponent/);
  assert.doesNotMatch(rendered, /Past Opponent/);
  assert.match(rendered, /Sep 09, 2026/);
  assert.match(rendered, /18:30/);
  assert.match(rendered, /<span class="home-pill">Home<\/span>/);
  assert.match(rendered, /Location<b>Frozen Pond Arena<\/b>/);
  assert.match(rendered, /Game type<b>League<\/b>/);
  assert.match(rendered, /<span class="eyebrow">Game Preview<\/span><p>Division seeding game\.<\/p>/);
});

test('Stage 1.2 Next Game empty state is polished and honest', () => {
  const rendered = renderCommandHarness({
    phase1Data: {
      roster: [],
      schedule: [{ opponent: 'Past Opponent', date: '2026-09-07', time: '19:00' }],
      games: [],
      playerStats: [],
      teamStats: [],
      seasonRecord: EMPTY_RECORD
    }
  });

  assert.match(rendered, /class="next-game-empty"/);
  assert.match(rendered, /No upcoming games scheduled\./);
  assert.doesNotMatch(rendered, /vs Past Opponent/);
});

test('Stage 1.2 Recent Games only lists completed games backed by team stats, newest first', () => {
  const rendered = renderCommandHarness({
    phase1Data: {
      roster: [],
      schedule: [],
      games: [
        { source_game_id: 'g1', opponent: 'Older Completed', date: '2026-09-01' },
        { source_game_id: 'g2', opponent: 'Newer Completed', date: '2026-09-05' },
        { source_game_id: 'g3', opponent: 'No Stats Game', date: '2026-09-06' },
        { source_game_id: 'g4', opponent: 'Future Game', date: '2026-09-12' }
      ],
      playerStats: [],
      teamStats: [
        { source_game_id: 'g1', goals_for: 2, goals_against: 2 },
        { source_game_id: 'g2', goals_for: 5, goals_against: 3 },
        { source_game_id: 'g4', goals_for: 9, goals_against: 0 }
      ],
      seasonRecord: EMPTY_RECORD
    }
  });

  assert.match(rendered, /<h3>Recent Games<\/h3>/);
  assert.ok(rendered.indexOf('Newer Completed') < rendered.indexOf('Older Completed'), 'newest completed game renders first');
  assert.match(rendered, /Newer Completed<\/strong><small>Sep 05, 2026<\/small>/);
  assert.match(rendered, /<span class="score">5–3<\/span><span class="result win">WIN<\/span>/);
  assert.match(rendered, /<span class="score">2–2<\/span><span class="result ">TIE<\/span>/);
  assert.doesNotMatch(rendered, /No Stats Game/);
  assert.doesNotMatch(rendered, /Future Game/);
});

test('Stage 1.2 Top Players sorts by points from canonical synced stats with G/A/P detail', () => {
  const rendered = renderCommandHarness({
    phase1Data: {
      roster: [
        { id: 'p1', source_player_id: 's1', jersey_number: '9', name: 'Playmaker Pat', position: 'F', status: 'active' },
        { id: 'p2', source_player_id: 's2', jersey_number: '4', name: 'Sniper Sam', position: 'D', status: 'active' }
      ],
      schedule: [],
      games: [],
      playerStats: [
        { source_game_id: 'g1', source_player_id: 's1', gp: 1, goals: 1, assists: 3 },
        { source_game_id: 'g2', source_player_id: 's1', gp: 1, goals: 0, assists: 1 },
        { source_game_id: 'g1', source_player_id: 's2', gp: 1, goals: 3, assists: 0 },
        { source_game_id: 'g2', source_player_id: 's2', gp: 1, goals: 1, assists: 0 }
      ],
      teamStats: [],
      seasonRecord: EMPTY_RECORD
    }
  });

  assert.match(rendered, /<h3>Top Players<\/h3>/);
  assert.ok(rendered.indexOf('Playmaker Pat') < rendered.indexOf('Sniper Sam'), '5 points outranks 4 points');
  assert.match(rendered, /<span class="jersey">#9<\/span><div class="leader-info"><strong>Playmaker Pat<\/strong><small>F · 2 GP<\/small><\/div><div class="leader-stats"><span>1 G<\/span><span>4 A<\/span><\/div><span class="leader-value">5 P<\/span>/);
  assert.match(rendered, /<span class="jersey">#4<\/span><div class="leader-info"><strong>Sniper Sam<\/strong><small>D · 2 GP<\/small><\/div><div class="leader-stats"><span>4 G<\/span><span>0 A<\/span><\/div><span class="leader-value">4 P<\/span>/);
});

test('Stage 1.2 Top Players empty state stays honest when no roster is synced', () => {
  const rendered = renderCommandHarness({
    phase1Data: { roster: [], schedule: [], games: [], playerStats: [], teamStats: [], seasonRecord: EMPTY_RECORD }
  });
  assert.match(rendered, /No roster performers are synced yet\./);
});

test('Stage 1.2 performance card uses only real record metrics and no invented trends', () => {
  const rendered = renderCommandHarness({
    phase1Data: {
      roster: [],
      schedule: [],
      games: [
        { source_game_id: 'g1', opponent: 'A', date: '2026-09-01' },
        { source_game_id: 'g2', opponent: 'B', date: '2026-09-03' },
        { source_game_id: 'g3', opponent: 'C', date: '2026-09-05' },
        { source_game_id: 'g4', opponent: 'Future', date: '2026-09-20' }
      ],
      playerStats: [],
      teamStats: [
        { source_game_id: 'g1', goals_for: 4, goals_against: 1 },
        { source_game_id: 'g2', goals_for: 2, goals_against: 3 },
        { source_game_id: 'g3', goals_for: 3, goals_against: 3 },
        { source_game_id: 'g4', goals_for: 7, goals_against: 0 }
      ],
      seasonRecord: { games_played: 3, wins: 1, losses: 1, ties: 1, goals_for: 9, goals_against: 7 }
    }
  });

  assert.match(rendered, /<h3>Team Performance<\/h3>/);
  assert.match(rendered, /<span class="metric-label">Win Rate<\/span>\s*<strong class="metric-value">33%<\/strong>/);
  assert.match(rendered, /<strong class="metric-value perf-score">9 \/ 7<\/strong>/);
  assert.match(rendered, /3\.0 GF &middot; 2\.3 GA per game/);
  const formMatch = rendered.match(/<strong class="metric-value perf-form">([\s\S]*?)<\/strong>/);
  assert.ok(formMatch, 'recent record badges render');
  assert.deepEqual([...formMatch[1].matchAll(/form-badge (\w+)">([WLT])</g)].map(match => match[2]), ['T', 'L', 'W']);
  assert.doesNotMatch(rendered, /Future/);
  const commandSource = extractFunction(app, 'command');
  assert.doesNotMatch(commandSource, /trend|improvem|streak|momentum/i);
});

test('Stage 1.2 performance card empty state is honest when no games are completed', () => {
  const rendered = renderCommandHarness({
    phase1Data: { roster: [], schedule: [], games: [], playerStats: [], teamStats: [], seasonRecord: EMPTY_RECORD }
  });
  assert.match(rendered, /Team performance metrics appear once completed games with synced stats are available\./);
  assert.doesNotMatch(rendered, /Win Rate<\/span>\s*<strong class="metric-value">/);
});

test('Stage 1.2 dashboard active roster count and goalie count remain unchanged', () => {
  const rendered = renderCommandHarness({
    phase1Data: {
      roster: [
        { id: 'p1', source_player_id: 's1', jersey_number: '9', name: 'Ava Skater', position: 'F', player_type: 'skater', status: 'active' },
        { id: 'p2', source_player_id: 's2', jersey_number: '31', name: 'Gabe Goalie', position: 'G', player_type: 'goalie', status: 'active' },
        { id: 'p3', source_player_id: 's3', jersey_number: '4', name: 'Drew Defender', position: 'D', player_type: 'skater', status: 'inactive' }
      ],
      schedule: [],
      games: [],
      playerStats: [],
      teamStats: [],
      seasonRecord: EMPTY_RECORD
    }
  });

  assert.match(rendered, /Active Roster<\/span>\s*<strong class="metric-value">2 Players<\/strong>/);
  assert.match(rendered, /1 Goalie<\/span>/);
  assert.doesNotMatch(rendered, />3<\/strong>\s*<span class="metric-meta">.*Goalie/);
});

test('Stage 1.2 sidebar keeps entitlement gating, beta badge, and adds a footer user area', () => {
  assert.match(app, /function navigationModel\(authorizedForView, sections = NAV_SECTIONS\)/);
  assert.match(app, /function syncNavigation\(view\)/);
  assert.match(app, /workspaceAuthorizedForView\(view\)/);
  assert.match(app, /entitlements\.isFeatureEnabled\(viewFeatures\[view\]\)/);
  assert.match(index, /<span class="beta-badge">BETA<\/span>/);
  assert.match(index, /<div class="sidebar-user" id="sidebarUser"><\/div>/);
  assert.match(app, /document\.querySelector\('#sidebarUser'\)/);
  assert.match(styles, /\.sidebar-user\b/);
  assert.match(styles, /\.sidebar-user-avatar\b/);
  assert.match(styles, /\.sidebar-user:empty\{display:none\}/);
});

test('Stage 1.2 context selectors keep authorized handlers and gain icons without breaking markup', () => {
  const source = `
    ${extractFunction(app, 'escapeHtml')}
    ${extractFunction(app, 'switcherMarkup')}
    this.single = switcherMarkup('team-switcher', 'Team', null, '', [], '', 'Demo Team', 'team');
    this.multi = switcherMarkup('organization-switcher', 'Organization', 'organizationSelect', 'Selected organization', [
      { value: 'org-a', label: 'Org A' },
      { value: 'org-b', label: 'Org B' }
    ], 'org-b', undefined, 'platform');
    this.legacy = switcherMarkup('season-switcher', 'Season', null, '', [], '', '2026-27');
  `;
  const context = {};
  vm.runInNewContext(source, context);

  assert.match(context.single, /<svg class="switcher-icon" aria-hidden="true"><use href="#icon-team"><\/use><\/svg>/);
  assert.match(context.single, /team-switcher-label">Team<\/span>/);
  assert.match(context.single, /switcher-value/);
  assert.match(context.multi, /<svg class="switcher-icon" aria-hidden="true"><use href="#icon-platform"><\/use><\/svg>/);
  assert.match(context.multi, /switcher-chevron/);
  assert.match(context.multi, /<select id="organizationSelect" aria-label="Selected organization">/);
  assert.doesNotMatch(context.legacy, /switcher-icon/);
  assert.match(context.legacy, /season-switcher-label">Season<\/span>/);

  assert.match(app, /organizationSelect'\)\.addEventListener\('change', event => selectOrganization/);
  assert.match(app, /teamSelect'\)\.addEventListener\('change', event => selectTeam/);
  assert.match(app, /seasonSelect'\)\.addEventListener\('change', event => selectSeason/);
  assert.match(styles, /\.switcher-icon\b/);
});

test('Stage 1.2 styles are brand-variable driven with no organization hard-coded', () => {
  assert.doesNotMatch(styles, /#d71920/i, 'no hard-coded organization red');
  assert.doesNotMatch(styles, /Arctic Foxes/i, 'no organization name in stylesheet');
  assert.match(styles, /var\(--brand-primary/);
  assert.match(styles, /var\(--brand-accent/);
  assert.match(styles, /var\(--org-surface/);
  assert.match(styles, /\.command-hero\b/);
  assert.match(styles, /\.dashboard-grid\b/);
  assert.match(styles, /\.dashboard-feature\{grid-column:1\/-1\}/);
  assert.match(styles, /\.game-preview\b/);
  assert.match(styles, /\.perf-grid\b/);
  assert.match(styles, /\.form-badge\b/);
  assert.match(styles, /@media\(min-width:1440px\)/);
  assert.match(styles, /@media\(max-width:1250px\)\{\.dashboard-grid/);
  assert.match(styles, /@media\(max-width:700px\)\{\.dashboard-grid\{grid-template-columns:1fr/);
});

test('Stage 1.2 login-first auth bootstrap is unchanged', () => {
  const bootstrap = app.slice(app.indexOf('if (recoveryCallbackPresent)'));
  assert.match(bootstrap, /showLogin\(\);\s*supabaseClient\.auth\.getSession\(\)/);
  assert.match(index, /<div class="auth-screen" id="authScreen" hidden><\/div>/);
  assert.match(app, /signInWithPassword/);
  assert.doesNotMatch(app, /\.(insert|update|upsert|delete)\(/);
});

test('Stage 1.2 notifications placeholder carries no fabricated unread count', () => {
  assert.match(index, /aria-label="Notifications"/);
  assert.doesNotMatch(index, /<em>\d+<\/em>/);
});

test('Stage 1.2 changed assets are cache-busted', () => {
  assert.match(index, /styles\.css\?v=beta-stage-1-3/);
  assert.match(index, /app\.js\?v=beta-stage-1-3/);
});
