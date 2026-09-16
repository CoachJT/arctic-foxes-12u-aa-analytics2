(function attachCoachQol(global) {
  // Stage 6 coach quality-of-life workflows for the PuckNexus web workspace.
  // All writes are team-scoped and authorized by RLS / guarded RPCs on the
  // server. This module deliberately contains every PostgREST mutation used by
  // the web workspace so the read surfaces stay read-only.
  const SAVE_STATES = Object.freeze({ IDLE: 'idle', SAVING: 'saving', SAVED: 'saved', ERROR: 'error' });
  const SAVE_LABELS = Object.freeze({
    idle: 'Save',
    saving: 'Saving…',
    saved: '✓ Saved',
    error: 'Save failed — Retry'
  });

  const SKATER_FIELDS = [
    ['goals', 'G', 'Goals scored by this player.'],
    ['assists', 'A', 'Assists credited to this player.'],
    ['shots', 'S', 'Shots credited to this player.'],
    ['penalty_minutes', 'PIM', 'Penalty minutes.'],
    ['plus_minus', '+/−', 'Goal differential while this player is on the ice at even strength under the current PuckNexus tracking rules.'],
    ['blocks', 'BLK', 'Blocked shots.'],
    ['faceoff_wins', 'FOW', 'Faceoffs won.'],
    ['faceoff_losses', 'FOL', 'Faceoffs lost.']
  ];
  const GOALIE_FIELDS = [
    ['saves', 'Saves', 'Shots this goalie stopped.'],
    ['goals_against', 'GA', 'Goals allowed by this goalie.'],
    ['wins', 'W', 'Win credited to this goalie.'],
    ['losses', 'L', 'Loss credited to this goalie.'],
    ['ties', 'T', 'Tie credited to this goalie.'],
    ['shutouts', 'SO', 'Complete game with no goals against.']
  ];

  const HELP = {
    season: 'Stats and games are grouped by season.',
    homeAway: 'Choose where your team is listed for this game.',
    gameType: 'League, exhibition, tournament, or playoff — used only for filtering.'
  };

  function createCoachQol({ client, getContext, onChanged }) {
    let draft = { skaters: {}, goalies: {}, gameId: null };
    let dirty = false;
    let saveState = SAVE_STATES.IDLE;
    let pendingAction = null;
    let statHistory = [];

    function esc(value) {
      return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function help(text) {
      return `<button class="help-bubble" type="button" aria-label="Help" data-help="${esc(text)}">?</button>`;
    }

    function context() {
      const ctx = getContext?.() || {};
      return {
        teamId: ctx.teamId || '',
        seasonId: ctx.seasonId || '',
        seasonKey: ctx.seasonKey || '',
        capabilities: ctx.capabilities || [],
        schedule: ctx.schedule || [],
        roster: ctx.roster || []
      };
    }

    function canWrite(capability) {
      return context().capabilities.includes(capability);
    }

    function numeric(value, label) {
      if (value === '' || value === null || value === undefined) return 0;
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`${label} must be a number.`);
      if (n < 0) throw new Error(`${label} cannot be negative.`);
      return n;
    }

    function findDuplicateGames(date, opponent, excludeId = '') {
      return (context().schedule || []).filter(game =>
        game.id !== excludeId
        && String(game.date) === String(date)
        && String(game.opponent || '').trim().toLowerCase() === String(opponent || '').trim().toLowerCase()
      );
    }

    // ---------- Games (schedule) ----------

    async function addGame(fields) {
      if (pendingAction === 'add-game') throw new Error('This game is already being added.');
      const { teamId, seasonId } = context();
      if (!teamId) throw new Error('No team is selected.');
      if (!seasonId) throw new Error('No season is selected.');
      if (!canWrite('schedule.edit')) throw new Error('You do not have schedule editing access.');
      // Eager shells mean adding a schedule game also creates a canonical game
      // row, so games.edit is genuinely required. Checked BEFORE the insert so
      // an unauthorized add cannot leave an orphaned schedule row behind. The
      // database enforces this again inside ensure_schedule_game_shell.
      if (!canWrite('games.edit')) throw new Error('You do not have game creation access for this team.');
      const date = String(fields.date || '').trim();
      const opponent = String(fields.opponent || '').trim();
      if (!date) throw new Error('Choose the game date.');
      if (!opponent) throw new Error('Enter the opponent.');
      pendingAction = 'add-game';
      try {
        const record = {
          team_id: teamId,
          source_schedule_id: crypto.randomUUID(),
          season_id: seasonId,
          date,
          time: fields.time || null,
          opponent,
          home_away: fields.homeAway === 'Away' ? 'Away' : 'Home',
          game_type: fields.gameType || 'League',
          location: String(fields.location || '').trim()
        };
        const { data, error } = await client.from('team_schedule_games').insert(record).select().single();
        if (error) throw new Error(error.message);
        // Eager canonical shell: Game Center reads team_games, so the game must
        // exist there immediately. The RPC is idempotent and row-locked, so a
        // double-click or retry can never produce a second game.
        const linked = await ensureGameShell(data.id);
        await onChanged?.('schedule');
        return { ...data, linked_game_source_id: linked };
      } finally {
        pendingAction = null;
      }
    }

    // Resolves the one canonical team_games row for a schedule entry. All
    // duplicate prevention, authorization, and doubleheader handling live in
    // the database function; this is a thin, honest passthrough.
    async function ensureGameShell(scheduleId) {
      if (!scheduleId) throw new Error('The game to link could not be identified.');
      const { data, error } = await client.rpc('ensure_schedule_game_shell', { target_schedule_id: scheduleId });
      if (error) throw new Error(error.message);
      return data;
    }

    async function editGame(scheduleId, fields) {
      if (pendingAction === 'edit-game') throw new Error('This game is already being updated.');
      const { teamId, seasonId } = context();
      if (!teamId) throw new Error('No team is selected.');
      if (!seasonId) throw new Error('No season is selected.');
      if (!canWrite('schedule.edit')) throw new Error('You do not have schedule editing access.');
      const date = String(fields.date || '').trim();
      const opponent = String(fields.opponent || '').trim();
      if (!scheduleId) throw new Error('The game to edit could not be identified.');
      if (!date) throw new Error('Choose the game date.');
      if (!opponent) throw new Error('Enter the opponent.');
      const patch = {
        target_schedule_id: scheduleId,
        new_date: date,
        new_opponent: opponent,
        new_time: fields.time || null,
        new_home_away: fields.homeAway === 'Away' ? 'Away' : 'Home',
        new_game_type: fields.gameType || 'League',
        new_location: String(fields.location || '').trim(),
        new_notes: String(fields.notes || '').trim(),
        // Omitting a season means "leave it as-is". Only an explicit season
        // correction is sent, and the server proves it belongs to this team.
        new_season_id: fields.seasonId || null
      };
      // One transactional RPC updates the schedule row and its linked canonical
      // game together. Doing this as two client writes could leave the rows
      // divergent, and would let a schedule-only editor mutate a game row they
      // lack games.edit on. The function re-checks both capabilities server-side
      // and never rewrites source_game_id, so existing stats stay attached.
      pendingAction = 'edit-game';
      try {
        const { data, error } = await client.rpc('save_schedule_game', patch);
        if (error) throw new Error(error.message);
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) throw new Error('That game was not found on this team.');
        await onChanged?.('schedule');
        return row;
      } finally {
        pendingAction = null;
      }
    }

    async function deleteGame(scheduleId) {
      const { teamId } = context();
      if (!teamId) throw new Error('No team is selected.');
      if (!canWrite('schedule.edit')) throw new Error('You do not have schedule editing access.');
      if (!scheduleId) throw new Error('The game to delete could not be identified.');
      const { error } = await client.from('team_schedule_games').delete().eq('id', scheduleId).eq('team_id', teamId);
      if (error) throw new Error(error.message);
      await onChanged?.('schedule');
      return true;
    }

    async function saveScore(gameId, goalsFor, goalsAgainst) {
      const { teamId, seasonId } = context();
      if (!teamId) throw new Error('No team is selected.');
      if (!seasonId) throw new Error('No season is selected.');
      if (!canWrite('stats.edit')) throw new Error('You do not have score editing access.');
      if (!gameId) throw new Error('The game to score could not be identified.');
      const parseScore = (value, label) => {
        const score = numeric(value, label);
        if (!Number.isInteger(score)) throw new Error(`${label} must be a whole number.`);
        return score;
      };
      const { data, error } = await client.rpc('save_game_score', {
        target_team_id: teamId,
        target_season_id: seasonId,
        target_source_game_id: gameId,
        target_goals_for: parseScore(goalsFor, 'Our score'),
        target_goals_against: parseScore(goalsAgainst, 'Opponent score')
      });
      if (error) throw new Error(error.message);
      await onChanged?.('score');
      return data;
    }

    async function submitScoreForm(form) {
      const button = form.querySelector('[data-score-save]');
      const status = form.querySelector('[data-score-status]');
      if (button.disabled) return;
      button.disabled = true;
      button.textContent = 'Saving…';
      status.textContent = '';
      status.className = 'coach-form-status';
      try {
        const result = await saveScore(form.gameId.value, form.goalsFor.value, form.goalsAgainst.value);
        button.textContent = '✓ Score Saved';
        const record = result?.season_record || result?.record;
        const outcome = Number(form.goalsFor.value) > Number(form.goalsAgainst.value) ? 'W'
          : Number(form.goalsFor.value) < Number(form.goalsAgainst.value) ? 'L' : 'T';
        status.textContent = record
          ? `Score saved. Record: ${record.wins || 0}–${record.losses || 0}–${record.ties || 0}.`
          : `Score saved: ${form.goalsFor.value}–${form.goalsAgainst.value} (${outcome}). Team record updated.`;
        status.classList.add('ok');
      } catch (error) {
        button.disabled = false;
        button.textContent = 'Save Score';
        status.textContent = error.message || 'The score could not be saved.';
        status.classList.add('err');
      }
    }

    function gameFormHtml(existing = null) {
      const g = existing || {};
      // Each help bubble sits OUTSIDE the <label>. A <button> nested inside a
      // label re-forwards activation to the control, which toggled the native
      // date picker open-then-closed. Explicit for/id association keeps the
      // label clickable without wrapping the input.
      return `<form class="coach-form" data-game-form>
        <input type="hidden" name="scheduleId" value="${esc(g.id || '')}" />
        <div class="coach-field"><span class="coach-field-label"><label for="coachGameDate">Date</label>${help(HELP.season)}</span><input id="coachGameDate" name="date" type="date" required value="${esc(g.date || '')}" /></div>
        <label>Opponent<input name="opponent" type="text" maxlength="120" required placeholder="Opponent name" value="${esc(g.opponent || '')}" /></label>
        <label>Time<input name="time" type="time" value="${esc(g.time || '')}" /></label>
        <div class="coach-field"><span class="coach-field-label"><label for="coachGameHomeAway">Home / Away</label>${help(HELP.homeAway)}</span><select id="coachGameHomeAway" name="homeAway"><option${g.home_away !== 'Away' ? ' selected' : ''}>Home</option><option${g.home_away === 'Away' ? ' selected' : ''}>Away</option></select></div>
        <div class="coach-field"><span class="coach-field-label"><label for="coachGameType">Type</label>${help(HELP.gameType)}</span><select id="coachGameType" name="gameType">${['League', 'Exhibition', 'Tournament', 'Playoff'].map(t => `<option${(g.game_type || 'League') === t ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
        <label>Location<input name="location" type="text" maxlength="160" placeholder="Arena (optional)" value="${esc(g.location || '')}" /></label>
        <button class="btn primary" type="submit" data-save-button>${existing ? SAVE_LABELS.idle : 'Add Game'}</button>
        <div class="coach-form-status" role="status" aria-live="polite"></div>
      </form>`;
    }

    // Chromium only opens the native calendar from the small indicator icon.
    // showPicker() makes a normal click/tap on the field open it, and degrades
    // silently where the API is unavailable or refuses the gesture.
    function enhanceDateInputs(scope) {
      if (!scope || typeof scope.querySelectorAll !== 'function') return 0;
      let bound = 0;
      scope.querySelectorAll('input[type="date"], input[type="time"]').forEach(input => {
        if (input.dataset.pickerBound === 'true') return;
        input.dataset.pickerBound = 'true';
        bound += 1;
        input.addEventListener('click', () => {
          if (typeof input.showPicker !== 'function') return;
          try {
            input.showPicker();
          } catch (error) {
            // Unsupported or blocked gesture — the native indicator still works.
          }
        });
      });
      return bound;
    }

    async function submitGameForm(form) {
      const button = form.querySelector('[data-save-button]');
      const status = form.querySelector('.coach-form-status');
      const isEdit = Boolean(form.scheduleId.value);
      if (button.disabled) return;
      const fields = {
        date: form.date.value,
        opponent: form.opponent.value,
        time: form.time.value,
        homeAway: form.homeAway.value,
        gameType: form.gameType.value,
        location: form.location.value,
        notes: form.notes?.value || ''
      };
      const duplicates = findDuplicateGames(fields.date, fields.opponent, form.scheduleId.value);
      button.disabled = true;
      button.textContent = isEdit ? SAVE_LABELS.saving : 'Adding…';
      status.textContent = '';
      status.className = 'coach-form-status';
      try {
        if (isEdit) await editGame(form.scheduleId.value, fields);
        else await addGame(fields);
        button.textContent = SAVE_LABELS.saved;
        status.textContent = isEdit ? 'Game updated.' : 'Game added successfully.';
        status.classList.add('ok');
        if (duplicates.length && !isEdit) {
          status.textContent += ` Note: ${duplicates.length} other game${duplicates.length === 1 ? '' : 's'} vs ${fields.opponent} on this date already exist${duplicates.length === 1 ? 's' : ''} (doubleheader is fine).`;
        }
      } catch (error) {
        button.disabled = false;
        button.textContent = SAVE_LABELS.error;
        status.textContent = error.message || 'The game could not be saved.';
        status.classList.add('err');
      }
    }

    // ---------- Stats ----------

    function openGame(gameId, skaterRows, goalieRows) {
      draft = { skaters: {}, goalies: {}, gameId };
      statHistory = [];
      (skaterRows || []).forEach(row => {
        draft.skaters[row.source_player_id] = { ...row };
      });
      (goalieRows || []).forEach(row => {
        draft.goalies[row.source_player_id] = { ...row };
      });
      dirty = false;
      saveState = SAVE_STATES.IDLE;
    }

    function setStat(playerType, playerId, field, value, label) {
      const n = field === 'plus_minus' ? Number(value || 0) : numeric(value, label || field);
      if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error(`${label || field} must be a whole number.`);
      if (saveState === SAVE_STATES.SAVING) throw new Error('Wait for the current save to finish.');
      const bucket = playerType === 'goalie' ? draft.goalies : draft.skaters;
      if (bucket[playerId]?.gp === 0) throw new Error('Mark this player present before entering stats.');
      statHistory.push({ playerType, playerId, field, value: bucket[playerId]?.[field], row: bucket[playerId] ? { ...bucket[playerId] } : null, dirty });
      if (!bucket[playerId]) bucket[playerId] = {};
      bucket[playerId][field] = n;
      dirty = true;
      saveState = SAVE_STATES.IDLE;
      return n;
    }

    function setAbsent(playerType, playerId, absent) {
      if (saveState === SAVE_STATES.SAVING) throw new Error('Wait for the current save to finish.');
      const bucket = playerType === 'goalie' ? draft.goalies : draft.skaters;
      const existing = bucket[playerId] || {};
      const unsupported = playerType === 'goalie' ? [] : ['faceoff_attempts', 'power_play_assists', 'short_handed_assists', 'game_winning_goals', 'game_tying_goals', 'takeaways', 'giveaways', 'chances', 'toi_minutes'];
      if (absent && unsupported.some(field => Number(existing[field] || 0) !== 0)) throw new Error('This player has additional recorded stats that this form cannot clear. Review the full game record before marking absent.');
      if (absent) bucket[playerId] = { gp: 0, ...Object.fromEntries((playerType === 'goalie' ? GOALIE_FIELDS : SKATER_FIELDS).map(([field]) => [field, 0])), power_play_goals: 0, power_play_points: 0, short_handed_goals: 0, short_handed_points: 0, minutes: 0 };
      else bucket[playerId] = { ...existing, gp: 1 };
      dirty = true;
      saveState = SAVE_STATES.IDLE;
      return bucket[playerId];
    }

    function undoStat() {
      if (saveState === SAVE_STATES.SAVING) return null;
      const change = statHistory.pop();
      if (!change) return null;
      const bucket = change.playerType === 'goalie' ? draft.goalies : draft.skaters;
      if (change.row) bucket[change.playerId] = change.row;
      else delete bucket[change.playerId];
      dirty = change.dirty;
      saveState = SAVE_STATES.IDLE;
      return change;
    }

    function derivedSkater(row) {
      const g = Number(row?.goals || 0);
      const a = Number(row?.assists || 0);
      const shots = Number(row?.shots || 0);
      return { points: g + a, shotPct: shots > 0 ? g / shots : null };
    }

    function derivedGoalie(row) {
      const saves = Number(row?.saves || 0);
      const ga = Number(row?.goals_against || 0);
      const sa = saves + ga;
      return { shotsAgainst: sa, savePct: sa > 0 ? saves / sa : null };
    }

    async function saveStats() {
      const { teamId, seasonId } = context();
      if (!teamId) throw new Error('No team is selected.');
      if (!seasonId) throw new Error('No season is selected.');
      if (!canWrite('stats.edit')) throw new Error('You do not have stats editing access.');
      if (!draft.gameId) throw new Error('Open a game before saving stats.');
      if (saveState === SAVE_STATES.SAVING) throw new Error('Stats are already being saved.');
      saveState = SAVE_STATES.SAVING;
      try {
        const skaters = Object.entries(draft.skaters).map(([playerId, row]) => ({
          source_player_id: playerId,
          gp: numeric(row.gp ?? 1, 'GP'),
          goals: numeric(row.goals, 'Goals'),
          assists: numeric(row.assists, 'Assists'),
          shots: numeric(row.shots, 'Shots'),
          penalty_minutes: numeric(row.penalty_minutes, 'PIM'),
          plus_minus: Number(row.plus_minus || 0),
          blocks: numeric(row.blocks, 'Blocks'),
          faceoff_wins: numeric(row.faceoff_wins, 'Faceoffs won'),
          faceoff_losses: numeric(row.faceoff_losses, 'Faceoffs lost'),
          power_play_goals: numeric(row.power_play_goals, 'PPG'),
          power_play_points: numeric(row.power_play_points, 'PPP'),
          short_handed_goals: numeric(row.short_handed_goals, 'SHG'),
          short_handed_points: numeric(row.short_handed_points, 'SHP')
        }));
        const goalies = Object.entries(draft.goalies).map(([playerId, row]) => ({
          source_player_id: playerId,
          gp: numeric(row.gp ?? 1, 'GP'),
          minutes: numeric(row.minutes ?? 0, 'Minutes'),
          saves: numeric(row.saves, 'Saves'),
          goals_against: numeric(row.goals_against, 'Goals against'),
          wins: numeric(row.wins, 'Wins'),
          losses: numeric(row.losses, 'Losses'),
          ties: numeric(row.ties, 'Ties'),
          shutouts: numeric(row.shutouts, 'Shutouts')
        }));
        const { error } = await client.rpc('save_game_stats', {
          target_team_id: teamId,
          target_season_id: seasonId,
          target_source_game_id: draft.gameId,
          skater_stats: skaters,
          goalie_stats: goalies,
          team_stats: null
        });
        if (error) throw new Error(error.message);
        saveState = SAVE_STATES.SAVED;
        statHistory = [];
        dirty = false;
        await onChanged?.('stats');
        return true;
      } catch (error) {
        saveState = SAVE_STATES.ERROR;
        // Edits stay in the draft so nothing is silently discarded.
        throw error;
      }
    }

    function statCell(playerType, playerId, field, helpText) {
      const bucket = playerType === 'goalie' ? draft.goalies : draft.skaters;
      const value = bucket[playerId]?.[field] ?? '';
      return `<input class="stat-input" type="number" ${field === 'plus_minus' ? '' : 'min="0"'} step="1" inputmode="numeric" data-stat-type="${playerType}" data-stat-player="${esc(playerId)}" data-stat-field="${field}" value="${esc(value)}" aria-label="${esc(helpText)}" ${bucket[playerId]?.gp === 0 ? 'disabled' : ''} />`;
    }

    function statsWorkspaceHtml(roster, existingSkaters = [], existingGoalies = []) {
      roster = global.PuckWorkspace ? global.PuckWorkspace.sortRoster(roster) : roster;
      const skaters = (roster || []).filter(p => p.position !== 'G');
      const goalies = (roster || []).filter(p => p.position === 'G');
      if (!skaters.length && !goalies.length) {
        return `<div class="coach-empty"><h2>Your roster is empty</h2><p>Add players before entering game stats.</p><button class="btn primary" data-coach-goto="roster" type="button">Add Player</button></div>`;
      }
      const skaterRows = skaters.map(p => {
        const row = draft.skaters[p.source_player_id] || existingSkaters.find(s => s.source_player_id === p.source_player_id) || {};
        const d = derivedSkater(row);
        return `<div class="stat-row" role="row">
          <div class="stat-row-head"><span class="stat-jersey">#${esc(p.jersey_number)}</span><strong>${esc(p.name)}</strong><button class="btn" type="button" data-player-absent="${esc(p.source_player_id)}" data-player-type="skater" aria-pressed="${row.gp === 0 ? 'true' : 'false'}">${row.gp === 0 ? 'Absent ✓' : 'Absent'}</button></div>
          <div class="stat-fields">${SKATER_FIELDS.map(([field, label, helpText]) => `<label>${esc(label)}${['G', 'S', '+/−', 'FOW', 'FOL'].includes(label) ? help(helpText) : ''}${statCell('skater', p.source_player_id, field, helpText)}</label>`).join('')}</div>
          <div class="stat-derived"><span>PTS ${d.points}</span><span>S% ${d.shotPct === null ? '—' : (d.shotPct * 100).toFixed(1)}</span></div>
        </div>`;
      }).join('');
      const goalieRows = goalies.map(p => {
        const row = draft.goalies[p.source_player_id] || existingGoalies.find(s => s.source_player_id === p.source_player_id) || {};
        const d = derivedGoalie(row);
        return `<div class="stat-row goalie" role="row">
          <div class="stat-row-head"><span class="stat-jersey">#${esc(p.jersey_number)}</span><strong>${esc(p.name)}</strong><span class="tag">Goalie</span><button class="btn" type="button" data-player-absent="${esc(p.source_player_id)}" data-player-type="goalie" aria-pressed="${row.gp === 0 ? 'true' : 'false'}">${row.gp === 0 ? 'Absent ✓' : 'Absent'}</button></div>
          <div class="stat-fields">${GOALIE_FIELDS.map(([field, label, helpText]) => `<label>${esc(label)}${statCell('goalie', p.source_player_id, field, helpText)}</label>`).join('')}</div>
          <div class="stat-derived"><span>SA ${d.shotsAgainst}</span><span>SV% ${d.savePct === null ? '—' : (d.savePct * 100).toFixed(1)}</span></div>
        </div>`;
      }).join('');
      return `<div class="stats-workspace">
        ${skaters.length ? `<h3 class="stat-group">Skaters</h3>${skaterRows}` : ''}
        ${goalies.length ? `<h3 class="stat-group">Goalies</h3>${goalieRows}` : ''}
        <div class="stats-save-bar">
          <span class="dirty-flag" data-dirty-flag>${dirty ? 'Unsaved changes' : ''}</span>
          <button class="btn primary" type="button" data-save-stats ${saveState === SAVE_STATES.SAVING ? 'disabled' : ''}>${saveState === SAVE_STATES.IDLE ? 'SAVE GAME STATS' : SAVE_LABELS[saveState]}</button>
          <span class="coach-form-status" data-stats-status role="status" aria-live="polite"></span>
        </div>
      </div>`;
    }

    // ---------- Roster ----------

    async function addPlayer(fields) {
      const { teamId, seasonId } = context();
      if (!teamId) throw new Error('No team is selected.');
      if (!canWrite('players.evaluate')) throw new Error('You do not have roster editing access.');
      const jersey = String(fields.jerseyNumber || '').trim();
      const name = String(fields.name || '').trim();
      const position = String(fields.position || 'F').trim().toUpperCase();
      const nameParts = name.split(/\s+/).filter(Boolean);
      if (!jersey) throw new Error('Enter a jersey number.');
      if (!name) throw new Error('Enter the player name.');
      if (nameParts.length < 2) throw new Error('Enter the player first and last name.');
      if (!['F', 'D', 'G'].includes(position)) throw new Error('Position must be F, D, or G.');
      const existing = (context().roster || []).find(p => String(p.jersey_number) === jersey);
      if (existing) throw new Error(`Jersey #${jersey} is already assigned to ${existing.name}.`);
      const { data, error } = await client.from('team_roster_players').insert({
        team_id: teamId,
        season_id: seasonId || null,
        source_player_id: `web-${crypto.randomUUID()}`,
        jersey_number: jersey,
        name,
        first_name: nameParts.shift(),
        last_name: nameParts.join(' '),
        position,
        player_type: position === 'G' ? 'goalie' : 'skater',
        status: 'active'
      }).select().single();
      if (error) throw new Error(error.message);
      await onChanged?.('roster');
      return data;
    }

    function parseBulkRoster(text) {
      const seen = new Set((context().roster || []).map(player => String(player.jersey_number).trim()));
      const rows = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      if (!rows.length) throw new Error('Paste at least one player row.');
      return rows.map((line, index) => {
        const parts = line.split(/\t|,/).map(value => value.trim()).filter(Boolean);
        if (parts.length !== 3) throw new Error(`Row ${index + 1} must be Jersey, Name, Position.`);
        const [jerseyNumber, name, position] = parts;
        if (!/^\d{1,4}$/.test(jerseyNumber)) throw new Error(`Row ${index + 1} has an invalid jersey number.`);
        if (!['F', 'D', 'G'].includes(position.toUpperCase())) throw new Error(`Row ${index + 1} position must be F, D, or G.`);
        if (name.split(/\s+/).filter(Boolean).length < 2) throw new Error(`Row ${index + 1} needs a first and last name.`);
        if (seen.has(jerseyNumber)) throw new Error(`Row ${index + 1} duplicates jersey #${jerseyNumber}.`);
        seen.add(jerseyNumber);
        return { jerseyNumber, name, position: position.toUpperCase() };
      });
    }

    async function addPlayersBulk(text) {
      const players = parseBulkRoster(text);
      for (const player of players) await addPlayer(player);
      return players.length;
    }

    async function editPlayer(playerId, fields) {
      const { teamId } = context();
      if (!teamId) throw new Error('No team is selected.');
      if (!canWrite('players.evaluate')) throw new Error('You do not have roster editing access.');
      const name = String(fields.name || '').trim();
      const position = String(fields.position || 'F').trim().toUpperCase();
      const nameParts = name.split(/\s+/).filter(Boolean);
      if (!name) throw new Error('Enter the player name.');
      if (nameParts.length < 2) throw new Error('Enter the player first and last name.');
      if (!['F', 'D', 'G'].includes(position)) throw new Error('Position must be F, D, or G.');
      const clash = (context().roster || []).find(p => p.id !== playerId && String(p.jersey_number) === String(fields.jerseyNumber).trim());
      if (clash) throw new Error(`Jersey #${String(fields.jerseyNumber).trim()} is already assigned to ${clash.name}.`);
      const { data, error } = await client.from('team_roster_players').update({
        jersey_number: String(fields.jerseyNumber || '').trim(),
        name,
        first_name: nameParts.shift(),
        last_name: nameParts.join(' '),
        position,
        player_type: position === 'G' ? 'goalie' : 'skater',
        updated_at: new Date().toISOString()
      }).eq('id', playerId).eq('team_id', teamId).select();
      if (error) throw new Error(error.message);
      if (!data || !data.length) throw new Error('That player was not found on this team.');
      await onChanged?.('roster');
      return data[0];
    }

    async function removePlayer(playerId) {
      const { teamId } = context();
      if (!teamId) throw new Error('No team is selected.');
      if (!canWrite('players.evaluate')) throw new Error('You do not have roster editing access.');
      const { data, error } = await client.from('team_roster_players')
        .update({ status: 'inactive', updated_at: new Date().toISOString() })
        .eq('id', playerId)
        .eq('team_id', teamId)
        .select();
      if (error) throw new Error(error.message);
      if (!data || !data.length) throw new Error('That player was not found on this team.');
      await onChanged?.('roster');
      return true;
    }

    // Roster edit form. Mirrors the schedule edit pattern: the player's row ID
    // is carried in a hidden field so the save updates that exact roster row.
    function playerEditFormHtml(player) {
      const p = player || {};
      const position = String(p.position || 'F').toUpperCase();
      return `<form class="coach-form quick-add" data-player-edit-form>
        <input type="hidden" name="playerId" value="${esc(p.id || '')}" />
        <input name="jerseyNumber" type="text" inputmode="numeric" maxlength="4" placeholder="#" aria-label="Jersey number" required value="${esc(p.jersey_number || '')}" />
        <input name="name" type="text" maxlength="120" placeholder="Player name" aria-label="Player name" required value="${esc(p.name || '')}" />
        <select name="position" aria-label="Position">${[['F', 'Forward'], ['D', 'Defense'], ['G', 'Goalie']].map(([value, label]) => `<option value="${value}"${position === value ? ' selected' : ''}>${label}</option>`).join('')}</select>
        <button class="btn primary" type="submit" data-save-button>${SAVE_LABELS.idle}</button>
        <button class="btn" type="button" data-cancel-player-edit>Cancel</button>
        <div class="coach-form-status" role="status" aria-live="polite"></div>
      </form>`;
    }

    async function submitPlayerEditForm(form) {
      const button = form.querySelector('[data-save-button]');
      const status = form.querySelector('.coach-form-status');
      if (button.disabled) return;
      button.disabled = true;
      button.textContent = SAVE_LABELS.saving;
      status.textContent = '';
      status.className = 'coach-form-status';
      try {
        const player = await editPlayer(form.playerId.value, {
          jerseyNumber: form.jerseyNumber.value,
          name: form.name.value,
          position: form.position.value
        });
        button.textContent = SAVE_LABELS.saved;
        status.textContent = `Player #${player.jersey_number} updated.`;
        status.classList.add('ok');
        return player;
      } catch (error) {
        button.disabled = false;
        button.textContent = SAVE_LABELS.error;
        status.textContent = error.message || 'The player could not be saved.';
        status.classList.add('err');
        throw error;
      }
    }

    function rosterWorkspaceHtml(roster) {
      const rows = (global.PuckWorkspace ? global.PuckWorkspace.sortRoster(roster) : (roster || []).slice().sort((a, b) => Number(a.jersey_number) - Number(b.jersey_number))).map(p => `
        <div class="roster-row">
          <span class="stat-jersey">#${esc(p.jersey_number)}</span>
          <strong>${esc(p.name)}</strong>
          <span class="tag">${esc(p.position)}</span>
          <button class="btn admin-action" type="button" data-edit-player="${esc(p.id)}">Edit</button>
          <button class="btn admin-action danger" type="button" data-remove-player="${esc(p.id)}">Remove</button>
        </div>`).join('');
      return `<div class="roster-workspace">
        <details class="workspace-disclosure"><summary>Paste multiple players</summary><form class="coach-form bulk-roster" data-bulk-roster-form>
          <label>Paste roster rows<textarea name="rosterRows" rows="5" placeholder="7, Jane Smith, F&#10;30, Sam Ray, G" required></textarea></label>
          <p class="sub">One player per line: jersey, full name, position (F, D, or G).</p>
          <button class="btn primary" type="submit" data-save-button>Add pasted roster</button>
          <div class="coach-form-status" role="status" aria-live="polite"></div>
        </form>
        </details><form class="coach-form quick-add" data-player-form>
          <input name="jerseyNumber" type="text" inputmode="numeric" maxlength="4" placeholder="#" aria-label="Jersey number" required />
          <input name="name" type="text" maxlength="120" placeholder="Player name" aria-label="Player name" required />
          <select name="position" aria-label="Position"><option value="F">Forward</option><option value="D">Defense</option><option value="G">Goalie</option></select>
          <button class="btn primary" type="submit" data-save-button>Add Player</button>
          <div class="coach-form-status" role="status" aria-live="polite"></div>
        </form>
        <div class="roster-list">${rows || '<div class="coach-empty"><h2>Your roster is empty</h2><p>Add players before entering game stats.</p></div>'}</div>
      </div>`;
    }

    async function submitPlayerForm(form) {
      const button = form.querySelector('[data-save-button]');
      const status = form.querySelector('.coach-form-status');
      if (button.disabled) return;
      button.disabled = true;
      button.textContent = SAVE_LABELS.saving;
      status.textContent = '';
      status.className = 'coach-form-status';
      try {
        const player = await addPlayer({
          jerseyNumber: form.jerseyNumber.value,
          name: form.name.value,
          position: form.position.value
        });
        button.textContent = SAVE_LABELS.saved;
        status.textContent = `Player #${player.jersey_number} added.`;
        status.classList.add('ok');
        form.reset();
        form.jerseyNumber.focus();
        setTimeout(() => { button.disabled = false; button.textContent = 'Add Player'; }, 900);
      } catch (error) {
        button.disabled = false;
        button.textContent = SAVE_LABELS.error;
        status.textContent = error.message;
        status.classList.add('err');
      }

    }

    async function submitBulkRosterForm(form) {
      const button = form.querySelector('[data-save-button]');
      const status = form.querySelector('.coach-form-status');
      if (button.disabled) return;
      button.disabled = true;
      button.textContent = 'Validating…';
      status.textContent = '';
      status.className = 'coach-form-status';
      try {
        const count = await addPlayersBulk(form.rosterRows.value);
        button.textContent = '✓ Roster Added';
        status.textContent = `${count} player${count === 1 ? '' : 's'} added.`;
        status.classList.add('ok');
        form.reset();
      } catch (error) {
        button.disabled = false;
        button.textContent = 'Add pasted roster';
        status.textContent = error.message || 'The roster could not be added.';
        status.classList.add('err');
      }
    }

    return {
      SAVE_STATES,
      context,
      findDuplicateGames,
      gameFormHtml,
      enhanceDateInputs,
      ensureGameShell,
      submitGameForm,
      addGame,
      editGame,
      deleteGame,
      saveScore,
      submitScoreForm,
      openGame,
      setStat,
      setAbsent,
      undoStat,
      get canUndo() { return statHistory.length > 0; },
      saveStats,
      derivedSkater,
      derivedGoalie,
      statsWorkspaceHtml,
      rosterWorkspaceHtml,
      playerEditFormHtml,
      submitPlayerEditForm,
      submitPlayerForm,
      submitBulkRosterForm,
      parseBulkRoster,
      addPlayersBulk,
      addPlayer,
      editPlayer,
      removePlayer,
      get dirty() { return dirty; },
      get saveState() { return saveState; }
    };
  }

  global.FoxesCoachQol = { createCoachQol, SAVE_STATES, SAVE_LABELS, SKATER_FIELDS, GOALIE_FIELDS };
}(window));
