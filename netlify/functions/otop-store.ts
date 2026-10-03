import type { Handler, HandlerEvent } from '@netlify/functions';
import { authUserFromBearer } from './_operations-db';
import { checkoutMemberOtopOrder, loadOtopStoreCatalog } from './_member-delivery-db';

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

function checkoutError(error: unknown) {
  const raw = error instanceof Error ? error.message : 'unknown';
  const code = raw.split(':')[0];
  const detail = raw.includes(':') ? raw.slice(raw.indexOf(':') + 1).slice(0, 80) : undefined;
  const conflict = new Set(['product_not_available', 'insufficient_stock', 'shipping_quote_changed']);
  const badRequest = new Set([
    'invalid_items', 'shipping_address_required', 'shipping_address_not_found',
    'international_shipping_not_enabled',
  ]);
  if (conflict.has(code)) return json(409, { error: code, detail });
  if (badRequest.has(code)) return json(400, { error: code });
  if (code === 'member_profile_required') return json(409, { error: code });
  if (code === 'shipping_temporarily_unavailable') return json(503, { error: code });
  console.error('OTOP_STORE_CHECKOUT_ERROR', code.slice(0, 120));
  return json(503, { error: 'checkout_temporarily_unavailable' });
}

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === 'GET') {
    try {
      return json(200, await loadOtopStoreCatalog());
    } catch (error) {
      console.error('OTOP_STORE_CATALOG_ERROR', error instanceof Error ? error.message.slice(0, 160) : 'unknown');
      return json(503, { error: 'catalog_temporarily_unavailable' });
    }
  }

  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  const user = await authUserFromBearer(header(event, 'authorization'));
  if (!user) return json(401, { error: 'authentication_required' });
  let body: unknown;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'malformed_json' });
  }
  try {
    return json(201, { order: await checkoutMemberOtopOrder(user.id, body) });
  } catch (error) {
    return checkoutError(error);
  }
};
