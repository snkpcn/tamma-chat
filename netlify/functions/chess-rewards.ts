/**
 * netlify/functions/chess-rewards.ts
 *
 * Winner Pass / My Rewards — server-authoritative reward listing,
 * one_zone selection, and redemption. The browser can only ever request
 * these actions; every eligibility, expiry and duplicate check happens
 * here against the live database, never trusting client-held state.
 *
 * Actions (all POST):
 *  - list:        { guestId } -> every reward this guest has, each with its
 *                 covered zones and per-zone redeemed state, plus the
 *                 current real eligible-zone catalog.
 *  - select_zone: { guestId, rewardId, zoneKey } -> one_zone reward only.
 *  - redeem:      { guestId, rewardId, zoneKey } -> atomic; requires the
 *                 UI to have already gotten explicit staff-facing
 *                 confirmation before calling this.
 *
 * Endpoint once deployed: POST /.netlify/functions/chess-rewards
 */

import type { Handler, HandlerEvent } from '@netlify/functions';
import {
  getEligibleZones,
  isValidAnonymousId,
  listRewards,
  redeemZone,
  resolveOrCreateGuestId,
  selectRewardZone,
  toPublicReward,
} from './_chess-db';

const LANGUAGES = ['th', 'en', 'zh', 'lo', 'vi'];

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}') as Record<string, unknown>;
  } catch {
    return json(400, { error: 'Malformed JSON body' });
  }

  const guestId = body.guestId;
  if (!isValidAnonymousId(guestId)) return json(400, { error: 'Missing or invalid guestId' });
  const language = isNonEmptyString(body.language) && LANGUAGES.includes(body.language) ? body.language : 'th';

  let guestDbId: string;
  try {
    guestDbId = await resolveOrCreateGuestId(guestId, language);
  } catch (err) {
    console.error('CHESS_REWARDS_GUEST_ERROR', err instanceof Error ? err.message.slice(0, 200) : 'unknown');
    return json(503, { error: 'Rewards are temporarily unavailable' });
  }

  const action = body.action;

  if (action === 'list') {
    try {
      const [rewards, zones] = await Promise.all([listRewards(guestDbId), getEligibleZones()]);
      return json(200, {
        rewards: rewards.map(r => toPublicReward(r, zones)),
        eligibleZones: zones,
      });
    } catch (err) {
      console.error('CHESS_REWARDS_LIST_ERROR', err instanceof Error ? err.message.slice(0, 200) : 'unknown');
      return json(503, { error: 'Could not load rewards' });
    }
  }

  const rewardId = body.rewardId;
  const zoneKey = body.zoneKey;
  if (!isNonEmptyString(rewardId) || !isNonEmptyString(zoneKey)) {
    return json(400, { error: 'Missing rewardId or zoneKey' });
  }

  if (action === 'select_zone') {
    try {
      const result = await selectRewardZone(rewardId, guestDbId, zoneKey);
      if ('error' in result) return json(409, { error: result.error });
      const zones = await getEligibleZones();
      return json(200, { reward: toPublicReward(result, zones) });
    } catch (err) {
      console.error('CHESS_REWARDS_SELECT_ERROR', err instanceof Error ? err.message.slice(0, 200) : 'unknown');
      return json(503, { error: 'Could not select a zone' });
    }
  }

  if (action === 'redeem') {
    try {
      const result = await redeemZone(rewardId, guestDbId, zoneKey);
      if (!result.ok) return json(409, { error: result.error });
      const zones = await getEligibleZones();
      return json(200, { reward: toPublicReward(result.reward, zones) });
    } catch (err) {
      console.error('CHESS_REWARDS_REDEEM_ERROR', err instanceof Error ? err.message.slice(0, 200) : 'unknown');
      return json(503, { error: 'Could not redeem this reward' });
    }
  }

  return json(400, { error: 'Unknown or missing action' });
};
