import type { Handler, HandlerEvent } from '@netlify/functions';
import {
  authUserFromBearer,
  guestDbIdFromAnonymousId,
  loadCustomerPortal,
  upsertCustomerAccount,
} from './_operations-db';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
    body: JSON.stringify(body),
  };
}

function header(event: HandlerEvent, name: string): string | undefined {
  const target = name.toLowerCase();
  return Object.entries(event.headers ?? {}).find(([key]) => key.toLowerCase() === target)?.[1];
}

function stringValue(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

export const handler: Handler = async (event: HandlerEvent) => {
  const authHeader = header(event, 'authorization');
  const authUser = await authUserFromBearer(authHeader);
  if (!authUser) return json(401, { error: 'Authentication required' });

  if (event.httpMethod === 'GET') {
    try {
      const portal = await loadCustomerPortal(authUser.id);
      return json(200, { account: portal });
    } catch (error) {
      console.error('CUSTOMER_ACCOUNT_GET_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
      return json(503, { error: 'Customer account temporarily unavailable' });
    }
  }

  if (event.httpMethod === 'POST') {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(event.body ?? '{}') as Record<string, unknown>;
    } catch {
      return json(400, { error: 'Malformed JSON' });
    }

    const anonymousGuestId = stringValue(body.guestId, 60);
    const guestDbId = anonymousGuestId && UUID_RE.test(anonymousGuestId)
      ? await guestDbIdFromAnonymousId(anonymousGuestId)
      : null;
    const preferred = ['line', 'phone', 'email'].includes(String(body.preferredContact))
      ? String(body.preferredContact) as 'line' | 'phone' | 'email'
      : null;

    try {
      await upsertCustomerAccount({
        authUserId: authUser.id,
        guestDbId,
        fullName: stringValue(body.fullName, 120),
        email: authUser.email ?? stringValue(body.email, 160),
        phone: stringValue(body.phone, 30),
        preferredContact: preferred,
        marketingOptIn: body.marketingOptIn === true,
      });
      const portal = await loadCustomerPortal(authUser.id);
      return json(200, { account: portal });
    } catch (error) {
      console.error('CUSTOMER_ACCOUNT_POST_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
      return json(503, { error: 'Could not update customer account' });
    }
  }

  return json(405, { error: 'Method not allowed' });
};
