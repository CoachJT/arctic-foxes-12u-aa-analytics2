const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('web/app.js', 'utf8');
const index = fs.readFileSync('web/index.html', 'utf8');
const styles = fs.readFileSync('web/styles.css', 'utf8');

test('desktop parity surfaces use existing cloud-backed data and read-only rendering', () => {
  assert.match(app, /function gameCenter\(\)/);
  assert.match(app, /team_game_team_stats/);
  assert.match(app, /team_game_player_stats/);
  assert.match(app, /function reports\(\)/);
  assert.match(app, /function development\(\)/);
  assert.match(app, /function settings\(\)/);
  assert.doesNotMatch(app, /\.(insert|update|upsert|delete)\(/);
});

test('player development is a distinct capability-gated workspace surface', () => {
  assert.match(app, /development: PERMISSIONS\.PLAYERS_VIEW/);
  assert.match(index, /Player Development/);
  assert.match(index, /data-view="development"/);
});

test('game center and empty shells avoid fabricated records', () => {
  assert.match(app, /No completed games are synced/);
  assert.match(app, /Reports are not synced yet/);
  assert.match(app, /Development records are not synced yet/);
  assert.doesNotMatch(app, /Sample|Mia Chen|Riverside Ravens|10–3–1/);
});

test('desktop parity styles preserve responsive layouts', () => {
  assert.match(styles, /\.game-center-grid/);
  assert.match(styles, /\.settings-grid/);
  assert.match(styles, /@media\(max-width:1050px\)\{\.game-center-grid/);
});
