(function attachOnboarding(global) {
  const STEPS = [
    { id: 'account', label: 'Account' },
    { id: 'organization', label: 'Organization' },
    { id: 'team', label: 'Team' },
    { id: 'season', label: 'Season' },
    { id: 'roster', label: 'Roster' },
    { id: 'staff', label: 'Staff' },
    { id: 'branding', label: 'Branding' },
    { id: 'review', label: 'Review' }
  ];
  const EDITABLE_STEPS = ['organization', 'team', 'season', 'roster', 'staff', 'branding'];

  function createOnboarding({ client, user, branding = {}, onComplete, onSignOut }) {
    let root = null;
    let progress = null;
    let step = 'organization';
    let busy = false;
    let error = '';
    let notice = '';
    let roster = [];
    let invites = [];
    let teamBranding = null;
    let organization = null;
    let team = null;

    function esc(value) {
      return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    async function call(name, args = {}) {
      const { data, error: rpcError } = await client.rpc(name, args);
      if (rpcError) throw new Error(rpcError.message || `${name} failed.`);
      return data;
    }

    function completion(id) {
      if (!progress) return false;
      if (id === 'account') return true;
      if (id === 'organization') return progress.organization_complete;
      if (id === 'team') return progress.team_complete;
      if (id === 'season') return progress.season_complete;
      if (id === 'roster') return progress.roster_complete || roster.length > 0;
      if (id === 'staff') return progress.staff_complete || invites.length > 0;
      if (id === 'branding') return progress.branding_complete;
      if (id === 'review') return progress.review_complete;
      return false;
    }

    function stepStatus(id) {
      if (progress?.completed_at) return 'Complete';
      if (completion(id)) return 'Complete';
      if (id === 'staff' || id === 'branding') return 'Optional';
      if (['organization', 'team', 'season', 'roster'].includes(id)) return 'Needs attention';
      return 'Optional';
    }

    function currentStepFromProgress() {
      if (!progress || progress.completed_at) return 'review';
      if (progress.current_step === 'review') return 'review';
      if (EDITABLE_STEPS.includes(progress.current_step)) return progress.current_step;
      return 'organization';
    }

    async function refreshState() {
      roster = [];
      invites = [];
      teamBranding = null;
      organization = null;
      team = null;
      if (progress?.organization_id) {
        const { data: org } = await client.from('organizations').select('id,name,slug,status').eq('id', progress.organization_id).maybeSingle();
        organization = org || null;
      }
      if (!progress?.team_id) return;
      const [rosterResult, inviteResult, brandingResult] = await Promise.all([
        client.from('team_roster_players').select('jersey_number,name,position,status').eq('team_id', progress.team_id).eq('status', 'active').order('jersey_number'),
        client.rpc('onboarding_list_invites'),
        client.from('team_branding').select('display_name,short_name,primary_color,secondary_color,accent_color,logo_url').eq('team_id', progress.team_id).maybeSingle()
      ]);
      if (rosterResult.error) throw new Error(rosterResult.error.message);
      if (inviteResult.error) throw new Error(inviteResult.error.message);
      roster = rosterResult.data || [];
      invites = inviteResult.data || [];
      teamBranding = brandingResult.data || null;
      const { data: teamRow } = await client.from('teams').select('id,name,slug').eq('id', progress.team_id).maybeSingle();
      team = teamRow || null;
    }

    async function load() {
      busy = true;
      error = '';
      paint();
      try {
        progress = await call('onboarding_ensure');
        step = currentStepFromProgress();
        await refreshState();
      } catch (loadError) {
        error = loadError.message || 'Onboarding could not be loaded.';
      }
      busy = false;
      paint();
    }

    function progressBar() {
      return `<ol class="onboarding-progress">${STEPS.map(item => {
        const done = completion(item.id);
        const current = item.id === step;
        return `<li class="${done ? 'done' : ''}${current ? ' current' : ''}"><span>${done ? '✓' : ''}</span>${esc(item.label)}</li>`;
      }).join('')}</ol>`;
    }

    function message() {
      return `${error ? `<div class="onboarding-error" role="alert">${esc(error)}</div>` : ''}${notice ? `<div class="onboarding-notice" role="status">${esc(notice)}</div>` : ''}`;
    }

    function accountBody() {
      return `<section class="onboarding-card"><h2>Account</h2>
        <p>You are signed in as <strong>${esc(user?.email || 'your PuckNexus account')}</strong>. Your account is ready — nothing else is needed here.</p>
        <div class="onboarding-actions"><button class="btn primary" data-next type="button">Continue</button></div></section>`;
    }

    function organizationBody() {
      return `<section class="onboarding-card"><h2>Create your organization</h2>
        <p>Your organization groups one or more teams under one program (for example, an association or club).</p>
        <form id="obOrganization" class="onboarding-form">
          <label>Organization name<input id="obOrgName" type="text" maxlength="120" required placeholder="Arctic Foxes Hockey" value="${esc(organization?.name || '')}" /></label>
          <button class="btn primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Saving…' : 'Create organization'}</button>
        </form></section>`;
    }

    function teamBody() {
      return `<section class="onboarding-card"><h2>Create your first team</h2>
        <p>This team belongs to <strong>${esc(organization?.name || 'your organization')}</strong>. You will be its owner.</p>
        <form id="obTeam" class="onboarding-form">
          <label>Team name<input id="obTeamName" type="text" maxlength="120" required placeholder="Arctic Foxes 12U AA" value="${esc(team?.name || '')}" /></label>
          <button class="btn primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Saving…' : 'Create team'}</button>
        </form></section>`;
    }

    function seasonBody() {
      const now = new Date();
      const startYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
      return `<section class="onboarding-card"><h2>Set up your season</h2>
        <p>Pick the season this team is playing. It becomes the team's active season.</p>
        <form id="obSeason" class="onboarding-form">
          <label>Season<input id="obSeasonKey" type="text" required pattern="\\d{4}-\\d{4}" placeholder="${startYear}-${startYear + 1}" value="${esc(progress?.season_id ? '' : `${startYear}-${startYear + 1}`)}" /></label>
          <button class="btn primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Saving…' : 'Create season'}</button>
        </form></section>`;
    }

    function rosterBody() {
      const rows = roster.map(player => `<tr><td>${esc(player.jersey_number)}</td><td>${esc(player.name)}</td><td>${esc(player.position)}</td></tr>`).join('');
      return `<section class="onboarding-card"><h2>Build your roster</h2>
        <p>Add players one at a time, or paste a CSV list (<code>jersey,name,position</code> — one player per line). Positions: F forward, D defense, G goalie.</p>
        <form id="obAddPlayer" class="onboarding-inline">
          <input id="obJersey" type="text" inputmode="numeric" maxlength="4" required placeholder="#" aria-label="Jersey number" />
          <input id="obPlayerName" type="text" maxlength="120" required placeholder="Player name" aria-label="Player name" />
          <select id="obPosition" aria-label="Position"><option value="F">F</option><option value="D">D</option><option value="G">G</option></select>
          <button class="btn" type="submit" ${busy ? 'disabled' : ''}>Add player</button>
        </form>
        <form id="obImport" class="onboarding-form onboarding-import">
          <label>Import roster (CSV paste)<textarea id="obCsv" rows="4" placeholder="7, Jane Smith, F&#10;22, Alex Doe, D&#10;30, Sam Ray, G"></textarea></label>
          <button class="btn" type="submit" ${busy ? 'disabled' : ''}>Import list</button>
        </form>
        <div class="onboarding-table-wrap"><table class="admin-table"><thead><tr><th>#</th><th>Player</th><th>Pos</th></tr></thead><tbody>${rows || '<tr><td colspan="3">No players yet. Add at least one to continue.</td></tr>'}</tbody></table></div>
        <div class="onboarding-actions"><span class="onboarding-count">${roster.length} player${roster.length === 1 ? '' : 's'} added</span>
        <button class="btn primary" data-mark-step="roster" type="button" ${busy || !roster.length ? 'disabled' : ''}>Continue</button></div></section>`;
    }

    function staffBody() {
      const rows = invites.map(invite => `<tr><td>${esc(invite.email)}</td><td>${esc(invite.display_name || '—')}</td><td>${esc(invite.role_id === 'assistant_goalie' ? 'Assistant / Goalie Coach' : 'Assistant Coach')}</td><td>${esc(invite.status)}</td></tr>`).join('');
      return `<section class="onboarding-card"><h2>Add your staff</h2>
        <p>Invite assistant coaches now, or skip and do it later. Each invite is recorded with a 14-day expiry and email delivery through the secure invite service.</p>
        <form id="obInvite" class="onboarding-inline onboarding-staff">
          <input id="obStaffName" type="text" maxlength="120" placeholder="Coach name" aria-label="Coach name" />
          <input id="obStaffEmail" type="email" maxlength="254" required placeholder="coach@example.com" aria-label="Coach email" />
          <select id="obStaffRole" aria-label="Staff role"><option value="assistant">Assistant Coach</option><option value="assistant_goalie">Assistant / Goalie Coach</option></select>
          <button class="btn" type="submit" ${busy ? 'disabled' : ''}>Send invite</button>
        </form>
        <div class="onboarding-table-wrap"><table class="admin-table"><thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No staff invited yet.</td></tr>'}</tbody></table></div>
        <div class="onboarding-actions"><button class="btn" data-mark-step="staff" type="button" ${busy ? 'disabled' : ''}>${invites.length ? 'Continue' : 'Skip for now'}</button></div></section>`;
    }

    function brandingBody() {
      const current = teamBranding || {};
      return `<section class="onboarding-card"><h2>Team branding</h2>
        <p>Pick your team colors. This only affects your team's workspace — the ${esc(branding.name || 'PuckNexus')} platform brand is untouched.</p>
        <form id="obBranding" class="onboarding-form onboarding-branding">
          <label>Team display name<input id="obBrandName" type="text" maxlength="120" value="${esc(current.display_name || team?.name || '')}" /></label>
          <div class="onboarding-colors">
            <label>Primary<input id="obPrimary" type="color" value="${esc(current.primary_color || '#d71920')}" /></label>
            <label>Secondary<input id="obSecondary" type="color" value="${esc(current.secondary_color || '#0d0e10')}" /></label>
            <label>Accent<input id="obAccent" type="color" value="${esc(current.accent_color || '#f2f3f4')}" /></label>
          </div>
          <div class="onboarding-preview" id="obPreview"><span class="onboarding-swatch" style="background:${esc(current.primary_color || '#d71920')}"></span><strong>${esc(current.display_name || team?.name || 'Your team')}</strong></div>
          <div class="onboarding-actions"><button class="btn" data-mark-step="branding" type="button" ${busy ? 'disabled' : ''}>Skip for now</button>
          <button class="btn primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Saving…' : 'Save branding'}</button></div>
        </form></section>`;
    }

    function reviewBody() {
      const rows = STEPS.filter(item => item.id !== 'review').map(item => {
        const status = stepStatus(item.id);
        return `<tr><td>${esc(item.label)}</td><td><span class="admin-badge admin-badge-${status === 'Complete' ? 'active' : status === 'Optional' ? 'standard' : 'pending'}">${status}</span></td>
          <td>${status !== 'Complete' && EDITABLE_STEPS.includes(item.id) ? `<button class="btn admin-action" data-goto="${item.id}" type="button">Go to ${esc(item.label)}</button>` : ''}</td></tr>`;
      }).join('');
      const requiredReady = ['organization', 'team', 'season', 'roster'].every(completion);
      return `<section class="onboarding-card"><h2>Review your setup</h2>
        <div class="admin-stat-grid">
          <div class="admin-stat"><small>Organization</small><strong>${esc(organization?.name || '—')}</strong></div>
          <div class="admin-stat"><small>Team</small><strong>${esc(team?.name || '—')}</strong></div>
          <div class="admin-stat"><small>Roster</small><strong>${roster.length} player${roster.length === 1 ? '' : 's'}</strong></div>
          <div class="admin-stat"><small>Staff invites</small><strong>${invites.length} pending</strong></div>
        </div>
        <div class="onboarding-table-wrap"><table class="admin-table"><thead><tr><th>Step</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
        <div class="onboarding-actions"><button class="btn primary ob-finish" id="obFinish" type="button" ${busy || !requiredReady ? 'disabled' : ''}>${busy ? 'Finishing…' : 'FINISH SETUP'}</button></div>
        ${requiredReady ? '' : '<p class="onboarding-hint">Organization, team, season, and at least one roster player are required before finishing.</p>'}</section>`;
    }

    function body() {
      if (step === 'account') return accountBody();
      if (step === 'organization') return organizationBody();
      if (step === 'team') return teamBody();
      if (step === 'season') return seasonBody();
      if (step === 'roster') return rosterBody();
      if (step === 'staff') return staffBody();
      if (step === 'branding') return brandingBody();
      return reviewBody();
    }

    function paint() {
      if (!root) return;
      root.innerHTML = `<div class="onboarding-head"><div class="eyebrow">${esc(branding.name || 'PuckNexus')} · Guided setup</div><h1>Set up your team</h1><p>Progress is saved to your account — you can leave and resume at any time.</p></div>
        ${progressBar()}${message()}${busy && !error ? '' : body()}
        <div class="onboarding-foot"><button class="btn" id="obSignOut" type="button">Sign out</button></div>`;
      bind();
    }

    async function run(action) {
      if (busy) return;
      busy = true;
      error = '';
      notice = '';
      paint();
      try {
        await action();
        progress = await call('onboarding_ensure');
        await refreshState();
      } catch (actionError) {
        error = actionError.message || 'That step could not be saved.';
      }
      busy = false;
      paint();
    }

    function parseCsv(text) {
      return String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map((line, index) => {
        const parts = line.split(',').map(part => part.trim());
        if (parts.length < 3) throw new Error(`Line ${index + 1}: expected "jersey, name, position".`);
        return { jersey: parts[0], name: parts[1], position: parts[2] };
      });
    }

    function bind() {
      root.querySelector('#obSignOut')?.addEventListener('click', () => onSignOut?.());
      root.querySelector('[data-next]')?.addEventListener('click', () => { step = 'organization'; paint(); });
      root.querySelectorAll('[data-goto]').forEach(button => button.addEventListener('click', () => { step = button.dataset.goto; paint(); }));
      root.querySelectorAll('[data-mark-step]').forEach(button => button.addEventListener('click', () => run(async () => {
        const result = await call('onboarding_mark_step', { step: button.dataset.markStep });
        step = result.next === 'review' ? 'review' : result.next;
      })));
      root.querySelector('#obOrganization')?.addEventListener('submit', event => {
        event.preventDefault();
        run(async () => {
          await call('onboarding_create_organization', { org_name: event.target.querySelector('#obOrgName').value });
          step = 'team';
        });
      });
      root.querySelector('#obTeam')?.addEventListener('submit', event => {
        event.preventDefault();
        run(async () => {
          await call('onboarding_create_team', { team_name: event.target.querySelector('#obTeamName').value });
          step = 'season';
        });
      });
      root.querySelector('#obSeason')?.addEventListener('submit', event => {
        event.preventDefault();
        run(async () => {
          await call('onboarding_create_season', { season_label: event.target.querySelector('#obSeasonKey').value });
          step = 'roster';
        });
      });
      root.querySelector('#obAddPlayer')?.addEventListener('submit', event => {
        event.preventDefault();
        const form = event.target;
        run(async () => {
          await call('onboarding_add_player', {
            player_name: form.querySelector('#obPlayerName').value,
            jersey: form.querySelector('#obJersey').value,
            player_position: form.querySelector('#obPosition').value
          });
          notice = 'Player added.';
        });
      });
      root.querySelector('#obImport')?.addEventListener('submit', event => {
        event.preventDefault();
        const text = event.target.querySelector('#obCsv').value;
        run(async () => {
          const players = parseCsv(text);
          const seen = new Set();
          for (const player of players) {
            const key = player.jersey;
            if (seen.has(key)) throw new Error(`Duplicate jersey number ${key} in the import list.`);
            seen.add(key);
            await call('onboarding_add_player', { player_name: player.name, jersey: player.jersey, player_position: player.position });
          }
          notice = `${players.length} player${players.length === 1 ? '' : 's'} imported.`;
        });
      });
      root.querySelector('#obInvite')?.addEventListener('submit', event => {
        event.preventDefault();
        const form = event.target;
        run(async () => {
          const { data, error: inviteError } = await client.functions.invoke('invite-staff', {
            body: {
              action: 'invite',
              email: form.querySelector('#obStaffEmail').value,
              displayName: form.querySelector('#obStaffName').value,
              roleId: form.querySelector('#obStaffRole').value,
              teamSlug: team?.slug || ''
            }
          });
          if (inviteError) throw new Error(inviteError.message || 'The invitation could not be created.');
          if (data?.error) throw new Error(data.error);
          notice = 'Invitation created. Email delivery runs through the invite service.';
        });
      });
      root.querySelector('#obBranding')?.addEventListener('submit', event => {
        event.preventDefault();
        const form = event.target;
        run(async () => {
          await call('onboarding_save_branding', {
            primary_color_input: form.querySelector('#obPrimary').value,
            secondary_color_input: form.querySelector('#obSecondary').value,
            accent_color_input: form.querySelector('#obAccent').value,
            display_name_input: form.querySelector('#obBrandName').value
          });
          step = 'review';
        });
      });
      root.querySelector('#obFinish')?.addEventListener('click', () => run(async () => {
        await call('onboarding_complete');
        onComplete?.(progress?.team_id);
      }));
    }

    function mount(element) {
      root = element;
      root.classList.add('onboarding-root');
      load();
    }

    function unmount() {
      root = null;
      progress = null;
      step = 'organization';
      busy = false;
      error = '';
      notice = '';
      roster = [];
      invites = [];
      teamBranding = null;
      organization = null;
      team = null;
    }

    return { mount, unmount, get progress() { return progress; }, get step() { return step; } };
  }

  global.FoxesOnboarding = { createOnboarding, STEPS };
}(window));
