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
  const languagePacks = read('assets/scripts/first-wave-language-packs.js');
  const chessSection = home.match(/<section class="section-pad" id="chess-challenge">[\s\S]*?<\/section>/u)?.[0] ?? '';
  assert.ok(chessSection, 'homepage should retain the chess entry point');
  assert.match(chessSection, /href="chess\.html"/u);
  assert.doesNotMatch(chessSection, /winner\s*pass|otop|discount|coupon|reward|ส่วนลด|คูปอง|รางวัล/iu);

  const chessTranslationLines = [...home.matchAll(/^.*chess_card_(?:eyebrow|heading|sub|cta).*$/gmu),
    ...languagePacks.matchAll(/^.*chess_card_(?:eyebrow|heading|sub|cta).*$/gmu)]
    .map((match) => match[0])
    .join('\n');
  assert.ok(chessTranslationLines, 'translated chess card copy should be present');
  assert.doesNotMatch(
    chessTranslationLines,
    /winner\s*pass|otop|discount|coupon|reward|privilege|ส่วนลด|คูปอง|รางวัล|สิทธิ์|奖励|优惠|折扣|クーポン|割引|特典|報酬|쿠폰|할인|혜택|보상/iu,
    'no supported language may advertise commerce through chess',
  );

  const journeyRewardLines = [...home.matchAll(/^.*flow_s5_d.*$/gmu),
    ...languagePacks.matchAll(/^.*flow_s5_d.*$/gmu)]
    .map((match) => match[0])
    .join('\n');
  assert.doesNotMatch(
    journeyRewardLines,
    /เล่นหมากรุก|chess|ทองไทย|thongthai|象棋|国际象棋|チェス|통타이|체스/iu,
    'journey privileges must never be earned through chess or Thongthai',
  );

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
