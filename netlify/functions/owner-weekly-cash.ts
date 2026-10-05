import type { Config } from '@netlify/functions';
import { sendOwnerWeeklyCashSummary } from './_ops-notifications';

export default async (): Promise<Response> => {
  try {
    const status = await sendOwnerWeeklyCashSummary();
    return Response.json({ ok: true, status });
  } catch (error) {
    console.error(
      'OWNER_WEEKLY_CASH_ERROR',
      error instanceof Error ? error.message.slice(0, 300) : 'unknown',
    );
    return new Response('Owner weekly cash summary failed', { status: 500 });
  }
};

export const config: Config = {
  // Netlify cron is UTC. Sunday 06:00 UTC = Sunday 13:00 Asia/Bangkok.
  schedule: '0 6 * * 0',
};
