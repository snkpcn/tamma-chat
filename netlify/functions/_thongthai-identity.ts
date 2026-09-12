import type { BrainChannel } from './_thongthai-brain';

function configuration(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/$/, ''), key } : null;
}

async function dbFetch(path: string): Promise<Response> {
  const config = configuration();
  if (!config) throw new Error('Supabase configuration missing');
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) throw new Error(`Identity lookup failed ${response.status}`);
  return response;
}

function provider(channel: BrainChannel): 'web' | 'line' | 'facebook' | 'backoffice' {
  return channel === 'facebook' ? 'facebook' : channel;
}

/**
 * Resolve a channel-local anonymous key to the canonical anonymous guest id.
 * This is deliberately server-side. Raw provider identifiers must be transformed
 * by the adapter before they reach this function (LINE already does this).
 */
export async function resolveCanonicalGuestId(
  channel: BrainChannel,
  providerUserKey: string | undefined,
): Promise<string | undefined> {
  if (!providerUserKey || !configuration()) return providerUserKey;
  const key = providerUserKey.trim().slice(0, 128);
  if (!key) return providerUserKey;

  try {
    const identityResponse = await dbFetch(
      `guest_identities?provider=eq.${encodeURIComponent(provider(channel))}`
      + `&provider_user_key=eq.${encodeURIComponent(key)}`
      + '&select=guest_id&limit=1',
    );
    const identities = await identityResponse.json() as Array<{ guest_id: string }>;
    const guestDbId = identities[0]?.guest_id;
    if (!guestDbId) return providerUserKey;

    const guestResponse = await dbFetch(
      `guests?id=eq.${encodeURIComponent(guestDbId)}&select=anonymous_id&limit=1`,
    );
    const guests = await guestResponse.json() as Array<{ anonymous_id: string }>;
    return guests[0]?.anonymous_id ?? providerUserKey;
  } catch (error) {
    console.error(
      'THONGTHAI_IDENTITY_RESOLVE_ERROR',
      error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    );
    return providerUserKey;
  }
}
