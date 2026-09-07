// Non-production fixtures only. No Auth users, emails, or UUIDs are created here.
const daveRoebuckWorkspaces = [
  {
    organization_id: 'fixture-arctic-foxes',
    organization_name: 'Arctic Foxes',
    team_id: 'fixture-arctic-foxes-2010-by',
    team_name: '2010 BY / 16U AA',
    role_id: 'owner',
    role_label: 'Head Coach',
    plan_id: 'FOUNDING',
    authorized: true
  },
  {
    organization_id: 'fixture-avonworth',
    organization_name: 'Avonworth Hockey',
    team_id: 'fixture-avonworth-jv',
    team_name: 'Junior Varsity',
    role_id: 'owner',
    role_label: 'Head Coach',
    plan_id: 'FOUNDING',
    authorized: true
  }
];

module.exports = { daveRoebuckWorkspaces };
