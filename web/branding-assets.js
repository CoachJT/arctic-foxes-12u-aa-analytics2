(function attachBrandingAssets(global) {
  const IMAGE_KEYS = ['hero_image_url', 'welcome_image_url', 'secondary_image_url', 'wordmark_url', 'watermark_url'];
  const FEATURE_KEYS = ['film', 'scouting', 'reports', 'development', 'coaching_tools'];

  function remoteImageUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const url = new URL(value.trim());
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
    } catch {
      return null;
    }
  }

  function safeText(value) {
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, 160) : null;
  }

  function normalize(branding = {}) {
    const settings = branding && typeof branding.settings === 'object' && !Array.isArray(branding.settings)
      ? branding.settings
      : {};
    const featureSource = settings.feature_images && typeof settings.feature_images === 'object' && !Array.isArray(settings.feature_images)
      ? settings.feature_images
      : {};
    const featureImages = Object.fromEntries(FEATURE_KEYS.map(key => [key, remoteImageUrl(featureSource[key])]));
    const assets = Object.fromEntries(IMAGE_KEYS.map(key => [key, remoteImageUrl(settings[key])]));
    return {
      logoUrl: remoteImageUrl(branding.logo_url || branding.logo),
      heroImageUrl: assets.hero_image_url,
      welcomeImageUrl: assets.welcome_image_url,
      secondaryImageUrl: assets.secondary_image_url,
      wordmarkUrl: assets.wordmark_url,
      watermarkUrl: assets.watermark_url,
      tagline: safeText(settings.tagline),
      motto: safeText(settings.motto),
      featureImages
    };
  }

  global.FoxesBrandingAssets = { normalize };
}(window));
