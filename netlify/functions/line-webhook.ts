import type { Handler, HandlerEvent, HandlerResponse } from '@netlify/functions';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { handler as coreHandler } from './_line-webhook-core';
import { registerLineContact } from './_operations-db';
import { handleLineOpsGroupMessage } from './_ops-notifications';
import { handleLineFuelImage, handleLineFuelText } from './_ops-fuel-receipts';
import { hasPendingLineFuelSession } from './_ops-fuel-session-guard';
import { handleStaffBookingPostback, type LineMessage } from './_ops-line-ui';

type LineSource = {
  type?: 'user' | 'group' | 'room';
  userId?: string;
  groupId?: string;
  roomId?: string;
};

type LineWebhookEvent = {
  type?: string;
  replyToken?: string;
  timestamp?: number;
  source?: LineSource;
  message?: { id?: string; type?: string; text?: string };
  postback?: {
    data?: string;
    params?: { datetime?: string; date?: string; time?: string };
  };
};

type LineWebhookBody = {
  destination?: string;
  events?: LineWebhookEvent[];
};

const LINE_REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply';

function getHeader(event: HandlerEvent, name: string): string | undefined {
  const target = name.toLowerCase();
  return Object.entries(event.headers ?? {}).find(([key]) => key.toLowerCase() === target)?.[1];
}

function verifyLineSignature(rawBody: string, signature: string | undefined, channelSecret: string): boolean {
  if (!signature) return false;
  try {
    const expected = createHmac('sha256', channelSecret).update(rawBody, 'utf8').digest();
    const received = Buffer.from(signature, 'base64');
    return received.length === expected.length && timingSafeEqual(received, expected);
  } catch {
    return false;
  }
}

function signInternalBody(rawBody: string, channelSecret: string): string {
  return createHmac('sha256', channelSecret).update(rawBody, 'utf8').digest('base64');
}

/** Stable UUID-shaped anonymous id used everywhere in Thongthai memory. */
function lineGuestId(userId: string): string {
  const hex = createHash('sha256')
    .update('tamma-line:' + userId, 'utf8')
    .digest('hex')
    .slice(0, 32)
    .split('');
  hex[12] = '5';
  const variant = parseInt(hex[16], 16);
  hex[16] = ((variant & 0x3) | 0x8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

function normalizeReplyMessages(input: string | LineMessage | LineMessage[]): LineMessage[] {
  if (typeof input === 'string') return [{ type: 'text', text: input.slice(0, 4900) }];
  return Array.isArray(input) ? input.slice(0, 5) : [input];
}

async function replyToLine(
  replyToken: string,
  reply: string | LineMessage | LineMessage[],
  accessToken: string,
): Promise<void> {
  const response = await fetch(LINE_REPLY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ replyToken, messages: normalizeReplyMessages(reply) }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`LINE ops reply failed ${response.status}: ${body.slice(0, 220)}`);
  }
}

async function handleOpsEvent(event: LineWebhookEvent, accessToken: string): Promise<void> {
  const sourceType = event.source?.type;
  if (sourceType !== 'group' && sourceType !== 'room') return;
  if (!event.replyToken) return;
  const targetId = sourceType === 'group' ? event.source?.groupId : event.source?.roomId;
  if (!targetId) return;

  // Staff buttons use LINE postback events. They never enter customer chat/memory.
  if (event.type === 'postback' && typeof event.postback?.data === 'string') {
    const messages = await handleStaffBookingPostback({
      targetId,
      userId: event.source?.userId ?? null,
      data: event.postback.data,
      params: event.postback.params ?? null,
    });
    if (messages?.length) await replyToLine(event.replyToken, messages, accessToken);
    return;
  }

  if (event.type !== 'message') return;

  if (event.message?.type === 'image' && event.message.id) {
    // Only treat an image as a fuel receipt after that staff member has named the ATV.
    // This prevents normal activity photos in the group from being OCR'd or written to the fuel ledger.
    const pendingFuel = await hasPendingLineFuelSession(targetId, event.source?.userId ?? null);
    if (!pendingFuel) return;
    const fuelReply = await handleLineFuelImage({
      targetType: sourceType,
      targetId,
      userId: event.source?.userId ?? null,
      messageId: event.message.id,
      timestamp: event.timestamp,
    });
    if (fuelReply) await replyToLine(event.replyToken, fuelReply, accessToken);
    return;
  }

  if (event.message?.type !== 'text' || typeof event.message.text !== 'string') return;

  const fuelReply = await handleLineFuelText({
    targetType: sourceType,
    targetId,
    userId: event.source?.userId ?? null,
    text: event.message.text,
  });
  if (fuelReply) {
    await replyToLine(event.replyToken, fuelReply, accessToken);
    return;
  }

  const reply = await handleLineOpsGroupMessage({
    targetType: sourceType,
    targetId,
    userId: event.source?.userId ?? null,
    text: event.message.text,
  });
  if (reply) await replyToLine(event.replyToken, reply, accessToken);
}

