const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
const migrations = fs.readdirSync(migrationsDir).filter(file => file.endsWith('.sql')).sort();
const sources = Object.fromEntries(migrations.map(file => [file, fs.readFileSync(path.join(migrationsDir, file), 'utf8')]));

const RESERVED_PARAMS = /\b(primary|secondary|references|order|group|where|select|insert|update|delete|table|column|default)\b/i;

test('migration chain only replaces functions, policies, triggers, and indexes explicitly', () => {
  const seen = new Map();
  const collisions = [];
  for (const [file, source] of Object.entries(sources)) {
    for (const match of source.matchAll(/create (or replace )?(table|function|policy|trigger|unique index|index)\s+(if not exists\s+)?(?:public\.)?([a-z0-9_]+)/gi)) {
      const [, orReplace, kind, ifNotExists, rawName] = match;
      const name = rawName.toLowerCase();
      const key = `${kind.toLowerCase()}:${name}`;
      if (seen.has(key)) {
        const prefix = source.slice(Math.max(0, match.index - 160), match.index).toLowerCase();
        const explicitlyReplaced = Boolean(orReplace || ifNotExists)
          || new RegExp(`drop\\s+${kind.toLowerCase().replace('unique ', '')}\\s+if\\s+exists\\s+(?:public\\.)?${name}`).test(prefix);
        if (!explicitlyReplaced) collisions.push(`${key} in ${file} and ${seen.get(key)}`);
      } else {
        seen.set(key, file);
      }
    }
  }
  assert.deepEqual(collisions, []);
});

test('no migration uses a reserved Postgres keyword as a bare function parameter', () => {
  const offenders = [];
  for (const [file, source] of Object.entries(sources)) {
    for (const match of source.matchAll(/function public\.([a-z0-9_]+)\(([^)]*)\)/gi)) {
      const params = match[2].split(',').map(p => p.trim().split(/\s+/)[0]).filter(Boolean);
      for (const param of params) {
        if (RESERVED_PARAMS.test(param) && !param.endsWith('_')) {
          offenders.push(`${file}: ${match[1]}(${param} …)`);
        }
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('production migration history is restored under its applied versions', () => {
  assert.match(sources['006_multi_team_foundation.sql'], /role_id text not null/);
  assert.match(sources['007_security_integrity_foundation.sql'], /can_access_team_season/);
  assert.match(sources['008_entitlement_and_pending_invites.sql'], /workspace_invites/);
  assert.match(sources['009_workspace_access_resolution.sql'], /resolve_workspace_access/);
  assert.match(sources['010_secure_workspace_invite_acceptance.sql'], /accept_workspace_invite/);
  for (const retired of ['007_platform_identity_and_roles.sql', '008_platform_admin_dashboard.sql', '009_onboarding.sql', '010_coach_qol_writes.sql']) {
    assert.equal(sources[retired], undefined, `${retired} must not reuse an applied production version`);
  }
});

test('every 2.0 table enables row level security', () => {
  const all = Object.values(sources).join('\n');
  for (const table of ['organizations', 'organization_memberships', 'seasons', 'team_branding', 'platform_admins', 'workspace_invites', 'onboarding_progress', 'team_roster_players', 'team_schedule_games', 'team_games', 'team_game_player_stats', 'team_game_team_stats', 'team_season_records']) {
    assert.match(all, new RegExp(`alter table public\\.${table} enable row level security`), table);
  }
});

test('every security-definer RPC guards or scopes the actor and revokes public execute', () => {
  const all = Object.entries(sources)
    .filter(([file]) => /^20260909.*reconcil/.test(file))
    .map(([, source]) => source).join('\n');
  const functions = [...all.matchAll(/function public\.((?:admin|onboarding|coach|has_|is_)_{0,1}[a-z0-9_]*)\(/gi)]
    .map(m => m[1])
    .filter(name => !/^prevent_/.test(name) && !/^is_org_owner$/.test(name) || ['admin_list_organizations','admin_get_organization','admin_list_teams','admin_list_users','admin_get_user','admin_list_memberships','admin_list_invitations','admin_revoke_invitation','admin_set_beta_status','admin_list_onboarding','onboarding_ensure','onboarding_create_organization','onboarding_create_team','onboarding_create_season','onboarding_mark_step','onboarding_complete','onboarding_add_player','onboarding_save_branding','is_platform_admin','is_platform_founder','is_org_member','has_org_role','is_org_owner'].includes(name));
  for (const fn of functions) {
    assert.match(all, new RegExp(`revoke all on function public\\.${fn}\\(`), `revoke missing for ${fn}`);
  }
  // Admin reads/writes must filter or raise on is_platform_admin.
  const admin = Object.entries(sources).find(([file]) => file.includes('reconciled_platform_admin'))?.[1] || '';
  const adminGuards = admin.match(/is_platform_admin\(\)/g) || [];
  assert.ok(adminGuards.length >= 8, 'admin RPCs must all reference is_platform_admin directly or through a guarded RPC');
  // Onboarding mutations must all require an authenticated caller.
  const onboarding = Object.entries(sources).find(([file]) => file.includes('reconciled_self_service_onboarding'))?.[1] || '';
  const authChecks = onboarding.match(/if \(select auth\.uid\(\)\) is null then/g) || [];
  assert.ok(authChecks.length >= 8, 'every onboarding RPC must require authentication');
});

test('no destructive statements and no hardcoded production identities anywhere', () => {
  const all = Object.values(sources).join('\n');
  assert.doesNotMatch(all, /\bdrop table\b/i);
  assert.doesNotMatch(all, /\btruncate\b/i);
  assert.doesNotMatch(all, /@(gmail|outlook|hotmail|icloud)\.com/i);
  // The only real-address backfill is the Arctic Foxes org/team identity, not a person.
  assert.doesNotMatch(all, /justin.*(founder|platform_admin)/i);
});

test('backfills are idempotent via on-conflict', () => {
  const s006 = sources['006_multi_team_foundation.sql'];
  assert.match(s006, /on conflict \(slug\) do update/);
  assert.match(s006, /on conflict \(team_id, season_key\) do update/);
  assert.match(s006, /on conflict \(team_id\) do update/);
  assert.match(s006, /on conflict \(organization_id, user_id\) do update/);
});
