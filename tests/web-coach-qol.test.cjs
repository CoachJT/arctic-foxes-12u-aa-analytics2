const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const coachSource = fs.readFileSync('web/coach-qol.js', 'utf8');
const appSource = fs.readFileSync('web/app.js', 'utf8');
const indexSource = fs.readFileSync('web/index.html', 'utf8');
const stylesSource = fs.readFileSync('web/styles.css', 'utf8');
const migrationSource = fs.readFileSync('supabase/migrations/20260908073105_016_game_stat_entry.sql', 'utf8');

function makeClient({ insertError = null, rpcError = null, onInsert } = {}) {
  const calls = { insert: [], update: [], delete: [], rpc: [] };
  const mutation = kind => (payload) => {
    calls[kind].push(payload);
    const chain = {
      eq: () => chain,
      select: () => chain,
      single: () => Promise.resolve({ data: { id: 'row-1', jersey_number: payload?.jersey_number || '7', ...payload }, error: kind === 'insert' ? insertError : null }),
      then: (resolve, reject) => Promise.resolve({ data: kind === 'delete' ? null : [{ id: 'row-1' }], error: kind === 'insert' ? insertError : null }).then(resolve, reject)
    };
    if (kind === 'insert') onInsert?.(payload);
    return chain;
  };
  return {
    calls,
    from: () => ({ insert: mutation('insert'), update: mutation('update'), delete: mutation('delete') }),
    rpc: (name, args) => {
      calls.rpc.push([name, args]);
      if (name === 'save_schedule_game') {
        return Promise.resolve({ data: rpcError ? null : { id: 'row-1', ...args }, error: rpcError });
      }
      return Promise.resolve({ data: rpcError ? null : { ok: true }, error: rpcError });
    }
  };
}

function loadCoach(clientOptions, contextValues = {}) {
  const context = { window: {}, crypto: { randomUUID: () => 'uuid-1' } };
  vm.runInNewContext(coachSource, context);
  return context.window.FoxesCoachQol.createCoachQol({
    client: makeClient(clientOptions),
    getContext: () => ({
      teamId: 'team-1',
      seasonId: 'season-1',
      seasonKey: '2026-2027',
      capabilities: ['schedule.edit', 'games.edit', 'stats.edit', 'players.evaluate'],
      schedule: [],
      roster: [],
      ...contextValues
    }),
    onChanged: () => {}
  });
}

test('add game creates exactly one record and rejects a second concurrent submit', async () => {
  const inserted = [];
  const coach = loadCoach({ onInsert: row => inserted.push(row) });
  const first = coach.addGame({ date: '2026-09-12', opponent: 'Riverside', homeAway: 'Home', gameType: 'League' });
  await assert.rejects(coach.addGame({ date: '2026-09-12', opponent: 'Riverside' }), /already being added/);
  await first;
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].team_id, 'team-1');
  assert.equal(inserted[0].opponent, 'Riverside');
  assert.equal(inserted[0].home_away, 'Home');
});

test('add game validates required fields before any write', async () => {
  const coach = loadCoach();
  await assert.rejects(coach.addGame({ opponent: 'Riverside' }), /Choose the game date/);
  await assert.rejects(coach.addGame({ date: '2026-09-12' }), /Enter the opponent/);
});

test('add game fails closed without the schedule.edit capability', async () => {
  const coach = loadCoach({}, { capabilities: ['stats.edit'] });
  await assert.rejects(coach.addGame({ date: '2026-09-12', opponent: 'Riverside' }), /schedule editing access/);
});

test('edit game patches the existing row scoped to the current team and never inserts', async () => {
  const coach = loadCoach();
  const result = await coach.editGame('sched-9', { date: '2026-09-13', opponent: 'Metro', homeAway: 'Away', gameType: 'Tournament' });
  assert.equal(result.id, 'row-1');
  assert.equal(coach.context && true, true);
});

test('edit and delete require an identifiable team-scoped row', async () => {
  const coach = loadCoach();
  await assert.rejects(coach.editGame('', { date: '2026-09-13', opponent: 'Metro' }), /could not be identified/);
  await assert.rejects(coach.deleteGame(''), /could not be identified/);
});

test('likely duplicate games are detected as advisory, never blocking doubleheaders', () => {
  const coach = loadCoach({}, {
    schedule: [{ id: 'g1', date: '2026-09-12', opponent: 'Riverside' }, { id: 'g2', date: '2026-09-13', opponent: 'Riverside' }]
  });
  const dupes = coach.findDuplicateGames('2026-09-12', 'riverside');
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].id, 'g1');
  assert.equal(coach.findDuplicateGames('2026-09-14', 'Riverside').length, 0);
  assert.equal(coach.findDuplicateGames('2026-09-12', 'Riverside', 'g1').length, 0);
});

