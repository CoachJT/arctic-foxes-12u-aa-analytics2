const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync('supabase/migrations/20260915040425_032_film_web_associations.sql', 'utf8');
const room = fs.readFileSync('web/film-room.js', 'utf8');
const app = fs.readFileSync('web/app.js', 'utf8');
const index = fs.readFileSync('web/index.html', 'utf8');

test('Film Web 1.0 is linked to canonical season, game, and private media records', () => {
  assert.match(migration, /add column if not exists season_id uuid references public\.seasons/);
  assert.match(migration, /add column if not exists game_id uuid references public\.team_games/);
  assert.match(migration, /add column if not exists media_asset_id uuid references public\.media_assets/);
  assert.match(migration, /External film URLs are not supported/);
  assert.match(migration, /validate_team_film_associations/);
});

test('Film Room uses private storage and timestamp references instead of external or duplicated videos', () => {
  assert.match(room, /createSignedUrl/);
  assert.match(room, /create_media_asset/);
  assert.match(room, /start_seconds/);
  assert.match(room, /end_seconds/);
  assert.doesNotMatch(room, /getPublicUrl/);
  assert.match(room, /film\.view/);
  assert.match(room, /film\.edit/);
});

test('Film Room is capability-gated and present in primary web navigation', () => {
  assert.match(app, /film: PERMISSIONS\.FILM_VIEW/);
  assert.match(app, /view === 'film'/);
  assert.match(index, /data-view="film"/);
  assert.match(index, /film-room\.js/);
});

test('Film migration remains forward-only and does not apply production changes', () => {
  assert.doesNotMatch(migration, /\bdrop table\b/i);
  assert.doesNotMatch(migration, /\btruncate\b/i);
  assert.match(migration, /queued migration/i);
});
