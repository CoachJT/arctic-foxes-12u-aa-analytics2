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

function rawToken(value: unknown) {
  if (typeof value !== 'string' || value.length < 32 || value.length > 256) {
    throw new Error('A valid invite token is required.');
  }
  return value;
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
    const token = rawToken(payload.token);
    const forbiddenOverrides = [
      'userId',
      'organizationId',
      'teamId',
      'seasonId',
      'roleId',
      'planId',
      'acceptedBy'
    ];
    if (forbiddenOverrides.some(field => Object.prototype.hasOwnProperty.call(payload, field))) {
      throw new Error('Invite target fields are controlled by the invite.');
    }

    const { data, error } = await callerClient.rpc('accept_workspace_invite', {
      target_token_hash: await sha256Hex(token)
    });
    if (error) throw error;

    const acceptedInvite = Array.isArray(data) ? data[0] : data;
    return json({
      status: 'accepted',
      invite: acceptedInvite
    });
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : 'The invite could not be accepted.'
    }, 400);
  }
});
