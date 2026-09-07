(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./cloud-primary-transition'));
  } else {
    root.FoxesWindowsCloudWrites = factory(root.FoxesCloudPrimary);
  }
})(globalThis, function (cloudPrimary) {
  'use strict';

  const FEATURE_FLAG_KEY = 'foxes-cloud-writes-enabled';
  const WRITABLE_DATASETS = Object.freeze([
    'roster', 'schedule', 'games', 'playerStats', 'teamStats',
    'opponentProfiles', 'opponentPlayers'
  ]);
  const DATASET_DEFINITIONS = Object.freeze({
    roster: { table: 'team_roster_players', conflict: 'team_id,source_player_id', keys: ['team_id', 'source_player_id'] },
    schedule: { table: 'team_schedule_games', conflict: 'team_id,source_schedule_id', keys: ['team_id', 'source_schedule_id'] },
    games: { table: 'team_games', conflict: 'team_id,source_game_id', keys: ['team_id', 'source_game_id'] },
    playerStats: { table: 'team_game_player_stats', conflict: 'team_id,source_game_id,source_player_id,player_type', keys: ['team_id', 'source_game_id', 'source_player_id', 'player_type'] },
    teamStats: { table: 'team_game_team_stats', conflict: 'team_id,source_game_id', keys: ['team_id', 'source_game_id'] },
    opponentProfiles: { table: 'phase2_opponent_profiles', conflict: 'team_id,source_profile_key', keys: ['team_id', 'source_profile_key'] },
    opponentPlayers: { table: 'phase2_opponent_players', conflict: 'team_id,source_player_key,source_game_id', keys: ['team_id', 'source_player_key', 'source_game_id'] }
  });
  const text = value => String(value == null ? '' : value).trim();
  const array = value => Array.isArray(value) ? value : [];
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const storageFor = storage => storage && typeof storage.getItem === 'function' &&
    typeof storage.setItem === 'function' ? storage : cloudPrimary.memoryStorage();

  function enabled(storage) {
    return storageFor(storage).getItem(FEATURE_FLAG_KEY) === 'true';
  }

  function setEnabled(storage, value) {
    storageFor(storage).setItem(FEATURE_FLAG_KEY, value === true ? 'true' : 'false');
    return value === true;
  }

  function sourceId(dataset, row) {
    if (dataset === 'roster') return text(row.source_player_id);
    if (dataset === 'schedule') return text(row.source_schedule_id);
    if (dataset === 'games' || dataset === 'teamStats') return text(row.source_game_id);
    if (dataset === 'playerStats') return `${text(row.source_game_id)}|${text(row.source_player_id)}|${text(row.player_type)}`;
    if (dataset === 'opponentProfiles') return text(row.source_profile_key);
    if (dataset === 'opponentPlayers') return `${text(row.source_player_key)}|${text(row.source_game_id)}`;
    return '';
  }

  function mapOpponentRows(state, teamId) {
    const profiles = array(state?.opponentProfiles).flatMap(row => {
      const key = text(row.source_profile_key);
      const name = text(row.opponent_name || row.name);
      return key && name ? [{ team_id: teamId, source_profile_key: key, opponent_name: name }] : [];
    });
    const players = array(state?.opponentPlayers).flatMap(row => {
      const key = text(row.source_player_key);
      if (!key) return [];
      return [{
        team_id: teamId,
        source_player_key: key,
        source_game_id: text(row.source_game_id) || null,
        opponent_profile_key: text(row.opponent_profile_key) || null,
        jersey_number: text(row.jersey_number || row.number) || null,
        player_name: text(row.player_name || row.name) || null,
        position: text(row.position) || null,
        source_kind: text(row.source_kind) || null
      }];
    });
    return { opponentProfiles: profiles, opponentPlayers: players };
  }

  function mapWritableState({ state = {}, schedule = [], teamId } = {}) {
    if (!text(teamId)) throw new Error('teamId is required for cloud writes.');
    const mapper = globalThis.FoxesSync || (typeof require === 'function' ? require('./supabase-sync') : null);
    if (!mapper || typeof mapper.dryRun !== 'function') throw new Error('The local sync mapper is unavailable.');
    const mapped = mapper.dryRun(state, schedule, teamId).payload;
    const opponents = mapOpponentRows(state, teamId);
    return {
      roster: mapped.roster,
      schedule: mapped.schedule,
      games: mapped.games,
      playerStats: mapped.playerStats,
      teamStats: mapped.teamStats,
      ...opponents
    };
  }

  function rowMatches(item, row) {
    if (!row) return false;
    return DATASET_DEFINITIONS[item.dataset].keys.every(key => text(row[key]) === text(item.payload[key]));
  }

  function createWindowsCloudWrites({
    client,
    storage = globalThis.localStorage,
    teamId,
    queue = cloudPrimary.createSyncQueue({ storage }),
    cache = cloudPrimary.createCloudCache({ storage }),
    retryBaseMs,
    maxRetries
  } = {}) {
    if (!client || typeof client.from !== 'function') throw new Error('An authenticated Supabase client is required.');
    if (!text(teamId)) throw new Error('teamId is required for cloud writes.');
    const backing = storageFor(storage);
    const primary = cloudPrimary.createCloudPrimary({
      client, storage, cache, queue, mode: 'live', allowLiveWrites: true
    });

    function assertEnabled() {
      if (!enabled(backing)) throw new Error('Cloud writes are disabled by feature flag.');
    }

    function enqueueLocal(input = {}) {
      assertEnabled();
      const mapped = mapWritableState({ ...input, teamId });
      const items = [];
      const datasets = Array.isArray(input.datasets) && input.datasets.length
        ? input.datasets.filter(dataset => WRITABLE_DATASETS.includes(dataset))
        : WRITABLE_DATASETS;
      datasets.forEach(dataset => {
        array(mapped[dataset]).forEach(payload => {
          const definition = DATASET_DEFINITIONS[dataset];
          const cached = cache.get(dataset, teamId);
          const current = array(cached?.rows).find(row => rowMatches({ dataset, payload }, row));
          items.push(queue.enqueue({
            teamId,
            dataset,
            sourceId: sourceId(dataset, payload),
            payload,
            baseRevision: current ? cloudPrimary.hash(cloudPrimary.stable(current)) : null
          }));
        });
      });
      return { queued: items.length, items, writes: 0, deletes: 0, mode: 'live' };
    }

    function enqueueRoster(input = {}) {
      return enqueueLocal({ ...input, datasets: ['roster'] });
    }

    function enqueueDatasets(input = {}, datasets = WRITABLE_DATASETS) {
      return enqueueLocal({ ...input, datasets });
    }

    async function writeBoundary(item) {
      assertEnabled();
      const definition = DATASET_DEFINITIONS[item.dataset];
      if (!definition || !WRITABLE_DATASETS.includes(item.dataset)) {
        throw new Error(`Dataset is not enabled for cloud writes: ${item.dataset}`);
      }
      if (text(item.payload?.team_id) !== text(teamId)) throw new Error('Cross-team cloud write rejected.');
      let query = client.from(definition.table).select('*');
      definition.keys.forEach(key => { query = query.eq(key, item.payload[key]); });
      const currentResult = await query.maybeSingle();
      if (currentResult?.error && currentResult.error.code !== 'PGRST116') throw currentResult.error;
      const current = currentResult?.data || null;
      if (item.baseRevision && current) {
        const currentRevision = cloudPrimary.hash(cloudPrimary.stable(current));
        if (currentRevision !== item.baseRevision) {
          return { conflict: true, currentRevision, reason: 'Cloud row changed after local edit was queued.' };
        }
      }
      const result = await client.from(definition.table).upsert(item.payload, { onConflict: definition.conflict });
      if (result?.error) throw result.error;
      const cached = cache.get(item.dataset, teamId);
      const rows = array(cached?.rows).filter(row => !rowMatches({ dataset: item.dataset, payload: item.payload }, row));
      rows.push(clone(item.payload));
      cache.set(item.dataset, teamId, rows, { source: 'cloud-write' });
      return { status: 'completed' };
    }

    async function flush(options = {}) {
      assertEnabled();
      return queue.process({
        retryBaseMs,
        maxRetries,
        ...options,
        executor: writeBoundary
      });
    }

    return {
      featureFlag: FEATURE_FLAG_KEY,
      writableDatasets: WRITABLE_DATASETS,
      enabled: () => enabled(backing),
      setEnabled: value => setEnabled(backing, value),
      mapWritableState,
      enqueueLocal,
      enqueueRoster,
      enqueueDatasets,
      flush,
      queue,
      cache,
      primary
    };
  }

  return {
    FEATURE_FLAG_KEY,
    WRITABLE_DATASETS,
    DATASET_DEFINITIONS,
    enabled,
    setEnabled,
    mapWritableState,
    createWindowsCloudWrites
  };
});
