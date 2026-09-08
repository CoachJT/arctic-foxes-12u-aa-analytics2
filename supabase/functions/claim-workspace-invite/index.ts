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

function newPassword(value: unknown) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 200) {
    throw new Error('Choose a password with at least 12 characters.');
  }
  return value;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

// Creates the first-time auth account for an invited coach. This deliberately
// does NOT accept the invitation: the client signs in afterwards and the
// existing accept_workspace_invite transaction consumes the invite. A failure
// here therefore leaves the invitation pending and reusable.
Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'POST is required.' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Invite service is not configured.');

    const payload = await request.json();
    const token = rawToken(payload?.token);
    const password = newPassword(payload?.password);

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data: lookupData, error: lookupError } = await serviceClient.rpc(
      'lookup_workspace_invite_by_token',
      { target_token_hash: await sha256Hex(token) }
    );
    if (lookupError) throw lookupError;

    const invite = Array.isArray(lookupData) ? lookupData[0] : lookupData;
    if (!invite?.valid) {
      return json({ created: false, reason: invite?.reason || 'invalid' }, 400);
    }

    if (invite.account_exists === true) {
      return json({ created: false, reason: 'account_exists', email: invite.invite_email });
    }

    // The invitation was delivered to this mailbox, so token possession proves
    // control of the address. Confirming here keeps the account eligible for
    // accept_workspace_invite, which requires a verified email.
    const { error: createError } = await serviceClient.auth.admin.createUser({
      email: invite.invite_email,
      password,
      email_confirm: true,
      user_metadata: { display_name: invite.invite_display_name || null }
    });

    if (createError) {
      const duplicate = /already|registered|exists/i.test(createError.message || '');
      if (duplicate) {
        return json({ created: false, reason: 'account_exists', email: invite.invite_email });
      }
      throw new Error('Your account could not be created.');
    }

    return json({ created: true, email: invite.invite_email });
  } catch (error) {
    return json({
      created: false,
      reason: 'error',
      error: error instanceof Error ? error.message : 'Your account could not be created.'
    }, 400);
  }
});
