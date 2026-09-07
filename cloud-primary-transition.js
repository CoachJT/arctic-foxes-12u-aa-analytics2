(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(globalThis);
  else root.FoxesCloudPrimary = factory(root);
})(globalThis, function (root) {
  'use strict';

  const DATASETS = Object.freeze({
    roster: { table: 'team_roster_players', sourceId: 'source_player_id' },
    schedule: { table: 'team_schedule_games', sourceId: 'source_schedule_id' },
    games: { table: 'team_games', sourceId: 'source_game_id' },
    playerStats: { table: 'team_game_player_stats', sourceId: 'source_player_id' },
    teamStats: { table: 'team_game_team_stats', sourceId: 'source_game_id' },
    seasonRecord: { table: 'team_season_records', sourceId: 'season_key' },
    opponentProfiles: { table: 'phase2_opponent_profiles', sourceId: 'source_profile_key' },
    opponentPlayers: { table: 'phase2_opponent_players', sourceId: 'source_player_key' }
  });
  const DATASET_ALIASES = { officialPlayerStats: 'playerStats', officialTeamStats: 'teamStats' };
  const ALL_DATASETS = Object.keys(DATASETS);
  const SKATER_FIELDS = {
    gp: 'gp', goals: 'g', assists: 'a', shots: 'shots', penalty_minutes: 'pim',
    plus_minus: 'plusMinus', blocks: 'blocks', faceoff_wins: 'fow', faceoff_losses: 'fol',
    faceoff_attempts: 'fo', power_play_goals: 'ppg', power_play_assists: 'ppa',
    power_play_points: 'ppp', short_handed_goals: 'shg', short_handed_assists: 'sha',
    short_handed_points: 'shp', game_winning_goals: 'gwg', game_tying_goals: 'gtg',
    takeaways: 'tk', giveaways: 'gv', chances: 'ch', toi_minutes: 'toiMin'
  };
  const GOALIE_FIELDS = {
    gp: 'gp', minutes: 'min', saves: 'saves', goals_against: 'ga',
    wins: 'w', losses: 'l', ties: 't', shutouts: 'so'
  };
  const TEAM_FIELDS = {
    power_play_chances: 'ppChances', power_play_success: 'ppSuccess',
    penalty_kill_chances: 'pkChances', penalty_kill_success: 'pkSuccess',
    faceoff_wins: 'fow', faceoff_losses: 'fol'
  };

  const text = value => String(value == null ? '' : value).trim();
  const array = value => Array.isArray(value) ? value : [];
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const finite = value => value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  const normalizeDataset = dataset => DATASET_ALIASES[dataset] || dataset;

  function stable(value) {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  function hash(value) {
    let result = 2166136261;
    for (const char of String(value)) {
      result ^= char.charCodeAt(0);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(16).padStart(8, '0');
  }

  function requireTeam(teamId) {
    const value = text(teamId);
    if (!value) throw new Error('teamId is required for a team-scoped cloud operation.');
    return value;
  }

  function requireDataset(dataset) {
    const value = normalizeDataset(dataset);
    if (!DATASETS[value]) throw new Error(`Unknown cloud dataset: ${dataset}`);
    return value;
  }

  function memoryStorage(initial) {
    const values = new Map(Object.entries(initial || {}));
    return {
      getItem: key => values.has(key) ? values.get(key) : null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: key => values.delete(key)
    };
  }

  function storageFor(storage) {
    if (storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function') return storage;
    return memoryStorage();
  }

  function cacheKey(prefix, dataset, teamId) {
    return `${prefix}:${encodeURIComponent(requireTeam(teamId))}:${requireDataset(dataset)}`;
  }

  function createCloudCache({ storage = root.localStorage, keyPrefix = 'foxes-cloud-cache-v1' } = {}) {
    const backing = storageFor(storage);
    function get(dataset, teamId) {
      const key = cacheKey(keyPrefix, dataset, teamId);
      try {
        const parsed = JSON.parse(backing.getItem(key) || 'null');
        return parsed && parsed.version === 1 ? parsed : null;
      } catch {
        return null;
      }
    }
    function set(dataset, teamId, rows, metadata = {}) {
      const normalized = requireDataset(dataset);
      const team = requireTeam(teamId);
      const entry = {
        version: 1,
        dataset: normalized,
        teamId: team,
        rows: clone(array(rows)),
        revision: text(metadata.revision) || hash(stable(rows)),
        updatedAt: metadata.updatedAt || new Date().toISOString(),
        source: text(metadata.source) || 'cloud-read'
      };
      backing.setItem(cacheKey(keyPrefix, normalized, team), JSON.stringify(entry));
      return clone(entry);
    }
    function remove(dataset, teamId) {
      backing.removeItem(cacheKey(keyPrefix, dataset, teamId));
    }
    function clear(teamId) {
      const team = requireTeam(teamId);
      ALL_DATASETS.forEach(dataset => remove(dataset, team));
    }
    return {
      get, set, remove, clear,
      read: get, write: set,
      storage: backing, keyPrefix
    };
  }

  function createSyncQueue({
    storage = root.localStorage,
    key = 'foxes-cloud-sync-queue-v1',
    clock = () => Date.now(),
    retryBaseMs = 1000,
    maxRetries = 5
  } = {}) {
    const backing = storageFor(storage);
    const read = () => {
      try {
        const parsed = JSON.parse(backing.getItem(key) || '{"version":1,"items":[]}');
        return parsed && parsed.version === 1 && Array.isArray(parsed.items) ? parsed.items : [];
      } catch {
        return [];
      }
    };
    const write = items => backing.setItem(key, JSON.stringify({ version: 1, items }));
    const idFor = input => text(input.id) || hash(stable({
      teamId: input.teamId, dataset: normalizeDataset(input.dataset),
      sourceId: input.sourceId, payload: input.payload
    }));
    const assertItemScope = item => {
      const team = requireTeam(item.teamId);
      if (item.payload && typeof item.payload === 'object') {
        const payloadTeam = item.payload.team_id || item.payload.teamId;
        if (payloadTeam && text(payloadTeam) !== team) throw new Error('Cross-team cloud queue item rejected.');
      }
      return team;
    };
    function list() { return clone(read()); }
    function enqueue(input = {}) {
      const dataset = requireDataset(input.dataset);
      const teamId = requireTeam(input.teamId);
      const item = {
        version: 1,
        id: idFor({ ...input, dataset, teamId }),
        teamId,
        dataset,
        operation: text(input.operation) || 'upsert',
        sourceId: text(input.sourceId) || null,
        payload: clone(input.payload),
        baseRevision: text(input.baseRevision) || null,
        attempts: 0,
        status: 'pending',
        nextAttemptAt: Number(input.nextAttemptAt || 0),
        lastError: null,
        conflict: null,
        createdAt: input.createdAt || clock(),
        updatedAt: clock()
      };
      assertItemScope(item);
      const items = read().filter(existing => existing.id !== item.id);
      items.push(item);
      write(items);
      return clone(item);
    }
    function update(id, patch) {
      const items = read();
      const index = items.findIndex(item => item.id === id);
      if (index < 0) return null;
      const next = { ...items[index], ...clone(patch), updatedAt: clock() };
      assertItemScope(next);
      items[index] = next;
      write(items);
      return clone(next);
    }
    function remove(id) {
      const items = read().filter(item => item.id !== id);
      write(items);
    }
    function clear() { write([]); }
    function detectConflict(item, currentRevision) {
      const current = text(currentRevision);
      return !!(item && item.baseRevision && current && item.baseRevision !== current);
    }
    async function process(options, maybeOptions) {
      const config = typeof options === 'function'
        ? { executor: options, ...(maybeOptions || {}) }
        : (options || {});
      if (typeof config.executor !== 'function') throw new Error('A queue executor is required.');
      const now = Number(config.now == null ? clock() : config.now);
      const limit = Number.isFinite(config.limit) ? config.limit : Infinity;
      const conflictDetector = config.conflictDetector;
      const summary = { attempted: 0, completed: 0, retried: 0, conflicts: 0, failed: 0, skipped: 0 };
      for (const item of read()) {
        if (summary.attempted >= limit) break;
        if (item.status !== 'pending' || Number(item.nextAttemptAt || 0) > now) {
          summary.skipped += 1;
          continue;
        }
        summary.attempted += 1;
        try {
          assertItemScope(item);
          const conflict = typeof conflictDetector === 'function' ? await conflictDetector(clone(item)) : null;
          if (conflict) {
            update(item.id, { status: 'conflict', conflict: clone(conflict), nextAttemptAt: null });
            summary.conflicts += 1;
            continue;
          }
          const result = await config.executor(clone(item));
          if (result && (result.conflict || result.status === 'conflict' ||
            (result.currentRevision && detectConflict(item, result.currentRevision)))) {
            update(item.id, { status: 'conflict', conflict: clone(result), nextAttemptAt: null });
            summary.conflicts += 1;
            continue;
          }
          remove(item.id);
          summary.completed += 1;
        } catch (error) {
          const current = read().find(candidate => candidate.id === item.id);
          const attempts = Number(current?.attempts || item.attempts || 0) + 1;
          const exhausted = attempts >= maxRetries;
          update(item.id, {
            attempts,
            status: exhausted ? 'failed' : 'pending',
            nextAttemptAt: exhausted ? null : now + retryBaseMs * (2 ** (attempts - 1)),
            lastError: String(error?.message || error)
          });
          if (exhausted) summary.failed += 1;
          else summary.retried += 1;
        }
      }
      return summary;
    }
    return {
      list, enqueue, update, remove, clear, process, detectConflict,
      pending: list, storage: backing, key
    };
  }

  function rowMap(rows, keyFn) {
    const map = new Map();
    array(rows).forEach(row => {
      const key = keyFn(row);
      if (key) map.set(key, row);
    });
    return map;
  }

  function mergeRoster(state, rows) {
    const players = array(state.players).map(clone);
    array(rows).forEach(row => {
      const id = text(row.source_player_id);
      const number = text(row.jersey_number);
      if (!id && !number) return;
      const index = players.findIndex(player => (id && text(player.id) === id) ||
        (number && text(player.number) === number));
      const existing = index >= 0 ? players[index] : {};
      const merged = {
        ...existing,
        ...(id ? { id } : {}),
        ...(number ? { number } : {}),
        ...(text(row.name) ? { name: row.name } : {}),
        ...(text(row.position) ? { pos: row.position } : {})
      };
      if (index >= 0) players[index] = merged;
      else players.push({ ...merged, shifts: array(merged.shifts) });
    });
    return players;
  }

  function mergeSchedule(schedule, rows) {
    const output = array(schedule).map(clone);
    array(rows).forEach(row => {
      const id = text(row.source_schedule_id);
      if (!id) return;
      const index = output.findIndex(entry => text(entry.id) === id);
      const patch = { id };
      if (text(row.date)) patch.date = row.date;
      if (text(row.time)) patch.time = row.time;
      if (text(row.opponent)) patch.opponent = row.opponent;
      if (text(row.home_away)) patch.homeAway = row.home_away;
      if (text(row.game_type)) patch.type = row.game_type;
      if (text(row.location)) patch.location = row.location;
      if (text(row.notes)) patch.notes = row.notes;
      if (text(row.linked_game_source_id)) patch.linkedGameId = row.linked_game_source_id;
      if (index >= 0) output[index] = { ...output[index], ...patch };
      else output.push(patch);
    });
    return output;
  }

  function mergeGames(state, rows) {
    const games = array(state.savedGames).map(clone);
    array(rows).forEach(row => {
      const id = text(row.source_game_id);
      if (!id) return;
      const index = games.findIndex(game => text(game.id) === id);
      const existing = index >= 0 ? games[index] : {};
      const patch = {
        id, date: row.date || existing.date || '',
        opponent: row.opponent || existing.opponent || ''
      };
      if (finite(row.period_length_min) !== null) patch.periodLengthMin = finite(row.period_length_min);
      const merged = { ...existing, ...patch };
      if (index >= 0) games[index] = merged;
      else games.push({ ...merged, officialStats: merged.officialStats || {} });
    });
    return games;
  }

  function statGroup(game, group, number, playerId) {
    game.officialStats = game.officialStats && typeof game.officialStats === 'object'
      ? game.officialStats : {};
    const current = game.officialStats[group];
    if (Array.isArray(current)) {
      const index = current.findIndex(row => (playerId && text(row.playerId) === playerId) ||
        (number && text(row.number) === number));
      if (index >= 0) return current[index];
      const row = {};
      current.push(row);
      return row;
    }
    if (!game.officialStats[group] || typeof game.officialStats[group] !== 'object') game.officialStats[group] = {};
    const key = number || playerId;
    if (!game.officialStats[group][key]) game.officialStats[group][key] = {};
    return game.officialStats[group][key];
  }

  function mergePlayerStats(games, rows, players) {
    const playerById = rowMap(players, row => text(row.id));
    array(rows).forEach(row => {
      const game = games.find(candidate => text(candidate.id) === text(row.source_game_id));
      if (!game || !text(row.source_player_id)) return;
      const player = playerById.get(text(row.source_player_id));
      const number = text(player?.number) || text(row.jersey_number);
      const group = String(row.player_type).toLowerCase() === 'goalie' ? 'goalies' : 'skaters';
      const target = statGroup(game, group, number, text(row.source_player_id));
      if (player) {
        if (target.playerId == null) target.playerId = player.id;
        if (target.number == null) target.number = player.number;
        if (target.name == null) target.name = player.name;
      }
      const fields = group === 'goalies' ? GOALIE_FIELDS : SKATER_FIELDS;
      Object.entries(fields).forEach(([cloudKey, localKey]) => {
        const value = finite(row[cloudKey]);
        if (value !== null) target[localKey] = value;
      });
      game.officialStats.imported = true;
    });
  }

  function mergeTeamStats(games, rows) {
    array(rows).forEach(row => {
      const game = games.find(candidate => text(candidate.id) === text(row.source_game_id));
      if (!game) return;
      game.officialStats = game.officialStats && typeof game.officialStats === 'object'
        ? game.officialStats : {};
      const team = game.officialStats.team && typeof game.officialStats.team === 'object'
        ? { ...game.officialStats.team } : {};
      Object.entries(TEAM_FIELDS).forEach(([cloudKey, localKey]) => {
        const value = finite(row[cloudKey]);
        if (value !== null) team[localKey] = value;
      });
      for (const [cloudKey, localKey] of [
        ['goals_for', 'goalsFor'], ['goals_against', 'goalsAgainst'],
        ['shots_for', 'shotsFor'], ['shots_against', 'shotsAgainst']
      ]) {
        const total = finite(row[cloudKey]);
        const periods = {};
        for (const period of ['p1', 'p2', 'p3', 'ot']) {
          const value = finite(row[`${cloudKey}_${period}`]);
          if (value !== null) periods[period] = value;
        }
        if (total !== null || Object.keys(periods).length) {
          team[localKey] = { ...(team[localKey] && typeof team[localKey] === 'object' ? team[localKey] : {}), ...periods };
          if (total !== null) team[localKey].total = total;
        }
      }
      game.officialStats.team = team;
      game.officialStats.imported = true;
    });
  }

  function mergeOpponentData(state, games, profileRows, playerRows) {
    const profiles = array(state.opponentProfiles).map(clone);
    array(profileRows).forEach(row => {
      const key = text(row.source_profile_key);
      if (!key) return;
      const index = profiles.findIndex(profile => text(profile.source_profile_key) === key);
      const patch = { source_profile_key: key };
      if (text(row.opponent_name)) patch.opponent_name = row.opponent_name;
      if (index >= 0) profiles[index] = { ...profiles[index], ...patch };
      else profiles.push(patch);
    });

    const opponentPlayers = array(state.opponentPlayers).map(clone);
    array(playerRows).forEach(row => {
      const key = text(row.source_player_key);
      if (!key) return;
      const patch = {
        source_player_key: key, source_game_id: text(row.source_game_id) || null,
        ...(text(row.opponent_profile_key) ? { opponent_profile_key: text(row.opponent_profile_key) } : {}),
        ...(row.jersey_number != null && text(row.jersey_number) ? { number: String(row.jersey_number) } : {}),
        ...(text(row.player_name) ? { name: row.player_name } : {}),
        ...(text(row.position) ? { position: row.position } : {}),
        ...(text(row.source_kind) ? { source_kind: row.source_kind } : {})
      };
      const index = opponentPlayers.findIndex(player => text(player.source_player_key) === key &&
        text(player.source_game_id) === text(row.source_game_id));
      if (index >= 0) opponentPlayers[index] = { ...opponentPlayers[index], ...patch };
      else opponentPlayers.push(patch);

      const game = games.find(candidate => text(candidate.id) === text(row.source_game_id));
      if (!game) return;
      const command = game.command31 && typeof game.command31 === 'object' ? game.command31 : {};
      const roster = command.opponentRoster && typeof command.opponentRoster === 'object'
        ? command.opponentRoster : {};
      const localPlayers = array(roster.players).map(clone);
      const localIndex = localPlayers.findIndex(player => text(player.sourcePlayerKey) === key ||
        (patch.number && text(player.number) === patch.number && patch.name && text(player.name).toLowerCase() === text(patch.name).toLowerCase()));
      const localPatch = {
        ...(patch.number ? { number: patch.number } : {}),
        ...(patch.name ? { name: patch.name } : {}),
        ...(patch.position ? { position: patch.position } : {}),
        sourcePlayerKey: key
      };
      if (localIndex >= 0) localPlayers[localIndex] = { ...localPlayers[localIndex], ...localPatch };
      else localPlayers.push(localPatch);
      game.command31 = { ...command, opponentRoster: { ...roster, players: localPlayers } };
    });
    return { profiles, opponentPlayers };
  }

  function materialize({ state = {}, schedule = [], datasets = {} } = {}) {
    const output = clone(state) || {};
    const get = name => datasets[name] || datasets[DATASET_ALIASES[name]] || [];
    output.players = mergeRoster(output, get('roster'));
    output.savedGames = mergeGames(output, get('games'));
    output.savedGames = output.savedGames.map(clone);
    mergePlayerStats(output.savedGames, get('playerStats'), output.players);
    mergeTeamStats(output.savedGames, get('teamStats'));
    const mergedOpponent = mergeOpponentData(output, output.savedGames, get('opponentProfiles'), get('opponentPlayers'));
    output.opponentProfiles = mergedOpponent.profiles;
    output.opponentPlayers = mergedOpponent.opponentPlayers;
    const recordRows = array(get('seasonRecord'));
    const seasonKey = text(output.seasonKey);
    const record = recordRows.find(row => !seasonKey || text(row.season_key) === seasonKey) || recordRows[0] || null;
    if (record) output.seasonRecord = clone(record);
    return {
      state: output,
      schedule: mergeSchedule(schedule, get('schedule')),
      seasonRecord: record ? clone(record) : null,
      datasets: clone(datasets),
      writes: 0,
      deletes: 0
    };
  }

  function rowsForQueue(mapped, teamId) {
    const mapping = {
      roster: mapped.roster, schedule: mapped.schedule, games: mapped.games,
      playerStats: mapped.playerStats, teamStats: mapped.teamStats
    };
    const items = [];
    Object.entries(mapping).forEach(([dataset, rows]) => array(rows).forEach(row => {
      if (text(row.team_id) !== teamId) throw new Error('Cross-team cloud queue item rejected.');
      const sourceId = DATASETS[dataset].sourceId === 'season_key'
        ? text(row.season_key) : text(row[DATASETS[dataset].sourceId]);
      items.push({ teamId, dataset, sourceId, payload: row });
    }));
    if (mapped.seasonRecord) items.push({
      teamId, dataset: 'seasonRecord', sourceId: text(mapped.seasonRecord.season_key),
      payload: { team_id: teamId, season_key: mapped.seasonRecord.season_key, ...mapped.seasonRecord }
    });
    return items;
  }

  function createCloudPrimary({
    client = null,
    storage = root.localStorage,
    cache = createCloudCache({ storage }),
    queue = createSyncQueue({ storage }),
    mode = 'local',
    allowLiveWrites = false,
    writeBoundary = null
  } = {}) {
    const configuredMode = text(mode).toLowerCase() || 'local';
    const networkReads = configuredMode === 'read-only' || configuredMode === 'cloud-read';
    async function readDataset(dataset, teamId, { refresh = false } = {}) {
      const normalized = requireDataset(dataset);
      const team = requireTeam(teamId);
      const cached = cache.get(normalized, team);
      if (cached && !refresh) return { ...clone(cached), cached: true };
      if (!networkReads) {
        return cached ? { ...clone(cached), cached: true } : {
          version: 1, dataset: normalized, teamId: team, rows: [], revision: null, cached: false
        };
      }
      if (!client || typeof client.from !== 'function') throw new Error('An authenticated read-only Supabase client is required.');
      const definition = DATASETS[normalized];
      const query = client.from(definition.table).select('*').eq('team_id', team);
      const result = await query;
      if (result?.error) throw result.error;
      const rows = array(result?.data);
      return { ...cache.set(normalized, team, rows, { source: 'cloud-read' }), cached: false };
    }
    async function bootstrap({ teamId, state = {}, schedule = [], refresh = false } = {}) {
      const team = requireTeam(teamId);
      const datasets = {};
      for (const dataset of ALL_DATASETS) {
        datasets[dataset] = (await readDataset(dataset, team, { refresh })).rows;
      }
      const result = materialize({ state, schedule, datasets });
      return { mode: configuredMode, teamId: team, ...result };
    }
    function enqueueMapped(mapped, teamId) {
      const team = requireTeam(teamId);
      const items = rowsForQueue(mapped, team).map(item => queue.enqueue(item));
      return { mode: configuredMode, writes: 0, deletes: 0, queued: items.length, items };
    }
    function mapLocal({ state = {}, schedule = [], teamId } = {}) {
      const team = requireTeam(teamId);
      let mapper = root.FoxesSync;
      if (!mapper && typeof require === 'function') {
        try { mapper = require('./supabase-sync.js'); } catch { mapper = null; }
      }
      if (!mapper || typeof mapper.dryRun !== 'function') throw new Error('The local sync mapper is unavailable.');
      return mapper.dryRun(state, schedule, team);
    }
    function enqueueLocalSync(input = {}) {
      const dryRun = mapLocal(input);
      const queued = enqueueMapped(dryRun.payload, input.teamId);
      return { ...queued, dryRun };
    }
    function dryRun(input = {}) {
      return mapLocal(input);
    }
    async function flush(options = {}) {
      if (configuredMode !== 'live' || allowLiveWrites !== true || typeof writeBoundary !== 'function') {
        return { mode: configuredMode, writes: 0, disabled: true, reason: 'live writes are disabled' };
      }
      return queue.process({ ...options, executor: writeBoundary });
    }
    return {
      mode: configuredMode,
      datasets: DATASETS,
      cache,
      queue,
      readDataset,
      bootstrap,
      materialize,
      enqueueMapped,
      enqueueLocalSync,
      dryRun,
      sync: enqueueLocalSync,
      flush
    };
  }

  return {
    DATASETS,
    createCloudCache,
    createSyncQueue,
    createCloudPrimary,
    materialize,
    memoryStorage,
    stable,
    hash
  };
});
