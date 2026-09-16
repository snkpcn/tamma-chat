import type { Handler } from '@netlify/functions';
import { sendDailyOpsSummaries } from './_ops-notifications';

export const handler: Handler = async () => {
  try {
    const results = await sendDailyOpsSummaries();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, results }),
    };
  } catch (error) {
    console.error('OPS_DAILY_SCHEDULE_ERROR', error instanceof Error ? error.message.slice(0, 300) : 'unknown');
    return { statusCode: 500, body: 'Daily schedule dispatch failed' };
  }
};
