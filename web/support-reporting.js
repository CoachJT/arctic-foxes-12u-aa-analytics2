(function attachSupportReporting(global) {
  const recentErrors = [];
  const MAX_ERRORS = 20;

  function sanitizeDiagnostics(input = {}) {
    const forbidden = /token|password|secret|cookie|authorization|session|invite/i;
    const output = {};
    Object.entries(input || {}).forEach(([key, value]) => {
      if (forbidden.test(key)) return;
      if (typeof value === 'string') output[key] = value.slice(0, 500);
      else if (typeof value === 'number' || typeof value === 'boolean' || value === null) output[key] = value;
    });
    return output;
  }

  function recordError(error, context = {}) {
    const item = sanitizeDiagnostics({
      message: error?.message || String(error || 'Unknown error'),
      code: error?.code || '',
      operation: context.operation || '',
      route: context.route || location.pathname,
      timestamp: new Date().toISOString()
    });
    recentErrors.push(item);
    if (recentErrors.length > MAX_ERRORS) recentErrors.shift();
    return item;
  }

  function createSupportReporting({ client, getWorkspace, getUser, appVersion = 'web-local' }) {
    async function submit({ reportType, subject, description, includeDiagnostics = false, screenshotAssetId = null, pageRoute = location.pathname, browser = navigator.userAgent }) {
      if (!['bug', 'feature_request', 'question'].includes(reportType)) throw new Error('Choose a valid report type.');
      if (!String(subject || '').trim() || !String(description || '').trim()) throw new Error('Subject and description are required.');
      const workspace = getWorkspace?.() || {};
      const diagnostics = includeDiagnostics ? sanitizeDiagnostics({
        organization_id: workspace.organization_id,
        team_id: workspace.team_id,
        season_id: workspace.season_id,
        role: workspace.role_label,
        plan: workspace.plan_id,
        features: Array.isArray(workspace.effective_features) ? workspace.effective_features.join(',') : '',
        recent_errors: JSON.stringify(recentErrors),
        timestamp: new Date().toISOString()
      }) : null;
      const { data, error } = await client.from('support_reports').insert({
        organization_id: workspace.organization_id || null,
        team_id: workspace.team_id || null,
        season_id: workspace.season_id || null,
        report_type: reportType,
        subject: String(subject).trim().slice(0, 200),
        description: String(description).trim().slice(0, 10000),
        page_route: String(pageRoute || '').slice(0, 300),
        app_version: appVersion,
        browser_name: browser.slice(0, 200),
        device_type: /Mobi|Android/i.test(browser) ? 'mobile' : 'desktop',
        diagnostics,
        screenshot_asset_id: screenshotAssetId
      }).select('id').maybeSingle();
      if (error) throw new Error(error.message || 'Support report could not be saved.');
      return { id: data?.id || '' };
    }

    return { submit, sanitizeDiagnostics, recentErrors, getUser };
  }

  global.FoxesSupportReporting = { createSupportReporting, sanitizeDiagnostics, recordError, recentErrors };
}(window));
