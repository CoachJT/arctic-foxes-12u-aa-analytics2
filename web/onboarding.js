(function attachOnboarding(global) {
  const STEPS = [
    { id: 'account', label: 'Account' },
    { id: 'organization', label: 'Organization' },
    { id: 'team', label: 'Team' },
    { id: 'season', label: 'Season' },
    { id: 'roster', label: 'Roster' },
    { id: 'staff', label: 'Staff' },
    { id: 'branding', label: 'Branding' },
    { id: 'first_game', label: 'First Game' },
    { id: 'first_stats', label: 'First Stats' },
    { id: 'review', label: 'Review' }
  ];
  const EDITABLE_STEPS = ['organization', 'team', 'season', 'roster', 'staff', 'branding', 'first_game', 'first_stats'];
  const STAFF_ROLES = {
    head_coach: { label: 'Head Coach', permissions: 'Full team operations and staff management' },
    assistant: { label: 'Assistant Coach', permissions: 'Roster, schedule, games, and reports' },
    assistant_goalie: { label: 'Assistant / Goalie Coach', permissions: 'Roster, schedule, games, and reports' },
    team_manager: { label: 'Team Manager', permissions: 'Schedule, roster, reports, and staff administration' },
    video_coach: { label: 'Video Coach', permissions: 'Games, video review, scouting, and reports' }
  };

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
    let firstGame = null;
    let firstGameStats = null;

    function esc(value) {
      return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    async function call(name, args = {}) {
      const { data, error: rpcError } = await client.rpc(name, args);
      if (rpcError) throw new Error(rpcError.message || `${name} failed.`);
      return data;
    }

    function isV2() {
      return Boolean(progress?.onboarding_v2_step);
    }

    function stepRpc() {
      return isV2() ? 'onboarding2_mark_step' : 'onboarding_mark_step';
    }

    function visibleSteps() {
      return isV2() ? STEPS : STEPS.filter(item => item.id !== 'first_game' && item.id !== 'first_stats');
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
      if (id === 'first_game') return progress.first_game_complete || Boolean(firstGame);
      if (id === 'first_stats') return progress.first_stats_complete || Boolean(firstGameStats);
      if (id === 'review') return progress.review_complete;
      return false;
    }

    function stepStatus(id) {
      if (progress?.completed_at) return 'Complete';
      if (completion(id)) return 'Complete';
      if (id === 'staff' || id === 'branding' || id === 'first_stats') return 'Optional';
      if (['organization', 'team', 'season', 'roster', 'first_game'].includes(id)) return 'Needs attention';
      return 'Optional';
    }

    function currentStepFromProgress() {
      if (!progress || progress.completed_at) return 'review';
      if (progress.onboarding_v2_step) return progress.onboarding_v2_step;
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
      firstGame = null;
      firstGameStats = null;
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
      if (progress.season_id) {
        const { data: gameRow, error: gameError } = await client.from('team_schedule_games')
          .select('id,date,time,opponent,home_away,game_type,location,linked_game_source_id')
          .eq('team_id', progress.team_id).eq('season_id', progress.season_id)
          .order('created_at', { ascending: true }).limit(1).maybeSingle();
        if (gameError) throw new Error(gameError.message);
        firstGame = gameRow || null;
        if (firstGame?.linked_game_source_id) {
          const { data: statsRow, error: statsError } = await client.from('team_game_team_stats')
            .select('goals_for,goals_against').eq('team_id', progress.team_id)
            .eq('source_game_id', firstGame.linked_game_source_id).maybeSingle();
          if (statsError) throw new Error(statsError.message);
          firstGameStats = statsRow || null;
        }
      }
    }

    async function load() {
      busy = true;
      error = '';
      paint();
      try {
        progress = await call('onboarding2_ensure');
        step = currentStepFromProgress();
        await refreshState();
      } catch (loadError) {
        error = loadError.message || 'Onboarding could not be loaded.';
      }
      busy = false;
      paint();
    }

    function progressBar() {
      return `<ol class="onboarding-progress">${visibleSteps().map(item => {
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
        <p>Add players one at a time, or import a CSV file/list with <code>jersey,name,position</code>. Positions: F forward, D defense, G goalie.</p>
        <form id="obAddPlayer" class="onboarding-inline">
          <input id="obJersey" type="text" inputmode="numeric" maxlength="4" required placeholder="#" aria-label="Jersey number" />
          <input id="obPlayerName" type="text" maxlength="120" required placeholder="Player name" aria-label="Player name" />
          <select id="obPosition" aria-label="Position"><option value="F">F</option><option value="D">D</option><option value="G">G</option></select>
          <button class="btn" type="submit" ${busy ? 'disabled' : ''}>Add player</button>
        </form>
        <form id="obImport" class="onboarding-form onboarding-import">
          <label>Roster CSV file<input id="obRosterFile" type="file" accept=".csv,text/csv" /></label>
          <label>Import roster (paste or review CSV)<textarea id="obCsv" rows="4" placeholder="jersey,name,position&#10;7, Jane Smith, F&#10;22, Alex Doe, D&#10;30, Sam Ray, G"></textarea></label>
          <button class="btn" type="submit" ${busy ? 'disabled' : ''}>Import list</button>
        </form>
        <div class="onboarding-table-wrap"><table class="admin-table"><thead><tr><th>#</th><th>Player</th><th>Pos</th></tr></thead><tbody>${rows || '<tr><td colspan="3">No players yet. Add at least one to continue.</td></tr>'}</tbody></table></div>
        <div class="onboarding-actions"><span class="onboarding-count">${roster.length} player${roster.length === 1 ? '' : 's'} added</span>
        <button class="btn primary" data-mark-step="roster" type="button" ${busy || !roster.length ? 'disabled' : ''}>Continue</button></div></section>`;
    }

    function staffBody() {
      const rows = invites.map(invite => `<tr><td>${esc(invite.email)}</td><td>${esc(invite.display_name || '—')}</td><td>${esc(STAFF_ROLES[invite.role_id]?.label || invite.role_id)}</td><td>${esc(invite.status)}</td></tr>`).join('');
      return `<section class="onboarding-card"><h2>Add your staff</h2>
        <p>Invite staff now, or skip and do it later. Roles control access inside this team only; no invite receives Platform Admin access.</p>
        <form id="obInvite" class="onboarding-inline onboarding-staff">
          <input id="obStaffName" type="text" maxlength="120" placeholder="Coach name" aria-label="Coach name" />
          <input id="obStaffEmail" type="email" maxlength="254" required placeholder="coach@example.com" aria-label="Coach email" />
          <select id="obStaffRole" aria-label="Staff role">${Object.entries(STAFF_ROLES).map(([id, role]) => `<option value="${id}">${esc(role.label)}</option>`).join('')}</select>
          <button class="btn" type="submit" ${busy ? 'disabled' : ''}>Send invite</button>
        </form>
        <p class="onboarding-role-note" id="obRoleNote"><strong>Assistant Coach:</strong> Roster, schedule, games, and reports. Permission is assigned securely when the invite is accepted.</p>
        <div class="onboarding-table-wrap"><table class="admin-table"><thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No staff invited yet.</td></tr>'}</tbody></table></div>
        <div class="onboarding-actions"><button class="btn" data-mark-step="staff" type="button" ${busy ? 'disabled' : ''}>${invites.length ? 'Continue' : 'Skip for now'}</button></div></section>`;
    }

    function brandingBody() {
      const current = teamBranding || {};
      return `<section class="onboarding-card"><h2>Team branding</h2>
        <p>Pick your team colors. This only affects your team's workspace — the ${esc(branding.name || 'PuckNexus')} platform brand is untouched.</p>
        <form id="obBranding" class="onboarding-form onboarding-branding">
          <label>Team display name<input id="obBrandName" type="text" maxlength="120" value="${esc(current.display_name || team?.name || '')}" /></label>
          <label>Team logo (optional, PNG/JPEG/WebP, max 10 MB)<input id="obLogoFile" type="file" accept="image/png,image/jpeg,image/webp" /></label>
          <div class="onboarding-colors">
            <label>Primary<input id="obPrimary" type="color" value="${esc(current.primary_color || '#d71920')}" /></label>
            <label>Secondary<input id="obSecondary" type="color" value="${esc(current.secondary_color || '#0d0e10')}" /></label>
            <label>Accent<input id="obAccent" type="color" value="${esc(current.accent_color || '#f2f3f4')}" /></label>
          </div>
          <div class="onboarding-preview" id="obPreview" style="border-color:${esc(current.primary_color || '#d71920')}">${current.logo_url ? `<img class="onboarding-logo" src="${esc(current.logo_url)}" alt="${esc(current.display_name || team?.name || 'Team')} logo" />` : '<span class="onboarding-swatch" style="background:#d71920"></span>'}<strong>${esc(current.display_name || team?.name || 'Your team')}</strong><span>Workspace preview</span></div>
          <div class="onboarding-actions"><button class="btn" data-mark-step="branding" type="button" ${busy ? 'disabled' : ''}>Skip for now</button>
          <button class="btn primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Saving…' : 'Save branding'}</button></div>
        </form></section>`;
    }

    function firstGameBody() {
      const today = new Date().toLocaleDateString('en-CA');
      if (firstGame) {
        return `<section class="onboarding-card"><h2>Your first game is ready</h2>
          <div class="onboarding-game-summary"><strong>${esc(firstGame.opponent)}</strong><span>${esc(firstGame.date)} · ${esc(firstGame.home_away)}${firstGame.time ? ` · ${esc(firstGame.time)}` : ''}</span></div>
          <p>You can manage every game later from Schedule. Continue now to enter the first result when the game is eligible.</p>
          <div class="onboarding-actions"><button class="btn primary" data-mark-step="first_game" type="button" ${busy ? 'disabled' : ''}>Continue to stats</button></div></section>`;
      }
      return `<section class="onboarding-card"><h2>Add your first game</h2>
        <p>This creates the first real Schedule and Game Center entry for your team.</p>
        <form id="obFirstGame" class="onboarding-form onboarding-game-form">
          <div class="onboarding-game-grid">
            <label>Date<input id="obGameDate" type="date" required value="${esc(today)}" /></label>
            <label>Opponent<input id="obGameOpponent" type="text" maxlength="120" required placeholder="Opponent name" /></label>
            <label>Time<input id="obGameTime" type="time" /></label>
            <label>Home / Away<select id="obGameHomeAway"><option>Home</option><option>Away</option></select></label>
            <label>Game type<select id="obGameType"><option>League</option><option>Exhibition</option><option>Tournament</option><option>Playoff</option></select></label>
            <label>Location<input id="obGameLocation" type="text" maxlength="160" placeholder="Arena (optional)" /></label>
          </div>
          <button class="btn primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Adding…' : 'Add first game'}</button>
        </form></section>`;
    }

    function firstStatsBody() {
      if (!firstGame) return `<section class="onboarding-card"><h2>Enter your first stats</h2><p>Add your first game before entering a result.</p><div class="onboarding-actions"><button class="btn primary" data-goto="first_game" type="button">Add first game</button></div></section>`;
      const today = new Date().toLocaleDateString('en-CA');
      const eligible = String(firstGame.date) <= today;
      const scored = firstGameStats?.goals_for !== null && firstGameStats?.goals_for !== undefined
        && firstGameStats?.goals_against !== null && firstGameStats?.goals_against !== undefined;
      if (!eligible) {
        return `<section class="onboarding-card"><h2>Stats unlock on game day</h2>
          <p>Your game against <strong>${esc(firstGame.opponent)}</strong> is scheduled for ${esc(firstGame.date)}. PuckNexus will not accept a result before the game is played.</p>
          <div class="onboarding-actions"><button class="btn primary" data-mark-step="first_stats" type="button" ${busy ? 'disabled' : ''}>Continue to review</button></div></section>`;
      }
      return `<section class="onboarding-card"><h2>Enter your first result</h2>
        <p>Save the final score now. Detailed player and goalie stats remain available in Game Center after setup.</p>
        <form id="obFirstStats" class="onboarding-score-form">
          <div><span>Us</span><input id="obGoalsFor" type="number" min="0" step="1" inputmode="numeric" required value="${scored ? esc(firstGameStats.goals_for) : ''}" /></div>
          <strong>–</strong>
          <div><span>Them</span><input id="obGoalsAgainst" type="number" min="0" step="1" inputmode="numeric" required value="${scored ? esc(firstGameStats.goals_against) : ''}" /></div>
          <button class="btn primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Saving…' : scored ? 'Update result' : 'Save result'}</button>
        </form>
        <div class="onboarding-actions"><button class="btn" data-mark-step="first_stats" type="button" ${busy ? 'disabled' : ''}>Enter detailed stats later</button></div></section>`;
    }

    function reviewBody() {
      const rows = visibleSteps().filter(item => item.id !== 'review').map(item => {
        const status = stepStatus(item.id);
        return `<tr><td>${esc(item.label)}</td><td><span class="admin-badge admin-badge-${status === 'Complete' ? 'active' : status === 'Optional' ? 'standard' : 'pending'}">${status}</span></td>
          <td>${status !== 'Complete' && EDITABLE_STEPS.includes(item.id) ? `<button class="btn admin-action" data-goto="${item.id}" type="button">Go to ${esc(item.label)}</button>` : ''}</td></tr>`;
      }).join('');
      const requiredSteps = isV2()
        ? ['organization', 'team', 'season', 'roster', 'first_game']
        : ['organization', 'team', 'season', 'roster'];
      const requiredReady = requiredSteps.every(completion);
      return `<section class="onboarding-card"><h2>Review your setup</h2>
        <div class="admin-stat-grid">
          <div class="admin-stat"><small>Organization</small><strong>${esc(organization?.name || '—')}</strong></div>
          <div class="admin-stat"><small>Team</small><strong>${esc(team?.name || '—')}</strong></div>
          <div class="admin-stat"><small>Roster</small><strong>${roster.length} player${roster.length === 1 ? '' : 's'}</strong></div>
          <div class="admin-stat"><small>Staff invites</small><strong>${invites.length} pending</strong></div>
        </div>
        <div class="onboarding-table-wrap"><table class="admin-table"><thead><tr><th>Step</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
        <div class="onboarding-actions"><button class="btn primary ob-finish" id="obFinish" type="button" ${busy || !requiredReady ? 'disabled' : ''}>${busy ? 'Finishing…' : 'FINISH SETUP'}</button></div>
        ${requiredReady ? '' : '<p class="onboarding-hint">Organization, team, season, at least one roster player, and a first game are required before finishing.</p>'}</section>`;
    }

    function body() {
      if (step === 'account') return accountBody();
      if (step === 'organization') return organizationBody();
      if (step === 'team') return teamBody();
      if (step === 'season') return seasonBody();
      if (step === 'roster') return rosterBody();
      if (step === 'staff') return staffBody();
      if (step === 'branding') return brandingBody();
      if (step === 'first_game') return firstGameBody();
      if (step === 'first_stats') return firstStatsBody();
      return reviewBody();
    }

    function paint() {
      if (!root) return;
      root.innerHTML = `<div class="onboarding-head"><div class="eyebrow">${esc(branding.name || 'PuckNexus')} · Guided setup</div><h1>Set up your team</h1><p>Progress is saved to your account — you can leave and resume at any time.</p></div>
        ${progressBar()}${message()}${busy && !error ? '' : body()}
        ${!busy && step !== 'organization' ? `<div class="onboarding-nav"><button class="btn" data-back type="button">Back</button><span>Changes save as you continue.</span></div>` : ''}
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
      const rows = [];
      let row = [], value = '', quoted = false;
      const source = String(text || '').replace(/^\uFEFF/, '');
      for (let index = 0; index <= source.length; index += 1) {
        const char = source[index] || '\n';
        if (char === '"') {
          if (quoted && source[index + 1] === '"') { value += '"'; index += 1; } else quoted = !quoted;
        } else if (char === ',' && !quoted) { row.push(value.trim()); value = ''; }
        else if ((char === '\n' || char === '\r') && !quoted) {
          if (char === '\r' && source[index + 1] === '\n') index += 1;
          row.push(value.trim());
          if (row.some(Boolean)) rows.push(row);
          row = []; value = '';
        } else value += char;
      }
      if (quoted) throw new Error('Your CSV has an unclosed quote. Fix it and try again.');
      if (rows[0]?.map(cell => cell.toLowerCase()).join(',') === 'jersey,name,position') rows.shift();
      return rows.map((parts, index) => {
        if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) throw new Error(`Line ${index + 1}: expected "jersey, name, position".`);
        return { jersey: parts[0], name: parts[1], position: parts[2].toUpperCase() };
      });
    }

    function previousStep() {
      const index = EDITABLE_STEPS.indexOf(step);
      return index > 0 ? EDITABLE_STEPS[index - 1] : 'organization';
    }

    async function uploadLogo(file) {
      if (!file) return;
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Logo must be a PNG, JPEG, or WebP image.');
      if (file.size < 1 || file.size > 10485760) throw new Error('Logo must be between 1 byte and 10 MB.');
      const prepared = await call('prepare_organization_branding_asset', {
        target_organization_id: progress.organization_id, target_team_id: progress.team_id,
        requested_asset_key: 'logo', requested_mime_type: file.type, requested_size_bytes: file.size
      });
      const asset = Array.isArray(prepared) ? prepared[0] : prepared;
      if (!asset?.asset_id || !asset?.bucket_name || !asset?.object_path) throw new Error('Logo upload could not be prepared.');
      try {
        const { error: storageError } = await client.storage.from(asset.bucket_name).upload(asset.object_path, file, { upsert: false, contentType: file.type });
        if (storageError) throw new Error(storageError.message || 'Logo upload failed.');
        await call('finalize_organization_branding_asset', { target_asset_id: asset.asset_id });
      } catch (uploadError) {
        await call('abort_organization_branding_asset', { target_asset_id: asset.asset_id }).catch(() => {});
        throw uploadError;
      }
    }

    function parseScore(value, label) {
      const score = Number(value);
      if (!Number.isInteger(score) || score < 0) throw new Error(`${label} must be a non-negative whole number.`);
      return score;
    }

    function bind() {
      root.querySelector('#obSignOut')?.addEventListener('click', () => onSignOut?.());
      root.querySelector('[data-next]')?.addEventListener('click', () => { step = 'organization'; paint(); });
      root.querySelector('[data-back]')?.addEventListener('click', () => { step = previousStep(); paint(); });
      root.querySelectorAll('[data-goto]').forEach(button => button.addEventListener('click', () => { step = button.dataset.goto; paint(); }));
      root.querySelectorAll('[data-mark-step]').forEach(button => button.addEventListener('click', () => run(async () => {
        const result = await call(stepRpc(), { step: button.dataset.markStep });
        step = result.next === 'review' ? 'review' : result.next;
      })));
      root.querySelector('#obOrganization')?.addEventListener('submit', event => {
        event.preventDefault();
        run(async () => {
          await call('onboarding_create_organization', { org_name: event.target.querySelector('#obOrgName').value });
          if (isV2()) await call('onboarding2_mark_step', { step: 'organization' });
          step = 'team';
        });
      });
      root.querySelector('#obTeam')?.addEventListener('submit', event => {
        event.preventDefault();
        run(async () => {
          await call('onboarding_create_team', { team_name: event.target.querySelector('#obTeamName').value });
          if (isV2()) await call('onboarding2_mark_step', { step: 'team' });
          step = 'season';
        });
      });
      root.querySelector('#obSeason')?.addEventListener('submit', event => {
        event.preventDefault();
        run(async () => {
          await call('onboarding_create_season', { season_label: event.target.querySelector('#obSeasonKey').value });
          if (isV2()) await call('onboarding2_mark_step', { step: 'season' });
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
      root.querySelector('#obRosterFile')?.addEventListener('change', event => {
        const file = event.target.files?.[0];
        if (!file) return;
        if (file.size > 1048576) { error = 'Roster CSV must be 1 MB or smaller.'; paint(); return; }
        const reader = new FileReader();
        reader.onload = () => {
          const textarea = root.querySelector('#obCsv');
          if (textarea) textarea.value = String(reader.result || '');
          notice = `${file.name} is ready to import.`;
        };
        reader.onerror = () => { error = 'The roster file could not be read.'; paint(); };
        reader.readAsText(file);
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
      root.querySelector('#obStaffRole')?.addEventListener('change', event => {
        const role = STAFF_ROLES[event.target.value] || STAFF_ROLES.assistant;
        const note = root.querySelector('#obRoleNote');
        if (note) note.innerHTML = `<strong>${esc(role.label)}:</strong> ${esc(role.permissions)}. Permission is assigned securely when the invite is accepted.`;
      });
      root.querySelector('#obBranding')?.addEventListener('submit', event => {
        event.preventDefault();
        const form = event.target;
        run(async () => {
          await uploadLogo(form.querySelector('#obLogoFile').files?.[0]);
          await call(isV2() ? 'onboarding2_save_branding' : 'onboarding_save_branding', {
            primary_color_input: form.querySelector('#obPrimary').value,
            secondary_color_input: form.querySelector('#obSecondary').value,
            accent_color_input: form.querySelector('#obAccent').value,
            display_name_input: form.querySelector('#obBrandName').value
          });
          step = 'first_game';
        });
      });
      root.querySelector('#obFirstGame')?.addEventListener('submit', event => {
        event.preventDefault();
        const form = event.target;
        run(async () => {
          await call('onboarding2_add_first_game', {
            game_date: form.querySelector('#obGameDate').value,
            opponent_name: form.querySelector('#obGameOpponent').value,
            game_time: form.querySelector('#obGameTime').value || null,
            game_home_away: form.querySelector('#obGameHomeAway').value,
            game_type_name: form.querySelector('#obGameType').value,
            game_location: form.querySelector('#obGameLocation').value
          });
          step = 'first_stats';
        });
      });
      root.querySelector('#obFirstStats')?.addEventListener('submit', event => {
        event.preventDefault();
        const form = event.target;
        run(async () => {
          await call('save_game_score', {
            target_team_id: progress.team_id,
            target_season_id: progress.season_id,
            target_source_game_id: firstGame.linked_game_source_id,
            target_goals_for: parseScore(form.querySelector('#obGoalsFor').value, 'Our score'),
            target_goals_against: parseScore(form.querySelector('#obGoalsAgainst').value, 'Opponent score')
          });
          await call(stepRpc(), { step: 'first_stats' });
          step = 'review';
          notice = 'First result saved. Your dashboard record is ready.';
        });
      });
      root.querySelector('#obFinish')?.addEventListener('click', () => run(async () => {
        await call(isV2() ? 'onboarding2_complete' : 'onboarding_complete');
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
      firstGame = null;
      firstGameStats = null;
    }

    return { mount, unmount, get progress() { return progress; }, get step() { return step; } };
  }

  global.FoxesOnboarding = { createOnboarding, STEPS };
}(window));
