import type { Handler } from '@netlify/functions';
import { runThongthaiAgentShadowTurn } from './_thongthai-agent-session';
import type { BrainChannel } from './_thongthai-brain-v3';

const ALLOWED_CHANNELS = new Set<BrainChannel>(['line', 'web', 'facebook', 'backoffice']);

function json(statusCode: number, body: Record<string, unknown>) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

export const handler: Handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });
  if (process.env.THONGTHAI_AGENT_SHADOW_ENABLED !== '1') {
    return json(404, { ok: false, error: 'agent_shadow_disabled' });
  }

  const expectedToken = process.env.THONGTHAI_AGENT_SHADOW_TOKEN?.trim();
  const suppliedToken = event.headers['x-thongthai-shadow-token']?.trim();
  if (!expectedToken || suppliedToken !== expectedToken) {
    return json(401, { ok: false, error: 'unauthorized' });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}') as Record<string, unknown>;
  } catch {
    return json(400, { ok: false, error: 'invalid_json' });
  }

  const guestDbId = typeof body.guestDbId === 'string' ? body.guestDbId.trim() : '';
  const conversationId = typeof body.conversationId === 'string' ? body.conversationId.trim() : '';
  const eventId = typeof body.eventId === 'string' ? body.eventId.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const channel = typeof body.channel === 'string' && ALLOWED_CHANNELS.has(body.channel as BrainChannel)
    ? body.channel as BrainChannel
    : 'web';

  if (!guestDbId || !conversationId || !eventId || !message) {
    return json(400, { ok: false, error: 'guestDbId_conversationId_eventId_message_required' });
  }

  try {
    const result = await runThongthaiAgentShadowTurn({
      guestDbId,
      conversationId,
      eventId,
      channel,
      message,
      environment: body.environment === 'test' ? 'test' : 'live',
    });
    return json(200, { ok: true, mode: 'shadow', ...result });
  } catch (error) {
    console.error('THONGTHAI_AGENT_SHADOW_ERROR', error instanceof Error ? error.message.slice(0, 500) : 'unknown');
    return json(502, {
      ok: false,
      error: 'agent_shadow_failed',
      detail: error instanceof Error ? error.message.slice(0, 300) : 'unknown',
    });
  }
};
