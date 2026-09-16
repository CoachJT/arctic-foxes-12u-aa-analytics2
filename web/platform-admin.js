(function attachPlatformAdmin(global) {
  const BETA_LABELS = { none: 'Standard', beta_team: 'Beta Team', early_adopter: 'Early Adopter' };

  function supportFlags(game, today) {
    const flags = [];
    if (!game.date || game.date >= today) return flags;
    if (game.goals_for == null || game.goals_against == null) flags.push('Final score not entered');
    if (!Number(game.player_stat_rows)) flags.push('Player stats not entered');
    if (game.goals_for != null && game.player_goals != null && Number(game.player_stat_rows) > 0 && Number(game.player_goals) !== Number(game.goals_for)) flags.push('Player goals differ from team score — verify context');
    return flags;
  }

  function createPlatformAdmin({ client, platformAccess, branding = {}, onSignOut }) {
    let root = null;
    let view = 'overview';
    let loading = false;
    let error = '';
    let detail = null;
    let search = '';
    let loadVersion = 0;
    let data = { organizations: null, teams: null, users: null, invitations: null };

    function esc(value) {
      return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function fmtDate(value) {
      if (!value) return '—';
      const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? `${value}T00:00:00` : value);
      return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' });
    }

    function badge(kind, label) {
      return `<span class="admin-badge admin-badge-${esc(kind)}">${esc(label)}</span>`;
    }

    function statusBadge(status) {
      return badge(status || 'unknown', status || 'unknown');
    }

    function betaBadge(status) {
      if (!status || status === 'none') return '';
      return badge('beta', BETA_LABELS[status] || status);
    }

    function platformBadges(roles) {
      return (roles || []).map(role => badge(role === 'founder' ? 'founder' : 'platform', role === 'founder' ? 'Founder' : 'Platform Admin')).join('');
    }

    function expectedDestination(record) {
      if ((record.platform_roles || []).length) {
        return {
          state: 'platform_admin',
          label: 'Admin Dashboard',
          issues: []
        };
      }
      const memberships = record.team_memberships || [];
      const active = memberships.filter(item => item.status === 'active');
      const invited = memberships.filter(item => item.status === 'invited');
      if (active.length) {
        const suspended = memberships.filter(item => item.status === 'suspended');
        return {
          state: 'team_workspace',
          label: 'Team Workspace',
          issues: suspended.map(item => `Suspended membership on ${item.team_name || item.team_id}`)
        };
      }
      if (invited.length) {
        return {
          state: 'onboarding',
          label: 'Onboarding',
          issues: invited.map(item => `Team membership is still invited, not active (${item.team_name || item.team_id})`)
        };
      }
      return {
        state: 'no_access',
        label: 'No Access',
        issues: ['No active membership or platform role found']
      };
    }

    async function call(name, args = {}) {
      const { data: result, error: rpcError } = await client.rpc(name, args);
      if (rpcError) throw new Error(rpcError.message || `${name} failed.`);
      return result;
    }

    async function loadView() {
      if (!root || !platformAccess?.isPlatformAdmin) return;
      const version = ++loadVersion;
      const requestedView = view;
      const requestedDetail = detail;
      const next = { ...data };
      loading = true;
      error = '';
      paint();
      try {
        if (requestedView === 'overview' || requestedView === 'organizations') {
          next.organizations = await call('admin_list_organizations');
        } else if (requestedView === 'organization') {
          const [organization, teams] = await Promise.all([
            call('admin_get_organization', { target_organization_id: requestedDetail.id }),
            call('admin_list_teams', { target_organization_id: requestedDetail.id })
          ]);
          next.organization = organization?.[0] || null;
          next.teams = teams;
        } else if (requestedView === 'teams') {
          next.teams = await call('admin_list_teams');
        } else if (requestedView === 'team') {
          const [teams, memberships, invitations, onboarding] = await Promise.all([
            call('admin_list_teams'),
            call('admin_list_memberships', { target_team_id: requestedDetail.id }),
            call('admin_list_invitations', { target_team_id: requestedDetail.id }),
            call('admin_list_onboarding')
          ]);
          next.team = (teams || []).find(team => team.id === requestedDetail.id) || null;
          next.memberships = memberships;
          next.invitations = invitations;
          next.onboarding = (onboarding || []).filter(row => row.team_id === requestedDetail.id);
        } else if (requestedView === 'support') {
          const snapshot = await call('admin_team_support_snapshot', { target_team_id: requestedDetail.id, target_season_id: requestedDetail.seasonId || null });
          if (!snapshot || snapshot.team_id !== requestedDetail.id) throw new Error('Support response did not match the selected team.');
          next.support = snapshot;
        } else if (requestedView === 'users') {
          next.users = await call('admin_list_users');
        } else if (requestedView === 'user') {
          next.user = (await call('admin_get_user', { target_user_id: requestedDetail.id }))?.[0] || null;
        } else if (requestedView === 'invitations') {
          next.invitations = await call('admin_list_invitations');
        } else if (requestedView === 'access') {
          const [organizations, teams] = await Promise.all([call('admin_list_organizations'), call('admin_list_teams')]);
          next.organizations = organizations;
          next.teams = teams;
        }
        if (version !== loadVersion || !root) return;
        data = next;
      } catch (loadError) {
        if (version !== loadVersion || !root) return;
        error = loadError.message || 'Admin data could not be loaded.';
      }
      loading = false;
      paint();
    }

    function head(title, sub) {
      return `<div class="admin-head"><div><div class="eyebrow">${esc(branding.name || 'PuckNexus')} · Platform Admin</div><h1>${esc(title)}</h1><p>${esc(sub)}</p></div><button class="btn" data-action="refresh" type="button">Refresh</button></div>`;
    }

    function nav() {
      const items = [
        ['overview', 'Overview'],
        ['organizations', 'Organizations'],
        ['teams', 'Teams'],
        ['users', 'Users'],
        ['invitations', 'Invitations'],
        ['access', 'Access / Beta']
      ];
      return `<nav class="admin-nav" aria-label="Platform admin navigation">${items.map(([id, label]) => `<button class="admin-nav-item${view === id ? ' active' : ''}" data-nav="${id}" type="button">${label}</button>`).join('')}</nav>`;
    }

    function searchRow(placeholder) {
      return `<div class="admin-toolbar"><input class="admin-search" type="search" placeholder="${esc(placeholder)}" value="${esc(search)}" aria-label="Search" /></div>`;
    }

    function matches(values) {
      if (!search.trim()) return true;
      const needle = search.trim().toLowerCase();
      return values.some(value => String(value ?? '').toLowerCase().includes(needle));
    }

    function table(headers, rows, emptyText) {
      if (!rows.length) return `<div class="admin-empty"><h2>Nothing to show</h2><p>${esc(emptyText)}</p></div>`;
      return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr>${headers.map(header => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => { let column = 0; return row.replace(/<td(?=[ >])/g, () => `<td data-label="${esc(headers[column++] || '')}"`); }).join('')}</tbody></table></div>`;
    }

    function overviewBody() {
      const orgs = data.organizations || [];
      const cards = [
        ['Organizations', orgs.length],
        ['Active organizations', orgs.filter(org => org.status === 'active').length],
        ['Total teams', orgs.reduce((sum, org) => sum + Number(org.team_count || 0), 0)],
        ['Organization members', orgs.reduce((sum, org) => sum + Number(org.member_count || 0), 0)],
        ['Beta / early adopter orgs', orgs.filter(org => org.beta_status && org.beta_status !== 'none').length]
      ];
      return `${head('Platform overview', 'Operational state across every organization on PuckNexus.')}
        <div class="admin-stat-grid">${cards.map(([label, value]) => `<div class="admin-stat"><small>${esc(label)}</small><strong>${value}</strong></div>`).join('')}</div>
        <section class="admin-card">${searchRow('Search organizations')}
        ${table(['Organization', 'Status', 'Beta', 'Teams', 'Members', 'Created'], orgs.filter(org => matches([org.name, org.slug])).map(org => `
          <tr><td><button class="admin-link" data-open-organization="${esc(org.id)}" type="button">${esc(org.name)}</button><small class="admin-sub">${esc(org.slug)}</small></td>
          <td>${statusBadge(org.status)}</td><td>${betaBadge(org.beta_status) || '<span class="admin-dim">—</span>'}</td>
          <td>${org.team_count}</td><td>${org.member_count}</td><td>${fmtDate(org.created_at)}</td></tr>`), 'No organizations exist yet.')}</section>`;
    }

    function organizationsBody() {
      const orgs = (data.organizations || []).filter(org => matches([org.name, org.slug]));
      return `${head('Organizations', 'Every organization on the platform. Open one to drill into teams and memberships.')}
        <section class="admin-card">${searchRow('Search organizations')}
        ${table(['Organization', 'Status', 'Beta', 'Teams', 'Members', 'Created'], orgs.map(org => `
          <tr><td><button class="admin-link" data-open-organization="${esc(org.id)}" type="button">${esc(org.name)}</button><small class="admin-sub">${esc(org.slug)}</small></td>
          <td>${statusBadge(org.status)}</td><td>${betaBadge(org.beta_status) || '<span class="admin-dim">—</span>'}</td>
          <td>${org.team_count}</td><td>${org.member_count}</td><td>${fmtDate(org.created_at)}</td></tr>`), 'No organizations match your search.')}</section>`;
    }

    function organizationBody() {
      const org = data.organization;
      if (!org) return `${head('Organization', 'The requested organization could not be read.')}<div class="admin-empty"><h2>Organization unavailable</h2><p>It may have been removed, or the read was rejected.</p></div>`;
      const teams = data.teams || [];
      return `${head(org.name, `${org.slug} · created ${fmtDate(org.created_at)}`)}
        <div class="admin-stat-grid">
          <div class="admin-stat"><small>Status</small><strong>${esc(org.status)}</strong></div>
          <div class="admin-stat"><small>Beta</small><strong>${esc(BETA_LABELS[org.beta_status] || org.beta_status)}</strong></div>
          <div class="admin-stat"><small>Teams</small><strong>${teams.length}</strong></div>
          <div class="admin-stat"><small>Members on teams</small><strong>${teams.reduce((sum, team) => sum + Number(team.member_count || 0), 0)}</strong></div>
        </div>
        <section class="admin-card"><div class="admin-card-title"><h2>Teams in this organization</h2></div>
        ${table(['Team', 'Season', 'Beta', 'Members', 'Pending invites'], teams.map(team => `
          <tr><td><button class="admin-link" data-open-team="${esc(team.id)}" type="button">${esc(team.name)}</button><small class="admin-sub">${esc(team.slug)}</small></td>
          <td>${esc(team.default_season_key || '—')}</td><td>${betaBadge(team.beta_status) || '<span class="admin-dim">—</span>'}</td>
          <td>${team.member_count}</td><td>${team.pending_invite_count > 0 ? badge('pending', `${team.pending_invite_count} pending`) : '0'}</td></tr>`), 'This organization has no teams yet.')}</section>
        <section class="admin-card"><div class="admin-card-title"><h2>Beta access</h2><span class="admin-security">Server-authorized</span></div>
          <div class="admin-actions-row">
            ${['none', 'beta_team', 'early_adopter'].map(status => `<button class="btn${org.beta_status === status ? ' primary' : ''}" data-beta-kind="organization" data-beta-id="${esc(org.id)}" data-beta-status="${status}" type="button">${esc(BETA_LABELS[status])}</button>`).join('')}
          </div></section>`;
    }

    function teamsBody() {
      const teams = (data.teams || []).filter(team => matches([team.name, team.slug, team.organization_name]));
      return `${head('Teams', 'Every team on the platform, across organizations.')}
        <section class="admin-card">${searchRow('Search teams or organizations')}
        ${table(['Team', 'Organization', 'Season', 'Beta', 'Members', 'Pending invites', 'Created'], teams.map(team => `
          <tr><td><button class="admin-link" data-open-team="${esc(team.id)}" type="button">${esc(team.name)}</button><small class="admin-sub">${esc(team.slug)}</small></td>
          <td>${esc(team.organization_name || '—')}</td><td>${esc(team.default_season_key || '—')}</td>
          <td>${betaBadge(team.beta_status) || '<span class="admin-dim">—</span>'}</td>
          <td>${team.member_count}</td><td>${team.pending_invite_count > 0 ? badge('pending', `${team.pending_invite_count} pending`) : '0'}</td>
          <td>${fmtDate(team.created_at)}</td></tr>`), 'No teams match your search.')}</section>`;
    }

    function teamBody() {
      const team = data.team;
      if (!team) return `${head('Team', 'The requested team could not be read.')}<div class="admin-empty"><h2>Team unavailable</h2><p>It may have been removed, or the read was rejected.</p></div>`;
      const memberships = data.memberships || [];
      const invitations = data.invitations || [];
      const onboarding = data.onboarding || [];
      return `${head(team.name, `${team.organization_name || 'No organization'} · season ${team.default_season_key || '—'}`)}
        <div class="admin-support-banner"><div><strong>Team support</strong><p>Inspect roster, game completeness and reported issues without editing this team's data.</p></div><button class="btn primary" data-open-support="${esc(team.id)}" type="button">Open support view ↗</button></div>
        ${setupChecks(team, memberships, invitations, onboarding)}
        <div class="admin-stat-grid">
          <div class="admin-stat"><small>Beta</small><strong>${esc(BETA_LABELS[team.beta_status] || team.beta_status)}</strong></div>
          <div class="admin-stat"><small>Members</small><strong>${memberships.length}</strong></div>
          <div class="admin-stat"><small>Active</small><strong>${memberships.filter(item => item.status === 'active').length}</strong></div>
          <div class="admin-stat"><small>Pending invites</small><strong>${invitations.filter(item => item.status === 'pending').length}</strong></div>
        </div>
        <section class="admin-card"><div class="admin-card-title"><h2>Onboarding status</h2></div>
        ${table(['User', 'Step', 'Status', 'Updated', 'Completed'], onboarding.map(row => `
          <tr><td>${esc(row.display_name)}</td><td>${esc(row.current_step)}</td><td>${statusBadge(row.status === 'in_progress' ? 'pending' : row.status === 'completed' ? 'active' : 'standard')}${esc(row.status === 'in_progress' ? 'In progress' : row.status === 'completed' ? 'Completed' : 'Not started')}</td>
          <td>${fmtDate(row.updated_at)}</td><td>${fmtDate(row.completed_at)}</td></tr>`), 'No onboarding records for this team — existing configured teams are not in onboarding.')}</section>
        <section class="admin-card"><div class="admin-card-title"><h2>Memberships</h2></div>
        ${table(['Member', 'Role', 'Status', 'Since'], memberships.map(item => `
          <tr><td><button class="admin-link" data-open-user="${esc(item.user_id)}" type="button">${esc(item.display_name)}</button></td>
          <td>${esc(item.role_label || item.role_id)}</td><td>${statusBadge(item.status)}</td><td>${fmtDate(item.created_at)}</td></tr>`), 'This team has no memberships.')}</section>
        <section class="admin-card"><div class="admin-card-title"><h2>Invitations</h2></div>
        ${table(['Email', 'Name', 'Role', 'Status', 'Expires'], invitations.map(item => `
          <tr><td>${esc(item.email)}</td><td>${esc(item.display_name || '—')}</td><td>${esc(item.role_id)}</td>
          <td>${statusBadge(item.status)}</td><td>${fmtDate(item.expires_at)}</td></tr>`), 'No invitations recorded for this team.')}</section>
        <section class="admin-card"><div class="admin-card-title"><h2>Beta access</h2><span class="admin-security">Server-authorized</span></div>
          <div class="admin-actions-row">
            ${['none', 'beta_team', 'early_adopter'].map(status => `<button class="btn${team.beta_status === status ? ' primary' : ''}" data-beta-kind="team" data-beta-id="${esc(team.id)}" data-beta-status="${status}" type="button">${esc(BETA_LABELS[status])}</button>`).join('')}
          </div></section>`;
    }

    function setupChecks(team, members, invitations, onboarding) {
      const checks = [];
      if (!team.default_season_id) checks.push(['Season not selected', 'Ask the team owner to finish season setup.']);
      if (!members.some(m => m.status === 'active' && m.role_id === 'owner')) checks.push(['No active team owner', 'Review Memberships below; the team may be unable to manage setup or staff.']);
      const pending = onboarding.filter(o => o.status === 'in_progress');
      if (pending.length) checks.push(['Setup in progress', pending.map(o => `${o.display_name || 'Coach'}: ${o.current_step || 'not recorded'}`).join(' · ')]);
      const expired = invitations.filter(i => i.status === 'expired' || (i.status === 'pending' && i.expires_at && new Date(i.expires_at) < new Date()));
      if (expired.length) checks.push(['Expired invitations', `${expired.length} invitation(s) need review in Invitations.`]);
      return `<section class="admin-card"><h2>Setup checks</h2>${checks.length ? checks.map(([title,body]) => `<div class="admin-support-check"><strong>${esc(title)}</strong><p>${esc(body)}</p></div>`).join('') : '<p>No setup flags found in the available membership, season and onboarding records.</p>'}<p class="admin-dim">These checks describe recorded setup state; they do not prove a coach made a mistake or that the app is working correctly.</p></section>`;
    }

    function supportBody() {
      const snapshot = data.support;
      if (!snapshot || snapshot.team_id !== detail.id) return head('Support unavailable', 'Refresh to load the selected team.');
      const team = (data.teams || []).find(t => t.id === detail.id);
      const games = snapshot.games || [];
      const issues = games.map(game => ({ game, flags: supportFlags(game, snapshot.today) })).filter(row => row.flags.length);
      return `${head(`${team?.name || 'Team'} · Support`, 'Read-only team inspection. You remain signed in as yourself; each inspection is logged.')}
        <div class="admin-support-banner"><strong>READ ONLY · ${esc(team?.name || detail.id)}</strong><button class="btn" data-open-team="${esc(detail.id)}" type="button">Back to team</button></div>
        <div class="admin-toolbar"><label>Season <select class="admin-support-season" aria-label="Support season"><option value="">Default season</option>${(snapshot.seasons || []).map(season => `<option value="${esc(season.id)}" ${season.id === snapshot.season_id ? 'selected' : ''}>${esc(season.name)}</option>`).join('')}</select></label><span>Checked ${esc(new Date(snapshot.checked_at).toLocaleString())}</span></div>
        <div class="admin-stat-grid"><div class="admin-stat"><small>Active roster</small><strong>${esc(snapshot.roster_count)}</strong></div><div class="admin-stat"><small>Season games</small><strong>${esc(snapshot.game_count)}</strong></div><div class="admin-stat"><small>Games to review in this sample</small><strong>${issues.length}</strong></div></div>
        <section class="admin-card"><h2>What needs a closer look</h2>${!snapshot.season_id ? '<p>No default season selected. Choose a season above or review team setup.</p>' : ''}${!snapshot.roster_count ? '<p>No active roster recorded. Confirm whether the team has completed roster setup.</p>' : ''}${issues.length ? issues.map(({game,flags}) => `<div class="admin-support-check"><strong>${esc(game.opponent)} · ${fmtDate(game.date)}</strong><p>${esc(flags.join(' · '))}</p></div>`).join('') : '<p>No game-completeness flags in the returned sample.</p>'}<p class="admin-dim">Missing data is not proof of an app fault. Goal differences can be valid (for example a shootout); confirm the game context with the coach. This view does not capture browser errors or reproduce another user’s permissions.</p></section>
        <section class="admin-card"><h2>Games & recorded stats</h2><p>Showing ${games.length} of ${esc(snapshot.game_count)} season games, newest first (limit 200).</p>${table(['Game','Date','Score','Shots for / against','Player stat rows'],games.map(g => `<tr><td>${esc(g.opponent)}</td><td>${fmtDate(g.date)}</td><td>${g.goals_for == null || g.goals_against == null ? 'Not entered' : `${esc(g.goals_for)}–${esc(g.goals_against)}`}</td><td>${esc(g.shots_for ?? '—')} / ${esc(g.shots_against ?? '—')}</td><td>${esc(g.player_stat_rows)}</td></tr>`),'No games in this season.')}</section>
        <section class="admin-card"><h2>Active roster</h2><p>Showing ${(snapshot.roster || []).length} of ${esc(snapshot.roster_count)} players (limit 500).</p>${table(['Jersey','Player','Position'],(snapshot.roster || []).map(p => `<tr><td>${esc(p.jersey_number)}</td><td>${esc(p.name)}</td><td>${esc(p.position)}</td></tr>`),'No active roster recorded.')}</section>
        <section class="admin-card"><h2>Reported issues</h2><p>Latest 50 submitted reports for this team, across seasons.</p>${(snapshot.reports || []).map(r => `<details class="admin-support-report"><summary>${esc(r.subject)} · ${esc(r.status)} · ${fmtDate(r.created_at)}</summary><p>${esc(r.description)}</p><small>${esc(r.page_route || '')}</small></details>`).join('') || '<p>No submitted reports returned. This does not mean the team has had no problems.</p>'}</section>`;
    }

    function usersBody() {
      const users = (data.users || []).filter(user => matches([user.display_name, ...(user.platform_roles || []),
        ...(user.team_memberships || []).map(item => item.team_name),
        ...(user.organization_memberships || []).map(item => item.organization_name)]));
      return `${head('Users', 'Every profile on the platform with platform, organization, and team state.')}
        <section class="admin-card">${searchRow('Search users, teams, or organizations')}
        ${table(['User', 'Platform', 'Organizations', 'Teams', 'Expected destination'], users.map(user => {
          const destination = expectedDestination(user);
          return `<tr><td><button class="admin-link" data-open-user="${esc(user.id)}" type="button">${esc(user.display_name)}</button></td>
          <td>${platformBadges(user.platform_roles) || '<span class="admin-dim">—</span>'}</td>
          <td>${(user.organization_memberships || []).map(item => `${esc(item.organization_name)} (${esc(item.role)})`).join('<br>') || '<span class="admin-dim">—</span>'}</td>
          <td>${(user.team_memberships || []).map(item => `${esc(item.team_name)} · ${statusBadge(item.status)}`).join('<br>') || '<span class="admin-dim">—</span>'}</td>
          <td>${badge(destination.state, destination.label)}</td></tr>`;
        }), 'No users match your search.')}</section>`;
    }

    function userBody() {
      const user = data.user;
      if (!user) return `${head('User', 'The requested user could not be read.')}<div class="admin-empty"><h2>User unavailable</h2><p>They may not have a profile record yet.</p></div>`;
      const destination = expectedDestination(user);
      return `${head(user.display_name, 'Operational access review for this account.')}
        <section class="admin-card"><div class="admin-card-title"><h2>Access troubleshooting</h2></div>
          <div class="admin-diagnostic"><strong>Expected destination: ${esc(destination.label)}</strong>
          ${destination.issues.length ? `<ul>${destination.issues.map(issue => `<li>Issue: ${esc(issue)}</li>`).join('')}</ul>` : '<p class="admin-dim">No access issues detected.</p>'}</div></section>
        <div class="admin-stat-grid">
          <div class="admin-stat"><small>Platform roles</small><strong>${(user.platform_roles || []).length ? user.platform_roles.map(role => role === 'founder' ? 'Founder' : 'Platform Admin').join(' + ') : 'None'}</strong></div>
          <div class="admin-stat"><small>Organizations</small><strong>${(user.organization_memberships || []).length}</strong></div>
          <div class="admin-stat"><small>Team memberships</small><strong>${(user.team_memberships || []).length}</strong></div>
          <div class="admin-stat"><small>Pending team invites</small><strong>${user.pending_invitations}</strong></div>
        </div>
        <section class="admin-card"><div class="admin-card-title"><h2>Organization memberships</h2></div>
        ${table(['Organization', 'Role', 'Status'], (user.organization_memberships || []).map(item => `
          <tr><td>${esc(item.organization_name)}</td><td>${esc(item.role)}</td><td>${statusBadge(item.status)}</td></tr>`), 'No organization memberships.')}</section>
        <section class="admin-card"><div class="admin-card-title"><h2>Team memberships</h2></div>
        ${table(['Team', 'Role', 'Status'], (user.team_memberships || []).map(item => `
          <tr><td><button class="admin-link" data-open-team="${esc(item.team_id)}" type="button">${esc(item.team_name)}</button></td>
          <td>${esc(item.role_id)}</td><td>${statusBadge(item.status)}</td></tr>`), 'No team memberships.')}</section>`;
    }

    function invitationsBody() {
      const invitations = (data.invitations || []).filter(item => matches([item.email, item.display_name, item.team_name, item.status]));
      return `${head('Invitations', 'Platform-wide invitation lifecycle. Resend and revoke are server-authorized.')}
        <section class="admin-card">${searchRow('Search invitations')}
        ${table(['Email', 'Name', 'Team', 'Role', 'Status', 'Expires', 'Actions'], invitations.map(item => `
          <tr><td>${esc(item.email)}</td><td>${esc(item.display_name || '—')}</td><td>${esc(item.team_name)}</td>
          <td>${esc(item.role_id)}</td><td>${statusBadge(item.status)}</td><td>${fmtDate(item.expires_at)}</td>
          <td class="admin-row-actions">${item.status === 'pending' || item.status === 'expired'
            ? `<button class="btn admin-action" data-resend-invite="${esc(item.id)}" data-team-id="${esc(item.team_id)}" type="button">Resend</button><button class="btn admin-action danger" data-revoke-invite="${esc(item.id)}" type="button">Revoke</button>`
            : '<span class="admin-dim">—</span>'}</td></tr>`), 'No invitations match your search.')}</section>`;
    }

    function accessBody() {
      const orgs = (data.organizations || []).filter(org => matches([org.name, org.beta_status]));
      const teams = (data.teams || []).filter(team => matches([team.name, team.beta_status, team.organization_name]));
      return `${head('Access / Beta', 'Beta Team and Early Adopter state across the platform.')}
        <section class="admin-card"><div class="admin-card-title"><h2>Organizations</h2></div>
        ${table(['Organization', 'Beta state'], orgs.map(org => `<tr><td><button class="admin-link" data-open-organization="${esc(org.id)}" type="button">${esc(org.name)}</button></td><td>${betaBadge(org.beta_status) || badge('standard', 'Standard')}</td></tr>`), 'No organizations.')}</section>
        <section class="admin-card"><div class="admin-card-title"><h2>Teams</h2></div>
        ${table(['Team', 'Organization', 'Beta state'], teams.map(team => `<tr><td><button class="admin-link" data-open-team="${esc(team.id)}" type="button">${esc(team.name)}</button></td><td>${esc(team.organization_name || '—')}</td><td>${betaBadge(team.beta_status) || badge('standard', 'Standard')}</td></tr>`), 'No teams.')}</section>`;
    }

    function body() {
      if (view === 'overview') return overviewBody();
      if (view === 'organizations') return organizationsBody();
      if (view === 'organization') return organizationBody();
      if (view === 'teams') return teamsBody();
      if (view === 'team') return teamBody();
      if (view === 'support') return supportBody();
      if (view === 'users') return usersBody();
      if (view === 'user') return userBody();
      if (view === 'invitations') return invitationsBody();
      return accessBody();
    }

    function paint() {
      if (!root) return;
      if (loading) {
        root.innerHTML = `${nav()}${head('Loading', 'Reading platform data through server-authorized queries…')}<div class="admin-empty"><h2>Loading platform data</h2><p>Please wait.</p></div>`;
        bind();
        return;
      }
      if (error) {
        root.innerHTML = `${nav()}${head('Unable to load admin data', error)}<div class="admin-empty"><h2>Request failed</h2><p>${esc(error)}</p></div>`;
        bind();
        return;
      }
      root.innerHTML = `${nav()}${body()}`;
      bind();
    }

    function setView(nextView, nextDetail = null) {
      if (!root || !platformAccess?.isPlatformAdmin) return;
      view = nextView;
      detail = nextDetail;
      search = '';
      loadView();
    }

    async function action(button, rpc, args, doneLabel) {
      if (button.disabled) return;
      button.disabled = true;
      const original = button.textContent;
      button.textContent = 'Working…';
      try {
        await call(rpc, args);
        button.textContent = doneLabel;
        await loadView();
      } catch (actionError) {
        button.disabled = false;
        button.textContent = original;
        error = actionError.message;
        paint();
      }

    }

    async function resendInvitation(button) {
        if (button.disabled) return;
        button.disabled = true;
        const original = button.textContent;
        button.textContent = 'Working…';
        try {
          const { data: result, error: functionError } = await client.functions.invoke('invite-staff', {
            body: {
              action: 'resend_setup',
              userId: button.dataset.resendInvite,
              teamId: button.dataset.teamId
            }
          });
          if (functionError) throw new Error(functionError.message || 'Invite resend failed.');
          if (result?.error) throw new Error(result.error);
          button.textContent = 'Resent';
          await loadView();
        } catch (actionError) {
          button.disabled = false;
          button.textContent = original;
          error = actionError.message;
          paint();
        }
      }

    function bind() {
      root.querySelectorAll('[data-nav]').forEach(button => button.addEventListener('click', () => setView(button.dataset.nav)));
      root.querySelector('[data-action="refresh"]')?.addEventListener('click', loadView);
      root.querySelector('.admin-search')?.addEventListener('input', event => {
        search = event.target.value;
        const caret = event.target.selectionStart;
        paint();
        const input = root.querySelector('.admin-search');
        if (input) {
          input.focus();
          input.setSelectionRange(caret, caret);
        }
      });
      root.querySelectorAll('[data-open-organization]').forEach(button => button.addEventListener('click', () => setView('organization', { id: button.dataset.openOrganization })));
      root.querySelectorAll('[data-open-team]').forEach(button => button.addEventListener('click', () => setView('team', { id: button.dataset.openTeam })));
      root.querySelectorAll('[data-open-support]').forEach(button => button.addEventListener('click', () => setView('support', { id: button.dataset.openSupport })));
      root.querySelector('.admin-support-season')?.addEventListener('change', event => setView('support', { id: detail.id, seasonId: event.target.value }));
      root.querySelectorAll('[data-open-user]').forEach(button => button.addEventListener('click', () => setView('user', { id: button.dataset.openUser })));
      root.querySelectorAll('[data-resend-invite]').forEach(button => button.addEventListener('click', () => resendInvitation(button)));
      root.querySelectorAll('[data-revoke-invite]').forEach(button => button.addEventListener('click', () => action(button, 'admin_revoke_invitation', { target_invitation_id: button.dataset.revokeInvite }, 'Revoked')));
      root.querySelectorAll('[data-beta-kind]').forEach(button => button.addEventListener('click', () => action(button, 'admin_set_beta_status', { target_kind: button.dataset.betaKind, target_id: button.dataset.betaId, new_status: button.dataset.betaStatus }, 'Saved')));
    }

    function mount(element) {
      // The dashboard renders only for accounts whose platform access was
      // resolved from the database; route names and client state grant nothing.
      if (!platformAccess?.isPlatformAdmin) {
        element.innerHTML = '<div class="admin-empty"><h2>Platform Admin access required</h2><p>This area is restricted to Founder and Platform Admin accounts.</p></div>';
        return;
      }
      root = element;
      root.classList.add('platform-admin-root');
      loadView();
    }

    function unmount() {
      loadVersion++;
      root = null;
      data = { organizations: null, teams: null, users: null, invitations: null };
      view = 'overview';
      detail = null;
      search = '';
      error = '';
    }

    return { mount, unmount, setView, expectedDestination };
  }

  global.FoxesPlatformAdmin = { createPlatformAdmin, BETA_LABELS, supportFlags };
}(window));
