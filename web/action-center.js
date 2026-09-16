(function attachActionCenter(global) {
  function scored(stats) {
    return stats && stats.goals_for !== null && stats.goals_for !== undefined
      && stats.goals_against !== null && stats.goals_against !== undefined;
  }

  function actionableItems({ roster = [], schedule = [], playerStats = [], teamStats = [], today, capabilities = [] }) {
    const canRoster = capabilities.includes('players.evaluate');
    const canScore = capabilities.includes('stats.edit');
    const teamStatsByGame = new Map(teamStats.map(row => [row.source_game_id, row]));
    const statsByGame = new Map();
    playerStats.forEach(row => statsByGame.set(row.source_game_id, (statsByGame.get(row.source_game_id) || 0) + 1));
    const day = today || new Date().toISOString().slice(0, 10);
    const items = [];
    if (canRoster && roster.length === 0) {
      items.push({ kind: 'empty-roster', view: 'players', label: 'Add your roster', detail: 'Add players before entering game stats.' });
    }
    schedule.filter(game => String(game.date) < day && game.linked_game_source_id).forEach(game => {
      const gameId = game.linked_game_source_id;
      if (canScore && !scored(teamStatsByGame.get(gameId))) {
        items.push({ kind: 'missing-score', view: 'schedule', gameId, label: `Score ${game.opponent}`, detail: `${game.date} needs a final score.` });
      } else if (canScore && scored(teamStatsByGame.get(gameId)) && !statsByGame.get(gameId)) {
        items.push({ kind: 'missing-stats', view: 'games', gameId, label: `Enter stats for ${game.opponent}`, detail: `${game.date} has a score but no player stats.` });
      }
    });
    return items;
  }

  global.FoxesActionCenter = { actionableItems };
}(window));
