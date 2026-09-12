import type { Handler } from '@netlify/functions';
import { createHash } from 'node:crypto';
import { handler as coreHandler } from './_line-webhook-core';
import { registerLineContact } from './_operations-db';

/**
 * Stable UUID-shaped anonymous id used everywhere in Thongthai memory.
 * The raw LINE user id never enters chat memory, semantic memory, logs, or model prompts.
 * For operational service follow-up only, the wrapper may store the raw provider id
 * encrypted server-side in customer_channel_contacts after the signed webhook succeeds.
 */
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

export const handler: Handler = async (event, context) => {
  const response = await coreHandler(event, context);

  // Only persist operational contact linkage after the core webhook has accepted
  // the signed LINE request. This keeps invalid/spoofed requests out of customer data.
  if (event.httpMethod === 'POST' && response?.statusCode === 200 && event.body) {
    try {
      const payload = JSON.parse(event.body) as {
        events?: Array<{ source?: { userId?: string } }>;
      };
      const userIds = [...new Set(
        (payload.events ?? [])
          .map(item => item.source?.userId)
          .filter((value): value is string => typeof value === 'string' && value.length > 0 && value.length <= 160),
      )];
      for (const userId of userIds) {
        // Never log userId. registerLineContact encrypts the provider id at rest
        // and stores a one-way hash only for lookup/deduplication.
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
