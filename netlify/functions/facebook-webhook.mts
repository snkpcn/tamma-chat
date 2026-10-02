import type { Config, Context } from '@netlify/functions';
import {
  THONGTHAI_FACEBOOK_PERSONA_NAME,
  THONGTHAI_FACEBOOK_PERSONA_PROFILE_URL,
  detectFacebookLanguage,
  extractFacebookTextEvents,
  facebookGuestId,
  findThongthaiPersonaId,
  splitFacebookText,
  verifyFacebookSignature,
} from './_facebook-messenger-adapter';

declare const Netlify: {
  env: {
    get(name: string): string | undefined;
  };
};

type ThongthaiResponse = {
  message?: string;
  intent?: string;
  contextUpdates?: Record<string, unknown>;
  journeyAction?: unknown;
  suggestedActions?: unknown[];
};

class FacebookSendHttpError extends Error {
  retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'FacebookSendHttpError';
    this.retryable = retryable;
  }
}

// Meta verification/runtime secrets are resolved from Netlify environment variables.
// Redeploy production after changing their scopes or contexts so the live function sees the new values.
function env(name: string): string {
  return Netlify.env.get(name)?.trim() ?? '';
}

async function alreadyProcessedFacebookEvent(conversationId: string, eventId: string): Promise<boolean> {
  const url = env('SUPABASE_URL').replace(/\/$/, '');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return false;
  const query = new URL(`${url}/rest/v1/ai_response_turns`);
  query.searchParams.set('conversation_id', `eq.${conversationId}`);
  query.searchParams.set('event_id', `eq.${eventId}`);
  query.searchParams.set('select', 'event_id');
  query.searchParams.set('limit', '1');
  const response = await fetch(query, {
    headers: { apikey:key, Authorization:`Bearer ${key}` },
  }).catch(() => null);
  if (!response?.ok) return false;
  const rows = await response.json().catch(() => []) as unknown[];
  return rows.length > 0;
}

function emptyGuestContext() {
  return {
    tripDuration: null,
    travelerType: null,
    group: { adults: null, children: null, elderly: null },
    interests: [] as string[],
    pace: null,
    budget: null,
    constraints: [] as string[],
  };
}

async function resolveThongthaiPersona(
  pageToken: string,
  pageId: string,
  graphVersion: string,
): Promise<string | null> {
  const endpoint = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(pageId)}/personas`;
  const listUrl = new URL(endpoint);
  listUrl.searchParams.set('fields', 'id,name,profile_picture_url');
  listUrl.searchParams.set('limit', '100');

  const listed = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${pageToken}` },
  });
  if (!listed.ok) {
    const body = await listed.text().catch(() => '');
    console.error('FACEBOOK_PERSONA_LIST_ERROR', `${listed.status}: ${body.slice(0, 220)}`);
    return null;
  }

  const listPayload = await listed.json().catch(() => null);
  const existing = findThongthaiPersonaId(listPayload);
  if (existing) return existing;

  const created = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pageToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: THONGTHAI_FACEBOOK_PERSONA_NAME,
      profile_picture_url: THONGTHAI_FACEBOOK_PERSONA_PROFILE_URL,
    }),
  });
  if (!created.ok) {
    const body = await created.text().catch(() => '');
    console.error('FACEBOOK_PERSONA_CREATE_ERROR', `${created.status}: ${body.slice(0, 220)}`);
    return null;
  }

  const payload = await created.json().catch(() => null) as { id?: unknown } | null;
  const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
  if (!id) {
    console.error('FACEBOOK_PERSONA_CREATE_EMPTY_ID');
    return null;
  }
  console.log('FACEBOOK_PERSONA_READY', JSON.stringify({ name: THONGTHAI_FACEBOOK_PERSONA_NAME }));
  return id;
}

async function sendFacebookText(
  recipientPsid: string,
  text: string,
  pageToken: string,
  pageId: string,
  graphVersion: string,
  personaId: string | null,
): Promise<void> {
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(pageId)}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pageToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      recipient: { id: recipientPsid },
      message_type: 'RESPONSE',
      ...(personaId ? { persona_id: personaId } : {}),
      message: { text },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new FacebookSendHttpError(
      `Facebook Send API failed ${response.status}: ${body.slice(0, 220)}`,
      response.status === 429 || response.status >= 500,
    );
  }
}

async function sendFacebookTextReliably(
  recipientPsid: string,
  text: string,
  pageToken: string,
  pageId: string,
  graphVersion: string,
  personaId: string | null,
): Promise<void> {
  // Meta/network outcomes can be ambiguous. Re-sending the same text here can
  // create duplicate customer bubbles, so a webhook delivery makes one Send
  // API attempt only.
  await sendFacebookText(recipientPsid, text, pageToken, pageId, graphVersion, personaId);
}

