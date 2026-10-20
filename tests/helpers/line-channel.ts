// Drives the REAL LINE entry point (netlify/functions/line-webhook.ts) inside
// the canonical core harness: a signed webhook batch goes in exactly as LINE
// sends it, and every call to api.line.me is captured so a test can assert on
// the text the customer would actually receive. Must run inside withHarness.
import { createHmac, randomUUID } from 'node:crypto';
import type { Harness } from './canonical-core-harness';

export type LineReply = { replyToken: string; status: number; texts: string[] };
export type LineDeliveryResult = {
  status: number;
  /** One entry per customer text, in order; null = the customer got nothing. */
  replies: Array<LineReply | null>;
  /** Every api.line.me call made while handling the batch. */
  calls: Array<{ endpoint: string; status: number; body: Record<string, unknown> }>;
};

const SECRET = 'line-channel-test-secret';

export async function deliverLineTexts(
  harness: Harness,
  input: {
    userId: string;
    texts: string[];
    /** Put one unbound-group event first in the same batch. */
    withGroup?: boolean;
    /** Status LINE answers a reply with (400 = expired/used reply token). */
    replyStatus?: number;
    /** Extra latency for the private ops router, to model a slow group path. */
    opsDelayMs?: number;
  },
): Promise<LineDeliveryResult> {
  const now = Date.now();
  const events: Array<Record<string, unknown>> = [];
  if (input.withGroup) {
    events.push({
      type: 'message', webhookEventId: 'g-' + randomUUID(), replyToken: 'rt-group-' + randomUUID(), timestamp: now, mode: 'active',
      source: { type: 'group', groupId: 'C-test-group', userId: 'U-staff' },
      message: { id: 'm-' + randomUUID(), type: 'text', text: 'สรุปยอดวันนี้' },
    });
  }
  const customerTokens: string[] = [];
  for (const text of input.texts) {
    const replyToken = 'rt-' + randomUUID();
    customerTokens.push(replyToken);
    events.push({
      type: 'message', webhookEventId: 'e-' + randomUUID(), replyToken, timestamp: now, mode: 'active',
      source: { type: 'user', userId: input.userId },
      message: { id: 'm-' + randomUUID(), type: 'text', text },
    });
  }
  const body = JSON.stringify({ destination: 'U-test-bot', events });
  const signature = createHmac('sha256', SECRET).update(body, 'utf8').digest('base64');

  const calls: LineDeliveryResult['calls'] = [];
  const inner = harness.fetchMock;
  const previousSecret = process.env.LINE_CHANNEL_SECRET;
  process.env.LINE_CHANNEL_SECRET = SECRET;
  global.fetch = (async (url: string | URL, init: RequestInit = {}) => {
    const u = String(url);
    if (/api\.line\.me\/v2\/bot\/(message\/(reply|push)|chat\/loading)/u.test(u)) {
      const parsed = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
      const status = u.endsWith('/reply') ? input.replyStatus ?? 200 : 200;
      calls.push({ endpoint: u.replace(/^.*\/v2\/bot\//u, ''), status, body: parsed });
      return new Response(status === 200 ? '{}' : '{"message":"Invalid reply token"}', { status });
    }
    if (input.opsDelayMs && u.includes('/api/line/snk-money')) {
      await new Promise(resolve => setTimeout(resolve, input.opsDelayMs));
    }
    return inner(url, init);
  }) as typeof fetch;
  try {
    const { handler } = await import('../../netlify/functions/line-webhook');
    const response = await handler({
      httpMethod: 'POST', headers: { 'x-line-signature': signature, 'content-type': 'application/json' }, body,
      path: '/.netlify/functions/line-webhook', rawUrl: 'https://test.invalid/.netlify/functions/line-webhook', rawQuery: '',
      queryStringParameters: {}, multiValueHeaders: {}, multiValueQueryStringParameters: {}, isBase64Encoded: false,
    } as never, {} as never);
    const replies = customerTokens.map(token => {
      const call = calls.find(c => c.endpoint === 'message/reply' && c.body.replyToken === token);
      if (!call) return null;
      const messages = (call.body.messages as Array<{ text?: string; altText?: string }> | undefined) ?? [];
      return { replyToken: token, status: call.status, texts: messages.map(m => m.text ?? m.altText ?? '') };
    });
    return { status: (response as { statusCode: number }).statusCode, replies, calls };
  } finally {
    global.fetch = inner;
    if (previousSecret === undefined) delete process.env.LINE_CHANNEL_SECRET;
    else process.env.LINE_CHANNEL_SECRET = previousSecret;
  }
}
