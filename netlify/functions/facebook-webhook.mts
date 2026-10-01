import type { Config, Context } from '@netlify/functions';
import { processThongthaiChatCore } from './thongthai-chat';
import {
  detectFacebookLanguage,
  extractFacebookTextEvents,
  facebookGuestId,
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

function env(name: string): string {
  return Netlify.env.get(name)?.trim() ?? '';
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

async function sendFacebookText(
  recipientPsid: string,
  text: string,
  pageToken: string,
  pageId: string,
  graphVersion: string,
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
      message: { text },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Facebook Send API failed ${response.status}: ${body.slice(0, 220)}`);
  }
}

async function sendFacebookTextReliably(
  recipientPsid: string,
  text: string,
  pageToken: string,
  pageId: string,
  graphVersion: string,
): Promise<void> {
  try {
    await sendFacebookText(recipientPsid, text, pageToken, pageId, graphVersion);
    return;
  } catch (firstError) {
    console.error(
      'FACEBOOK_SEND_FIRST_ATTEMPT_ERROR',
      firstError instanceof Error ? firstError.message.slice(0, 260) : 'unknown',
    );
  }

  await new Promise(resolve => setTimeout(resolve, 250));
  await sendFacebookText(recipientPsid, text, pageToken, pageId, graphVersion);
}

async function askThongthai(message: string, psid: string, eventId: string): Promise<ThongthaiResponse> {
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
  const pageId = env('FACEBOOK_PAGE_ID');
  const appSecret = env('FACEBOOK_APP_SECRET');
  const graphVersion = env('FACEBOOK_GRAPH_VERSION') || 'v26.0';

  if (req.method === 'GET') {
    const url = new URL(req.url);
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
      for (const chunk of splitFacebookText(reply)) {
        await sendFacebookTextReliably(event.senderPsid, chunk, pageToken, pageId, graphVersion);
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
