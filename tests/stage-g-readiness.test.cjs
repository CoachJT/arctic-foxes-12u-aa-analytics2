const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Stage G storage correction requires authorized workspace access for reads', () => {
  const migration = read('supabase/migrations/013_stage_g_storage_isolation.sql');
  assert.match(migration, /can_access_team_season/);
  assert.match(migration, /has_workspace_feature_access/);
  assert.match(migration, /drop policy if exists storage_objects_select_private_media/i);
});

test('Stage G storage and support migrations keep anonymous access denied', () => {
  const migration = read('supabase/migrations/013_stage_g_storage_isolation.sql');
  assert.match(migration, /has_table_privilege\('anon', 'storage\.objects', 'select'\)/);
  assert.match(migration, /revoke all on function public\.validate_support_report_scope\(\) from public, anon, authenticated/i);
});

test('Pages deployment remains the only web deployment workflow and does not package Electron', () => {
  const workflow = read('.github/workflows/deploy-web-pages.yml');
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /path: web/);
  assert.doesNotMatch(workflow, /electron-builder|npm run dist|main\.js/);
});
