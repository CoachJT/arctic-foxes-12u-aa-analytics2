(function attachGameVisibility(global) {
  function activeGames(schedule, games) {
    const rows = schedule || [];
    const canonical = games || [];
    const linked = new Set(rows.map(row => row.linked_game_source_id).filter(Boolean));
    const visible = canonical.filter(game => linked.has(game.source_game_id));
    // Older schedule rows can predate canonical linkage. Resolve only one
    // same-date/opponent game per row; never expose every duplicate candidate.
    const claimed = new Set(visible.map(game => game.source_game_id));
    for (const row of rows.filter(item => !item.linked_game_source_id)) {
      const match = canonical.find(game => !claimed.has(game.source_game_id)
        && game.date === row.date
        && String(game.opponent || '').trim().toLowerCase() === String(row.opponent || '').trim().toLowerCase());
      if (match) { visible.push(match); claimed.add(match.source_game_id); }
    }
    return visible;
  }
  global.PuckGameVisibility = { activeGames };
  if (typeof module !== 'undefined') module.exports = global.PuckGameVisibility;
}(typeof window !== 'undefined' ? window : globalThis));
