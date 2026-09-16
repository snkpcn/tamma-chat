import type { Handler, HandlerEvent } from '@netlify/functions';
import { createHash, timingSafeEqual } from 'node:crypto';
import { dispatchEntityNotification, type OpsNotificationEntity } from './_ops-notifications';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPS_NOTIFICATION_WEBHOOK_SECRET_SHA256 = '0c99ca5d870b02c4b58b485c0cdf8d88158fe18ea86ba126751cc72715f506d5';

function header(event: HandlerEvent, name: string): string | undefined {
  const key = name.toLowerCase();
  return Object.entries(event.headers ?? {}).find(([value]) => value.toLowerCase() === key)?.[1];
}

function secretMatches(actual: string | undefined): boolean {
  if (!actual) return false;
  const actualHash = createHash('sha256').update(actual, 'utf8').digest();
  const expectedHash = Buffer.from(OPS_NOTIFICATION_WEBHOOK_SECRET_SHA256, 'hex');
  return actualHash.length === expectedHash.length && timingSafeEqual(actualHash, expectedHash);
}

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  if (!secretMatches(header(event, 'x-ops-notification-secret'))) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  let body: { entity?: string; id?: string };
  try {
    body = JSON.parse(event.body ?? '{}') as { entity?: string; id?: string };
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }
  const entity = body.entity as OpsNotificationEntity | undefined;
  if (!entity || !['booking', 'cafe_inquiry', 'otop_order'].includes(entity)) {
    return { statusCode: 400, body: 'Invalid entity' };
  }
  if (!body.id || !UUID_RE.test(body.id)) return { statusCode: 400, body: 'Invalid id' };

  try {
    const status = await dispatchEntityNotification(entity, body.id);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, entity, id: body.id, status }),
    };
  } catch (error) {
    console.error('OPS_NOTIFICATION_DISPATCH_ERROR', error instanceof Error ? error.message.slice(0, 300) : 'unknown');
    return { statusCode: 500, body: 'Notification dispatch failed' };
  }
};
