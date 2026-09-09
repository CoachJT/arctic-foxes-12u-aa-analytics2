import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const allowedRoles = new Set(['assistant_goalie', 'assistant']);
// Invite expiry matches the 72-hour Beta onboarding window from migration 018.
const inviteExpiryMs = 72 * 60 * 60 * 1000;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
});

function normalizedEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function requiredText(value: unknown, label: string, maxLength: number) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

// --- Secure raw-token lifecycle -------------------------------------------
// The raw token is the only secret capable of accepting an invite through
// accept_workspace_invite. It is generated here, embedded (best-effort) in
// the Auth email redirect, and is otherwise NEVER stored, returned in a
// response body, or written to a log. Only its SHA-256 hash — which is a
// one-way digest satisfying workspace_invites' token_hash format check
// (`^[0-9a-f]{64}$`) — is persisted, through create_workspace_invite (010).
function toHex(bytes: Uint8Array) {
  return Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function generateRawInviteToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

async function hashInviteToken(rawToken: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawToken));
  return toHex(new Uint8Array(digest));
}

function buildInviteRedirectUrl(rawToken: string) {
  const base = Deno.env.get('INVITE_REDIRECT_URL');
  if (!base) throw new Error('Invite redirect URL is not configured.');
  try {
    const url = new URL(base);
    if (url.protocol !== 'https:') throw new Error('Invite redirect URL must use HTTPS.');
    url.searchParams.set('invite_token', rawToken);
    return url.toString();
  } catch {
    throw new Error('Invite redirect URL is invalid.');
  }
}

async function findAuthUserByEmail(adminClient: ReturnType<typeof createClient>, email: string) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const match = data.users.find(user => normalizedEmail(user.email) === email);
    if (match) return match;
    if (data.users.length < 1000) break;
  }
  return null;
}

// Sends the Auth email that carries the raw token to the recipient. An
// existing Auth account gets a recovery-style link (it can already sign in);
// a brand-new email gets Supabase's own invite email. Either way, no
// workspace access is granted until the recipient authenticates and calls
// accept_workspace_invite with the raw token — this function never touches
// team_memberships or profiles.
async function deliverInviteEmail(
  context: Awaited<ReturnType<typeof getOwnerContext>>,
  email: string,
  displayName: string,
  rawToken: string
) {
  const redirectTo = buildInviteRedirectUrl(rawToken);
  const existingUser = await findAuthUserByEmail(context.adminClient, email);
  if (existingUser) {
    const { error } = await context.publicClient.auth.resetPasswordForEmail(email, {
      redirectTo
    });
    return error || null;
  }

  const { error } = await context.adminClient.auth.admin.inviteUserByEmail(email, {
    data: { display_name: displayName },
    redirectTo
  });
  return error || null;
}

async function getOwnerContext(request: Request, requestedTeamSlug?: unknown, requestedTeamId?: unknown) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) throw new Error('Invite service is not configured.');

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) throw new Error('Authentication is required.');

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } }
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData.user) throw new Error('Authentication is required.');

  // Team scope comes from the caller's request but is always validated against
  // the caller's actual ownership — never trusted blindly.
  const teamSlug = typeof requestedTeamSlug === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(requestedTeamSlug.trim())
    ? requestedTeamSlug.trim()
    : '';
  const teamId = typeof requestedTeamId === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedTeamId)
    ? requestedTeamId
    : '';
  if (!teamSlug && !teamId) throw new Error('A valid team is required.');

  let teamQuery = adminClient
    .from('teams')
    .select('id,name,slug,organization_id');
  teamQuery = teamId ? teamQuery.eq('id', teamId) : teamQuery.eq('slug', teamSlug);
  const { data: team, error: teamError } = await teamQuery.single();
  if (teamError || !team) throw new Error('That team could not be found or managed.');

  const [capabilityResult, platformResult] = await Promise.all([
    callerClient.rpc('has_team_capability', {
      target_team_id: team.id,
      requested_capability: 'admin.users'
    }),
    callerClient.rpc('is_platform_admin')
  ]);
  if ((capabilityResult.error || capabilityResult.data !== true)
      && (platformResult.error || platformResult.data !== true)) {
    throw new Error('That team could not be found or managed.');
  }

  return {
    caller: userData.user,
    team,
    canManageTeam: !capabilityResult.error && capabilityResult.data === true,
    isPlatformAdmin: !platformResult.error && platformResult.data === true,
    // callerClient carries the caller's own JWT so security-definer RPCs that
    // gate on auth.uid() (create_workspace_invite, list_workspace_invites,
    // resolve_workspace_plan, revoke_workspace_invite) authorize correctly.
    callerClient,
    publicClient: createClient(supabaseUrl, anonKey),
    adminClient
  };
}