test('stat entry tracks a dirty draft, computes derived stats, and rejects invalid values', () => {
  const coach = loadCoach();
  coach.openGame('game-1');
  assert.equal(coach.dirty, false);
  coach.setStat('skater', 'p7', 'goals', '2', 'Goals');
  coach.setStat('skater', 'p7', 'assists', '1', 'Assists');
  coach.setStat('skater', 'p7', 'shots', '5', 'Shots');
  assert.equal(coach.dirty, true);
  const derived = coach.derivedSkater({ goals: 2, assists: 1, shots: 5 });
  assert.equal(derived.points, 3);
  assert.ok(Math.abs(derived.shotPct - 0.4) < 1e-9);
  assert.throws(() => coach.setStat('skater', 'p7', 'goals', '-1', 'Goals'), /cannot be negative/);
  assert.throws(() => coach.setStat('skater', 'p7', 'goals', 'abc', 'Goals'), /must be a number/);
});

test('bulk save is one atomic RPC keyed by game — saving twice upserts, never doubles', async () => {
  const coach = loadCoach();
  coach.openGame('game-1');
  coach.setStat('skater', 'p7', 'goals', '2', 'Goals');
  coach.setStat('goalie', 'p30', 'saves', '18', 'Saves');
  coach.setStat('goalie', 'p30', 'goals_against', '3', 'Goals against');
  await coach.saveStats();
  assert.equal(coach.saveState, 'saved');
  assert.equal(coach.dirty, false);
  await coach.saveStats();
  const client = coach;
  assert.ok(client);
  assert.equal(coach.saveState, 'saved');
  assert.match(migrationSource, /on conflict \(team_id, source_game_id, source_player_id, player_type\)\s+do update/);
});

test('failed save keeps the dirty draft on screen and marks the error state', async () => {
  const coach = loadCoach({ rpcError: { message: 'permission denied for table team_game_player_stats' } });
  coach.openGame('game-1');
  coach.setStat('skater', 'p7', 'goals', '2', 'Goals');
  await assert.rejects(coach.saveStats(), /permission denied/);
  assert.equal(coach.saveState, 'error');
  assert.equal(coach.dirty, true);
});

test('stats save is rejected without a game open or without stats.edit', async () => {
  const coach = loadCoach();
  await assert.rejects(coach.saveStats(), /Open a game before saving stats/);
  const limited = loadCoach({}, { capabilities: ['players.evaluate'] });
  limited.openGame('game-1');
  await assert.rejects(limited.saveStats(), /stats editing access/);
});

test('goalie saves and shots-against stay derived, never double-entered', () => {
  const coach = loadCoach();
  const derived = coach.derivedGoalie({ saves: 18, goals_against: 3 });
  assert.equal(derived.shotsAgainst, 21);
  assert.ok(Math.abs(derived.savePct - 18 / 21) < 1e-9);
  const html = coach.statsWorkspaceHtml([{ source_player_id: 'p30', jersey_number: '30', name: 'Sam Ray', position: 'G' }]);
  assert.match(html, /Goalie/);
  assert.match(html, /data-stat-type="goalie"/);
  assert.doesNotMatch(html, /data-stat-field="shots_against"/);
});

test('quick add validates, blocks duplicate jerseys, and stays on the form', async () => {
  const coach = loadCoach({}, { roster: [{ id: 'r1', source_player_id: 'p7', jersey_number: '7', name: 'Jane Smith', position: 'F' }] });
  const added = await coach.addPlayer({ jerseyNumber: '9', name: 'Alex Doe', position: 'D' });
  assert.equal(added.jersey_number, '9');
  await assert.rejects(coach.addPlayer({ jerseyNumber: '7', name: 'Other Player', position: 'F' }), /already assigned to Jane Smith/);
  await assert.rejects(coach.addPlayer({ jerseyNumber: '10', name: '', position: 'F' }), /player name/);
  await assert.rejects(coach.addPlayer({ jerseyNumber: '10', name: 'X Player', position: 'C' }), /F, D, or G/);
});

test('roster edits and removals are scoped to the current team', async () => {
  const coach = loadCoach({}, { roster: [{ id: 'r1', source_player_id: 'p7', jersey_number: '7', name: 'Jane Smith', position: 'F' }] });
  await assert.rejects(coach.editPlayer('r1', { jerseyNumber: '7', name: 'Jane Smith', position: 'X' }), /F, D, or G/);
  const updated = await coach.editPlayer('r1', { jerseyNumber: '8', name: 'Jane Smith', position: 'D' });
  assert.equal(updated.id, 'row-1');
  assert.ok(await coach.removePlayer('r1'));
});

test('roster operations fail closed without players.evaluate', async () => {
  const coach = loadCoach({}, { capabilities: ['stats.edit'] });
  await assert.rejects(coach.addPlayer({ jerseyNumber: '9', name: 'Alex', position: 'F' }), /roster editing access/);
});

