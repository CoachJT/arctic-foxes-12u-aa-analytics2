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
    const inviteId = requiredString(payload?.inviteId, 'Invite ID', 80);
    const rawToken = await createToken();
    const { data, error } = await callerClient.rpc('reissue_beta_onboarding_invite', {
      target_invite_id: inviteId,
      target_token_hash: await sha256Hex(rawToken)
    });
    if (error) throw error;

    const reissuedInvite = Array.isArray(data) ? data[0] : data;
    if (!reissuedInvite?.invite_id) throw new Error('The Beta onboarding invite could not be reissued.');

    return json({
      invite_id: reissuedInvite.invite_id,
      status: reissuedInvite.invite_status,
      expires_at: reissuedInvite.invite_expires_at,
      invite_url: inviteUrl(rawToken),
      token: rawToken
    });
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : 'The Beta onboarding invite could not be reissued.'
    }, 400);
  }
});
