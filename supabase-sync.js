/* Phase 1 additive sync mapping. The Windows app remains the source of truth. */
(function (root) {
  'use strict';

  const SKATER_FIELDS = {
    gp: 'gp', g: 'goals', a: 'assists', shots: 'shots', pim: 'penalty_minutes',
    plusMinus: 'plus_minus', blocks: 'blocks', fow: 'faceoff_wins', fol: 'faceoff_losses',
    fo: 'faceoff_attempts', ppg: 'power_play_goals', ppa: 'power_play_assists',
    ppp: 'power_play_points', shg: 'short_handed_goals', sha: 'short_handed_assists',
    shp: 'short_handed_points', gwg: 'game_winning_goals', gtg: 'game_tying_goals',
    tk: 'takeaways', gv: 'giveaways', ch: 'chances', toiMin: 'toi_minutes'
  };
  const GOALIE_FIELDS = {
    gp: 'gp', min: 'minutes', saves: 'saves', ga: 'goals_against',
    w: 'wins', l: 'losses', t: 'ties', so: 'shutouts'
  };
  const TEAM_FIELDS = {
    ppChances: 'power_play_chances', ppSuccess: 'power_play_success',
    pkChances: 'penalty_kill_chances', pkSuccess: 'penalty_kill_success',
    fow: 'faceoff_wins', fol: 'faceoff_losses'
  };
  const PERIOD_FIELDS = ['p1', 'p2', 'p3', 'ot'];

  const arrayOrEmpty = value => Array.isArray(value) ? value : [];
  const finite = value => value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  const dateOrNull = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null;
  const timeOrNull = value => /^\d{2}:\d{2}(:\d{2})?$/.test(String(value || '')) ? String(value) : null;
  const isoOrNull = value => {
    if (value === null || value === undefined || value === '') return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  };

  function sourceId(value, fallback) {
    const id = String(value || fallback || '').trim();
    return id || null;
  }

  function statRows(stats, group) {
    if (!stats || typeof stats !== 'object') return [];
    const value = stats[group];
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object') return [];
    return Object.entries(value).map(([key, row]) => ({ ...(row || {}), number: row?.number ?? key }));
  }

  function mapPlayerStats(row, player, game, teamId, playerType, fields) {
    const mapped = {
      team_id: teamId,
      source_game_id: sourceId(game.id),
      source_player_id: sourceId(row.playerId, player?.id || `jersey:${row.number}`),
      player_type: playerType,
      source_updated_at: isoOrNull(game.updatedAt)
    };
    Object.entries(fields).forEach(([source, target]) => {
      const value = finite(row[source]);
      if (value !== null) mapped[target] = value;
    });
    return mapped.source_game_id && mapped.source_player_id ? mapped : null;
  }

  function mapTeamStats(game, teamId) {
    const source = game.officialStats?.team;
    if (!source || typeof source !== 'object') return null;
    const imported = game.officialStats?.imported === true;
    const hasNonZeroValue = Object.values(source).some(value => {
      if (value && typeof value === 'object') {
        return Object.values(value).some(item => finite(item) !== null && finite(item) !== 0);
      }
      return finite(value) !== null && finite(value) !== 0;
    });
    if (!imported && !hasNonZeroValue) return null;
    const row = {
      team_id: teamId,
      source_game_id: sourceId(game.id),
      source_updated_at: isoOrNull(game.updatedAt)
    };
    Object.entries(TEAM_FIELDS).forEach(([sourceKey, target]) => {
      const value = finite(source[sourceKey]);
      if (value !== null) row[target] = value;
    });
    [['goalsFor', 'goals_for'], ['goalsAgainst', 'goals_against'],
      ['shotsFor', 'shots_for'], ['shotsAgainst', 'shots_against']].forEach(([sourceKey, target]) => {
      const value = source[sourceKey];
      if (value && typeof value === 'object') {
        const total = finite(value.total);
        if (total !== null) row[target] = total;
        PERIOD_FIELDS.forEach(period => {
          const periodValue = finite(value[period]);
          if (periodValue !== null) row[`${target}_${period}`] = periodValue;
        });
      } else {
        const number = finite(value);
        if (number !== null) row[target] = number;
      }
    });
    return Object.keys(row).length > 3 ? row : null;
  }

  function mapSchedule(schedule, teamId, skipped) {
    return arrayOrEmpty(schedule).flatMap(entry => {
      const id = sourceId(entry.id);
      const date = dateOrNull(entry.date);
      const opponent = String(entry.opponent || '').trim();
      if (!id || !date || !opponent) {
        skipped.push({ kind: 'schedule', source_id: id, reason: 'missing id, date, or opponent' });
        return [];
      }
      return [{
        team_id: teamId,
        source_schedule_id: id,
        date,
        time: timeOrNull(entry.time),
        opponent,
        home_away: String(entry.homeAway || 'Home'),
        game_type: String(entry.type || 'League'),
        location: String(entry.location || ''),
        notes: String(entry.notes || ''),
        linked_game_source_id: sourceId(entry.linkedGameId),
        source_created_at: isoOrNull(entry.createdAt),
        source_updated_at: isoOrNull(entry.updatedAt)
      }];
    });
  }

  function readSchedule(storage) {
    if (!storage || typeof storage.getItem !== 'function') return [];
    try {
      const value = JSON.parse(storage.getItem('foxes-301-season-schedule') || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function mapState(state, schedule, teamId) {
    const skipped = [];
    const players = arrayOrEmpty(state?.players).flatMap(player => {
      const id = sourceId(player.id);
      const number = String(player.number || '').trim();
      const name = String(player.name || '').trim();
      const position = String(player.pos || '').trim().toUpperCase();
      if (!id || !number || !name || !['F', 'D', 'G'].includes(position)) {
        skipped.push({ kind: 'player', source_id: id, reason: 'missing id, number, name, or valid position' });
        return [];
      }
      return [{
        team_id: teamId,
        source_player_id: id,
        jersey_number: number,
        name,
        position
      }];
    });

    const games = arrayOrEmpty(state?.savedGames).flatMap(game => {
      const id = sourceId(game.id);
      const date = dateOrNull(game.date);
      const opponent = String(game.opponent || '').trim();
      if (!id || !date || !opponent) {
        skipped.push({ kind: 'game', source_id: id, reason: 'missing id, date, or opponent' });
        return [];
      }
      return [{
        team_id: teamId,
        source_game_id: id,
        date,
        opponent,
        period_length_min: finite(game.periodLengthMin),
        source_created_at: isoOrNull(game.createdAt),
        source_updated_at: isoOrNull(game.updatedAt)
      }];
    });

    const playerByNumber = new Map(arrayOrEmpty(state?.players).map(player => [String(player.number), player]));
    const playerStats = [];
    const teamStats = [];
    arrayOrEmpty(state?.savedGames).forEach(game => {
      statRows(game.officialStats, 'skaters').forEach(row => {
        const player = playerByNumber.get(String(row.number));
        const mapped = mapPlayerStats(row, player, game, teamId, 'skater', SKATER_FIELDS);
        if (mapped) playerStats.push(mapped);
      });
      statRows(game.officialStats, 'goalies').forEach(row => {
        const player = playerByNumber.get(String(row.number));
        const mapped = mapPlayerStats(row, player, game, teamId, 'goalie', GOALIE_FIELDS);
        if (mapped) playerStats.push(mapped);
      });
      const mappedTeam = mapTeamStats(game, teamId);
      if (mappedTeam) teamStats.push(mappedTeam);
    });

    const scheduleRows = mapSchedule(schedule, teamId, skipped);
    const scored = teamStats.filter(row => row.goals_for !== undefined && row.goals_against !== undefined);
    const record = scored.reduce((summary, row) => {
      summary.games_played += 1;
      summary.goals_for += row.goals_for;
      summary.goals_against += row.goals_against;
      if (row.goals_for > row.goals_against) summary.wins += 1;
      else if (row.goals_for < row.goals_against) summary.losses += 1;
      else summary.ties += 1;
      return summary;
    }, { games_played: 0, wins: 0, losses: 0, ties: 0, goals_for: 0, goals_against: 0 });

    return {
      roster: players,
      schedule: scheduleRows,
      games,
      playerStats,
      teamStats,
      seasonRecord: record,
      skipped
    };
  }

  function dryRun(state, schedule, teamId) {
    if (!teamId) throw new Error('teamId is required for a team-scoped sync.');
    const mapped = mapState(state, schedule, teamId);
    return {
      mode: 'dry-run',
      writes: 0,
      counts: {
        players: mapped.roster.length,
        scheduleEntries: mapped.schedule.length,
        games: mapped.games.length,
        playerStatRows: mapped.playerStats.length,
        teamStatRows: mapped.teamStats.length
      },
      seasonRecord: mapped.seasonRecord,
      skipped: mapped.skipped,
      payload: mapped
    };
  }

  async function sync(supabase, state, schedule, teamId) {
    if (!supabase || typeof supabase.from !== 'function') throw new Error('A Supabase client is required.');
    const mapped = mapState(state, schedule, teamId);
    const upsert = async (table, rows, onConflict) => {
      if (!rows.length) return;
      const { error } = await supabase.from(table).upsert(rows, { onConflict });
      if (error) throw error;
    };
    await upsert('team_roster_players', mapped.roster, 'team_id,source_player_id');
    await upsert('team_schedule_games', mapped.schedule, 'team_id,source_schedule_id');
    await upsert('team_games', mapped.games, 'team_id,source_game_id');
    await upsert('team_game_player_stats', mapped.playerStats, 'team_id,source_game_id,source_player_id,player_type');
    await upsert('team_game_team_stats', mapped.teamStats, 'team_id,source_game_id');
    const seasonKey = String(state?.seasonKey || '2026-2027');
    await upsert('team_season_records', [{ team_id: teamId, season_key: seasonKey, ...mapped.seasonRecord }], 'team_id,season_key');
    return dryRun(state, schedule, teamId);
  }

  const api = { mapState, dryRun, sync, readSchedule };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.FoxesSync = api;
    root.foxesSyncDryRun = teamId => api.dryRun(
      root.state,
      root.readSchedule301?.() || api.readSchedule(root.localStorage),
      teamId || root.foxesTeamId
    );
  }
})(globalThis);
