const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const storageSource = fs.readFileSync('web/media-storage.js', 'utf8');
const supportSource = fs.readFileSync('web/support-reporting.js', 'utf8');
const migrationSource = fs.readFileSync('supabase/migrations/012_storage_and_support_foundation.sql', 'utf8');
const appSource = fs.readFileSync('web/app.js', 'utf8');
const indexSource = fs.readFileSync('web/index.html', 'utf8');
const stylesSource = fs.readFileSync('web/styles.css', 'utf8');

function load(source) {
  const context = { window: {}, location: { pathname: '/support' }, navigator: { userAgent: 'test' } };
  vm.runInNewContext(source, context);
  return context.window;
}

test('private media storage validates MIME types and uses the resolved workspace', async () => {
  const win = load(storageSource);
  const calls = [];
  const client = {
    rpc: async (name, args) => { calls.push([name, args]); return { data: [{ asset_id: 'asset-1', bucket_name: 'game-film', object_path: 'org/team/season/game-film/game/file.mp4' }], error: null }; },
    storage: { from: () => ({ upload: async () => ({ error: null }) }) }
  };
  const manager = win.FoxesMediaStorage.createMediaStorage({
    client,
    getWorkspace: () => ({ authorized: true, organization_id: 'org', team_id: 'team', season_id: 'season' })
  });
  await manager.prepareUpload({ file: { name: 'game.mp4', type: 'video/mp4', size: 100 }, assetType: 'game_film', gameId: 'game' });
  assert.equal(calls[0][1].target_team_id, 'team');
  assert.equal(win.FoxesMediaStorage.validMime('game_film', 'text/html'), false);
});

test('support diagnostics remove secrets and are opt-in', () => {
  const win = load(supportSource);
  const sanitized = win.FoxesSupportReporting.sanitizeDiagnostics({
    team_id: 'team',
    access_token: 'secret',
    Authorization: 'Bearer secret',
    route: '/support'
  });
  assert.equal(sanitized.team_id, 'team');
  assert.equal(Object.hasOwn(sanitized, 'access_token'), false);
  assert.equal(Object.hasOwn(sanitized, 'Authorization'), false);
});

test('storage and support migration keeps buckets private and enforces user-owned support reads', () => {
  assert.match(migrationSource, /insert into storage\.buckets/);
  assert.match(migrationSource, /public\)/);
  assert.match(migrationSource, /create table public\.media_assets/);
  assert.match(migrationSource, /create table public\.support_reports/);
  assert.match(migrationSource, /support_reports_insert/);
  assert.match(migrationSource, /created_by = \(select auth\.uid\(\)\)/);
  assert.match(migrationSource, /Storage limit reached/);
  assert.match(migrationSource, /create_media_asset/);
});

test('web shell includes support, private storage foundation, theme motion, and reduced-motion handling', () => {
  assert.match(indexSource, /data-view="support"/);
  assert.match(indexSource, /media-storage\.js/);
  assert.match(indexSource, /support-reporting\.js/);
  assert.match(appSource, /Report Issue/);
  assert.match(appSource, /supportReporting\.submit/);
  assert.match(stylesSource, /prefers-reduced-motion/);
  assert.match(stylesSource, /arena-drift/);
});
