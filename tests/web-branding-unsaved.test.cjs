const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const brandingSource = fs.readFileSync(path.join(__dirname, '../web/team-branding.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');
// Run the actual navigation function, not a reimplementation of its guard.
const renderSource = appSource.slice(appSource.indexOf("function render(view = 'command')"),
  appSource.indexOf("window.addEventListener('beforeunload'"));

function element() {
  return { value: '', checked: false, disabled: false, dataset: {}, textContent: '',
    listeners: {}, style: { setProperty() {} }, classList: { remove() {} },
    attributes: {}, addEventListener(name, fn) { this.listeners[name] = fn; }, setAttribute(name,value) { this.attributes[name]=value; } };
}

async function setup() {
  const events = {}, prompts = [], saved = [];
  let answer = false, pendingSave, saveError;
  const row = { team_id: 'team-a', display_name: 'Test Hockey', updated_at: '2026-09-16T00:00:00Z',
    primary_color: '#38bdf8', secondary_color: '#081320', accent_color: '#dceef9',
    settings: { visual: { tagline: 'Saved tagline' } } };
  const context = { membership: { team_id: 'team-a', status: 'active' },
    capabilities: ['admin.permissions'], userId: 'coach-a' };
  const form = element(), previewPage = element(), backgroundPage = element(), preview = element(), status = element(), reset = element();
  const controls = new Map();
  const devices = ['desktop', 'tablet', 'mobile'].map(device => Object.assign(element(), { dataset: { device } }));
  const presets = [Object.assign(element(), { dataset: { preset: 'Classic Red' } })];
  const themes = ['Ice Arena','Players','Bench View'].map(theme=>Object.assign(element(),{dataset:{theme}}));
  const hexes = ['primary','secondary','accent'].map(key=>Object.assign(element(),{dataset:{hex:key+'_color'}}));
  const host = {
    isConnected: true,
    set innerHTML(html) {
      // Minimal DOM adapter for the real mount() listeners. Unexpected selectors fail closed.
      controls.clear();
      for (const m of html.matchAll(/<input\b([^>]+)>/g)) {
        const name = m[1].match(/name="([^"]+)"/)?.[1];
        if (name) controls.set(name, Object.assign(element(), {
          value: m[1].match(/value="([^"]*)"/)?.[1] || '', checked: /\bchecked\b/.test(m[1])
        }));
      }
      for (const m of html.matchAll(/<textarea\b[^>]*name="([^"]+)"[^>]*>([^<]*)<\/textarea>/g))
        controls.set(m[1], Object.assign(element(), { value: m[2] }));
      for (const m of html.matchAll(/<select name="([^"]+)">([\s\S]*?)<\/select>/g))
        controls.set(m[1], Object.assign(element(), { value: m[2].match(/<option selected>([^<]+)</)?.[1] || '' }));
      form.elements = Object.fromEntries(controls);
      previewPage.value = 'command';
      status.textContent = html.match(/id="brandStatus"[^>]*>([^<]*)</)?.[1] || '';
    },
    querySelector(selector) {
      const named = selector.match(/^\[name="([^"]+)"\]$/);
      if (named) return controls.get(named[1]);
      const nodes = { form, '#brandForm': form, '#previewPage': previewPage, '#brandPreview': preview,
        '#brandStatus': status, '#resetBranding': reset, '#backgroundPage': backgroundPage };
      assert.ok(selector in nodes, `Unexpected selector: ${selector}`);
      return nodes[selector];
    },
    querySelectorAll(selector) {
      const lists = { '[data-device]': devices, '[data-preset]': presets, '[data-upload]': [], '[data-theme]': themes, '[data-hex]': hexes,
        'input,select,textarea': [...controls.values(),...hexes],
        'input,select,textarea,button': [...controls.values(), ...devices, ...presets, reset] };
      assert.ok(selector in lists, `Unexpected selector: ${selector}`);
      return lists[selector];
    }
  };
  const client = { from() {
    let patch;
    return { select() { return this; }, eq() { return this; }, is() { return this; },
      update(value) { patch = value; return this; },
      async maybeSingle() {
        if (!patch) return { data: structuredClone(row) };
        if (pendingSave) await pendingSave;
        if (saveError) return { error: { message: saveError } };
        Object.assign(row, patch);
        return { data: structuredClone(row) };
      } };
  } };
  const window = { addEventListener(name, fn) { events[name] = fn; },
    confirm(message) { prompts.push(message); return answer; }, scrollTo() {}, scrollY: 0 };
  class FormData {
    constructor() { this.entries = [...controls].map(([name, el]) => [name, el.value]); }
    [Symbol.iterator]() { return this.entries[Symbol.iterator](); }
    get(name) { return this.entries.find(([key]) => key === name)?.[1] ?? null; }
  }
  const sandbox = { window, URL, FormData };
  vm.createContext(sandbox);
  vm.runInContext(brandingSource, sandbox);
  const B = window.PuckTeamBranding;
  await B.mount(host, { client, getContext: () => context, onSaved: async value => saved.push(value) });
  let page = 'settings';
  const nodes = Object.fromEntries(['#viewCrumb', '#sidebar', '#scrim', '#openSidebar'].map(key => [key, element()]));
  Object.assign(sandbox, {
    lastRenderedView: 'settings', coachQol: { saveState: 'idle', SAVE_STATES: { SAVING: 'saving' }, dirty: false },
    can: () => true, roleViews: { games: 'games' }, activeStaff: {}, phase1Data: {}, phase1DataError: '',
    document: { querySelector: selector => nodes[selector] || null, querySelectorAll: () => [] },
    app: { set innerHTML(value) { page = value; host.isConnected = false; } },
    gameCenter: () => 'game view', viewNames: { games: 'Game Center' }, seasonContext: { branding: row }, nav: [],
    renderRoleSwitcher() {}, renderTeamSwitcher() {}, renderSeasonSwitcher() {}, renderTenantBranding() {},
    renderActionCenter() {}, bindCoachStatsControls() {}, syncNavigation() {}
  });
  // Styling is unrelated to navigation and has no browser document in this unit harness.
  B.apply = () => {};
  vm.runInContext(renderSource, sandbox);
  return { B, host, form, controls, devices, presets, reset, status, prompts, saved, themes, hexes, previewPage,
    answer(value) { answer = value; }, page: () => page,
    edit(value = 'Unsaved tagline') { controls.get('tagline').value = value; form.listeners.input(); },
    navigate() { return vm.runInContext("render('games')", sandbox); },
    submit() { return form.onsubmit({ preventDefault() {} }); },
    delaySave(promise) { pendingSave = promise; }, failSave(message) { saveError = message; },
    unload() { const event = { prevented: false, preventDefault() { this.prevented = true; } }; events.beforeunload(event); return event; }
  };
}

