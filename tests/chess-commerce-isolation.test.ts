import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import retiredChessRewards from '../netlify/functions/chess-rewards';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('chess runtime is isolated from OTOP, discounts, coupons, and reward issuance', () => {
  const chessPage = read('chess.html');
  const chessGame = read('netlify/functions/chess-game.ts');
  const chessDb = read('netlify/functions/_chess-db.ts');

  assert.doesNotMatch(chessPage, /chess-rewards|winner\s*pass|discount|coupon|otop|ส่วนลด|คูปอง|รางวัล/iu);
  assert.doesNotMatch(chessGame, /issueRewardForWin|getEligibleZones|toPublicReward|chess_rewards|service_resources/iu);
  assert.doesNotMatch(chessDb, /chess_rewards|chess_reward_redemptions|service_resources|discount_percent/iu);
  assert.doesNotMatch(chessGame, /\breward\s*[,}]/u, 'game responses must not expose a reward payload');
});

test('account links to the standalone game without a chess commerce client', () => {
  const account = read('account.html');
  const chessSection = account.match(/<section id="play-chess"[\s\S]*?<\/section>/u)?.[0] ?? '';
  assert.ok(chessSection, 'account should retain a simple play-chess entry');
  assert.match(chessSection, /href="chess\.html"/u);
  assert.doesNotMatch(chessSection, /otop|discount|coupon|reward|ส่วนลด|คูปอง|รางวัล/iu);
  assert.doesNotMatch(account, /\.netlify\/functions\/chess-rewards|ttChessApiCall|ttLoadRewards/u);
});

test('homepage chess entry is recreational and has no commerce promise', () => {
  const home = read('index.html');
  const chessSection = home.match(/<section class="section-pad" id="chess-challenge">[\s\S]*?<\/section>/u)?.[0] ?? '';
  assert.ok(chessSection, 'homepage should retain the chess entry point');
  assert.match(chessSection, /href="chess\.html"/u);
  assert.doesNotMatch(chessSection, /winner\s*pass|otop|discount|coupon|reward|ส่วนลด|คูปอง|รางวัล/iu);

  const buildTransform = read('scripts/apply-isan-boutique-phase1.mjs');
  const generatedSection = buildTransform.match(/const chessSection = `([\s\S]*?)`;/u)?.[1] ?? '';
  assert.ok(generatedSection, 'build transform should define the chess entry point');
  assert.doesNotMatch(generatedSection, /winner\s*pass|otop|discount|coupon|reward|ส่วนลด|คูปอง|รางวัล/iu);
});

test('cached clients cannot use the retired chess reward endpoint', async () => {
  const response = await retiredChessRewards();
  assert.equal(response.status, 410);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const body = await response.json() as { error?: string };
  assert.equal(body.error, 'chess_rewards_retired');
});
