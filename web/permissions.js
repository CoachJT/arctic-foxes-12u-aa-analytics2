// Prototype-only authorization fixtures. Backend authorization must supersede this model.
(function () {
const PERMISSIONS = Object.freeze({
  DASHBOARD_VIEW: 'dashboard.view',
  SCHEDULE_VIEW: 'schedule.view',
  SCHEDULE_EDIT: 'schedule.edit',
  STATS_VIEW: 'stats.view',
  STATS_EDIT: 'stats.edit',
  STATS_EDIT_OFFICIAL: 'stats.editOfficial',
  PLAYERS_VIEW: 'players.view',
  PLAYERS_EVALUATE: 'players.evaluate',
  GAMES_VIEW: 'games.view',
  GAMES_EDIT: 'games.edit',
  GAMES_DELETE: 'games.delete',
  SCOUTING_VIEW: 'scouting.view',
  SCOUTING_EDIT: 'scouting.edit',
  SCOUTING_PRIVATE: 'scouting.private',
  REPORTS_VIEW: 'reports.view',
  REPORTS_EDIT: 'reports.edit',
  GOALIE_ANALYTICS_VIEW: 'goalieAnalytics.view',
  GOALIE_ANALYTICS_EDIT: 'goalieAnalytics.edit',
  ADMIN_USERS: 'admin.users',
  ADMIN_PERMISSIONS: 'admin.permissions',
  BACKUP_RESTORE: 'backup.restore',
  RELEASE_MANAGE: 'release.manage',
  SEASONS_DELETE: 'seasons.delete'
});

const ROLE_PERMISSIONS = Object.freeze({
  owner: Object.values(PERMISSIONS),
  assistantGoalie: [
    PERMISSIONS.DASHBOARD_VIEW, PERMISSIONS.SCHEDULE_VIEW, PERMISSIONS.SCHEDULE_EDIT,
    PERMISSIONS.STATS_VIEW, PERMISSIONS.STATS_EDIT, PERMISSIONS.PLAYERS_VIEW, PERMISSIONS.PLAYERS_EVALUATE,
    PERMISSIONS.GAMES_VIEW, PERMISSIONS.GAMES_EDIT, PERMISSIONS.SCOUTING_VIEW, PERMISSIONS.SCOUTING_EDIT,
    PERMISSIONS.SCOUTING_PRIVATE, PERMISSIONS.REPORTS_VIEW, PERMISSIONS.REPORTS_EDIT,
    PERMISSIONS.GOALIE_ANALYTICS_VIEW, PERMISSIONS.GOALIE_ANALYTICS_EDIT
  ],
  assistant: [
    PERMISSIONS.DASHBOARD_VIEW, PERMISSIONS.SCHEDULE_VIEW, PERMISSIONS.SCHEDULE_EDIT,
    PERMISSIONS.STATS_VIEW, PERMISSIONS.STATS_EDIT, PERMISSIONS.PLAYERS_VIEW, PERMISSIONS.PLAYERS_EVALUATE,
    PERMISSIONS.GAMES_VIEW, PERMISSIONS.SCOUTING_VIEW, PERMISSIONS.SCOUTING_EDIT,
    PERMISSIONS.REPORTS_VIEW, PERMISSIONS.REPORTS_EDIT
  ]
});

const STAFF = Object.freeze([
  { id: 'justin-kostosky', name: 'Justin Kostosky', initials: 'JK', roleId: 'owner', role: 'Owner / Head Coach' },
  { id: 'austin-koposko', name: 'Austin Koposko', initials: 'AK', roleId: 'assistantGoalie', role: 'Assistant Coach / Goalie Coach' },
  { id: 'chris-skwortz', name: 'Chris Skwortz', initials: 'CS', roleId: 'assistant', role: 'Assistant Coach' }
]);

function can(permission, staff) {
  if (staff?.capabilities) return staff.capabilities.includes(permission);
  return Boolean(staff && ROLE_PERMISSIONS[staff.roleId]?.includes(permission));
}

function getStaff(id) {
  return STAFF.find(member => member.id === id) || STAFF[0];
}

  window.FoxesPermissions = Object.freeze({ PERMISSIONS, ROLE_PERMISSIONS, STAFF, can, getStaff });
})();
