const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('web/action-center.js', 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context);
const { actionableItems } = context.window.FoxesActionCenter;

const schedule = [
  { date: '2026-09-01', opponent: 'Rivals', linked_game_source_id: 'past-unscored' },
  { date: '2026-09-02', opponent: 'Blades', linked_game_source_id: 'past-scored' },
  { date: '2026-09-20', opponent: 'Future', linked_game_source_id: 'future' }
];

test('Action Center derives real team-season actions and preserves their navigation', () => {
  const items = actionableItems({
    roster: [],
    schedule,
    teamStats: [{ source_game_id: 'past-scored', goals_for: 3, goals_against: 2 }],
    playerStats: [],
    today: '2026-09-15',
    capabilities: ['players.evaluate', 'stats.edit']
  });
  assert.deepEqual(JSON.parse(JSON.stringify(items.map(item => [item.kind, item.view]))), [
    ['empty-roster', 'players'],
    ['missing-score', 'schedule'],
    ['missing-stats', 'games']
  ]);
});

test('Action Center capability filtering never exposes unauthorized work', () => {
  const items = actionableItems({
    roster: [],
    schedule,
    teamStats: [],
    playerStats: [],
    today: '2026-09-15',
    capabilities: []
  });
  assert.equal(items.length, 0);
});

test('Action Center ignores future games and excludes completed detailed stats', () => {
  const items = actionableItems({
    roster: [{ jersey_number: '7' }],
    schedule,
    teamStats: [{ source_game_id: 'past-scored', goals_for: 3, goals_against: 2 }],
    playerStats: [{ source_game_id: 'past-scored', source_player_id: 'p7' }],
    today: '2026-09-15',
    capabilities: ['stats.edit']
  });
  assert.deepEqual(JSON.parse(JSON.stringify(items.map(item => item.kind))), ['missing-score']);
});
