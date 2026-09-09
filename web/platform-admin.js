(function attachPlatformAdmin(global) {
  const BETA_LABELS = { none: 'Standard', beta_team: 'Beta Team', early_adopter: 'Early Adopter' };

  function createPlatformAdmin({ client, platformAccess, branding = {}, onSignOut }) {
    let root = null;
    let view = 'overview';
    let loading = false;
    let error = '';
    let detail = null;
    let search = '';
    let data = { organizations: null, teams: null, users: null, invitations: null };

    function esc(value) {
      return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function fmtDate(value) {
      if (!value) return '—';
      const date = new Date(value);
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
      loading = true;
      error = '';
      paint();
      try {
        if (view === 'overview' || view === 'organizations') {
          data.organizations = await call('admin_list_organizations');
        } else if (view === 'organization') {
          const [organization, teams] = await Promise.all([
            call('admin_get_organization', { target_organization_id: detail.id }),
            call('admin_list_teams', { target_organization_id: detail.id })
          ]);
          data.organization = organization?.[0] || null;
          data.teams = teams;
        } else if (view === 'teams') {
          data.teams = await call('admin_list_teams');
        } else if (view === 'team') {
          const [teams, memberships, invitations, onboarding] = await Promise.all([
            call('admin_list_teams'),
            call('admin_list_memberships', { target_team_id: detail.id }),
            call('admin_list_invitations', { target_team_id: detail.id }),
            call('admin_list_onboarding')
          ]);
          data.team = (teams || []).find(team => team.id === detail.id) || null;
          data.memberships = memberships;
          data.invitations = invitations;
          data.onboarding = (onboarding || []).filter(row => row.team_id === detail.id);
        } else if (view === 'users') {
          data.users = await call('admin_list_users');
        } else if (view === 'user') {
          data.user = (await call('admin_get_user', { target_user_id: detail.id }))?.[0] || null;
        } else if (view === 'invitations') {
          data.invitations = await call('admin_list_invitations');
        } else if (view === 'access') {
          const [organizations, teams] = await Promise.all([call('admin_list_organizations'), call('admin_list_teams')]);
          data.organizations = organizations;
          data.teams = teams;
        }
      } catch (loadError) {
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
      return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr>${headers.map(header => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
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
      root = null;
      data = { organizations: null, teams: null, users: null, invitations: null };
      view = 'overview';
      detail = null;
      search = '';
      error = '';
    }

    return { mount, unmount, setView, expectedDestination };
  }

  global.FoxesPlatformAdmin = { createPlatformAdmin, BETA_LABELS };
}(window));
