const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync('supabase/migrations/20260915040425_032_film_web_associations.sql', 'utf8');
const room = fs.readFileSync('web/film-room.js', 'utf8');
const app = fs.readFileSync('web/app.js', 'utf8');
const index = fs.readFileSync('web/index.html', 'utf8');
const styles = fs.readFileSync('web/styles.css', 'utf8');
const migrations = fs.readdirSync('supabase/migrations').filter(file => file.endsWith('.sql')).map(file => fs.readFileSync(`supabase/migrations/${file}`, 'utf8')).join('\n');

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
  assert.match(app, /filmRoom\.openForGame/);
  assert.match(app, /data-open-film-room="\$\{escapeHtml\(game\.id\)\}"/);
  assert.match(index, /data-view="film"/);
  assert.match(index, /film-room\.js/);
});

test('Film migration remains forward-only and does not apply production changes', () => {
  assert.doesNotMatch(migration, /\bdrop table\b/i);
  assert.doesNotMatch(migration, /\btruncate\b/i);
  assert.match(migration, /queued migration/i);
});

test('clip management supports edit, delete, timestamp validation, and playlist-safe removal', () => {
  assert.match(room, /function validateClip/);
  assert.match(room, /Clip end must be after clip start/);
  assert.match(room, /data-film-edit-clip/);
  assert.match(room, /data-film-delete-clip/);
  assert.match(room, /The original video will not be deleted/);
  assert.match(room, /team_film_clips'\)\.delete\(\)\.eq\('id'/);
});

test('playlist management supports add, remove, reorder, save order, delete, and sequential playback', () => {
  assert.match(room, /data-film-create-playlist/);
  assert.match(room, /data-film-remove-playlist-clip/);
  assert.match(room, /data-film-move-up/);
  assert.match(room, /function savePlaylistOrder/);
  assert.match(room, /draggable="\$\{canEdit\(\)\}"/);
  assert.match(room, /function startPlaylist/);
  assert.match(room, /function nextPlaylistClip/);
  assert.match(room, /Clip \$\{Math\.min\(state\.playback\.index \+ 1, items\.length\)\} \/ \$\{items\.length\}/);
});

test('selected-staff sharing UI is film.share gated and same-team server enforced', () => {
  assert.match(room, /canShare\(\)/);
  assert.match(room, /film\.share is required to modify playlist sharing/);
  assert.match(room, /team_memberships'\)\.select/);
  assert.match(room, /\.eq\('team_id', teamId\(\)\)\.eq\('status', 'active'\)/);
  assert.match(migration, /has_team_capability\(p\.team_id, 'film\.share'\)/);
  assert.match(migration, /sharing = 'team_private' or public\.has_team_capability\(team_id, 'film\.share'\)/);
  assert.match(migrations, /Playlist can only be shared with active members of the same team/);
});

test('film deletion and upload flows protect coach work and duplicate submissions', () => {
  assert.match(room, /Film deletion is blocked while clips exist/);
  assert.match(room, /playlist references/i);
  assert.match(room, /if \(state\.uploading\) return/);
  assert.match(room, /submit\.disabled = true/);
  assert.match(room, /No fake percentage is shown/);
  assert.match(room, /VIDEO_TYPES/);
});

test('large-file upload audit documents resumable upload requirement before beta', () => {
  assert.match(room, /LARGE_FILE_AUDIT/);
  assert.match(room, /Multi-GB full-game uploads/);
  assert.match(room, /resumable\/TUS uploads before BETA/);
});

test('mobile and tablet film contracts avoid fixed-width overflow', () => {
  assert.match(styles, /@media\(max-width:1050px\)\{\.film-grid,\.film-workspace-grid\{grid-template-columns:1fr\}/);
  assert.match(styles, /@media\(max-width:700px\)/);
  assert.match(styles, /\.playlist-items li\{grid-template-columns:1fr 1fr\}/);
  assert.match(styles, /\.staff-select\{grid-template-columns:1fr\}/);
});
