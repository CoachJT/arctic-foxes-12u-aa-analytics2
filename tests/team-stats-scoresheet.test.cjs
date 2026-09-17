const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Founder Polish: Team Stats hockey-scoresheet visual redesign. These
// functions are pure HTML-string builders in web/app.js with no real DOM
// dependency, so the real implementation is sliced out and executed
// directly (matching the approach already used by
// tests/web-team-stats-editor.test.cjs and tests/work-browser-regressions.test.cjs)
// rather than re-implemented, so a regression in app.js is actually caught.
const appSource = fs.readFileSync('web/app.js', 'utf8');
const source = appSource.slice(
  appSource.indexOf('const teamStatsFields = ['),
  appSource.indexOf('let selectedPlayerId = ')
);
assert.ok(source.includes('function teamStatsForm('), 'slice must include teamStatsForm');
assert.ok(source.includes('function teamStatsSpecialTeamsBadges('), 'slice must include teamStatsSpecialTeamsBadges');

function loadForm() {
  const context = { console, tenantName: () => 'Arctic Foxes', escapeHtml: value => String(value ?? '') };
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.api = { teamStatsForm, resetTeamStatsEditor, teamStatsEditor };`, context);
  return context.api;
}

test('Founder Polish: Team Stats renders a P1/P2/P3/OT/Total scoresheet table with team/opponent row labels and preserves derived totals', () => {
  const api = loadForm();
  const game = { source_game_id: 'g1', opponent: 'Ice Hawks' };
  const row = { source_game_id: 'g1', shots_for_p1: 8, shots_for_p2: 11, shots_for_p3: 9, shots_against_p1: 6, shots_against_p2: 7, shots_against_p3: 10 };
  const html = api.teamStatsForm(game, row, true);
  assert.match(html, /<table class="team-stats-scoresheet">/);
  assert.match(html, /<th scope="col">P1<\/th>/);
  assert.match(html, /<th scope="col">P2<\/th>/);
  assert.match(html, /<th scope="col">P3<\/th>/);
  assert.match(html, /<th scope="col">OT<\/th>/);
  assert.match(html, /<th scope="col">Total<\/th>/);
  assert.match(html, /Arctic Foxes/);
  assert.match(html, /Ice Hawks/);
  assert.match(html, />28<\/strong>/); // derived total for = 8+11+9
  assert.match(html, />23<\/strong>/); // derived total against = 6+7+10
  // Every existing period field must still be a real, individually
  // addressable input -- the scoresheet redesign must not drop or merge
  // fields, only restructure their surrounding markup.
  ['shots_for_p1', 'shots_for_p2', 'shots_for_p3', 'shots_for_ot', 'shots_against_p1', 'shots_against_p2', 'shots_against_p3', 'shots_against_ot']
    .forEach(field => assert.match(html, new RegExp(`data-team-stat-field="${field}"`)));
});

test('Founder Polish: teamStatsForm still exposes exactly two .team-stats-total-grid > div nodes in for-then-against order (live-update selector contract from bindTeamStatsEditor)', () => {
  const api = loadForm();
  const game = { source_game_id: 'g2', opponent: 'Opponent' };
  const row = { source_game_id: 'g2' };
  const html = api.teamStatsForm(game, row, true);
  const wrappers = [...html.matchAll(/<div class="team-stats-total-grid">(<div>.*?<\/div>)<\/div>/g)];
  assert.equal(wrappers.length, 2, 'exactly one .team-stats-total-grid wrapper per row (for, then against)');
  assert.match(wrappers[0][1], /Shots for/);
  assert.match(wrappers[1][1], /Shots against/);
});

test('Founder Polish: Team Stats special-teams summary shows a computed percentage only when both fields are recorded, and dashes otherwise, without replacing the editable inputs', () => {
  const api = loadForm();
  const game = { source_game_id: 'g3', opponent: 'Opponent' };
  const row = { source_game_id: 'g3' };
  api.resetTeamStatsEditor('g3', row);
  api.teamStatsEditor.draft.power_play_success = '2';
  api.teamStatsEditor.draft.power_play_chances = '4';
  const html = api.teamStatsForm(game, row, true);
  assert.match(html, /Power play/);
  assert.match(html, /2 \/ 4/);
  assert.match(html, /50\.0%/);
  assert.match(html, /Penalty kill/);
  assert.match(html, /— \/ —/); // penalty kill not recorded in this draft
  assert.match(html, /Faceoffs/);
  assert.match(html, /— – —/); // faceoffs not recorded in this draft
  // The badges are a read-only summary layered alongside the real inputs;
  // the underlying editable power-play/penalty-kill/faceoff fields must
  // still be present as real inputs.
  ['power_play_chances', 'power_play_success', 'penalty_kill_chances', 'penalty_kill_success', 'faceoff_wins', 'faceoff_losses']
    .forEach(field => assert.match(html, new RegExp(`data-team-stat-field="${field}"`)));
});
