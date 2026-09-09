(function attachDashboard(global) {
  // Stage 7 coach Team Dashboard derivation layer for PuckNexus.
  // Pure functions over the Phase-1 synced datasets (roster, schedule, games,
  // player stats, team stats, season record). No fetches, no DOM, no writes —
  // the UI renders what this module computes, and every metric traces to real
  // stored data. Unsupported metrics are reported, never fabricated.

  const TREND_MIN_GAMES = 6; // last-3 vs previous-3 both required

  function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function isScored(game, teamStatsByGame) {
    const stats = teamStatsByGame?.get(game.source_game_id);
    return Boolean(stats) && stats.goals_for !== null && stats.goals_for !== undefined && stats.goals_against !== null && stats.goals_against !== undefined;
  }

  function resultFor(game, teamStatsByGame) {
    if (!isScored(game, teamStatsByGame)) return null;
    const stats = teamStatsByGame.get(game.source_game_id);
    const gf = num(stats.goals_for);
    const ga = num(stats.goals_against);
    return gf > ga ? 'W' : gf < ga ? 'L' : 'T';
  }

  function snapshot(games, teamStatsByGame, seasonRecord) {
    const scored = (games || []).filter(game => isScored(game, teamStatsByGame));
    const totals = { gp: 0, w: 0, l: 0, t: 0, gf: 0, ga: 0, shots: 0, goals: 0, scoredGames: 0 };
    scored.forEach(game => {
      const stats = teamStatsByGame.get(game.source_game_id);
      totals.gp += 1;
      totals.gf += num(stats.goals_for);
      totals.ga += num(stats.goals_against);
      totals.shots += num(stats.shots_for);
      const result = resultFor(game, teamStatsByGame);
      if (result === 'W') totals.w += 1;
      else if (result === 'L') totals.l += 1;
      else totals.t += 1;
    });
    totals.scoredGames = scored.length;
    // The synced season record, when present, is authoritative for W/L/T/GP
    // because it includes games imported before per-game team stats existed.
    if (seasonRecord) {
      totals.gp = num(seasonRecord.games_played) || totals.gp;
      totals.w = num(seasonRecord.wins);
      totals.l = num(seasonRecord.losses);
      totals.t = num(seasonRecord.ties);
      totals.gf = num(seasonRecord.goals_for) || totals.gf;
      totals.ga = num(seasonRecord.goals_against) || totals.ga;
    }
    totals.diff = totals.gf - totals.ga;
    totals.shootingPct = totals.shots > 0 ? totals.gf / totals.shots : null;
    totals.hasRecord = totals.gp > 0;
    return totals;
  }

  function lastFive(games, teamStatsByGame) {
    const scored = (games || [])
      .filter(game => isScored(game, teamStatsByGame))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 5);
    const record = { w: 0, l: 0, t: 0, count: scored.length };
    scored.forEach(game => {
      const result = resultFor(game, teamStatsByGame);
      if (result === 'W') record.w += 1;
      else if (result === 'L') record.l += 1;
      else record.t += 1;
    });
    return record;
  }

  function recentGames(games, teamStatsByGame, limit = 5) {
    return (games || [])
      .filter(game => isScored(game, teamStatsByGame))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, limit)
      .map(game => {
        const stats = teamStatsByGame.get(game.source_game_id);
        return {
          id: game.source_game_id,
          date: game.date,
          opponent: game.opponent,
          score: `${num(stats.goals_for)}–${num(stats.goals_against)}`,
          result: resultFor(game, teamStatsByGame)
        };
      });
  }

  function upcomingGame(schedule, today) {
    const day = today || new Date().toISOString().slice(0, 10);
    return (schedule || [])
      .filter(game => String(game.date) >= day)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.time || '23:59').localeCompare(String(b.time || '23:59')))[0] || null;
  }

  function playerTotals(roster, playerStats) {
    const totals = new Map();
    (playerStats || []).forEach(row => {
      if (row.player_type !== 'skater') return;
      const current = totals.get(row.source_player_id) || { gp: 0, goals: 0, assists: 0, shots: 0, pim: 0, plusMinus: 0, blocks: 0, fow: 0, fol: 0, byGame: [] };
      current.gp += num(row.gp);
      current.goals += num(row.goals);
      current.assists += num(row.assists);
      current.shots += num(row.shots);
      current.pim += num(row.penalty_minutes);
      current.plusMinus += num(row.plus_minus);
      current.blocks += num(row.blocks);
      current.fow += num(row.faceoff_wins);
      current.fol += num(row.faceoff_losses);
      current.byGame.push({ gameId: row.source_game_id, points: num(row.goals) + num(row.assists) });
      totals.set(row.source_player_id, current);
    });
    return (roster || [])
      .filter(player => player.position !== 'G')
      .map(player => {
        const stats = totals.get(player.source_player_id) || { gp: 0, goals: 0, assists: 0, shots: 0, pim: 0, plusMinus: 0, blocks: 0, fow: 0, fol: 0, byGame: [] };
        return { player, ...stats, points: stats.goals + stats.assists, faceoffs: stats.fow + stats.fol };
      });
  }

  const LEADER_CATEGORIES = {
    goals: { label: 'Goals', value: row => row.goals, min: 1 },
    assists: { label: 'Assists', value: row => row.assists, min: 1 },
    points: { label: 'Points', value: row => row.points, min: 1 },
    shots: { label: 'Shots', value: row => row.shots, min: 1 },
    blocks: { label: 'Blocks', value: row => row.blocks, min: 1 },
    plusMinus: { label: '+/−', value: row => row.plusMinus, min: 1 },
    faceoffPct: { label: 'Faceoff %', value: row => (row.faceoffs >= 10 ? row.fow / row.faceoffs : null), min: 10, format: value => `${(value * 100).toFixed(1)}%`, note: 'Minimum 10 faceoffs' },
    pim: { label: 'PIM', value: row => row.pim, min: 1 }
  };

  function leaders(rows, category, limit = 5) {
    const config = LEADER_CATEGORIES[category] || LEADER_CATEGORIES.points;
    return rows
      .map(row => ({ row, value: config.value(row) }))
      .filter(entry => entry.value !== null && entry.value !== undefined && Number.isFinite(entry.value) && (config.min > 1 ? entry.value >= 0 : entry.value >= (config.min || 0) && entry.value > 0))
      .sort((a, b) => b.value - a.value)
      .slice(0, limit)
      .map((entry, index) => ({ rank: index + 1, player: entry.row.player, value: entry.value, display: config.format ? config.format(entry.value) : String(entry.value) }));
  }

  function recentForm(rows, games, limit = 5) {
    const order = new Map((games || []).map((game, index) => [game.source_game_id, index]));
    return rows.map(row => {
      const form = row.byGame
        .slice()
        .sort((a, b) => (order.get(a.gameId) ?? 0) - (order.get(b.gameId) ?? 0))
        .slice(-limit)
        .map(game => game.points);
      return { player: row.player, form, total: form.reduce((sum, points) => sum + points, 0) };
    }).filter(entry => entry.form.length > 0);
  }

  // Trend: last 3 games vs previous 3 games of points for the player.
  // Requires at least 6 games with stats — smaller samples show no arrow.
  function trendFor(byGame, gamesOrder) {
    const ordered = (byGame || []).slice().sort((a, b) => (gamesOrder.get(a.gameId) ?? 0) - (gamesOrder.get(b.gameId) ?? 0));
    if (ordered.length < TREND_MIN_GAMES) return null;
    const last = ordered.slice(-3).reduce((sum, game) => sum + game.points, 0) / 3;
    const previous = ordered.slice(-6, -3).reduce((sum, game) => sum + game.points, 0) / 3;
    if (Math.abs(last - previous) < 0.34) return 'stable';
    return last > previous ? 'improving' : 'declining';
  }

  function goalieTotals(roster, playerStats) {
    const totals = new Map();
    (playerStats || []).forEach(row => {
      if (row.player_type !== 'goalie') return;
      const current = totals.get(row.source_player_id) || { gp: 0, saves: 0, ga: 0, w: 0, l: 0, t: 0, so: 0 };
      current.gp += num(row.gp);
      current.saves += num(row.saves);
      current.ga += num(row.goals_against);
      current.w += num(row.wins);
      current.l += num(row.losses);
      current.t += num(row.ties);
      current.so += num(row.shutouts);
      totals.set(row.source_player_id, current);
    });
    return (roster || [])
      .filter(player => player.position === 'G')
      .map(player => {
        const stats = totals.get(player.source_player_id) || { gp: 0, saves: 0, ga: 0, w: 0, l: 0, t: 0, so: 0 };
        const sa = stats.saves + stats.ga;
        return { player, ...stats, shotsAgainst: sa, savePct: sa > 0 ? stats.saves / sa : null };
      });
  }

  function teamTrendSeries(games, teamStatsByGame, metric, window) {
    const scored = (games || [])
      .filter(game => isScored(game, teamStatsByGame))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const limited = window === 'season' ? scored : scored.slice(-num(window));
    const points = limited.map(game => {
      const stats = teamStatsByGame.get(game.source_game_id);
      if (metric === 'goalsFor') return { label: game.date, value: num(stats.goals_for) };
      if (metric === 'goalsAgainst') return { label: game.date, value: num(stats.goals_against) };
      if (metric === 'shots') return { label: game.date, value: num(stats.shots_for) };
      if (metric === 'shootingPct') return { label: game.date, value: num(stats.shots_for) > 0 ? num(stats.goals_for) / num(stats.shots_for) : null };
      if (metric === 'faceoffPct') {
        const fow = num(stats.faceoff_wins);
        const fol = num(stats.faceoff_losses);
        return { label: game.date, value: fow + fol > 0 ? fow / (fow + fol) : null };
      }
      if (metric === 'pim') {
        return { label: game.date, value: null, unsupported: true };
      }
      return { label: game.date, value: null };
    });
    return { metric, points, games: limited.length };
  }

  function compareToAverage(games, teamStatsByGame) {
    const scored = (games || []).filter(game => isScored(game, teamStatsByGame));
    if (!scored.length) return null;
    const seasonGf = scored.reduce((sum, game) => sum + num(teamStatsByGame.get(game.source_game_id).goals_for), 0) / scored.length;
    const last = scored.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 5);
    const recentGf = last.reduce((sum, game) => sum + num(teamStatsByGame.get(game.source_game_id).goals_for), 0) / last.length;
    return { season: seasonGf, recent: recentGf, direction: recentGf > seasonGf ? 'up' : recentGf < seasonGf ? 'down' : 'flat', sample: last.length };
  }

  function dashboardState({ roster, schedule, games, playerStats, teamStats, seasonRecord, today }) {
    const teamStatsByGame = new Map((teamStats || []).map(row => [row.source_game_id, row]));
    const hasRoster = (roster || []).length > 0;
    const hasSchedule = (schedule || []).length > 0;
    const hasGames = (games || []).length > 0;
    const scoredGames = (games || []).filter(game => isScored(game, teamStatsByGame));
    const hasStats = scoredGames.length > 0 || (playerStats || []).length > 0;
    return {
      hasRoster,
      hasSchedule,
      hasGames,
      hasStats,
      scoredCount: scoredGames.length,
      emptyKind: !hasRoster ? 'no_roster' : !hasSchedule && !hasGames ? 'no_games' : !hasStats ? 'no_stats' : null
    };
  }

  global.FoxesDashboard = {
    TREND_MIN_GAMES,
    LEADER_CATEGORIES,
    num,
    isScored,
    resultFor,
    snapshot,
    lastFive,
    recentGames,
    upcomingGame,
    playerTotals,
    leaders,
    recentForm,
    trendFor,
    goalieTotals,
    teamTrendSeries,
    compareToAverage,
    dashboardState
  };
}(window));
