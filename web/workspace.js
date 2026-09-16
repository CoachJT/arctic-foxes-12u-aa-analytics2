(function (global) {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function crest(name, logoUrl = '') {
    const initials = String(name || 'Team').split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase();
    const logo = /^https?:\/\//i.test(logoUrl) ? `<img src="${esc(logoUrl)}" alt="" loading="lazy">` : '';
    return `<div class="team-crest" aria-hidden="true"><span>${esc(initials)}</span>${logo}<svg viewBox="0 0 60 18"><path d="M13 2l30 13h9M47 2L17 15H8"/></svg></div>`;
  }
  function position(player) {
    const p = String(player.position || '').toUpperCase();
    return player.player_type === 'goalie' || p === 'G' ? 'G' : ['D', 'LD', 'RD'].includes(p) ? 'D' : ['F', 'C', 'LW', 'RW'].includes(p) ? 'F' : 'Other';
  }
  function sortRoster(roster) {
    const order = { F: 0, D: 1, G: 2, Other: 3 };
    return (roster || []).slice().sort((a, b) => order[position(a)] - order[position(b)] || String(a.jersey_number ?? '').localeCompare(String(b.jersey_number ?? ''), undefined, { numeric: true }) || String(a.name).localeCompare(String(b.name)));
  }
  function playerPicker(roster) {
    return ['F', 'D', 'G', 'Other'].map(group => {
      const players = sortRoster(roster).filter(p => position(p) === group);
      return players.length ? `<fieldset class="player-group"><legend>${{ F: 'Forwards', D: 'Defense', G: 'Goalies', Other: 'Other players' }[group]}</legend><div class="player-picker">${players.map(p => `<button type="button" class="player-pick" data-pick-player="${esc(p.source_player_id)}" aria-pressed="false"><b>#${esc(p.jersey_number)}</b><span>${esc(p.name)}</span></button>`).join('')}</div></fieldset>` : '';
    }).join('');
  }
  // This is an alternate control surface for the existing draft inputs. It
  // never sends requests or keeps a second set of stat totals.
  function bindQuickEntry(host, roster, coach) {
    const workspace = host.querySelector('.stats-workspace');
    if (!workspace || !roster.length) return;
    const rows = [...workspace.querySelectorAll('.stat-row, .stat-group')];
    const quick = document.createElement('div');
    quick.className = 'quick-entry';
    quick.innerHTML = `<div class="entry-picker"><h3>1. Choose a player</h3>${playerPicker(roster)}</div><div class="entry-events"><div class="selected-player" aria-live="polite"></div><h3>2. Tap a stat to add one</h3><div class="event-buttons"></div><p class="sub">Changes stay in this game until you save. Penalties are entered as minutes.</p><div class="entry-summary" aria-live="polite"></div></div>`;
    const toolbar = document.createElement('div');
    toolbar.className = 'entry-mode';
    toolbar.innerHTML = `<div class="segmented" aria-label="Entry mode"><button class="active" type="button" data-mode="quick" aria-pressed="true">Quick entry</button><button type="button" data-mode="bulk" aria-pressed="false">All players / bulk</button></div><button class="btn" type="button" data-undo-stat disabled>Undo last change</button>`;
    workspace.prepend(quick);
    workspace.prepend(toolbar);
    let selected = sortRoster(roster)[0];
    const inputs = [...host.querySelectorAll('.stat-input')];
    const playerInputs = () => inputs.filter(input => input.dataset.statPlayer === selected.source_player_id);
    const labels = { goals: 'Goal', assists: 'Assist', shots: 'Shot', penalty_minutes: 'Penalty minute', plus_minus: 'Plus / minus', blocks: 'Block', faceoff_wins: 'Faceoff win', faceoff_losses: 'Faceoff loss', saves: 'Save', goals_against: 'Goal against', wins: 'Win', losses: 'Loss', ties: 'Tie', shutouts: 'Shutout' };
    function refresh() {
      quick.querySelector('.selected-player').textContent = `#${selected.jersey_number} · ${selected.name}`;
      quick.querySelectorAll('[data-pick-player]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.pickPlayer === selected.source_player_id)));
      quick.querySelector('.event-buttons').innerHTML = playerInputs().map(input => `<button class="event-button" type="button" data-add-stat="${esc(input.dataset.statField)}" ${input.disabled ? 'disabled' : ''}><span>+ ${labels[input.dataset.statField]}</span><strong>${esc(input.value || 0)}</strong></button>`).join('');
      const values = Object.fromEntries(playerInputs().map(i => [i.dataset.statField, Number(i.value || 0)]));
      const goalie = position(selected) === 'G';
      const derived = goalie ? coach.derivedGoalie(values) : coach.derivedSkater(values);
      quick.querySelector('.entry-summary').textContent = goalie ? `${derived.shotsAgainst} shots against · ${derived.savePct === null ? '—' : (derived.savePct * 100).toFixed(1) + '%'} save percentage` : `${derived.points} points · ${derived.shotPct === null ? '—' : (derived.shotPct * 100).toFixed(1) + '%'} shooting`;
      host.querySelectorAll('.stat-row').forEach(row => {
        const values = Object.fromEntries([...row.querySelectorAll('.stat-input')].map(input => [input.dataset.statField, Number(input.value || 0)]));
        const goalie = row.classList.contains('goalie');
        const totals = goalie ? coach.derivedGoalie(values) : coach.derivedSkater(values);
        const derived = row.querySelector('.stat-derived');
        if (derived) derived.textContent = goalie ? `SA ${totals.shotsAgainst} · SV% ${totals.savePct === null ? '—' : (totals.savePct * 100).toFixed(1)}` : `PTS ${totals.points} · S% ${totals.shotPct === null ? '—' : (totals.shotPct * 100).toFixed(1)}`;
      });
      toolbar.querySelector('[data-undo-stat]').disabled = !coach.canUndo;
    }
    quick.addEventListener('click', event => {
      const pick = event.target.closest('[data-pick-player]');
      if (pick) { selected = roster.find(p => p.source_player_id === pick.dataset.pickPlayer); refresh(); }
      const add = event.target.closest('[data-add-stat]');
      if (add) {
        const input = playerInputs().find(i => i.dataset.statField === add.dataset.addStat);
        if (!input || input.disabled) return;
        input.value = Number(input.value || 0) + 1;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        refresh();
        quick.querySelector(`[data-add-stat="${add.dataset.addStat}"]`)?.focus({ preventScroll: true });
      }
    });
    toolbar.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
      const bulk = button.dataset.mode === 'bulk';
      quick.hidden = bulk;
      rows.forEach(row => { row.hidden = !bulk; });
      toolbar.querySelectorAll('[data-mode]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); });
    }));
    toolbar.querySelector('[data-undo-stat]').addEventListener('click', () => {
      const change = coach.undoStat();
      if (!change) return;
      const input = inputs.find(i => i.dataset.statPlayer === change.playerId && i.dataset.statField === change.field && i.dataset.statType === change.playerType);
      if (input) { input.value = change.value ?? ''; input.setCustomValidity(''); }
      host.querySelector('[data-dirty-flag]').textContent = coach.dirty ? 'Unsaved changes' : 'No unsaved changes';
      refresh();
    });
    host.addEventListener('input', refresh);
    rows.forEach(row => { row.hidden = true; });
    refresh();
  }
  global.PuckWorkspace = { crest, position, sortRoster, playerPicker, bindQuickEntry };
  if (typeof module !== 'undefined') module.exports = global.PuckWorkspace;
}(typeof window !== 'undefined' ? window : globalThis));
