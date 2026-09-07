'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const writes = require('../windows-cloud-primary-writes');
const cloud = require('../cloud-primary-transition');

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

function state() {
  return {
    seasonKey: '2026-2027',
    players: [{ id: 'p-1', number: '13', name: 'Updated Name', pos: 'F', shifts: [{ startElapsed: 1 }] }],
    savedGames: []
  };
}

function mockClient(row, calls) {
  return {
    from(table) {
      const filters = [];
      const chain = {
        select(fields) { calls.push([table, 'select', fields]); return chain; },
        eq(field, value) { filters.push([field, value]); calls.push([table, 'eq', field, value]); return chain; },
        maybeSingle() {
          calls.push([table, 'maybeSingle']);
          return Promise.resolve({ data: row, error: null });
        },
        upsert(payload, options) {
          calls.push([table, 'upsert', payload, options]);
          return Promise.resolve({ data: [payload], error: null });
        }
      };
      return chain;
    }
  };
}

test('writes remain disabled by default and only roster rows can be queued for the controlled test', () => {
  const store = storage();
  const manager = writes.createWindowsCloudWrites({
    client: mockClient(null, []),
    storage: store,
    teamId: 'team-1',
    cache: cloud.createCloudCache({ storage: store })
  });
  assert.equal(manager.enabled(), false);
  assert.throws(() => manager.enqueueRoster({ state: state(), schedule: [] }), /disabled by feature flag/);
  manager.setEnabled(true);
  const result = manager.enqueueRoster({ state: state(), schedule: [] });
  assert.equal(result.queued, 1);
  assert.equal(result.items[0].dataset, 'roster');
  assert.equal(manager.queue.list()[0].payload.team_id, 'team-1');
});

test('authenticated queue flush upserts once, acknowledges the queue, and updates the cache', async () => {
  const store = storage();
  const calls = [];
  const existing = { team_id: 'team-1', source_player_id: 'p-1', jersey_number: '13', name: 'Old Name', position: 'F' };
  const cache = cloud.createCloudCache({ storage: store });
  cache.set('roster', 'team-1', [existing]);
  const manager = writes.createWindowsCloudWrites({
    client: mockClient(existing, calls),
    storage: store,
    teamId: 'team-1',
    cache
  });
  manager.setEnabled(true);
  manager.enqueueRoster({ state: state(), schedule: [] });
  const result = await manager.flush({ limit: 1 });
  assert.equal(result.completed, 1);
  assert.equal(result.conflicts, 0);
  assert.equal(manager.queue.list().length, 0);
  assert.equal(calls.filter(call => call[1] === 'upsert').length, 1);
  assert.equal(cache.get('roster', 'team-1').rows[0].name, 'Updated Name');
});

test('revision mismatch becomes a conflict and never upserts', async () => {
  const store = storage();
  const calls = [];
  const cached = { team_id: 'team-1', source_player_id: 'p-1', jersey_number: '13', name: 'Cached Name', position: 'F' };
  const remote = { ...cached, name: 'Remote Name' };
  const cache = cloud.createCloudCache({ storage: store });
  cache.set('roster', 'team-1', [cached]);
  const manager = writes.createWindowsCloudWrites({
    client: mockClient(remote, calls),
    storage: store,
    teamId: 'team-1',
    cache
  });
  manager.setEnabled(true);
  manager.enqueueRoster({ state: state(), schedule: [] });
  const result = await manager.flush({ limit: 1 });
  assert.equal(result.conflicts, 1);
  assert.equal(manager.queue.list()[0].status, 'conflict');
  assert.equal(calls.some(call => call[1] === 'upsert'), false);
});

test('cross-team payloads are rejected before network writes', async () => {
  const store = storage();
  const manager = writes.createWindowsCloudWrites({
    client: mockClient(null, []),
    storage: store,
    teamId: 'team-1'
  });
  manager.setEnabled(true);
  assert.throws(() => manager.queue.enqueue({
    teamId: 'team-1',
    dataset: 'roster',
    sourceId: 'p-1',
    payload: { team_id: 'team-2', source_player_id: 'p-1' }
  }), /Cross-team/);
});

test('dataset-level queue controls prepare only the requested approved datasets', () => {
  const store = storage();
  const manager = writes.createWindowsCloudWrites({
    client: mockClient(null, []),
    storage: store,
    teamId: 'team-1'
  });
  manager.setEnabled(true);
  const result = manager.enqueueDatasets({
    state: {
      seasonKey: '2026-2027',
      players: [{ id: 'p-1', number: '13', name: 'Player', pos: 'F' }],
      savedGames: [{ id: 'g-1', date: '2026-09-01', opponent: 'Bears', officialStats: { team: {} } }]
    },
    schedule: [{ id: 's-1', date: '2026-09-02', opponent: 'Bears' }]
  }, ['schedule', 'games', 'playerStats', 'teamStats']);
  assert.deepEqual([...new Set(result.items.map(item => item.dataset))].sort(), ['games', 'schedule']);
  assert.equal(result.items.some(item => item.dataset === 'roster'), false);
});
