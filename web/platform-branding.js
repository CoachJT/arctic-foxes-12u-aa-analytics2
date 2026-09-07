(function attachPlatformBranding(global) {
  const PLATFORM = Object.freeze({
    name: 'PuckNexus',
    tagline: 'The Connected Hockey Platform'
  });

  function applyDocumentBrand() {
    global.document.title = `${PLATFORM.name} | ${PLATFORM.tagline}`;
  }

  global.FoxesPlatformBranding = { PLATFORM, applyDocumentBrand };
}(window));
