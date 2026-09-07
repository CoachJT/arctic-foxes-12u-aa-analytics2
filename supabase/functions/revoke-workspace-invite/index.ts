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
    if (typeof payload.inviteId !== 'string' || !payload.inviteId.trim()) {
      throw new Error('Invite ID is required.');
    }

    const { data, error } = await callerClient.rpc('revoke_workspace_invite', {
      target_invite_id: payload.inviteId.trim()
    });
    if (error) throw error;

    return json({ status: data === true ? 'revoked' : 'unchanged' });
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : 'The invite could not be revoked.'
    }, 400);
  }
});
