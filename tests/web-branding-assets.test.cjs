const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('web/branding-assets.js', 'utf8');
const appSource = fs.readFileSync('web/app.js', 'utf8');
const indexSource = fs.readFileSync('web/index.html', 'utf8');
const context = { window: {}, URL };
vm.runInNewContext(source, context);
const { normalize } = context.window.FoxesBrandingAssets;

test('branding assets accept trimmed HTTP and HTTPS image URLs', () => {
  const assets = normalize({
    logo_url: ' https://cdn.example/logo.png ',
    settings: {
      hero_image_url: 'https://cdn.example/hero.jpg',
      welcome_image_url: 'http://cdn.example/welcome.jpg',
      feature_images: { film: ' https://cdn.example/film.jpg ' }
    }
  });
  assert.equal(assets.logoUrl, 'https://cdn.example/logo.png');
  assert.equal(assets.heroImageUrl, 'https://cdn.example/hero.jpg');
  assert.equal(assets.welcomeImageUrl, 'http://cdn.example/welcome.jpg');
  assert.equal(assets.featureImages.film, 'https://cdn.example/film.jpg');
});

test('branding assets reject unsafe and malformed URLs', () => {
  const assets = normalize({
    logo_url: 'javascript:alert(1)',
    settings: {
      hero_image_url: 'data:image/png;base64,abc',
      welcome_image_url: 'file:///image.jpg',
      secondary_image_url: 'blob:https://example.test/id',
      wordmark_url: 'not a URL',
      feature_images: { reports: 'javascript:alert(1)' }
    }
  });
  assert.equal(assets.logoUrl, null);
  assert.equal(assets.heroImageUrl, null);
  assert.equal(assets.welcomeImageUrl, null);
  assert.equal(assets.secondaryImageUrl, null);
  assert.equal(assets.wordmarkUrl, null);
  assert.equal(assets.featureImages.reports, null);
});

test('branding assets provide null fallbacks and preserve only safe text', () => {
  const assets = normalize({ settings: { tagline: '  Team first  ', motto: '  Compete together  ' } });
  assert.equal(assets.heroImageUrl, null);
  assert.equal(assets.featureImages.coaching_tools, null);
  assert.equal(assets.tagline, 'Team first');
  assert.equal(assets.motto, 'Compete together');
});

test('Home and Stats use the shared asset model and failed image rendering is hidden', () => {
  assert.match(indexSource, /branding-assets\.js\?v=premium-org-assets-1/);
  assert.match(appSource, /FoxesBrandingAssets\?\.normalize/);
  assert.match(appSource, /event\.target\.hidden = true/);
  assert.match(appSource, /brandingAssets\.heroImageUrl/);
  assert.match(appSource, /brandingAssets\.wordmarkUrl/);
  assert.match(appSource, /brandingAssets\.featureImages/);
});
