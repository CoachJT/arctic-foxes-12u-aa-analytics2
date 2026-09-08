(function attachEntitlements(global) {
  function normalizeFeatures(value) {
    if (Array.isArray(value)) return new Set(value.filter(item => typeof item === 'string'));
    if (value && typeof value === 'object') {
      return new Set(Object.entries(value).filter(([, enabled]) => enabled === true).map(([key]) => key));
    }
    return new Set();
  }

  function createEntitlements() {
    let plan = null;
    let features = new Set();

    function setWorkspace(workspace) {
      plan = workspace?.plan_id || null;
      features = normalizeFeatures(workspace?.effective_features);
      return getState();
    }

    function clear() {
      plan = null;
      features = new Set();
    }

    function isFeatureEnabled(featureKey) {
      return Boolean(featureKey && features.has(featureKey));
    }

    function getFeatureSet() {
      return new Set(features);
    }

    function getState() {
      return { plan, features: getFeatureSet() };
    }

    return { setWorkspace, clear, isFeatureEnabled, getCurrentPlan: () => plan, getFeatureSet, getState };
  }

  global.FoxesEntitlements = { createEntitlements, normalizeFeatures };
}(window));
