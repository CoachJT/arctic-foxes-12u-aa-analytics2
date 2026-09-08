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
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

// Resolves what a pending invitation points at so an invited coach who has
// never held a PuckNexus session can be shown the correct screen before
// authenticating. Possession of the unguessable token is the only credential,
// and nothing is returned for an invalid, revoked, expired, or used invite.
Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'POST is required.' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Invite service is not configured.');

    const payload = await request.json();
    const token = rawToken(payload?.token);

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data, error } = await serviceClient.rpc('lookup_workspace_invite_by_token', {
      target_token_hash: await sha256Hex(token)
    });
    if (error) throw error;

    const invite = Array.isArray(data) ? data[0] : data;
    if (!invite?.valid) {
      return json({ valid: false, reason: invite?.reason || 'invalid' });
    }

    return json({
      valid: true,
      reason: 'pending',
      email: invite.invite_email,
      display_name: invite.invite_display_name,
      organization_name: invite.organization_name,
      team_name: invite.team_name,
      account_exists: invite.account_exists === true
    });
  } catch (_error) {
    // Failure detail is deliberately withheld so this endpoint cannot be used
    // to probe invite or account existence.
    return json({ valid: false, reason: 'invalid' }, 400);
  }
});