async function askThongthai(message: string, psid: string, eventId: string): Promise<ThongthaiResponse> {
  // Keep Meta's GET verification path tiny and fast: load the full Thongthai
  // application graph only for real POST message processing.
  const { processThongthaiChatCore } = await import('./thongthai-chat');
  const result = await processThongthaiChatCore({
    guestId: facebookGuestId(psid),
    message,
    language: detectFacebookLanguage(message),
    chatHistory: [],
    guestContext: emptyGuestContext(),
    journeyContext: {
      currentPlan: null,
      savedPlan: null,
      visitedExperiences: [],
      favorites: [],
      journalEntries: [],
    },
    pageContext: { section: 'facebook' },
  }, eventId);

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw new Error(`Thongthai core returned ${result.statusCode}`);
  }
  return result.payload as ThongthaiResponse;
}

export default async (req: Request, _context: Context) => {
  const verifyToken = env('FACEBOOK_VERIFY_TOKEN');
  const pageToken = env('FACEBOOK_PAGE_ACCESS_TOKEN');
  const pageId = env('FACEBOOK_PAGE_ID'); // production Page binding ready
  const appSecret = env('FACEBOOK_APP_SECRET');
  const graphVersion = env('FACEBOOK_GRAPH_VERSION') || 'v26.0';

  if (req.method === 'GET') {
    const url = new URL(req.url);
    if (url.searchParams.get('probe') === '1') {
      return Response.json({
        ok: true,
        verifyTokenConfigured: Boolean(verifyToken),
        pageTokenConfigured: Boolean(pageToken),
        pageIdConfigured: Boolean(pageId),
        appSecretConfigured: Boolean(appSecret),
      });
    }
    const mode = url.searchParams.get('hub.mode');
    const suppliedToken = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && verifyToken && suppliedToken === verifyToken && challenge !== null) {
      console.log('FACEBOOK_WEBHOOK_VERIFIED');
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
    return new Response('Forbidden', { status: 403 });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  if (!pageToken || !pageId) {
    console.error('FACEBOOK_WEBHOOK_CONFIGURATION_MISSING');
    return new Response('Facebook configuration missing', { status: 503 });
  }

  // Do not process customer messages until the Meta App Secret is installed.
  // The GET verification above intentionally remains available so the callback
  // can be registered first without ever accepting unsigned production events.
  if (!appSecret) {
    console.error('FACEBOOK_APP_SECRET_MISSING');
    return new Response('Facebook app secret missing', { status: 503 });
  }

  const rawBody = await req.text();
  if (!verifyFacebookSignature(rawBody, req.headers.get('x-hub-signature-256'), appSecret)) {
    console.error('FACEBOOK_WEBHOOK_SIGNATURE_INVALID');
    return new Response('Invalid signature', { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const events = extractFacebookTextEvents(payload, pageId);
  if (!events.length) {
    return new Response('EVENT_RECEIVED', { status: 200 });
  }

  for (const event of events) {
    const guestId = facebookGuestId(event.senderPsid);
    console.log('FACEBOOK_TEXT_EVENT_RECEIVED', JSON.stringify({
      guest: guestId.slice(0, 8),
      eventId: event.eventId.slice(0, 80),
      chars: event.text.length,
    }));

    if (await alreadyProcessedFacebookEvent(guestId, event.eventId)) {
      console.log('FACEBOOK_DUPLICATE_EVENT_SKIPPED', JSON.stringify({
        guest: guestId.slice(0,8),
        eventId: event.eventId.slice(0,80),
      }));
      continue;
    }

    let reply = '';
    try {
      const result = await askThongthai(event.text, event.senderPsid, event.eventId);
      reply = typeof result.message === 'string' && result.message.trim()
        ? result.message.trim()
        : 'ทองไทยรับข้อความแล้วครับ ลองพิมพ์อีกครั้งได้เลยครับ';
    } catch (error) {
      console.error(
        'FACEBOOK_THONGTHAI_ERROR',
        error instanceof Error ? error.message.slice(0, 260) : 'unknown',
      );
      reply = 'ทองไทยรับข้อความแล้วครับ แต่ระบบตอบกลับไม่ทันในรอบนี้ ลองส่งข้อความเดิมอีกครั้งได้เลยครับ';
    }

    try {
      const personaId = await resolveThongthaiPersona(pageToken, pageId, graphVersion).catch(error => {
        console.error(
          'FACEBOOK_PERSONA_RESOLVE_ERROR',
          error instanceof Error ? error.message.slice(0, 260) : 'unknown',
        );
        return null;
      });
      for (const chunk of splitFacebookText(reply)) {
        await sendFacebookTextReliably(event.senderPsid, chunk, pageToken, pageId, graphVersion, personaId);
      }
    } catch (error) {
      console.error(
        'FACEBOOK_REPLY_ERROR',
        error instanceof Error ? error.message.slice(0, 260) : 'unknown',
      );
      // Acknowledge the webhook to avoid a Meta retry storm. Core actions are
      // event-idempotent, and transport failures are observable in Netlify logs.
    }
  }

  return new Response('EVENT_RECEIVED', { status: 200 });
};

export const config: Config = {
  path: '/api/facebook/webhook',
};
