const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migrationFile = '20260916000711_032_film_web_associations.sql';
const migration = fs.readFileSync(`supabase/migrations/${migrationFile}`, 'utf8');
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
  assert.doesNotMatch(room, /storage\.from\(meta\.bucket_name\)\.upload/);
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
  assert.equal(migrationFile > '20260916000710_031_private_team_film_clips_playlists.sql', true);
  assert.equal(fs.existsSync('supabase/migrations/20260915040425_032_film_web_associations.sql'), false);
  assert.equal(fs.existsSync(`supabase/migrations/${migrationFile}`), true);
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
  assert.match(room, /No fake progress is shown/);
  assert.match(room, /VIDEO_TYPES/);
});

test('resumable upload initializes Supabase Storage TUS with authenticated private media metadata', () => {
  assert.match(room, /LARGE_FILE_AUDIT/);
  assert.match(room, /new window\.tus\.Upload\(file/);
  assert.match(room, /storage\.supabase\.co\/storage\/v1\/upload\/resumable/);
  assert.match(room, /chunkSize: 6 \* 1024 \* 1024/);
  assert.match(room, /authorization: `Bearer \$\{token\}`/);
  assert.match(room, /apikey: publishableKey/);
  assert.match(room, /bucketName: meta\.bucket_name/);
  assert.match(room, /objectName: meta\.object_path/);
  assert.match(room, /team_id: teamId\(\), season_id: seasonId\(\), game_id: meta\.targetGameId/);
});

test('resumable upload progress, retry, cancel, failure, and finalization states are explicit', () => {
  assert.match(room, /onProgress\(bytesUploaded, bytesTotal\)/);
  assert.match(room, /Uploading \$\{progress\}%/);
  assert.match(room, /findPreviousUploads/);
  assert.match(room, /resumeFromPreviousUpload/);
  assert.match(room, /Paused\/interrupted/);
  assert.match(room, /Retrying\/resuming previous upload/);
  assert.match(room, /Processing\/finalizing private film/);
  assert.match(room, /Upload cancelled/);
  assert.match(room, /upload_state: 'uploading'/);
  assert.match(room, /upload_state: 'failed'/);
  assert.match(room, /upload_state: 'uploaded'/);
  assert.match(room, /data-film-clean-failed/);
});

test('mobile and tablet film contracts avoid fixed-width overflow', () => {
  assert.match(styles, /@media\(max-width:1050px\)\{\.film-grid,\.film-workspace-grid\{grid-template-columns:1fr\}/);
  assert.match(styles, /@media\(max-width:700px\)/);
  assert.match(styles, /\.playlist-items li\{grid-template-columns:1fr 1fr\}/);
  assert.match(styles, /\.staff-select\{grid-template-columns:1fr\}/);
});