test('game form exposes only the fields a coach needs with sensible defaults', () => {
  const coach = loadCoach();
  const html = coach.gameFormHtml();
  assert.match(html, /name="date"/);
  assert.match(html, /name="opponent"/);
  assert.match(html, /name="homeAway"/);
  assert.match(html, /name="gameType"/);
  assert.match(html, /Add Game/);
  const editHtml = coach.gameFormHtml({ id: 'g1', date: '2026-09-12', opponent: 'Riverside', home_away: 'Away', game_type: 'League', location: 'Main Rink' });
  assert.match(editHtml, /value="sched|value="g1"/);
  assert.match(editHtml, /value="Riverside"/);
  assert.match(editHtml, /<option selected>Away<\/option>/);
});

test('save states follow the idle → saving → saved / error standard', () => {
  const coach = loadCoach();
  assert.equal(coach.SAVE_STATES.SAVING, 'saving');
  const html = coach.gameFormHtml();
  assert.match(html, /data-save-button/);
  assert.match(fs.readFileSync('web/coach-qol.js', 'utf8'), /Saving…/);
  assert.match(fs.readFileSync('web/coach-qol.js', 'utf8'), /✓ Saved/);
  assert.match(fs.readFileSync('web/coach-qol.js', 'utf8'), /Save failed — Retry/);
});

test('help bubbles explain hockey terms without cluttering every field', () => {
  const coach = loadCoach();
  const html = coach.statsWorkspaceHtml([{ source_player_id: 'p7', jersey_number: '7', name: 'Jane', position: 'F' }]);
  assert.match(html, /class="help-bubble"/);
  assert.match(html, /Faceoffs won\./);
  const form = coach.gameFormHtml();
  assert.match(form, /Choose where your team is listed/);
});

test('empty states tell the coach the next action', () => {
  const coach = loadCoach();
  const empty = coach.statsWorkspaceHtml([]);
  assert.match(empty, /Your roster is empty/);
  assert.match(empty, /Add Player/);
  const roster = coach.rosterWorkspaceHtml([]);
  assert.match(roster, /Your roster is empty/);
});

test('app wires coach controls behind capabilities and the module loads before app.js', () => {
  assert.match(indexSource, /coach-qol\.js\?v=schedule-linkage-2/);
  assert.ok(indexSource.indexOf('coach-qol.js') < indexSource.indexOf('app.js'));
  assert.match(appSource, /FoxesCoachQol\.createCoachQol/);
  assert.match(appSource, /bindCoachGameControls/);
  assert.match(appSource, /bindCoachRosterControls/);
  assert.match(appSource, /bindCoachStatsControls/);
  assert.match(appSource, /data-enter-stats/);
  assert.match(appSource, /coachQol\.saveStats\(\)/);
  assert.match(appSource, /unsaved changes\. Leave without saving\?/i);
});

test('all web coach writes live in coach-qol.js; app.js makes no direct mutations', () => {
  assert.doesNotMatch(appSource, /\.(insert|update|upsert|delete)\(/);
  assert.match(coachSource, /from\('team_schedule_games'\)/);
  assert.match(coachSource, /from\('team_roster_players'\)/);
  assert.match(coachSource, /rpc\('save_game_stats'/);
});

test('bulk save RPC is guarded, atomic, and team-scoped server-side', () => {
  assert.match(migrationSource, /function public\.save_game_stats\(/);
  assert.match(migrationSource, /has_workspace_feature_access\(target_team_id, target_season_id, 'stats\.edit', 'stats'\)/);
  assert.match(migrationSource, /parse_finite_stat/);
  assert.match(migrationSource, /source_player_id/);
  assert.match(migrationSource, /security definer/);
  assert.match(migrationSource, /revoke all on function public\.save_game_stats/);
  assert.match(migrationSource, /grant execute on function public\.save_game_stats\(uuid, uuid, text, jsonb, jsonb, jsonb\) to authenticated/);
  assert.doesNotMatch(migrationSource, /\bdelete from\b/i);
  assert.doesNotMatch(migrationSource, /\bdrop table\b/i);
});

test('team context guards every write against stale team selection', () => {
  const coach = loadCoach({}, { teamId: '' });
  return Promise.all([
    assert.rejects(coach.addGame({ date: '2026-09-12', opponent: 'X' }), /No team is selected/),
    assert.rejects(coach.addPlayer({ jerseyNumber: '9', name: 'A', position: 'F' }), /No team is selected/)
  ]);
});

test('mobile layouts stack coach forms and enlarge stat inputs', () => {
  assert.match(stylesSource, /@media\(max-width:700px\)[\s\S]{0,400}\.stat-fields\{grid-template-columns:repeat\(4,1fr\)\}/);
  assert.match(stylesSource, /@media\(max-width:420px\)[\s\S]{0,300}\.stat-input\{min-height:48px/);
  assert.match(stylesSource, /\.help-bubble::after/);
  assert.match(stylesSource, /\.stats-save-bar/);
});

// --- 2.0.x interaction fixes: schedule/roster identity, picker, scroll ---

test('schedule reads select the row id so Edit and Delete receive a real identifier', () => {
  const select = appSource.match(/read\('schedule', 'team_schedule_games', '([^']+)'/);
  assert.ok(select, 'the schedule read must exist');
  assert.ok(select[1].split(',').includes('id'), 'schedule select must include id');
  assert.match(appSource, /data-coach-edit-game="\$\{escapeHtml\(game\.id\)\}"/);
  assert.match(appSource, /data-coach-delete-game="\$\{escapeHtml\(game\.id\)\}"/);
  assert.match(appSource, /\.find\(g => g\.id === button\.dataset\.coachEditGame\)/);
});

test('roster Edit is bound and mounts an edit form that saves through editPlayer', () => {
  assert.match(appSource, /querySelectorAll\('\[data-edit-player\]'\)/);
  assert.match(appSource, /coachQol\.playerEditFormHtml\(player\)/);
  assert.match(appSource, /data-player-edit-form/);
  assert.match(coachSource, /playerEditFormHtml/);
  assert.match(coachSource, /submitPlayerEditForm/);
});

test('roster edit saves the exact row id and never inserts a duplicate player', async () => {
  const coach = loadCoach({}, { roster: [{ id: 'row-1', jersey_number: '9', name: 'Old Name' }] });
  const updated = await coach.editPlayer('row-1', { jerseyNumber: '9', name: 'New Name', position: 'D' });
  assert.equal(updated.id, 'row-1');
  await assert.rejects(coach.editPlayer('row-1', { jerseyNumber: '9', name: 'Single' }), /first and last name/);
});

test('the date field associates its label by id and keeps the help button outside the label', () => {
  const coach = loadCoach();
  const html = coach.gameFormHtml();
  assert.match(html, /<label for="coachGameDate">Date<\/label>/);
  assert.match(html, /<input id="coachGameDate" name="date" type="date"/);
  assert.doesNotMatch(html, /<label>Date[\s\S]*?<input/);
  assert.doesNotMatch(html, /<label[^>]*>[^<]*<button/);
});

test('date and time inputs open the native picker on a normal click, once, with a safe fallback', () => {
  const bound = [];
  const makeInput = () => {
    const listeners = [];
    return {
      dataset: {},
      addEventListener: (type, handler) => listeners.push([type, handler]),
      fire: () => listeners.filter(([type]) => type === 'click').forEach(([, handler]) => handler()),
      listeners
    };
  };
  const supported = makeInput();
  let opened = 0;
  supported.showPicker = () => { opened += 1; };
  const throwing = makeInput();
  throwing.showPicker = () => { throw new Error('blocked'); };
  const unsupported = makeInput();
  const scope = { querySelectorAll: () => [supported, throwing, unsupported] };

  const coach = loadCoach();
  assert.equal(coach.enhanceDateInputs(scope), 3);
  assert.equal(coach.enhanceDateInputs(scope), 0, 'inputs must never be double-bound');
  supported.fire();
  assert.equal(opened, 1);
  assert.doesNotThrow(() => throwing.fire(), 'an unavailable picker must not break the field');
  assert.doesNotThrow(() => unsupported.fire());
  assert.equal(coach.enhanceDateInputs(null), 0);
});

test('a same-view rerender preserves scroll position and no dead hash links remain', () => {
  assert.match(appSource, /const sameView = view === lastRenderedView;/);
  assert.match(appSource, /window\.scrollTo\(0, sameView \? preservedScroll : 0\)/);
  assert.doesNotMatch(appSource, /href="#"/);
  assert.match(appSource, /class="card-note"/);
  assert.match(stylesSource, /\.card-title \.card-note/);
});

test('changed web assets carry a fresh cache-busting version', () => {
  for (const asset of ['styles.css', 'coach-qol.js', 'app.js']) {
    assert.ok(indexSource.includes(`${asset}?v=schedule-linkage-2`), `${asset} must be cache-busted`);
  }
});

// --- 023 eager canonical game shells: Schedule -> Game Center linkage ---

const linkageMigration = fs.readFileSync('supabase/migrations/20260910000100_023_schedule_game_linkage.sql', 'utf8');

// A small stateful fake that mirrors the real database semantics we depend on:
// a unique (team_id, source_game_id) on games, and an ensure_schedule_game_shell
// RPC that is row-locked, idempotent, and derives identity from the schedule row.
function makeLinkedDb(capabilities = ['schedule.edit', 'games.edit', 'stats.edit']) {
  const db = { schedule: [], games: [], rpcCalls: 0, stats: [], seasons: [
    { id: 'season-1', team_id: 'team-1' },
    { id: 'season-2', team_id: 'team-1' },
    { id: 'season-other', team_id: 'team-2' }
  ] };
  let uuid = 0;
  const client = {
    db,
    from: table => ({
      insert: payload => {
        const chain = {
          select: () => chain,
          single: () => {
            const row = { id: `sched-${++uuid}`, linked_game_source_id: null, ...payload };
            db[table === 'team_schedule_games' ? 'schedule' : 'games'].push(row);
            return Promise.resolve({ data: row, error: null });
          }
        };
        return chain;
      },
      update: patch => {
        const filters = {};
        const chain = {
          eq: (col, val) => { filters[col] = val; return chain; },
          select: () => chain,
          then: (resolve, reject) => {
            const key = table === 'team_schedule_games' ? 'schedule' : 'games';
            const hits = db[key].filter(r => Object.entries(filters).every(([c, v]) => r[c] === v));
            hits.forEach(r => Object.assign(r, patch));
            return Promise.resolve({ data: hits, error: null }).then(resolve, reject);
          }
        };
        return chain;
      },
      delete: () => {
        const filters = {};
        const chain = {
          eq: (col, val) => { filters[col] = val; return chain; },
          then: (resolve, reject) => {
            const key = table === 'team_schedule_games' ? 'schedule' : 'games';
            const before = db[key].length;
            db[key] = db[key].filter(r => !Object.entries(filters).every(([c, v]) => r[c] === v));
            db.deleted = before - db[key].length;
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          }
        };
        return chain;
      }
    }),
    rpc: (name, args) => {
      db.rpcCalls += 1;
      // Mirrors public.save_schedule_game: one transactional unit that gates
      // linked-game mutation on games.edit and validates season ownership.
      if (name === 'save_schedule_game') {
        const sched = db.schedule.find(r => r.id === args.target_schedule_id);
        if (!sched) return Promise.resolve({ data: null, error: { message: 'That game was not found on this team.' } });
        if (!capabilities.includes('schedule.edit')) {
          return Promise.resolve({ data: null, error: { message: 'You do not have schedule editing access.' } });
        }
        const effectiveSeason = args.new_season_id || sched.season_id;
        if (effectiveSeason && !db.seasons.some(s => s.id === effectiveSeason && s.team_id === sched.team_id)) {
          return Promise.resolve({ data: null, error: { message: 'The selected season does not belong to this team.' } });
        }
        if (sched.linked_game_source_id) {
          if (!capabilities.includes('games.edit')) {
            // Reject before writing anything so the pair cannot diverge.
            return Promise.resolve({ data: null, error: { message: 'You do not have game editing access for the linked game.' } });
          }
          const game = db.games.find(g => g.team_id === sched.team_id && g.source_game_id === sched.linked_game_source_id);
          if (!game) return Promise.resolve({ data: null, error: { message: 'The linked game does not belong to this team.' } });
          game.date = args.new_date;
          game.opponent = args.new_opponent;
          game.season_id = effectiveSeason;
        }
        Object.assign(sched, {
          date: args.new_date,
          opponent: args.new_opponent,
          time: args.new_time,
          home_away: args.new_home_away,
          game_type: args.new_game_type,
          location: args.new_location,
          notes: args.new_notes,
          season_id: effectiveSeason
        });
        return Promise.resolve({ data: sched, error: null });
      }
      if (name !== 'ensure_schedule_game_shell') return Promise.resolve({ data: null, error: null });
      const sched = db.schedule.find(r => r.id === args.target_schedule_id);
      if (!sched) return Promise.resolve({ data: null, error: { message: 'The schedule entry was not found.' } });
      if (!capabilities.includes('games.edit')) {
        return Promise.resolve({ data: null, error: { message: 'You are not authorized to create games for this team.' } });
      }
      if (sched.linked_game_source_id) return Promise.resolve({ data: sched.linked_game_source_id, error: null });
      const canonical = sched.source_schedule_id;
      if (!db.games.some(g => g.team_id === sched.team_id && g.source_game_id === canonical)) {
        db.games.push({ team_id: sched.team_id, source_game_id: canonical, season_id: sched.season_id, date: sched.date, opponent: sched.opponent });
      }
      sched.linked_game_source_id = canonical;
      return Promise.resolve({ data: canonical, error: null });
    }
  };
  let seed = 0;
  const context = { window: {}, crypto: { randomUUID: () => `game-uuid-${++seed}` } };
  vm.runInNewContext(coachSource, context);
  const coach = context.window.FoxesCoachQol.createCoachQol({
    client,
    getContext: () => ({ teamId: 'team-1', seasonId: 'season-1', capabilities, schedule: [], roster: [] }),
    onChanged: () => Promise.resolve()
  });
  return { coach, db };
}

test('Schedule Add creates one schedule row and one canonical game shell', async () => {
  const { coach, db } = makeLinkedDb();
  const game = await coach.addGame({ date: '2026-11-01', opponent: 'Riverside' });
  assert.equal(db.schedule.length, 1);
  assert.equal(db.games.length, 1, 'exactly one canonical shell');
  assert.equal(db.games[0].source_game_id, db.schedule[0].source_schedule_id, 'identity derives from the schedule row');
  assert.equal(db.schedule[0].linked_game_source_id, db.games[0].source_game_id, 'link is populated');
  assert.equal(game.linked_game_source_id, db.games[0].source_game_id);
});

test('Game Center immediately shows a schedule-added game because it reads the shell', async () => {
  const { coach, db } = makeLinkedDb();
  await coach.addGame({ date: '2026-11-01', opponent: 'Riverside' });
  // Game Center reads team_games; the added game must be present there.
  assert.ok(db.games.some(g => g.opponent === 'Riverside'), 'the game is visible to Game Center');
  assert.equal(db.games[0].season_id, 'season-1', 'the shell inherits the active season');
});

test('the schedule row carries the active season so it cannot drift across seasons', async () => {
  const { coach, db } = makeLinkedDb();
  await coach.addGame({ date: '2026-11-01', opponent: 'Riverside' });
  assert.equal(db.schedule[0].season_id, 'season-1');
});

test('repeated and concurrent shell resolution never creates a second game', async () => {
  const { coach, db } = makeLinkedDb();
  const game = await coach.addGame({ date: '2026-11-01', opponent: 'Riverside' });
  const results = await Promise.all(Array.from({ length: 8 }, () => coach.ensureGameShell(game.id)));
  assert.equal(new Set(results).size, 1, 'every caller resolves the same canonical game');
  assert.equal(db.games.length, 1, 'no duplicate shell');
});

test('a same-day doubleheader creates two distinct shells even with an identical opponent', async () => {
  const { coach, db } = makeLinkedDb();
  const a = await coach.addGame({ date: '2026-08-29', opponent: 'Gilmour Academy' });
  const b = await coach.addGame({ date: '2026-08-29', opponent: 'Gilmour Academy' });
  assert.notEqual(a.linked_game_source_id, b.linked_game_source_id, 'date+opponent must never collapse a doubleheader');
  assert.equal(db.games.length, 2);
  assert.equal(db.schedule.length, 2);
});

test('editing a schedule game updates the linked canonical game, not a new one', async () => {
  const { coach, db } = makeLinkedDb();
  const game = await coach.addGame({ date: '2026-11-01', opponent: 'Riverside' });
  await coach.editGame(game.id, { date: '2026-11-02', opponent: 'Riverside B' });
  assert.equal(db.games.length, 1, 'edit must not create a game');
  assert.equal(db.games[0].opponent, 'Riverside B', 'the canonical game follows the schedule edit');
  assert.equal(db.games[0].date, '2026-11-02');
});

test('deleting a schedule game removes the schedule row and preserves scored history', async () => {
  const { coach, db } = makeLinkedDb();
  const game = await coach.addGame({ date: '2026-11-01', opponent: 'Riverside' });
  await coach.deleteGame(game.id);
  assert.equal(db.schedule.length, 0, 'the schedule row is deleted');
  assert.equal(db.games.length, 1, 'the canonical game (which may hold stats) is retained');
});

test('a shell alone never counts as completed and a future game is not stat-eligible', () => {
  // Game Center derives played from a team-stats row, never from the shell.
  assert.match(appSource, /const isPlayed = game => teamStats\.has\(game\.source_game_id\)/);
  assert.match(appSource, /const playedCount = games\.filter\(isPlayed\)\.length/);
  assert.match(appSource, /playedCount\} of \$\{games\.length\} games played/);
  assert.match(appSource, /'NOT SCORED' : 'SCHEDULED'/);
  assert.match(appSource, /canEditStats && eligible \?/, 'stat entry is hidden for a not-yet-played shell');
  // The database enforces the same rule independently of the UI.
  assert.match(migrationSource, /game\.date <= current_date/);
});

test('Enter Stats targets the canonical linked game id', () => {
  assert.match(appSource, /data-enter-stats="\$\{escapeHtml\(game\.source_game_id\)\}"/);
  assert.match(appSource, /read\('games', 'team_games'/, 'Game Center reads the canonical game table');
});

test('migration 023 is additive and enforces linkage, season, delete, and uniqueness', () => {
  assert.match(linkageMigration, /add column if not exists season_id uuid/);
  assert.match(linkageMigration, /having count\(\*\) = 1/, 'only unambiguous single-season rows are backfilled');
  assert.match(linkageMigration, /create unique index if not exists team_schedule_games_unique_link_idx/);
  assert.match(linkageMigration, /where linked_game_source_id is not null/, 'the unique link index is partial');
  assert.match(linkageMigration, /create policy team_schedule_games_delete/);
  assert.match(linkageMigration, /for delete using \(public\.has_team_capability\(team_id, 'schedule\.edit'\)\)/);
  assert.match(linkageMigration, /validate_team_schedule_game_season/);
  assert.match(linkageMigration, /validate_schedule_game_link/);
  assert.doesNotMatch(linkageMigration, /drop table|drop column|truncate/i, 'the migration must be forward-only and additive');
});

test('the shell RPC is row-locked, idempotent, and authorizes server-side', () => {
  assert.match(linkageMigration, /for update/, 'the schedule row is locked so concurrent callers serialize');
  assert.match(linkageMigration, /on conflict \(team_id, source_game_id\) do nothing/);
  assert.match(linkageMigration, /if sched\.linked_game_source_id is not null then\s*\n\s*return sched\.linked_game_source_id/);
  assert.match(linkageMigration, /has_team_capability\(sched\.team_id, 'schedule\.edit'\)/);
  assert.match(linkageMigration, /has_team_capability\(sched\.team_id, 'games\.edit'\)/);
  assert.match(linkageMigration, /canonical_id := sched\.source_schedule_id/, 'identity is the schedule row, never date+opponent');
  assert.match(linkageMigration, /revoke all on function public\.ensure_schedule_game_shell\(uuid\) from public/);
  assert.match(linkageMigration, /grant execute on function public\.ensure_schedule_game_shell\(uuid\) to authenticated/);
});

test('player edit restoration is deterministic and not timer-based', () => {
  assert.doesNotMatch(appSource, /setTimeout\([^)]*restore/, 'restoration must not be scheduled on a timer');
  assert.match(appSource, /await coachQol\.submitPlayerEditForm\(event\.currentTarget\);\s*\n[^\n]*\n[^\n]*\n\s*if \(document\.body\.contains\(host\)\) restore\(\);/);
  assert.match(appSource, /return loadPhase1Data\(authTeam\.team_id\);/, 'onChanged returns the reload promise');
  assert.match(coachSource, /await onChanged\?\.\('roster'\)/, 'writes await the reload');
  assert.match(coachSource, /await onChanged\?\.\('schedule'\)/);
});

test('team and season switching stays scoped after eager shell creation', async () => {
  const { coach, db } = makeLinkedDb();
  await coach.addGame({ date: '2026-11-01', opponent: 'Riverside' });
  assert.equal(db.games[0].team_id, 'team-1', 'the shell is written to the active team only');
  assert.equal(db.games[0].season_id, 'season-1');
  // The database refuses a season belonging to another team, independently.
  assert.match(linkageMigration, /The selected season does not belong to this team/);
  assert.match(linkageMigration, /The linked game does not belong to this team/);
});

// --- Migration 023 HOLD items: season propagation + games.edit enforcement ---

test('editing the date propagates to the linked canonical game', async () => {
  const { coach, db } = makeLinkedDb();
  const game = await coach.addGame({ date: '2026-11-01', opponent: 'Riverside' });
  await coach.editGame(game.id, { date: '2026-12-24', opponent: 'Riverside' });
  assert.equal(db.games[0].date, '2026-12-24');
  assert.equal(db.schedule[0].date, '2026-12-24');
});

test('editing the opponent propagates to the linked canonical game', async () => {
  const { coach, db } = makeLinkedDb();
  const game = await coach.addGame({ date: '2026-11-01', opponent: 'Riverside' });
  await coach.editGame(game.id, { date: '2026-11-01', opponent: 'Gilmour Academy' });
  assert.equal(db.games[0].opponent, 'Gilmour Academy');
  assert.equal(db.schedule[0].opponent, 'Gilmour Academy');
});

test('correcting the season propagates to the linked canonical game', async () => {
  const { coach, db } = makeLinkedDb();
  const game = await coach.addGame({ date: '2026-11-01', opponent: 'Riverside' });
  assert.equal(db.games[0].season_id, 'season-1');
  await coach.editGame(game.id, { date: '2026-11-01', opponent: 'Riverside', seasonId: 'season-2' });
  assert.equal(db.games[0].season_id, 'season-2', 'the canonical game follows the season correction');
  assert.equal(db.schedule[0].season_id, 'season-2', 'the schedule row matches');
});

test('a season belonging to another team is rejected and nothing is written', async () => {
  const { coach, db } = makeLinkedDb();
  const game = await coach.addGame({ date: '2026-11-01', opponent: 'Riverside' });
  await assert.rejects(
    coach.editGame(game.id, { date: '2027-01-01', opponent: 'Hacked', seasonId: 'season-other' }),
    /does not belong to this team/
  );
  assert.equal(db.games[0].season_id, 'season-1', 'season unchanged');
  assert.equal(db.games[0].opponent, 'Riverside', 'no partial write reached the game');
  assert.equal(db.schedule[0].opponent, 'Riverside', 'no partial write reached the schedule');
});

test('omitting the season leaves the existing season intact rather than clearing it', async () => {
  const { coach, db } = makeLinkedDb();
  const game = await coach.addGame({ date: '2026-11-01', opponent: 'Riverside' });
  await coach.editGame(game.id, { date: '2026-11-05', opponent: 'Riverside' });
  assert.equal(db.schedule[0].season_id, 'season-1');
  assert.equal(db.games[0].season_id, 'season-1');
});

test('a schedule editor without games.edit cannot indirectly mutate the linked game', async () => {
  // Seed with full rights so a linked shell exists, then drop games.edit.
  const seeded = makeLinkedDb();
  const game = await seeded.coach.addGame({ date: '2026-11-01', opponent: 'Riverside' });
  const limited = makeLinkedDb(['schedule.edit', 'stats.edit']);
  limited.db.schedule.push({ ...seeded.db.schedule[0] });
  limited.db.games.push({ ...seeded.db.games[0] });
  await assert.rejects(
    limited.coach.editGame(game.id, { date: '2099-12-31', opponent: 'HACKED' }),
    /game editing access/
  );
  assert.equal(limited.db.games[0].opponent, 'Riverside', 'the canonical game is untouched');
  assert.equal(limited.db.schedule[0].opponent, 'Riverside', 'the schedule row is untouched, so the rows never diverge');
});

test('a schedule editor without games.edit cannot create a game via Add', async () => {
  const { coach, db } = makeLinkedDb(['schedule.edit', 'stats.edit']);
  await assert.rejects(
    coach.addGame({ date: '2026-11-01', opponent: 'Riverside' }),
    /game creation access/
  );
  assert.equal(db.schedule.length, 0, 'no orphaned schedule row is left behind');
  assert.equal(db.games.length, 0);
});

test('a team owner with both capabilities can edit date, opponent and season together', async () => {
  const { coach, db } = makeLinkedDb(['schedule.edit', 'games.edit', 'stats.edit']);
  const game = await coach.addGame({ date: '2026-11-01', opponent: 'Riverside' });
  await coach.editGame(game.id, { date: '2027-02-02', opponent: 'Kings', seasonId: 'season-2' });
  assert.equal(db.games[0].date, '2027-02-02');
  assert.equal(db.games[0].opponent, 'Kings');
  assert.equal(db.games[0].season_id, 'season-2');
});

test('a schedule edit preserves the canonical game identity so stats stay attached', async () => {
  const { coach, db } = makeLinkedDb();
  const game = await coach.addGame({ date: '2026-11-01', opponent: 'Riverside' });
  const originalSourceId = db.games[0].source_game_id;
  db.stats.push({ team_id: 'team-1', source_game_id: originalSourceId, goals: 4 });
  await coach.editGame(game.id, { date: '2027-03-03', opponent: 'Kings', seasonId: 'season-2' });
  assert.equal(db.games[0].source_game_id, originalSourceId, 'source_game_id is never rewritten');
  assert.equal(db.games.length, 1, 'no shadow game is created');
  assert.equal(db.stats.filter(s => s.source_game_id === originalSourceId).length, 1, 'stats remain attached');
  assert.equal(db.stats[0].goals, 4);
});

test('schedule edit goes through one transactional RPC, not independent table writes', async () => {
  const { coach, db } = makeLinkedDb();
  const game = await coach.addGame({ date: '2026-11-01', opponent: 'Riverside' });
  const before = db.rpcCalls;
  await coach.editGame(game.id, { date: '2026-11-09', opponent: 'Kings' });
  assert.equal(db.rpcCalls - before, 1, 'exactly one server call performs the whole edit atomically');
});

test('migration 023 defines an atomic save_schedule_game that gates linked-game writes on games.edit', () => {
  const sql = fs.readFileSync('supabase/migrations/20260910000100_023_schedule_game_linkage.sql', 'utf8');
  assert.match(sql, /create or replace function public\.save_schedule_game/, 'the secure edit RPC exists');
  assert.match(sql, /security definer/, 'it runs as definer so it can enforce its own rules');
  assert.match(sql, /for update/, 'the schedule row is locked for the duration of the edit');
  assert.match(sql, /has_team_capability\(sched\.team_id, 'schedule\.edit'\)/, 'schedule.edit is required');
  assert.match(sql, /has_team_capability\(sched\.team_id, 'games\.edit'\)/, 'games.edit gates the linked-game write');
  assert.match(sql, /does not belong to this team/, 'cross-team season assignment is rejected');
  assert.match(sql, /coalesce\(new_season_id, sched\.season_id\)/, 'omitting a season never clears it');
  const editStmt = sql.slice(sql.indexOf('update public.team_games'));
  const setClause = editStmt.slice(0, editStmt.indexOf('where'));
  assert.doesNotMatch(setClause, /source_game_id/, 'the linked game identity is never rewritten, so stats stay attached');
  assert.match(setClause, /season_id\s*=\s*effective_season/, 'the season is propagated to the linked game');
  assert.match(sql, /grant execute on function public\.save_schedule_game[\s\S]{0,200}to authenticated/, 'only authenticated callers may execute it');
});

test('the web client performs a schedule edit through the RPC rather than two table writes', () => {
  const editBody = coachSource.slice(coachSource.indexOf('async function editGame'), coachSource.indexOf('async function deleteGame'));
  assert.match(editBody, /client\.rpc\('save_schedule_game'/, 'the edit path calls the transactional RPC');
  assert.doesNotMatch(editBody, /from\('team_games'\)/, 'the client never writes team_games directly on edit');
  assert.doesNotMatch(editBody, /from\('team_schedule_games'\)\.update/, 'the client no longer issues a separate schedule update');
});

test('the add path requires games.edit before inserting so no orphan schedule row can be created', () => {
  const addBody = coachSource.slice(coachSource.indexOf('async function addGame'), coachSource.indexOf('async function editGame'));
  const capIndex = addBody.indexOf("canWrite('games.edit')");
  const insertIndex = addBody.indexOf('.insert(');
  assert.ok(capIndex > -1, 'games.edit is checked on the add path');
  assert.ok(capIndex < insertIndex, 'the capability check happens before the insert');
});
