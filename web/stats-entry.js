// Game Stat Entry v1 — coach-facing skater/goalie/team stat entry for a single game.
// Canonical field names match supabase/migrations/003_team_data_sync.sql exactly.
// Missing/untracked values are preserved as null end-to-end; only real zero entries
// are stored as 0. All writes go through the save_game_stats RPC (see migration 015)
// so skater, goalie, and team-game rows are written atomically in one transaction.
(function attachStatsEntry(global) {
  const SKATER_FIELDS = [
    'gp', 'goals', 'assists', 'shots', 'penalty_minutes', 'plus_minus', 'blocks',
    'faceoff_wins', 'faceoff_losses', 'power_play_goals', 'power_play_points',
    'short_handed_goals', 'short_handed_points'
  ];
  const GOALIE_FIELDS = ['gp', 'wins', 'losses', 'ties', 'saves', 'goals_against', 'minutes', 'shutouts'];
  const TEAM_FIELDS = ['goals_for', 'goals_against', 'shots_for', 'shots_against'];

  // Blank/undefined stays null (untracked). Only a value that parses to a finite
  // number is stored; anything unparsable is treated as untracked rather than 0.
  function parseStatValue(raw) {
    if (raw === null || raw === undefined) return null;
    const trimmed = String(raw).trim();
    if (trimmed === '') return null;
    const number = Number(trimmed);
    return Number.isFinite(number) ? number : null;
  }

  function normalizeStatRow(input = {}, fields) {
    const row = {};
    fields.forEach(field => { row[field] = parseStatValue(input[field]); });
    return row;
  }

  function normalizeSkaterRow(input) { return normalizeStatRow(input, SKATER_FIELDS); }
  function normalizeGoalieRow(input) { return normalizeStatRow(input, GOALIE_FIELDS); }
  function normalizeTeamRow(input) { return normalizeStatRow(input, TEAM_FIELDS); }

  // PTS is not a stored column (see migration 003); it is always derived and only
  // when both inputs are tracked, matching the Stats Dashboard convention.
  function derivePoints(row) {
    return row.goals !== null && row.assists !== null ? row.goals + row.assists : null;
  }

  function deriveFaceoffPct(row) {
    const attempts = row.faceoff_wins !== null && row.faceoff_losses !== null
      ? row.faceoff_wins + row.faceoff_losses
      : null;
    return {
      faceoffAttempts: attempts,
      faceoffPct: attempts !== null && attempts > 0 ? (row.faceoff_wins / attempts) * 100 : null
    };
  }

  // SA only when both Saves and Goals Against are tracked (never fabricated).
  // SV% only when SA > 0. GAA only when goalie minutes are tracked and > 0.
  function deriveGoalieMetrics(row) {
    const shotsAgainst = row.saves !== null && row.goals_against !== null ? row.saves + row.goals_against : null;
    const savePct = row.saves !== null && shotsAgainst !== null && shotsAgainst > 0 ? row.saves / shotsAgainst : null;
    const gaa = row.goals_against !== null && row.minutes !== null && row.minutes > 0
      ? row.goals_against / (row.minutes / 60)
      : null;
    return { shotsAgainst, savePct, gaa };
  }

  function existingStatsByPlayer(existingPlayerStats = [], playerType) {
    const map = new Map();
    (existingPlayerStats || [])
      .filter(row => (row.player_type || 'skater') === playerType)
      .forEach(row => map.set(String(row.source_player_id), row));
    return map;
  }
  const existingSkaterStatsByPlayer = rows => existingStatsByPlayer(rows, 'skater');
  const existingGoalieStatsByPlayer = rows => existingStatsByPlayer(rows, 'goalie');

  function buildSkaterPayload(rows = []) {
    return rows
      .filter(row => row && row.source_player_id)
      .map(row => ({ source_player_id: String(row.source_player_id), ...normalizeSkaterRow(row) }));
  }

  function buildGoaliePayload(rows = []) {
    return rows
      .filter(row => row && row.source_player_id)
      .map(row => ({ source_player_id: String(row.source_player_id), ...normalizeGoalieRow(row) }));
  }

  function buildSavePayload({ workspace, sourceGameId, skaterRows = [], goalieRows = [], teamStats = null }) {
    if (!workspace?.authorized || !workspace.team_id) throw new Error('An authorized team workspace is required.');
    if (!sourceGameId) throw new Error('A game is required to save stats.');
    const skater_stats = buildSkaterPayload(skaterRows);
    const goalie_stats = buildGoaliePayload(goalieRows);
    const normalizedTeamStats = teamStats ? normalizeTeamRow(teamStats) : null;
    const hasTeamStats = Boolean(normalizedTeamStats) && Object.values(normalizedTeamStats).some(value => value !== null);
    return {
      target_team_id: workspace.team_id,
      target_season_id: workspace.season_id || null,
      target_source_game_id: String(sourceGameId),
      skater_stats,
      goalie_stats,
      team_stats: hasTeamStats ? normalizedTeamStats : null
    };
  }

  async function saveGameStats(client, params) {
    const payload = buildSavePayload(params);
    const { data, error } = await client.rpc('save_game_stats', payload);
    if (error) throw new Error(error.message || 'Game stats could not be saved.');
    return data;
  }

  function createStatsEntry({ client, getWorkspace }) {
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

    async function save(sourceGameId, { skaterRows = [], goalieRows = [], teamStats = null } = {}) {
      return saveGameStats(client, { workspace: currentWorkspace(), sourceGameId, skaterRows, goalieRows, teamStats });
    }

    return {
      setWorkspace,
      clearWorkspace,
      getWorkspace: currentWorkspace,
      save,
      buildSavePayload,
      normalizeSkaterRow,
      normalizeGoalieRow,
      normalizeTeamRow,
      derivePoints,
      deriveFaceoffPct,
      deriveGoalieMetrics,
      existingSkaterStatsByPlayer,
      existingGoalieStatsByPlayer,
      parseStatValue
    };
  }

  global.FoxesStatsEntry = {
    createStatsEntry,
    normalizeSkaterRow,
    normalizeGoalieRow,
    normalizeTeamRow,
    derivePoints,
    deriveFaceoffPct,
    deriveGoalieMetrics,
    existingSkaterStatsByPlayer,
    existingGoalieStatsByPlayer,
    buildSavePayload,
    buildSkaterPayload,
    buildGoaliePayload,
    parseStatValue,
    SKATER_FIELDS,
    GOALIE_FIELDS,
    TEAM_FIELDS
  };
}(window));
