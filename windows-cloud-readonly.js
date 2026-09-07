(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./cloud-primary-transition'));
  else root.FoxesWindowsCloudReadonly = factory(root.FoxesCloudPrimary);
})(globalThis, function (cloudPrimary) {
  'use strict';

  const SUPABASE_URL = 'https://yshbvrumzusmwlprfcnr.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_PFK2d1or62DYpk3VxarJwA_Anazyv7D';
  const TEAM_KEY = 'foxes-cloud-selected-team-id';
  const SEASON_KEY = 'foxes-cloud-selected-season-id';
  const DATASETS = Object.freeze([
    'roster', 'schedule', 'games', 'playerStats', 'teamStats',
    'seasonRecord', 'opponentProfiles', 'opponentPlayers'
  ]);
  const DATASET_SOURCE = Object.freeze({
    roster: row => row.source_player_id,
    schedule: row => row.source_schedule_id,
    games: row => row.source_game_id,
    playerStats: row => `${row.source_game_id}|${row.source_player_id}|${row.player_type || ''}`,
    teamStats: row => row.source_game_id,
    seasonRecord: row => row.season_key,
    opponentProfiles: row => row.source_profile_key,
    opponentPlayers: row => `${row.source_player_key}|${row.source_game_id || ''}`
  });

  const text = value => String(value == null ? '' : value).trim();
  const array = value => Array.isArray(value) ? value : [];
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

  function sourceIds(dataset, rows) {
    const key = DATASET_SOURCE[dataset];
    return array(rows).map(row => text(key?.(row))).filter(Boolean);
  }

  function localRows(dataset, state, schedule) {
    const players = array(state?.players);
    const games = array(state?.savedGames);
    if (dataset === 'roster') return players.map(player => ({
      source_player_id: player.id, jersey_number: player.number, name: player.name, position: player.pos
    }));
    if (dataset === 'schedule') return array(schedule).map(entry => ({ source_schedule_id: entry.id }));
    if (dataset === 'games') return games.map(game => ({ source_game_id: game.id }));
    if (dataset === 'playerStats') {
      return games.flatMap(game => ['skaters', 'goalies'].flatMap(group => {
        const rows = game.officialStats?.[group];
        if (Array.isArray(rows)) return rows.map(row => ({ ...row, source_game_id: game.id, player_type: group === 'goalies' ? 'goalie' : 'skater', source_player_id: row.playerId || row.id || row.number }));
        return Object.entries(rows || {}).map(([number, row]) => ({ ...row, number, source_game_id: game.id, player_type: group === 'goalies' ? 'goalie' : 'skater', source_player_id: row?.playerId || row?.id || number }));
      }));
    }
    if (dataset === 'teamStats') return games.flatMap(game => game.officialStats?.team ? [{ source_game_id: game.id }] : []);
    if (dataset === 'seasonRecord') return state?.seasonKey ? [{ season_key: state.seasonKey }] : [];
    if (dataset === 'opponentProfiles') return array(state?.opponentProfiles);
    if (dataset === 'opponentPlayers') return array(state?.opponentPlayers);
    return [];
  }

  function diagnosticReport({ state = {}, schedule = [], datasets = {}, seasonKey = '' } = {}) {
    const counts = {};
    const mismatches = [];
    DATASETS.forEach(dataset => {
      let cloudRows = array(datasets[dataset]);
      if (dataset === 'seasonRecord' && seasonKey) {
        cloudRows = cloudRows.filter(row => text(row.season_key) === text(seasonKey));
      }
      const local = localRows(dataset, state, schedule);
      const cloudIds = sourceIds(dataset, cloudRows);
      const localIds = sourceIds(dataset, local);
      const cloudSet = new Set(cloudIds);
      const localSet = new Set(localIds);
      const cloudOnly = cloudIds.filter(id => !localSet.has(id));
      const localOnly = localIds.filter(id => !cloudSet.has(id));
      const shared = cloudIds.filter(id => localSet.has(id));
      counts[dataset] = {
        cloud: cloudIds.length,
        local: localIds.length,
        shared: shared.length,
        cloudOnly: cloudOnly.length,
        localOnly: localOnly.length
      };
      if (cloudOnly.length || localOnly.length) {
        mismatches.push({ dataset, cloudOnly, localOnly });
      }
    });
    return { counts, mismatches, hasMismatch: mismatches.length > 0 };
  }

  function dateInSeason(value, season) {
    const date = text(value);
    if (!date) return true;
    const start = text(season?.starts_on);
    const end = text(season?.ends_on);
    return (!start || date >= start) && (!end || date <= end);
  }

  function scopeDatasets(datasets, season) {
    const output = { ...datasets };
    const games = array(output.games).filter(row => dateInSeason(row.date, season));
    const schedules = array(output.schedule).filter(row => dateInSeason(row.date, season));
    const gameIds = new Set(games.map(row => text(row.source_game_id)).filter(Boolean));
    output.games = games;
    output.schedule = schedules;
    output.playerStats = array(output.playerStats).filter(row => gameIds.has(text(row.source_game_id)));
    output.teamStats = array(output.teamStats).filter(row => gameIds.has(text(row.source_game_id)));
    output.opponentPlayers = array(output.opponentPlayers).filter(row => !text(row.source_game_id) || gameIds.has(text(row.source_game_id)));
    output.seasonRecord = array(output.seasonRecord).filter(row => !season?.season_key || text(row.season_key) === text(season.season_key));
    return output;
  }

  function chooseMembership(memberships, storage, preferredTeamSlug = 'arctic-foxes-12u-aa') {
    const remembered = text(storage?.getItem(TEAM_KEY));
    return array(memberships).find(item => text(item.team_id) === remembered)
      || array(memberships).find(item => text(item.teams?.slug) === preferredTeamSlug)
      || array(memberships)[0]
      || null;
  }

  function chooseSeason(seasons, membership, storage) {
    const remembered = text(storage?.getItem(SEASON_KEY));
    return array(seasons).find(item => text(item.id) === remembered)
      || array(seasons).find(item => text(item.id) === text(membership?.teams?.default_season_id))
      || array(seasons).find(item => text(item.status).toLowerCase() === 'active')
      || array(seasons)[0]
      || null;
  }

  function createWindowsCloudReadonly({
    client = null,
    supabase = null,
    storage = globalThis.localStorage,
    preferredTeamSlug = 'arctic-foxes-12u-aa'
  } = {}) {
    const authClient = client || supabase?.createClient?.(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    if (!authClient) throw new Error('A public Supabase client is required.');
    const primary = cloudPrimary.createCloudPrimary({
      client: authClient, storage, mode: 'read-only', allowLiveWrites: false
    });
    const context = {
      session: null, user: null, memberships: [], selectedMembership: null,
      seasons: [], selectedSeason: null, capabilities: [], pending: null
    };

    async function loadContext(session = null) {
      const activeSession = session || (await authClient.auth.getSession()).data?.session;
      if (!activeSession?.user) throw new Error('Sign in to load the PuckNexus team context.');
      const { data: memberships, error: membershipError } = await authClient
        .from('team_memberships')
        .select('team_id,role_id,status,teams(id,name,slug,organization_id,default_season_id),roles(label)')
        .eq('user_id', activeSession.user.id)
        .eq('status', 'active');
      if (membershipError) throw membershipError;
      const selectedMembership = chooseMembership(memberships, storage, preferredTeamSlug);
      if (!selectedMembership) throw new Error('Your account has no active team membership.');
      const { data: seasons, error: seasonError } = await authClient
        .from('seasons')
        .select('id,team_id,name,season_key,status,starts_on,ends_on')
        .eq('team_id', selectedMembership.team_id)
        .order('starts_on', { ascending: false, nullsFirst: false });
      if (seasonError) throw seasonError;
      const selectedSeason = chooseSeason(seasons, selectedMembership, storage);
      const { data: permissions, error: permissionError } = await authClient
        .from('role_permissions')
        .select('capability')
        .eq('role_id', selectedMembership.role_id);
      if (permissionError) throw permissionError;
      context.session = activeSession;
      context.user = activeSession.user;
      context.memberships = array(memberships);
      context.selectedMembership = selectedMembership;
      context.seasons = array(seasons);
      context.selectedSeason = selectedSeason;
      context.capabilities = array(permissions).map(permission => permission.capability).filter(Boolean);
      storage?.setItem(TEAM_KEY, selectedMembership.team_id);
      if (selectedSeason) storage?.setItem(SEASON_KEY, selectedSeason.id);
      return clone(context);
    }

    async function selectTeam(teamId) {
      const membership = context.memberships.find(item => text(item.team_id) === text(teamId));
      if (!membership) throw new Error('That team is not an active membership.');
      storage?.setItem(TEAM_KEY, membership.team_id);
      return loadContext(context.session);
    }

    async function selectSeason(seasonId) {
      const season = context.seasons.find(item => text(item.id) === text(seasonId));
      if (!season) throw new Error('That season does not belong to the selected team.');
      storage?.setItem(SEASON_KEY, season.id);
      context.selectedSeason = season;
      return clone(context);
    }

    async function signIn(email, password) {
      const result = await authClient.auth.signInWithPassword({ email: text(email), password });
      if (result.error) throw result.error;
      return loadContext(result.data?.session);
    }

    async function signOut() {
      const result = await authClient.auth.signOut();
      if (result?.error) throw result.error;
      context.session = null;
      context.user = null;
      context.pending = null;
      return clone(context);
    }

    async function prepareBootstrap({ state = {}, schedule = [], refresh = true } = {}) {
      if (!context.selectedMembership || !context.selectedSeason) throw new Error('Select an authenticated team and season first.');
      const teamId = context.selectedMembership.team_id;
      const selectedState = { ...clone(state), seasonKey: context.selectedSeason.season_key };
      const raw = await primary.bootstrap({ teamId, state: selectedState, schedule, refresh });
      const datasets = scopeDatasets(raw.datasets, context.selectedSeason);
      const result = cloudPrimary.materialize({
        state: selectedState, schedule, datasets
      });
      const diagnostic = diagnosticReport({
        state, schedule, datasets, seasonKey: context.selectedSeason.season_key
      });
      context.pending = {
        teamId, seasonId: context.selectedSeason.id, seasonKey: context.selectedSeason.season_key,
        result: { ...raw, ...result, datasets, mode: 'read-only', writes: 0, deletes: 0 },
        diagnostic
      };
      return clone(context.pending);
    }

    function confirmBootstrap(confirmed = false) {
      if (!confirmed) throw new Error('Explicit confirmation is required before changing active state.');
      if (!context.pending) throw new Error('Run the read-only cloud diagnostic before confirming.');
      const pending = context.pending;
      context.pending = null;
      return clone(pending);
    }

    return {
      constants: { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, TEAM_KEY, SEASON_KEY },
      client: authClient, primary, context, loadContext, selectTeam, selectSeason,
      signIn, signOut, prepareBootstrap, confirmBootstrap, diagnosticReport, scopeDatasets
    };
  }

  return {
    SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, DATASETS, diagnosticReport, scopeDatasets,
    chooseMembership, chooseSeason, createWindowsCloudReadonly
  };
});
