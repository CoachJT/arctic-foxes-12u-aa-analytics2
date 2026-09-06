(function attachSeasonContext(global) {
  const FALLBACK_BRANDING = {
    display_name: 'Arctic Foxes 12U AA',
    short_name: 'AF 12U AA',
    primary_color: '#d71920',
    secondary_color: '#0d0e10',
    accent_color: '#f2f3f4'
  };

  function createSeasonContext({ client, storage = global.sessionStorage }) {
    const context = {
      seasons: [],
      selectedSeasonId: '',
      selectedSeason: null,
      branding: { ...FALLBACK_BRANDING },
      loading: false,
      error: ''
    };

    function applyBranding(branding) {
      const resolved = { ...FALLBACK_BRANDING, ...(branding || {}) };
      const root = global.document.documentElement;
      root.style.setProperty('--red', resolved.primary_color);
      root.style.setProperty('--bg', resolved.secondary_color);
      root.style.setProperty('--ice', resolved.accent_color);
      root.style.setProperty('--brand-primary', resolved.primary_color);
      root.style.setProperty('--brand-secondary', resolved.secondary_color);
      root.style.setProperty('--brand-accent', resolved.accent_color);
      context.branding = resolved;
      return resolved;
    }

    function chooseSeason(seasons, defaultSeasonId) {
      const rememberedId = storage?.getItem('foxes-selected-season-id');
      return seasons.find(season => season.id === rememberedId)
        || seasons.find(season => season.id === defaultSeasonId)
        || seasons.find(season => season.status === 'active')
        || seasons[0]
        || null;
    }

    async function load(teamId, defaultSeasonId = '') {
      context.loading = true;
      context.error = '';
      context.seasons = [];
      context.selectedSeasonId = '';
      context.selectedSeason = null;
      applyBranding(null);
      const [{ data: seasons, error: seasonsError }, { data: branding, error: brandingError }] = await Promise.all([
        client.from('seasons').select('id,team_id,name,season_key,status,starts_on,ends_on').eq('team_id', teamId).order('starts_on', { ascending: false, nullsFirst: false }),
        client.from('team_branding').select('team_id,display_name,short_name,logo_url,primary_color,secondary_color,accent_color,settings').eq('team_id', teamId).maybeSingle()
      ]);
      if (seasonsError || brandingError) {
        context.loading = false;
        context.error = seasonsError?.message || brandingError?.message || 'Team context could not be loaded.';
        throw new Error(context.error);
      }
      context.seasons = seasons || [];
      const selected = chooseSeason(context.seasons, defaultSeasonId);
      context.selectedSeasonId = selected?.id || '';
      context.selectedSeason = selected;
      if (selected) storage?.setItem('foxes-selected-season-id', selected.id);
      applyBranding(branding);
      context.loading = false;
      return context;
    }

    function select(seasonId) {
      const season = context.seasons.find(item => item.id === seasonId);
      if (!season) throw new Error('That season does not belong to the selected team.');
      context.selectedSeasonId = season.id;
      context.selectedSeason = season;
      storage?.setItem('foxes-selected-season-id', season.id);
      return season;
    }

    function applyFallbackBranding() {
      applyBranding(null);
    }

    return { context, load, select, applyFallbackBranding, FALLBACK_BRANDING };
  }

  global.FoxesSeasonContext = { createSeasonContext, FALLBACK_BRANDING };
}(window));
