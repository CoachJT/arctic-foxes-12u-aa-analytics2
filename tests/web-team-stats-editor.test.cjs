const test = require('node:test');
const assert = require('node:assert/strict');
const looseAssert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');

// Re-QA regressions (Fixes 3, 4, 5): the Team Stats save/dirty/discard state
// machine and the live shot-total preview. These are pure/state functions in
// web/app.js with no DOM dependency beyond `window.confirm`, so the real
// implementation is sliced out and executed directly -- not reimplemented --
// so a regression in app.js is actually caught here.
const appSource = fs.readFileSync('web/app.js', 'utf8');
const editorSource = appSource.slice(
  appSource.indexOf('const teamStatsFields = ['),
  appSource.indexOf('function teamStatsInput(field, label, value, disabled = \'\') {')
);
assert.ok(editorSource.includes('function confirmTeamStatsDiscard'), 'editor slice must include confirmTeamStatsDiscard');
assert.ok(editorSource.includes('function teamStatsTotalFromDraft'), 'editor slice must include teamStatsTotalFromDraft');

function loadEditor({ confirmReturns = true } = {}) {
  const context = { console, window: { confirm: () => confirmReturns } };
  vm.createContext(context);
  // `teamStatsEditor` is declared with `const`, so (unlike the `function`
  // declarations here) it never becomes a property of the vm context on its
  // own -- expose the same object reference explicitly so tests can inspect
  // the real mutable state the extracted functions operate on.
  vm.runInContext(`${editorSource}\nthis.teamStatsEditor = teamStatsEditor;`, context);
  return context;
}

test('Fix 3/baseline: a successful save refreshes the original baseline to the persisted draft, not the pre-save values', () => {
  const ctx = loadEditor();
  ctx.resetTeamStatsEditor('g1', { shots_for_p1: 5, shots_for_p2: 6, shots_for_p3: 7 });
  ctx.teamStatsEditor.draft.shots_for_p1 = '9';
  looseAssert.deepEqual(ctx.teamStatsPatch(), { shots_for_p1: 9 });
  // Simulate the save-success handler's baseline refresh (mirrors the real
  // app.js `bindTeamStatsEditor` success branch).
  ctx.teamStatsEditor.original = { ...ctx.teamStatsEditor.draft };
  ctx.teamStatsEditor.dirty = false;
  // Same gameId (no reset triggered) -- the next patch computation must not
  // re-diff against the stale pre-save baseline.
  looseAssert.deepEqual(ctx.teamStatsPatch(), {});
  ctx.teamStatsEditor.draft.shots_for_p2 = '11';
  looseAssert.deepEqual(ctx.teamStatsPatch(), { shots_for_p2: 11 }); // only the truly new edit, not p1 again
});

test('Fix 4: discarding unsaved changes restores the draft to the last-saved baseline, not just clears the dirty flag', () => {
  const ctx = loadEditor({ confirmReturns: true });
  ctx.resetTeamStatsEditor('g1', { shots_for_p1: 5 });
  ctx.teamStatsEditor.draft.shots_for_p1 = '99';
  ctx.teamStatsEditor.dirty = true;
  const left = ctx.confirmTeamStatsDiscard();
  assert.equal(left, true);
  assert.equal(ctx.teamStatsEditor.dirty, false);
  // The draft itself must be restored to the saved original, not left as
  // the discarded edit -- otherwise returning to the same game (which never
  // re-triggers resetTeamStatsEditor since gameId is unchanged) would keep
  // showing the discarded, never-persisted value.
  assert.equal(ctx.teamStatsEditor.draft.shots_for_p1, '5');
});

test('Fix 4: declining the discard confirmation keeps the draft and dirty flag intact', () => {
  const ctx = loadEditor({ confirmReturns: false });
  ctx.resetTeamStatsEditor('g1', { shots_for_p1: 5 });
  ctx.teamStatsEditor.draft.shots_for_p1 = '99';
  ctx.teamStatsEditor.dirty = true;
  const left = ctx.confirmTeamStatsDiscard();
  assert.equal(left, false);
  assert.equal(ctx.teamStatsEditor.dirty, true);
  assert.equal(ctx.teamStatsEditor.draft.shots_for_p1, '99');
});

test('Fix 5: the shot total previews live from a complete unsaved draft rather than the stale historical stored total', () => {
  const ctx = loadEditor();
  assert.equal(ctx.teamStatsTotalFromDraft({ shots_for_p1: '2', shots_for_p2: '3', shots_for_p3: '4' }, 'for'), 9);
  // Partial draft (still missing a period entry) must not fabricate a total.
  assert.equal(ctx.teamStatsTotalFromDraft({ shots_for_p1: '2', shots_for_p2: '', shots_for_p3: '4' }, 'for'), null);
  assert.equal(ctx.teamStatsTotalFromDraft({ shots_for_p1: '0', shots_for_p2: '0', shots_for_p3: '0' }, 'for'), 0); // explicit zeros are a real total, not missing
});

test('Fix 5: an incomplete draft falls back to the historical/server-derived total instead of showing nothing', () => {
  const ctx = loadEditor();
  const row = { shots_for_p1: 5, shots_for_p2: 6, shots_for_p3: 7 };
  assert.equal(ctx.teamStatsTotal(row, 'for'), 18);
  assert.equal(ctx.teamStatsTotalFromDraft({ shots_for_p1: '', shots_for_p2: '', shots_for_p3: '' }, 'for'), null);
});
