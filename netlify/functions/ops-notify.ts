import type { Handler, HandlerEvent } from '@netlify/functions';
import { timingSafeEqual } from 'node:crypto';
import { dispatchEntityNotification, type OpsNotificationEntity } from './_ops-notifications';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function header(event: HandlerEvent, name: string): string | undefined {
  const key = name.toLowerCase();
  return Object.entries(event.headers ?? {}).find(([value]) => value.toLowerCase() === key)?.[1];
}

function secretMatches(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const a = Buffer.from(actual, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  const secret = process.env.OPS_NOTIFICATION_WEBHOOK_SECRET;
  if (!secret) return { statusCode: 500, body: 'Notification webhook secret missing' };
  if (!secretMatches(header(event, 'x-ops-notification-secret'), secret)) {
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
