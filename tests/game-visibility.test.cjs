const test = require('node:test');
const assert = require('node:assert/strict');
const { activeGames } = require('../web/game-visibility.js');

test('schedule removal hides its orphan canonical game from Game Center', () => {
  const games = [{ source_game_id: 'real', date: '2026-09-12', opponent: 'SHAHA' }, { source_game_id: 'duplicate', date: '2026-09-12', opponent: 'SHAHA' }];
  assert.deepEqual(activeGames([{ linked_game_source_id: 'real' }], games).map(game => game.source_game_id), ['real']);
});

test('legacy unlinked schedule resolves one game per entry without surfacing duplicate shells', () => {
  const games = [{ source_game_id: 'one', date: '2026-09-12', opponent: 'SHAHA' }, { source_game_id: 'two', date: '2026-09-12', opponent: 'SHAHA' }];
  assert.deepEqual(activeGames([{ date: '2026-09-12', opponent: 'SHAHA' }], games).map(game => game.source_game_id), ['one']);
  assert.equal(activeGames([{ date: '2026-09-12', opponent: 'SHAHA' }, { date: '2026-09-12', opponent: 'SHAHA' }], games).length, 2);
});