async function resolveTeamPlan(context: Awaited<ReturnType<typeof getOwnerContext>>) {
  const { data: planId, error } = await context.callerClient.rpc(
    'resolve_workspace_plan',
    { target_team_id: context.team.id }
  );
  if (error) throw error;
  if (!planId) throw new Error('No active plan is associated with this team.');
  return planId as string;
}

// list_workspace_invites(target_team_id uuid) is a narrow, security-definer
// RPC (010/018-style contract; added by a forward migration, not this file)
// that authorizes the caller via has_team_capability(target_team_id,
// 'admin.users') and returns only safe workspace_invites fields — invite_id,
// email, display_name, role_id, status, created_at, expires_at. It must
// never select or return token_hash, and workspace_invites itself must stay
// unreadable to anon/authenticated (010/018 already assert this).
async function listWorkspaceInvites(context: Awaited<ReturnType<typeof getOwnerContext>>) {
  const { data, error } = await context.callerClient.rpc(
    'list_workspace_invites',
    { target_team_id: context.team.id }
  );
  if (error) throw error;
  return (data || []) as Array<{
    invite_id: string;
    email: string;
    display_name: string;
    role_id: string;
    status: string;
    created_at: string;
    expires_at: string | null;
  }>;
}

async function listInvites(context: Awaited<ReturnType<typeof getOwnerContext>>) {
  const invites = await listWorkspaceInvites(context);
  return invites.map(invite => ({
    // `user_id` intentionally carries the invite id, not an Auth user id: the
    // pending-invite lifecycle no longer creates an Auth user (or any
    // membership) until the recipient authenticates and redeems their raw
    // token through accept_workspace_invite, so no Auth user id exists yet.
    user_id: invite.invite_id,
    display_name: invite.display_name,
    email: invite.email,
    role_id: invite.role_id,
    status: invite.status,
    created_at: invite.created_at,
    updated_at: invite.expires_at || invite.created_at
  }));
}

async function inviteStaff(context: Awaited<ReturnType<typeof getOwnerContext>>, payload: Record<string, unknown>) {
  if (!context.canManageTeam) {
    throw new Error('Team owner permission is required to create a staff invite.');
  }

  const email = normalizedEmail(payload.email);
  const displayName = requiredText(payload.displayName, 'Name', 120);
  const roleId = requiredText(payload.roleId, 'Role', 40);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('A valid staff email is required.');
  if (!allowedRoles.has(roleId)) throw new Error('Only assistant staff roles can be invited.');

  const existingUser = await findAuthUserByEmail(context.adminClient, email);
  if (existingUser) {
    const { data: existingMembership, error: membershipLookupError } = await context.adminClient
      .from('team_memberships')
      .select('user_id,status')
      .eq('team_id', context.team.id)
      .eq('user_id', existingUser.id)
      .maybeSingle();
    if (membershipLookupError) throw membershipLookupError;
    if (existingMembership && existingMembership.status !== 'suspended') {
      throw new Error('This person is already part of the team. No invite was sent.');
    }
  }

  const existingInvites = await listWorkspaceInvites(context);
  if (existingInvites.some(invite => invite.status === 'pending' && invite.email === email)) {
    throw new Error('A pending invite already exists for this email. Use resend instead.');
  }

  const planId = await resolveTeamPlan(context);
  const rawToken = generateRawInviteToken();
  const tokenHash = await hashInviteToken(rawToken);
  const expiresAt = new Date(Date.now() + inviteExpiryMs).toISOString();

  const { data: created, error: createError } = await context.callerClient.rpc('create_workspace_invite', {
    target_organization_id: context.team.organization_id,
    target_team_id: context.team.id,
    target_season_id: null,
    target_email_normalized: email,
    target_display_name: displayName,
    target_role_id: roleId,
    target_organization_role_id: null,
    target_plan_id: planId,
    target_token_hash: tokenHash,
    target_expires_at: expiresAt,
    replace_invite_id: null
  });
  if (createError || !created?.length) throw createError || new Error('The invite could not be created.');

  const inviteId = created[0].invite_id;
  const { data: claimRows, error: claimError } = await context.callerClient.rpc(
    'claim_workspace_invite_delivery',
    { target_invite_id: inviteId, allow_resend: false }
  );
  if (claimError || claimRows?.[0]?.claimed !== true) {
    throw claimError || new Error('The invitation email delivery could not be claimed.');
  }

  const emailError = await deliverInviteEmail(context, email, displayName, rawToken);
  const { error: recordError } = await context.callerClient.rpc('record_workspace_invite_delivery', {
    target_invite_id: inviteId,
    target_delivered: !emailError,
    target_failure_reason: emailError?.message || null
  });
  if (recordError) throw recordError;
  if (emailError) {
    throw new Error('Invitation email delivery failed.');
  }

  return {
    message: 'Invite created and a setup email was sent.',
    status: created[0].invite_status,
    role_id: roleId
  };
}

