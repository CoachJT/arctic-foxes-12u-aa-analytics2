const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Repository = require('../pucknexus-analytics-repository');

const migrationPath = 'supabase/migrations/019_pucknexus_impact_mvp_awards_v1.sql';
const migration = fs.readFileSync(migrationPath, 'utf8');
const tables = [
  'team_game_impact_results',
  'team_player_trend_results',
  'team_game_mvp_results',
  'team_season_awards',
  'team_player_feedback',
  'team_analytics_reviews',
  'team_analytics_audit_log'
];

test('analytics migration is uniquely numbered after the authoritative migration chain', () => {
  const numbers = fs.readdirSync('supabase/migrations')
    .map(name => Number(name.match(/^(\d+)_/)?.[1]))
    .filter(Number.isFinite);
  assert.equal(Math.max(...numbers), 19);
  assert.ok(fs.existsSync(migrationPath));
});

test('every analytics table enables RLS and denies anonymous grants', () => {
  for (const table of tables) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  }
  assert.match(migration, /revoke all on[\s\S]+from anon;/i);
  assert.doesNotMatch(migration, /to anon/i);
});

test('database contract validates team-season ownership and immutable tenant scope', () => {
  assert.match(migration, /season\.id = new\.season_id[\s\S]*season\.team_id = new\.team_id/i);
  assert.match(migration, /new\.team_id <> old\.team_id or new\.season_id <> old\.season_id/i);
  assert.match(migration, /can_access_team_season\(team_id, season_id\)/i);
  assert.match(migration, /impact_score between 0 and 100/i);
  assert.match(migration, /position in \('forward', 'defense', 'goalie'\)/i);
  assert.match(migration, /unique \(team_id, season_id, source_game_id\)/i);
  assert.match(migration, /tie_candidate_ids text\[\]/i);
  assert.match(migration, /award_scope.*\('player', 'goalie', 'team'\)/i);
  assert.match(migration, /Original PuckNexus prediction is immutable/i);
  assert.match(migration, /team_analytics_audit_log_idempotency_idx/i);
  assert.match(migration, /replace_pucknexus_game_analytics_v1/i);
  assert.match(migration, /grant execute on function public\.replace_pucknexus_game_analytics_v1[\s\S]*to service_role/i);
  assert.doesNotMatch(migration, /grant\s+(?:all|delete)[\s\S]*to authenticated/i);
});

test('formula writes are server-controlled and reviews require platform-admin claims', () => {
  assert.match(migration, /is_platform_admin/i);
  assert.match(migration, /revoke insert, update, delete on[\s\S]*team_game_impact_results/i);
  assert.match(migration, /revoke insert, delete on public\.team_game_mvp_results from authenticated/i);
  assert.doesNotMatch(migration, /team_game_impact_results_insert/i);
  assert.match(migration, /feedback_type text not null.*agreement.*review/i);
  assert.match(migration, /feedback_type = 'review' and reason_code is not null/i);
  assert.match(migration, /severity.*obvious_miss/i);
  assert.match(migration, /review_state.*pnx_correct.*overridden.*model_review/i);
});

test('repository reads always apply both tenant predicates', () => {
  const calls = [];
  const chain = {
    select(columns) { calls.push(['select', columns]); return this; },
    eq(column, value) { calls.push(['eq', column, value]); return this; }
  };
  const client = {
    from(table) {
      calls.push(['from', table]);
      return chain;
    }
  };
  const repository = Repository.createRepository(client, {
    team_id: 'team-a',
    season_id: 'season-a'
  });
  repository.listImpact('id,impact_score');
  assert.deepEqual(calls, [
    ['from', 'team_game_impact_results'],
    ['select', 'id,impact_score'],
    ['eq', 'team_id', 'team-a'],
    ['eq', 'season_id', 'season-a']
  ]);
});

test('repository game projections reject a foreign tenant', () => {
  const repository = Repository.createRepository({ from() {} }, {
    team_id: 'team-a',
    season_id: 'season-a'
  });
  assert.throws(() => repository.buildGameProjection('game-a', [{
      team_id: 'team-b',
      season_id: 'season-b',
      source_player_id: 'p1',
      player_type: 'skater',
      gp: 1,
      goals: 1
    }]), /Tenant scope mismatch/);
});