export const handler: Handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    const coreResponse = await coreHandler(event, context);
    if (!coreResponse) return { statusCode: 500, body: 'LINE core handler returned no response' };
    return coreResponse;
  }

  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!channelSecret || !accessToken) {
    console.error('LINE_WEBHOOK_CONFIGURATION_MISSING');
    return { statusCode: 500, body: 'LINE configuration missing' };
  }

  const rawBody = event.body ?? '';
  if (!verifyLineSignature(rawBody, getHeader(event, 'x-line-signature'), channelSecret)) {
    console.error('LINE_WEBHOOK_SIGNATURE_INVALID');
    return { statusCode: 401, body: 'Invalid signature' };
  }

  let payload: LineWebhookBody;
  try {
    payload = JSON.parse(rawBody) as LineWebhookBody;
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const allEvents = Array.isArray(payload.events) ? payload.events : [];
  const opsEvents = allEvents.filter(item => item.source?.type === 'group' || item.source?.type === 'room');
  const customerEvents = allEvents.filter(item => item.source?.type !== 'group' && item.source?.type !== 'room');

  if (opsEvents.length) {
    const results = await Promise.allSettled(opsEvents.map(item => handleOpsEvent(item, accessToken)));
    for (const result of results) {
      if (result.status === 'rejected') {
        const message = result.reason instanceof Error ? result.reason.message : 'Unknown LINE ops group error';
        console.error('LINE_OPS_GROUP_ERROR', message.slice(0, 300));
      }
    }
  }

  let response: HandlerResponse = { statusCode: 200, body: 'OK' };
  if (customerEvents.length) {
    const customerBody = JSON.stringify({ ...payload, events: customerEvents });
    const headers = Object.fromEntries(
      Object.entries(event.headers ?? {}).filter(([key]) => key.toLowerCase() !== 'x-line-signature'),
    );
    headers['x-line-signature'] = signInternalBody(customerBody, channelSecret);
    const customerEvent: HandlerEvent = { ...event, headers, body: customerBody };
    const coreResponse = await coreHandler(customerEvent, context);
    if (!coreResponse) {
      console.error('LINE_WEBHOOK_EMPTY_RESPONSE');
      return { statusCode: 500, body: 'LINE webhook failed' };
    }
    response = coreResponse;
  }

  // Persist customer linkage only for direct-user events. Staff group senders stay out of customer memory/CRM.
  if (response.statusCode === 200 && customerEvents.length) {
    try {
      const userIds = [...new Set(
        customerEvents
          .filter(item => item.source?.type === 'user')
          .map(item => item.source?.userId)
          .filter((value): value is string => typeof value === 'string' && value.length > 0 && value.length <= 160),
      )];
      for (const userId of userIds) {
        await registerLineContact(lineGuestId(userId), userId);
      }
    } catch (error) {
      console.error(
        'LINE_OPERATIONAL_CONTACT_LINK_ERROR',
        error instanceof Error ? error.message.slice(0, 180) : 'unknown',
      );
    }
  }

  return response;
};