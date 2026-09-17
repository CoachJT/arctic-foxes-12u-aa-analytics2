const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('web/app.js', 'utf8');
function harness(fail = false) {
  const handlers = {};
  const button = { disabled: false, textContent: 'Save Team Stats', addEventListener: (type, fn) => handlers.save = fn };
  const status = { textContent: '', className: '' };
  const inputs = [{ disabled: false, addEventListener(type, fn) { handlers.input=fn; } }];
  const totals = [{strong:{},span:{}},{strong:{},span:{}}];
  const cards = totals.map(card=>({querySelector:selector=>card[selector]}));
  const editor = { querySelectorAll: selector => selector === '.team-stats-total-grid > div' ? cards : inputs, querySelector: selector => selector === '[data-save-team-stats]' ? button : status };
  const row = { source_game_id: 'qa', shots_for_p1: 1, shots_for_p2: 2, shots_for_p3: 3 };
  let acceptDiscard = false;
  const sandbox = { document: { querySelector: () => editor }, window: { confirm: () => acceptDiscard },
    phase1Data: { teamStats: [row] }, authTeam: { team_id: 'team' }, seasonContext: { selectedSeasonId: 'season' },
    escapeHtml: String, render() {}, loadPhase1Data: async () => {},
    supabaseClient: { rpc: async (name, args) => {
      await Promise.resolve();
      if (fail) return { error: { message: 'Try again' } };
      Object.assign(row, args.payload);
      return { error: null };
    } }
  };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(source.indexOf('const teamStatsFields ='), source.indexOf('let selectedPlayerId =')) + '\n' + source.slice(source.indexOf('function bindTeamStatsEditor()'), source.indexOf('function bindCoachStatsControls()')) + '\nthis.api = {resetTeamStatsEditor, teamStatsEditor, teamStatsPatch, confirmTeamStatsDiscard, bindTeamStatsEditor};', sandbox);
  sandbox.api.resetTeamStatsEditor('qa', row);
  sandbox.api.teamStatsEditor.draft.shots_for_p1 = '10';
  sandbox.api.teamStatsEditor.dirty = true;
  sandbox.api.bindTeamStatsEditor();
  return { ...sandbox.api, button, status, inputs, row, totals, input: (field,value)=>handlers.input({currentTarget:{dataset:{teamStatField:field},value}}), save: async () => {
    const event = { currentTarget: button };
    const pending = handlers.save(event);
    // Native event.currentTarget is cleared once dispatch has finished.
    event.currentTarget = null;
    await pending;
  }, setDiscard: value => { acceptDiscard = value; } };
}
test('failed asynchronous save is retryable and preserves the entered draft', async () => {
  const h = harness(true);
  await h.save();
  assert.equal(h.button.disabled, false);
  assert.equal(h.button.textContent, 'Save Team Stats');
  assert.equal(h.status.textContent, 'Try again');
  assert.equal(h.inputs[0].disabled, false);
  assert.equal(h.teamStatsEditor.draft.shots_for_p1, '10');
  assert.equal(h.teamStatsEditor.dirty, true);
});

test('input events immediately update totals and mark incomplete drafts', () => {
  const h=harness();
  h.input('shots_for_p1','8');h.input('shots_for_p2','11');h.input('shots_for_p3','9');
  assert.equal(h.totals[0].strong.textContent,28);
  h.input('shots_for_p2','');
  assert.equal(h.totals[0].strong.textContent,6);
  assert.match(h.totals[0].span.textContent,/incomplete/);
});
test('successful save rebases patches so editing back to the former value is recorded', async () => {
  const h = harness();
  await h.save();
  assert.equal(h.teamStatsEditor.original.shots_for_p1, '10');
  assert.equal(Object.keys(h.teamStatsPatch()).length, 0);
  h.teamStatsEditor.draft.shots_for_p1 = '1';
  assert.equal(h.teamStatsPatch().shots_for_p1, 1);
});
test('cancel keeps the draft; confirmed discard restores the saved baseline', () => {
  const h = harness();
  assert.equal(h.confirmTeamStatsDiscard(), false);
  assert.equal(h.teamStatsEditor.dirty, true);
  h.setDiscard(true);
  assert.equal(h.confirmTeamStatsDiscard(), true);
  assert.equal(h.teamStatsEditor.draft.shots_for_p1, '1');
  assert.equal(h.teamStatsEditor.dirty, false);
});
