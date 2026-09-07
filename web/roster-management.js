(function attachRosterManagement(global) {
  const POSITIONS = new Set(['F', 'D', 'G']);
  const PLAYER_TYPES = new Set(['skater', 'goalie']);
  const SHOOTS = new Set(['L', 'R', 'unknown']);
  const STATUSES = new Set(['active', 'inactive']);

  function clean(value) {
    return String(value ?? '').trim();
  }

  function normalizePlayer(input = {}) {
    const firstName = clean(input.first_name);
    const lastName = clean(input.last_name);
    return {
      jersey_number: clean(input.jersey_number),
      first_name: firstName,
      last_name: lastName,
      position: clean(input.position).toUpperCase(),
      player_type: clean(input.player_type).toLowerCase() || 'skater',
      shoots: clean(input.shoots).toUpperCase() || 'UNKNOWN',
      notes: clean(input.notes),
      status: clean(input.status).toLowerCase() || 'active'
    };
  }

  function validatePlayer(input) {
    const player = normalizePlayer(input);
    const errors = [];
    if (!/^\d{1,3}$/.test(player.jersey_number)) errors.push('Jersey number must be one to three digits.');
    if (!player.first_name) errors.push('First name is required.');
    if (!player.last_name) errors.push('Last name is required.');
    if (!POSITIONS.has(player.position)) errors.push('Position must be F, D, or G.');
    if (!PLAYER_TYPES.has(player.player_type)) errors.push('Player type must be skater or goalie.');
    if (player.player_type === 'goalie' && player.position !== 'G') errors.push('Goalies must use position G.');
    if (player.player_type === 'skater' && player.position === 'G') errors.push('Skaters cannot use position G.');
    if (player.shoots === 'UNKNOWN') player.shoots = 'unknown';
    if (!SHOOTS.has(player.shoots)) errors.push('Shoots must be L, R, or unknown.');
    if (!STATUSES.has(player.status)) errors.push('Status must be active or inactive.');
    return { player, errors };
  }

  function duplicateKind(candidate, existing) {
    const first = candidate.first_name.toLowerCase();
    const last = candidate.last_name.toLowerCase();
    return (existing || []).find(row => {
      const rowFirst = clean(row.first_name || row.name?.split(/\s+/)[0]).toLowerCase();
      const rowLast = clean(row.last_name || row.name?.replace(/^\S+\s*/, '')).toLowerCase();
      return (rowFirst === first && rowLast === last)
        || (clean(row.jersey_number) === candidate.jersey_number && rowLast === last);
    }) || null;
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let index = 0; index < String(text || '').length; index += 1) {
      const character = text[index];
      const next = text[index + 1];
      if (character === '"' && quoted && next === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = !quoted;
      } else if (character === ',' && !quoted) {
        row.push(cell);
        cell = '';
      } else if ((character === '\n' || character === '\r') && !quoted) {
        if (character === '\r' && next === '\n') index += 1;
        row.push(cell);
        if (row.some(value => clean(value))) rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += character;
      }
    }
    row.push(cell);
    if (row.some(value => clean(value))) rows.push(row);
    if (!rows.length) return [];
    const headers = rows.shift().map(value => clean(value).toLowerCase());
    return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
  }

  function createRosterManagement({ client, getWorkspace }) {
    let workspace = null;

    function setWorkspace(nextWorkspace) {
      workspace = nextWorkspace || null;
      return workspace;
    }

    function clearWorkspace() {
      workspace = null;
    }

    function requireWorkspace() {
      if (!workspace?.authorized || !workspace.team_id) {
        throw new Error('An authorized team workspace is required.');
      }
      return workspace;
    }

    function currentWorkspace() {
      return getWorkspace?.() || workspace;
    }

    async function createPlayer(input) {
      const current = currentWorkspace();
      if (!current?.authorized || !current.team_id) throw new Error('An authorized team workspace is required.');
      const { player, errors } = validatePlayer(input);
      if (errors.length) throw new Error(errors.join(' '));
      const { data, error } = await client.from('team_roster_players')
        .insert({ ...player, team_id: current.team_id, season_id: current.season_id || null })
        .select('id,team_id,season_id,source_player_id,jersey_number,name,first_name,last_name,position,player_type,shoots,notes,status,created_by,updated_by')
        .maybeSingle();
      if (error) throw new Error(error.message || 'Player could not be added.');
      return data;
    }

    async function updatePlayer(playerId, input) {
      const current = currentWorkspace();
      if (!current?.authorized || !current.team_id) throw new Error('An authorized team workspace is required.');
      if (!playerId) throw new Error('A player ID is required.');
      const { player, errors } = validatePlayer(input);
      if (errors.length) throw new Error(errors.join(' '));
      const { data, error } = await client.from('team_roster_players')
        .update(player)
        .eq('id', playerId)
        .eq('team_id', current.team_id)
        .select('id,team_id,season_id,source_player_id,jersey_number,name,first_name,last_name,position,player_type,shoots,notes,status,created_by,updated_by')
        .maybeSingle();
      if (error) throw new Error(error.message || 'Player could not be updated.');
      if (!data) throw new Error('Player was not found in the selected team workspace.');
      return data;
    }

    async function setStatus(playerId, status) {
      const current = currentWorkspace();
      if (!current?.authorized || !current.team_id) throw new Error('An authorized team workspace is required.');
      if (!STATUSES.has(status)) throw new Error('Invalid roster status.');
      const { data, error } = await client.from('team_roster_players')
        .update({ status })
        .eq('id', playerId)
        .eq('team_id', current.team_id)
        .select('id,status')
        .maybeSingle();
      if (error) throw new Error(error.message || 'Player status could not be changed.');
      if (!data) throw new Error('Player was not found in the selected team workspace.');
      return data;
    }

    function validateImport(rows, existing = []) {
      const valid = [];
      const errors = [];
      const duplicates = [];
      rows.forEach((row, index) => {
        const result = validatePlayer(row);
        if (result.errors.length) {
          errors.push({ row: index + 2, errors: result.errors });
          return;
        }
        const duplicate = duplicateKind(result.player, [...existing, ...valid]);
        if (duplicate) {
          duplicates.push({ row: index + 2, player: result.player, existing: duplicate });
          return;
        }
        valid.push(result.player);
      });
      return { valid, errors, duplicates };
    }

    async function importPlayers(rows, { allowDuplicates = false, existing = [] } = {}) {
      const result = validateImport(rows, existing);
      if (result.errors.length || (result.duplicates.length && !allowDuplicates)) return result;
      const importable = allowDuplicates
        ? [...result.valid, ...result.duplicates.map(item => item.player)]
        : result.valid;
      const created = [];
      for (const player of importable) created.push(await createPlayer(player));
      return { ...result, valid: importable, created };
    }

    return {
      setWorkspace,
      clearWorkspace,
      getWorkspace: currentWorkspace,
      createPlayer,
      updatePlayer,
      deactivatePlayer: playerId => setStatus(playerId, 'inactive'),
      reactivatePlayer: playerId => setStatus(playerId, 'active'),
      validatePlayer,
      validateImport,
      importPlayers,
      parseCsv,
      downloadTemplate: () => 'jersey_number,first_name,last_name,position,player_type,shoots,notes,status\n73,Landon,Kowalski,F,skater,R,,active\n'
    };
  }

  global.FoxesRosterManagement = { createRosterManagement, normalizePlayer, validatePlayer, parseCsv };
}(window));
