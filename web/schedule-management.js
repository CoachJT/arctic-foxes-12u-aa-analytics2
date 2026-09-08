// Schedule Management v1 — coach-facing "add a game to the schedule" write path
// for the web dashboard. Mirrors roster-management.js: normalize + validate
// client-side, then a single-table insert against team_schedule_games, which
// is guarded server-side by the existing team_schedule_games_insert RLS
// policy (has_team_capability(team_id, 'schedule.edit')). No migration is
// required — this policy already exists in supabase/migrations/003_team_data_sync.sql.
(function attachScheduleManagement(global) {
  const HOME_AWAY = new Set(['Home', 'Away', 'Neutral']);
  const GAME_TYPES = new Set(['League', 'Independent', 'Tournament', 'Scrimmage', 'Other']);
  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  const TIME_PATTERN = /^\d{2}:\d{2}(:\d{2})?$/;

  function clean(value) {
    return String(value ?? '').trim();
  }

  function normalizeScheduleGame(input = {}) {
    return {
      date: clean(input.date),
      time: clean(input.time),
      opponent: clean(input.opponent),
      home_away: clean(input.home_away) || 'Home',
      game_type: clean(input.game_type) || 'League',
      location: clean(input.location),
      notes: clean(input.notes)
    };
  }

  function validateScheduleGame(input) {
    const game = normalizeScheduleGame(input);
    const errors = [];
    if (!DATE_PATTERN.test(game.date)) errors.push('A valid game date is required.');
    if (!game.opponent) errors.push('Opponent is required.');
    if (game.time && !TIME_PATTERN.test(game.time)) errors.push('Time must be a valid HH:MM value.');
    if (!HOME_AWAY.has(game.home_away)) errors.push('Home/Away must be Home, Away, or Neutral.');
    if (!GAME_TYPES.has(game.game_type)) errors.push('Game type must be League, Independent, Tournament, Scrimmage, or Other.');
    return { game, errors };
  }

  function createScheduleManagement({ client, getWorkspace }) {
    let workspace = null;

    function setWorkspace(nextWorkspace) {
      workspace = nextWorkspace || null;
      return workspace;
    }

    function clearWorkspace() {
      workspace = null;
    }

    function currentWorkspace() {
      return getWorkspace?.() || workspace;
    }

    async function createGame(input) {
      const current = currentWorkspace();
      if (!current?.authorized || !current.team_id) throw new Error('An authorized team workspace is required.');
      const { game, errors } = validateScheduleGame(input);
      if (errors.length) throw new Error(errors.join(' '));
      const sourceScheduleId = (typeof input?.source_schedule_id === 'string' && input.source_schedule_id)
        || (global.crypto?.randomUUID ? global.crypto.randomUUID() : `web-${Date.now()}-${Math.random().toString(16).slice(2)}`);
      const { data, error } = await client.from('team_schedule_games')
        .insert({
          team_id: current.team_id,
          source_schedule_id: sourceScheduleId,
          date: game.date,
          time: game.time || null,
          opponent: game.opponent,
          home_away: game.home_away,
          game_type: game.game_type,
          location: game.location,
          notes: game.notes
        })
        .select('source_schedule_id,date,time,opponent,home_away,game_type,location,notes,linked_game_source_id')
        .maybeSingle();
      if (error) throw new Error(error.message || 'The game could not be added to the schedule.');
      return data;
    }

    return { setWorkspace, clearWorkspace, getWorkspace: currentWorkspace, createGame };
  }

  global.FoxesScheduleManagement = { createScheduleManagement, normalizeScheduleGame, validateScheduleGame };
}(window));