async function resendSetupLink(context: Awaited<ReturnType<typeof getOwnerContext>>, payload: Record<string, unknown>) {
  const inviteId = requiredText(payload.userId, 'Invite', 80);
  const invites = await listWorkspaceInvites(context);
  const invite = invites.find(candidate => candidate.invite_id === inviteId);
  if (!invite) throw new Error('The staff invite could not be found.');
  if (!['pending', 'expired'].includes(invite.status)) {
    throw new Error('A setup link is only available for a pending or expired invite.');
  }
  if (!allowedRoles.has(invite.role_id)) throw new Error('Only assistant staff invites can receive setup links.');

  const { data: claimRows, error: claimError } = await context.callerClient.rpc(
    'claim_workspace_invite_delivery',
    { target_invite_id: inviteId, allow_resend: true }
  );
  if (claimError) throw claimError;
  if (claimRows?.[0]?.claimed !== true) {
    throw new Error(`The setup link could not be resent (${claimRows?.[0]?.reason || 'not_available'}).`);
  }

  const rawToken = generateRawInviteToken();
  const tokenHash = await hashInviteToken(rawToken);

  const { data: reissued, error: reissueError } = await context.callerClient.rpc(
    'rotate_workspace_invite_delivery_token',
    {
      target_invite_id: invite.invite_id,
      target_token_hash: tokenHash
    }
  );
  if (reissueError || !reissued?.length) {
    await context.callerClient.rpc('record_workspace_invite_delivery', {
      target_invite_id: inviteId,
      target_delivered: false,
      target_failure_reason: reissueError?.message || 'Token rotation failed.'
    });
    throw reissueError || new Error('The invite could not be reissued.');
  }

  const emailError = await deliverInviteEmail(context, invite.email, invite.display_name, rawToken);
  const { error: recordError } = await context.callerClient.rpc('record_workspace_invite_delivery', {
    target_invite_id: inviteId,
    target_delivered: !emailError,
    target_failure_reason: emailError?.message || null
  });
  if (recordError) throw recordError;
  if (emailError) throw new Error('Invitation email delivery failed.');

  return {
    message: 'A new setup link was sent.',
    status: reissued[0].invite_status,
    role_id: invite.role_id
  };
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'POST is required.' }, 405);

  try {
    const payload = await request.json();
    const context = await getOwnerContext(request, payload?.teamSlug, payload?.teamId);
    if (payload?.action === 'list') return json({ invites: await listInvites(context) });
    if (payload?.action === 'invite') return json(await inviteStaff(context, payload));
    if (payload?.action === 'resend_setup') return json(await resendSetupLink(context, payload));
    return json({ error: 'Unknown invite action.' }, 400);
  } catch (error) {
    // Never log the raw invite token or any Error whose message could carry
    // one — only a fixed, generic message is logged server-side.
    console.error('Staff invite request failed.');
    return json({ error: error instanceof Error ? error.message : 'Staff invite request failed.' }, 400);
  }
});