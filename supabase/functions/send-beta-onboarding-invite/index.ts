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

function createToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function inviteUrl(rawToken: string) {
  const configuredBaseUrl = Deno.env.get('INVITE_ACCEPT_URL');
  if (!configuredBaseUrl) throw new Error('Invite delivery is not configured.');
  const url = new URL(configuredBaseUrl);
  url.hash = `invite_token=${encodeURIComponent(rawToken)}`;
  return url.toString();
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character] as string));
}

// Provider errors are echoed back to the operator UI, so anything token-shaped
// is stripped before the message leaves this function or reaches the database.
function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : 'The invitation email could not be sent.';
  return message.replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]').slice(0, 240);
}

function inviteEmailBody(options: {
  coachName: string;
  organizationName: string;
  teamName: string | null;
  acceptUrl: string;
}) {
  const workspace = options.teamName
    ? `${options.organizationName} \u00b7 ${options.teamName}`
    : options.organizationName;
  const text = [
    `Hi ${options.coachName},`,
    '',
    `You have been invited to the ${workspace} workspace on PuckNexus.`,
    '',
    'Open the secure link below to set up your account and join your team:',
    options.acceptUrl,
    '',
    'This link expires in 72 hours and can only be used once.',
    'If you were not expecting this invitation you can safely ignore this email.',
    '',
    'PuckNexus'
  ].join('\n');

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#07111e;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#e8eef6">
  <div style="max-width:520px;margin:0 auto;background:#0f1a28;border:1px solid #22344a;border-radius:14px;padding:28px">
    <p style="margin:0 0 6px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#7d90a6">PuckNexus</p>
    <h1 style="margin:0 0 18px;font-size:22px;color:#ffffff">You have been invited to ${escapeHtml(workspace)}</h1>
    <p style="margin:0 0 16px;line-height:1.6;color:#c3d0de">Hi ${escapeHtml(options.coachName)}, your PuckNexus workspace is ready.</p>
    <p style="margin:0 0 24px;line-height:1.6;color:#c3d0de">Use the secure button below to set up your account and join your team.</p>
    <p style="margin:0 0 24px"><a href="${escapeHtml(options.acceptUrl)}" style="display:inline-block;background:#2f81f7;color:#ffffff;text-decoration:none;font-weight:600;padding:13px 22px;border-radius:9px">Accept your invitation</a></p>
    <p style="margin:0;font-size:12px;line-height:1.6;color:#7d90a6">This link expires in 72 hours and can only be used once. If you were not expecting this invitation you can safely ignore this email.</p>
  </div>
</body></html>`;

  return { text, html };
}

async function sendInviteEmail(options: {
  to: string;
  coachName: string;
  organizationName: string;
  teamName: string | null;
  acceptUrl: string;
}) {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const fromEmail = Deno.env.get('INVITE_FROM_EMAIL');
  if (!apiKey || !fromEmail) throw new Error('Invite email delivery is not configured.');

  const { text, html } = inviteEmailBody(options);
  const workspace = options.teamName
    ? `${options.organizationName} \u00b7 ${options.teamName}`
    : options.organizationName;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [options.to],
      subject: `Your PuckNexus invitation to ${workspace}`,
      text,
      html
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Email provider rejected the invitation (HTTP ${response.status}). ${detail}`.trim());
  }
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'POST is required.' }, 405);

  let callerClient: ReturnType<typeof createClient> | null = null;
  let inviteId = '';
  let claimed = false;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !anonKey) throw new Error('Invite service is not configured.');

    const authorization = request.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) throw new Error('Authentication is required.');

    callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } }
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) throw new Error('Authentication is required.');

    const payload = await request.json();
    inviteId = requiredString(payload?.inviteId, 'Invite ID', 80);
    const allowResend = payload?.resend === true;

    // Claim first. Platform Admin authorization, invite state, and duplicate
    // suppression are all enforced in the database rather than here.
    const { data: claimData, error: claimError } = await callerClient.rpc(
      'claim_beta_onboarding_invite_delivery',
      { target_invite_id: inviteId, allow_resend: allowResend }
    );
    if (claimError) throw claimError;

    const claim = Array.isArray(claimData) ? claimData[0] : claimData;
    if (!claim?.claimed) {
      return json({
        delivered: false,
        skipped: true,
        reason: claim?.reason || 'delivery_not_claimed',
        invite_status: claim?.invite_status || null,
        delivery_state: claim?.delivery_state || null
      });
    }
    claimed = true;

    const rawToken = createToken();
    const { data: rotateData, error: rotateError } = await callerClient.rpc(
      'rotate_beta_onboarding_invite_token',
      { target_invite_id: inviteId, target_token_hash: await sha256Hex(rawToken) }
    );
    if (rotateError) throw rotateError;

    const rotated = Array.isArray(rotateData) ? rotateData[0] : rotateData;
    if (!rotated?.invite_id || !rotated?.invite_email) {
      throw new Error('The invitation could not be prepared for delivery.');
    }

    await sendInviteEmail({
      to: rotated.invite_email,
      coachName: rotated.invite_display_name || 'Coach',
      organizationName: rotated.organization_name || 'your organization',
      teamName: rotated.team_name || null,
      acceptUrl: inviteUrl(rawToken)
    });

    const { error: recordError } = await callerClient.rpc(
      'record_beta_onboarding_invite_delivery',
      { target_invite_id: inviteId, target_delivered: true, target_failure_reason: null }
    );
    if (recordError) throw recordError;

    return json({
      delivered: true,
      invite_id: rotated.invite_id,
      invite_status: rotated.invite_status,
      expires_at: rotated.invite_expires_at,
      email: rotated.invite_email
    });
  } catch (error) {
    const message = safeErrorMessage(error);
    // The workspace and its pending invitation are deliberately left intact so
    // a delivery failure never destroys a freshly provisioned team.
    if (callerClient && claimed && inviteId) {
      try {
        await callerClient.rpc('record_beta_onboarding_invite_delivery', {
          target_invite_id: inviteId,
          target_delivered: false,
          target_failure_reason: message
        });
      } catch (_recordError) {
        // Delivery bookkeeping is best effort; the invite stays pending either way.
      }
    }
    return json({ delivered: false, error: message }, 400);
  }
});
