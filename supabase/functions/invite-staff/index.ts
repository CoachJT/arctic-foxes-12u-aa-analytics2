import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const allowedRoles = new Set(['assistant_goalie', 'assistant']);
const resendCooldownMs = 60_000;
const resendCooldowns = new Map<string, number>();
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

async function getOwnerContext(request: Request) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) throw new Error('Invite service is not configured.');

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) throw new Error('Authentication is required.');

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } }
  });
  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData.user) throw new Error('Authentication is required.');

  const { data: team, error: teamError } = await callerClient
    .from('teams')
    .select('id,name,slug')
    .eq('slug', 'arctic-foxes-12u-aa')
    .single();
  if (teamError || !team) throw new Error('The Arctic Foxes team could not be found.');

  const { data: hasCapability, error: capabilityError } = await callerClient.rpc(
    'has_team_capability',
    { target_team_id: team.id, requested_capability: 'admin.users' }
  );
  if (capabilityError || hasCapability !== true) throw new Error('Owner permission is required to invite staff.');

  return {
    caller: userData.user,
    team,
    publicClient: createClient(supabaseUrl, anonKey),
    adminClient: createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  };
}

async function listInvites(context: Awaited<ReturnType<typeof getOwnerContext>>) {
  const { data: memberships, error: membershipError } = await context.adminClient
    .from('team_memberships')
    .select('user_id,role_id,status,created_at,updated_at')
    .eq('team_id', context.team.id)
    .neq('role_id', 'owner')
    .order('created_at', { ascending: false });
  if (membershipError) throw membershipError;

  const userIds = (memberships || []).map(membership => membership.user_id);
  const { data: profiles, error: profileError } = userIds.length
    ? await context.adminClient.from('profiles').select('id,display_name').in('id', userIds)
    : { data: [], error: null };
  if (profileError) throw profileError;

  const profileById = new Map((profiles || []).map(profile => [profile.id, profile.display_name]));
  const usersById = new Map<string, { email?: string }>();
  for (const userId of userIds) {
    const { data, error } = await context.adminClient.auth.admin.getUserById(userId);
    if (!error && data.user) usersById.set(userId, { email: data.user.email });
  }

  return (memberships || []).map(membership => ({
    user_id: membership.user_id,
    display_name: profileById.get(membership.user_id) || 'Pending staff member',
    email: usersById.get(membership.user_id)?.email || '',
    role_id: membership.role_id,
    status: membership.status,
    created_at: membership.created_at,
    updated_at: membership.updated_at
  }));
}

