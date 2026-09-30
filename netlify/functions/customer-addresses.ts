import type { Handler, HandlerEvent } from '@netlify/functions';
import { authUserFromBearer } from './_operations-db';
import {
  deleteMemberAddress,
  listMemberAddresses,
  saveMemberAddress,
} from './_member-delivery-db';

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

function parseBody(event: HandlerEvent): Record<string, unknown> {
  try {
    const value = JSON.parse(event.body ?? '{}');
    return value && typeof value === 'object' ? value as Record<string, unknown> : {};
  } catch {
    throw new Error('malformed_json');
  }
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message.split(':')[0] : 'unknown';
  const badRequest = new Set([
    'malformed_json', 'recipient_name_required', 'invalid_phone', 'address_line_required',
    'district_required', 'province_required', 'invalid_postal_code', 'address_not_found',
  ]);
  if (code === 'member_profile_required') return json(409, { error: code });
  if (badRequest.has(code)) return json(400, { error: code });
  console.error('CUSTOMER_ADDRESSES_ERROR', code.slice(0, 120));
  return json(503, { error: 'addresses_temporarily_unavailable' });
}

export const handler: Handler = async (event: HandlerEvent) => {
  const user = await authUserFromBearer(header(event, 'authorization'));
  if (!user) return json(401, { error: 'authentication_required' });

  try {
    if (event.httpMethod === 'GET') {
      return json(200, { addresses: await listMemberAddresses(user.id) });
    }
    if (event.httpMethod === 'POST') {
      const body = parseBody(event);
      const address = await saveMemberAddress(user.id, body.address ?? body);
      return json(201, { address, addresses: await listMemberAddresses(user.id) });
    }
    if (event.httpMethod === 'PATCH') {
      const body = parseBody(event);
      const id = typeof body.id === 'string' ? body.id : '';
      const address = await saveMemberAddress(user.id, body.address ?? body, id);
      return json(200, { address, addresses: await listMemberAddresses(user.id) });
    }
    if (event.httpMethod === 'DELETE') {
      const body = parseBody(event);
      const id = typeof body.id === 'string' ? body.id : '';
      await deleteMemberAddress(user.id, id);
      return json(200, { deleted: true, addresses: await listMemberAddresses(user.id) });
    }
    return json(405, { error: 'method_not_allowed' });
  } catch (error) {
    return errorResponse(error);
  }
};
