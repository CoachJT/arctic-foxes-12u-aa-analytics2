import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
});

function requiredString(value: unknown, label: string, maxLength: number) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function normalizedEmail(value: unknown) {
  const email = requiredString(value, 'Email', 320).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error('A valid invite email is required.');
  }
  return email;
}

function optionalUuid(value: unknown, label: string) {
  if (value === null || value === undefined || value === '') return null;
  return requiredString(value, label, 80);
}

function optionalExpiry(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = new Date(requiredString(value, 'Expiry', 80));
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() <= Date.now()) {
    throw new Error('Expiry must be a valid future timestamp.');
  }
  return parsed.toISOString();
}

function base64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function createToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function inviteUrl(rawToken: string) {
  const configuredBaseUrl = Deno.env.get('INVITE_ACCEPT_URL');
  if (!configuredBaseUrl) return null;
  const url = new URL(configuredBaseUrl);
  url.hash = `invite_token=${encodeURIComponent(rawToken)}`;
  return url.toString();
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'POST is required.' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !anonKey) throw new Error('Invite service is not configured.');

    const authorization = request.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) throw new Error('Authentication is required.');

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } }
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) throw new Error('Authentication is required.');

    const payload = await request.json();
    const organizationId = requiredString(payload.organizationId, 'Organization', 80);
    const teamId = optionalUuid(payload.teamId, 'Team');
    const seasonId = optionalUuid(payload.seasonId, 'Season');
    const roleId = teamId ? requiredString(payload.roleId, 'Role', 40) : null;
    const organizationRoleId = teamId
      ? null
      : requiredString(payload.organizationRoleId, 'Organization role', 40);
    const planId = requiredString(payload.planId, 'Plan', 40).toUpperCase();
    const email = normalizedEmail(payload.email);
    const displayName = requiredString(payload.displayName, 'Display name', 120);
    const expiresAt = optionalExpiry(payload.expiresAt);
    const replaceInviteId = optionalUuid(payload.replaceInviteId, 'Replacement invite');
    const rawToken = await createToken();
    const tokenHash = await sha256Hex(rawToken);

    const { data, error } = await callerClient.rpc('create_workspace_invite', {
      target_organization_id: organizationId,
      target_team_id: teamId,
      target_season_id: seasonId,
      target_email_normalized: email,
      target_display_name: displayName,
      target_role_id: roleId,
      target_organization_role_id: organizationRoleId,
      target_plan_id: planId,
      target_token_hash: tokenHash,
      target_expires_at: expiresAt,
      replace_invite_id: replaceInviteId
    });
    if (error) throw error;

    const createdInvite = Array.isArray(data) ? data[0] : data;
    if (!createdInvite?.invite_id) throw new Error('The invite could not be created.');

    return json({
      invite_id: createdInvite.invite_id,
      status: createdInvite.invite_status,
      expires_at: createdInvite.invite_expires_at,
      invite_url: inviteUrl(rawToken),
      token: rawToken
    });
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : 'The invite could not be created.'
    }, 400);
  }
});
