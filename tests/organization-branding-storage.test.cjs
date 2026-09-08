const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('web/organization-branding-storage.js', 'utf8');
const context = { window: {}, URL };
vm.runInNewContext(source, context);
const storage = context.window.FoxesOrganizationBrandingStorage;
const ORG = '2570ad07-af6b-44c0-92aa-25ea45697e5e';
const ASSET = 'a570ad07-af6b-44c0-92aa-25ea45697e5e';
const TEAM = '3570ad07-af6b-44c0-92aa-25ea45697e5e';

test('organization branding validates allowed images and rejects unsafe uploads', () => {
  const validImage = storage.validateImageFile({ type: 'image/png', size: 1024 });
  assert.equal(validImage.mimeType, 'image/png');
  assert.equal(validImage.extension, 'png');
  assert.equal(validImage.sizeBytes, 1024);
  assert.throws(() => storage.validateImageFile({ type: 'image/svg+xml', size: 100 }), /PNG, JPEG, or WebP/);
  assert.throws(() => storage.validateImageFile({ type: 'text/html', size: 100 }), /PNG, JPEG, or WebP/);
  assert.throws(() => storage.validateImageFile({ type: 'image/jpeg', size: (10 * 1024 * 1024) + 1 }), /10 MB/);
});

test('organization branding paths are tenant scoped and do not trust filenames', () => {
  assert.equal(storage.brandingObjectPath({ organizationId: ORG, assetId: ASSET, assetKey: 'hero', extension: 'jpg' }), `organizations/${ORG}/hero/${ASSET}.jpg`);
  assert.throws(() => storage.brandingObjectPath({ organizationId: '../other', assetId: ASSET, assetKey: 'hero', extension: 'jpg' }), /organization ID/);
  assert.throws(() => storage.brandingObjectPath({ organizationId: ORG, assetId: ASSET, assetKey: 'unknown', extension: 'jpg' }), /Unsupported branding asset key/);
});

test('organization branding settings merges preserve unrelated settings', () => {
  const merged = storage.mergeBrandingSettings(
    { font: 'default', theme: 'arctic-foxes', retained: { enabled: true }, feature_images: { film: 'https://cdn.example/old-film.jpg' } },
    { hero: 'https://cdn.example/hero.jpg', wordmark: 'https://cdn.example/wordmark.png', watermark: 'https://cdn.example/watermark.png', film: 'https://cdn.example/film.jpg', tagline: '  Arctic Foxes Hockey  ' }
  );
  assert.equal(merged.font, 'default');
  assert.equal(merged.theme, 'arctic-foxes');
  assert.deepEqual(merged.retained, { enabled: true });
  assert.equal(merged.hero_image_url, 'https://cdn.example/hero.jpg');
  assert.equal(merged.wordmark_url, 'https://cdn.example/wordmark.png');
  assert.equal(merged.watermark_url, 'https://cdn.example/watermark.png');
  assert.equal(merged.feature_images.film, 'https://cdn.example/film.jpg');
  assert.equal(merged.tagline, 'Arctic Foxes Hockey');
});

test('organization branding rejects non-stable URLs and returns public HTTPS URLs', () => {
  for (const url of ['javascript:alert(1)', 'data:image/png;base64,x', 'blob:https://example.test/x', 'file:///asset.png', 'not a url']) {
    assert.equal(storage.safeImageUrl(url), null);
  }
  const client = { storage: { from: bucket => ({ getPublicUrl: path => ({ data: { publicUrl: `https://project.supabase.co/storage/v1/object/public/${bucket}/${path}` } }) }) } };
  assert.equal(storage.stablePublicUrl(client, 'organizations/org/hero/asset.jpg'), 'https://project.supabase.co/storage/v1/object/public/organization-branding/organizations/org/hero/asset.jpg');
});

test('organization branding helpers require an authorized workspace before writes', async () => {
  const manager = storage.createOrganizationBrandingStorage({ client: {}, getWorkspace: () => ({ authorized: false }) });
  await assert.rejects(manager.deleteAsset(ASSET), /authorized workspace/);
});

test('organization branding uploads and deletes use only the resolved workspace and server RPCs', async () => {
  const calls = [];
  const client = {
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'prepare_organization_branding_asset') return { data: [{ asset_id: ASSET, bucket_name: 'organization-branding', object_path: `organizations/${ORG}/hero/${ASSET}.jpg` }], error: null };
      return { data: true, error: null };
    },
    storage: { from: () => ({
      upload: async () => ({ error: null }),
      getPublicUrl: path => ({ data: { publicUrl: `https://project.supabase.co/storage/v1/object/public/organization-branding/${path}` } })
    }) }
  };
  const manager = storage.createOrganizationBrandingStorage({
    client,
    getWorkspace: () => ({ authorized: true, organization_id: ORG, team_id: TEAM })
  });
  await manager.uploadAsset({ assetKey: 'hero', file: { type: 'image/jpeg', size: 100 } });
  await manager.deleteAsset(ASSET);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ['prepare_organization_branding_asset', {
    target_organization_id: ORG, target_team_id: TEAM, requested_asset_key: 'hero', requested_mime_type: 'image/jpeg', requested_size_bytes: 100
  }]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1])), ['finalize_organization_branding_asset', {
    target_asset_id: ASSET
  }]);
  assert.ok(!('public_url' in calls[1][1]), 'finalize must not send a client-computed public URL');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[2])), ['delete_organization_branding_asset', {
    target_organization_id: ORG, target_team_id: TEAM, target_asset_id: ASSET
  }]);
});

test('organization branding settings merge tolerates a malformed existing feature_images value', () => {
  for (const malformed of [['not', 'an', 'object'], 'a string', 42, null]) {
    const merged = storage.mergeBrandingSettings(
      { font: 'default', feature_images: malformed },
      { film: 'https://cdn.example/film.jpg' }
    );
    assert.deepEqual(JSON.parse(JSON.stringify(merged.feature_images)), { film: 'https://cdn.example/film.jpg' });
    assert.equal(merged.font, 'default');
  }
});

test('organization branding settings merge drops a feature image when the value is unsafe', () => {
  const merged = storage.mergeBrandingSettings(
    { feature_images: { film: 'https://cdn.example/old-film.jpg' } },
    { film: 'javascript:alert(1)' }
  );
  assert.equal(merged.feature_images.film, undefined);
});