test('repository maps trend and award calculations to persistence fields', () => {
  const repository = Repository.createRepository({ from() {} }, {
    team_id: 'team-a',
    season_id: 'season-a'
  });
  const trend = repository.buildTrendProjection('p1', [
    { date: '2026-09-01', impact_score: 1 },
    { date: '2026-09-02', impact_score: 2 },
    { date: '2026-09-03', impact_score: 3 }
  ]);
  assert.equal(trend.direction, 'improving');
  assert.equal(trend.first_value, 1);
  assert.equal(trend.window_ends_at, '2026-09-03');
  const awards = repository.buildAwardProjection([{
    source_player_id: 'p1',
    player_type: 'skater',
    position: 'F',
    gp: 1,
    goals: 2
  }]);
  assert.ok(awards.length > 0);
  assert.ok(awards.every(row => row.team_id === 'team-a' && row.season_id === 'season-a'));
  assert.ok(awards.every(row => ['player', 'goalie'].includes(row.award_scope)));
});

test('repository emits exactly one MVP row and scoped game award records', () => {
  const repository = Repository.createRepository({ from() {} }, {
    team_id: 'team-a',
    season_id: 'season-a'
  });
  const projection = repository.buildGameProjection('game-a', [{
    source_player_id: 'z',
    player_type: 'skater',
    position: 'F',
    gp: 1,
    goals: 1
  }, {
    source_player_id: 'a',
    player_type: 'skater',
    position: 'F',
    gp: 1,
    goals: 1
  }], {
    calculatedAt: '2026-09-08T00:00:00Z',
    teamStats: { goals_for: 3, goals_against: 1, shots_for: 36, shots_against: 17 }
  });
  assert.equal(Array.isArray(projection.mvp), false);
  assert.equal(projection.mvp.source_player_id, 'a');
  assert.deepEqual(projection.mvp.tie_candidate_ids, ['a', 'z']);
  assert.equal(projection.awards.find(row => row.award_key === 'TEAM_TILTED_ICE').award_scope, 'team');
  assert.ok(projection.awards.every(row => row.source_game_id === 'game-a'));
});

test('recalculation contract is repeatable and carries replacement scope plus idempotent audit', () => {
  const repository = Repository.createRepository({ from() {} }, {
    team_id: 'team-a',
    season_id: 'season-a'
  });
  const stats = [{
    source_player_id: 'p1', player_type: 'skater', position: 'F', gp: 1, goals: 2
  }];
  const options = {
    statsRevision: 'revision-7',
    calculatedAt: '2026-09-08T12:00:00Z',
    teamStats: { goals_for: 2, goals_against: 1 }
  };
  const first = repository.buildGameRecalculation('game-a', stats, options);
  const second = repository.buildGameRecalculation('game-a', stats, options);
  assert.deepEqual(first, second);
  assert.equal(first.replacement_scope.source_game_id, 'game-a');
  assert.equal(first.audit.idempotency_key,
    'game-a:revision-7:pnx-impact-v1:pnx-awards-v1');
  assert.equal(first.impacts[0].computed_at, options.calculatedAt);
});

test('repository persists a recalculation through one atomic server-only RPC', async () => {
  const calls = [];
  const repository = Repository.createRepository({
    from() {},
    async rpc(name, payload) {
      calls.push([name, payload]);
      return { data: true, error: null };
    }
  }, { team_id: 'team-a', season_id: 'season-a' });
  const calculation = repository.buildGameRecalculation('game-a', [{
    source_player_id: 'p1', player_type: 'skater', position: 'F', gp: 1, goals: 1
  }], {
    statsRevision: 'revision-8',
    calculatedAt: '2026-09-08T12:00:00Z',
    teamStats: { goals_for: 1, goals_against: 0 }
  });
  assert.equal(await repository.saveGameRecalculation(calculation), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'replace_pucknexus_game_analytics_v1');
  assert.equal(calls[0][1].target_idempotency_key,
    'game-a:revision-8:pnx-impact-v1:pnx-awards-v1');
});

test('browser integration hook is loaded and scopes every query', () => {
  const calls = [];
  const chain = {
    select() { return this; },
    eq(column, value) { calls.push([column, value]); return this; }
  };
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync('web/analytics-context.js', 'utf8'), sandbox);
  const source = sandbox.window.PuckNexusAnalyticsContext.createAnalyticsContext({
    client: { from() { return chain; } },
    getWorkspace: () => ({ teamId: 'team-a', seasonId: 'season-a' })
  });
  source.query('team_game_impact_results');
  assert.deepEqual(calls, [['team_id', 'team-a'], ['season_id', 'season-a']]);
  assert.match(fs.readFileSync('web/index.html', 'utf8'), /analytics-context\.js\?v=contract-v1/);
});