test('clean branding and preview-only controls do not prompt or block unloading', async () => {
  const h = await setup();
  h.devices[2].onclick();
  assert.equal(h.B.canLeave(), true);
  assert.equal(h.unload().prevented, false);
  assert.equal(h.prompts.length, 0);
});

test('Cancel on unsaved branding stops real navigation and preserves entered values', async () => {
  const h = await setup(); h.edit(); h.answer(false);
  assert.equal(h.navigate(), false);
  assert.equal(h.page(), 'settings');
  assert.equal(h.host.isConnected, true);
  assert.equal(h.controls.get('tagline').value, 'Unsaved tagline');
  assert.equal(h.prompts[0], 'You have unsaved branding changes. Leave without saving?');
  const event = h.unload();
  assert.equal(event.prevented, true);
  assert.equal(event.returnValue, '');
});

test('Confirm allows real navigation and detached editor no longer blocks unloading', async () => {
  const h = await setup(); h.edit(); h.answer(true);
  assert.notEqual(h.navigate(), false);
  assert.equal(h.page(), 'game view');
  assert.equal(h.prompts.length, 1);
  assert.equal(h.B.canLeave(), true);
  assert.equal(h.unload().prevented, false);
});

test('pending save blocks leaving; successful save clears dirty state and its warning', async () => {
  const h = await setup(); h.edit('New saved tagline');
  let release; h.delaySave(new Promise(resolve => { release = resolve; }));
  const saving = h.submit();
  assert.equal(h.navigate(), false);
  assert.equal(h.prompts.length, 0);
  assert.equal(h.unload().prevented, true);
  release(); await saving;
  assert.equal(h.saved[0].settings.visual.tagline, 'New saved tagline');
  assert.equal(h.status.textContent, 'Team branding saved.');
  assert.equal(h.unload().prevented, false);
  h.navigate();
  assert.equal(h.page(), 'game view');
  assert.equal(h.prompts.length, 0);
});

test('failed save preserves unsaved values and continues to protect navigation', async () => {
  const h = await setup(); h.edit(); h.failSave('Save rejected');
  await h.submit();
  assert.equal(h.status.textContent, 'Save rejected');
  assert.equal(h.saved.length, 0);
  assert.equal(h.controls.get('tagline').value, 'Unsaved tagline');
  assert.equal(h.navigate(), false);
  assert.equal(h.unload().prevented, true);
});

test('color preset marks branding dirty; Reset restores saved values and clears protection', async () => {
  const h = await setup(); h.presets[0].onclick();
  assert.equal(h.B.canLeave(), false);
  assert.equal(h.controls.get('primary_color').value, '#e32636');
  h.reset.onclick();
  assert.equal(h.controls.get('primary_color').value, '#38bdf8');
  assert.equal(h.controls.get('tagline').value, 'Saved tagline');
  const count = h.prompts.length;
  assert.equal(h.B.canLeave(), true);
  assert.equal(h.prompts.length, count);
  assert.equal(h.unload().prevented, false);
});

test('thumbnail edits only the previewed page, preserves other assignments and saves through the existing patch', async () => {
  const h = await setup();
  h.previewPage.value='film'; h.previewPage.listeners.change();
  assert.equal(h.B.canLeave(),true);
  h.themes[1].onclick();
  assert.equal(h.controls.get('theme_film').value,'Players');
  assert.equal(h.controls.get('theme_command').value,'Ice Arena');
  assert.equal(h.themes[1].attributes['aria-pressed'],'true');
  assert.equal(h.unload().prevented,true);
  await h.submit();
  assert.equal(h.saved[0].settings.visual.page_themes.film,'Players');
  assert.equal(h.unload().prevented,false);
});

test('valid manual hex edits update the existing color value; invalid edits never enter the patch', async () => {
  const h=await setup(), input=h.hexes[0];
  input.value='#00ff00'; h.form.listeners.input({target:input});
  assert.equal(h.controls.get('primary_color').value,'#00ff00');
  input.value='invalid'; h.form.listeners.input({target:input});
  assert.equal(h.controls.get('primary_color').value,'#00ff00');
  assert.equal(h.unload().prevented,true);
  h.reset.onclick();
  assert.equal(h.controls.get('primary_color').value,'#38bdf8');
  assert.equal(h.unload().prevented,false);
});