async function inviteStaff(context: Awaited<ReturnType<typeof getOwnerContext>>, payload: Record<string, unknown>) {
  const email = normalizedEmail(payload.email);
  const displayName = requiredText(payload.displayName, 'Name', 120);
  const roleId = requiredText(payload.roleId, 'Role', 40);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('A valid staff email is required.');
  if (!allowedRoles.has(roleId)) throw new Error('Only assistant staff roles can be invited.');

  const existingUser = await findAuthUserByEmail(context.adminClient, email);
  let userId = existingUser?.id || null;
  let emailOperation;
  const redirectTo = Deno.env.get('INVITE_REDIRECT_URL') || undefined;

  if (existingUser) {
    const [{ data: existingProfile, error: profileLookupError }, { data: existingMembership, error: membershipLookupError }] = await Promise.all([
      context.adminClient.from('profiles').select('id').eq('id', existingUser.id).maybeSingle(),
      context.adminClient.from('team_memberships').select('user_id,role_id,status').eq('team_id', context.team.id).eq('user_id', existingUser.id).maybeSingle()
    ]);
    if (profileLookupError || membershipLookupError) {
      throw profileLookupError || membershipLookupError || new Error('Existing staff records could not be checked.');
    }
    if (existingMembership) {
      throw new Error('An Auth user and team membership already exist for this email. No invite was sent.');
    }

    const { error: recoveryError } = await context.publicClient.auth.resetPasswordForEmail(email, {
      ...(redirectTo ? { redirectTo } : {})
    });
    emailOperation = recoveryError;
    if (recoveryError) throw recoveryError;
    userId = existingUser.id;
    console.info('Reusing an existing Auth user for staff invite recovery:', userId);
  } else {
    const { data: invitedUser, error: inviteError } = await context.adminClient.auth.admin.inviteUserByEmail(email, {
      data: { display_name: displayName },
      ...(redirectTo ? { redirectTo } : {})
    });
    emailOperation = inviteError;
    if (inviteError || !invitedUser.user) throw inviteError || new Error('The invite could not be created.');
    userId = invitedUser.user.id;
  }

  if (!userId || emailOperation) throw emailOperation || new Error('The invite email operation did not complete.');

  const { error: profileError } = await context.adminClient
    .from('profiles')
    .upsert({ id: userId, display_name: displayName }, { onConflict: 'id' });
  const { error: membershipError } = await context.adminClient
    .from('team_memberships')
    .insert({
      team_id: context.team.id,
      user_id: userId,
      role_id: roleId,
      status: 'invited',
      invited_by: context.caller.id
    });

  if (profileError || membershipError) {
    throw profileError || membershipError || new Error('The pending membership could not be created.');
  }

  return {
    message: existingUser
      ? 'Recovery email sent and pending membership created for the existing Auth user.'
      : 'Invite sent and pending membership created.',
    status: 'invited',
    role_id: roleId
  };
}

async function resendSetupLink(context: Awaited<ReturnType<typeof getOwnerContext>>, payload: Record<string, unknown>) {
  const userId = requiredText(payload.userId, 'User', 80);
  const cooldownKey = `${context.caller.id}:${userId}`;
  const lastSentAt = resendCooldowns.get(cooldownKey) || 0;
  const remainingMs = resendCooldownMs - (Date.now() - lastSentAt);
  if (remainingMs > 0) {
    throw new Error(`A setup link was sent recently. Try again in ${Math.ceil(remainingMs / 1000)} seconds.`);
  }

  const { data: membership, error: membershipError } = await context.adminClient
    .from('team_memberships')
    .select('user_id,role_id,status')
    .eq('team_id', context.team.id)
    .eq('user_id', userId)
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership) throw new Error('The staff membership could not be found.');
  if (membership.status !== 'invited') throw new Error('A setup link is only available for invited staff members.');
  if (!allowedRoles.has(membership.role_id)) throw new Error('Only assistant staff memberships can receive setup links.');

  const { data: userData, error: userError } = await context.adminClient.auth.admin.getUserById(userId);
  if (userError || !userData.user?.email) throw userError || new Error('The existing Auth user could not be found.');

  const redirectTo = Deno.env.get('INVITE_REDIRECT_URL') || undefined;
  resendCooldowns.set(cooldownKey, Date.now());
  const { error: recoveryError } = await context.publicClient.auth.resetPasswordForEmail(userData.user.email, {
    ...(redirectTo ? { redirectTo } : {})
  });
  if (recoveryError) {
    resendCooldowns.delete(cooldownKey);
    throw recoveryError;
  }

  return {
    message: 'A new account setup link was sent to the existing Auth user.',
    status: membership.status,
    role_id: membership.role_id
  };
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'POST is required.' }, 405);

  try {
    const context = await getOwnerContext(request);
    const payload = await request.json();
    if (payload?.action === 'list') return json({ invites: await listInvites(context) });
    if (payload?.action === 'invite') return json(await inviteStaff(context, payload));
    if (payload?.action === 'resend_setup') return json(await resendSetupLink(context, payload));
    return json({ error: 'Unknown invite action.' }, 400);
  } catch (error) {
    console.error('Staff invite request failed:', error instanceof Error ? error.message : 'unknown error');
    return json({ error: error instanceof Error ? error.message : 'Staff invite request failed.' }, 400);
  }
});
