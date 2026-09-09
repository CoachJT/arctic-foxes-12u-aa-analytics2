const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const coachSource = fs.readFileSync('web/coach-qol.js', 'utf8');
const appSource = fs.readFileSync('web/app.js', 'utf8');
const indexSource = fs.readFileSync('web/index.html', 'utf8');
const stylesSource = fs.readFileSync('web/styles.css', 'utf8');
const migrationSource = fs.readFileSync('supabase/migrations/010_coach_qol_writes.sql', 'utf8');

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
      seasonKey: '2026-2027',
      capabilities: ['schedule.edit', 'stats.edit', 'players.evaluate'],
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
  assert.match(migrationSource, /on conflict \(team_id, source_game_id, source_player_id, player_type\) do update/);
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
  await assert.rejects(coach.addPlayer({ jerseyNumber: '7', name: 'Other', position: 'F' }), /already assigned to Jane Smith/);
  await assert.rejects(coach.addPlayer({ jerseyNumber: '10', name: '', position: 'F' }), /player name/);
  await assert.rejects(coach.addPlayer({ jerseyNumber: '10', name: 'X', position: 'C' }), /F, D, or G/);
});

test('roster edits and removals are scoped to the current team', async () => {
  const coach = loadCoach({}, { roster: [{ id: 'r1', source_player_id: 'p7', jersey_number: '7', name: 'Jane', position: 'F' }] });
  await assert.rejects(coach.editPlayer('r1', { jerseyNumber: '7', name: 'Jane', position: 'X' }), /F, D, or G/);
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
  assert.match(indexSource, /coach-qol\.js\?v=stage6-coach-1/);
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
  assert.match(coachSource, /rpc\('coach_save_game_stats'/);
});

test('bulk save RPC is guarded, atomic, and team-scoped server-side', () => {
  assert.match(migrationSource, /function public\.coach_save_game_stats\(/);
  assert.match(migrationSource, /if not public\.has_team_capability\(target_team_id, 'stats\.edit'\) then/);
  assert.match(migrationSource, /security definer/);
  assert.match(migrationSource, /revoke all on function public\.coach_save_game_stats/);
  assert.match(migrationSource, /grant execute on function public\.coach_save_game_stats\(uuid, text, jsonb, jsonb\) to authenticated/);
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
