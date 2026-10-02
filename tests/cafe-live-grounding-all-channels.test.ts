import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Web, LINE and Facebook/Messenger all enter the same canonical Thongthai core',()=>{
  const core=readFileSync('netlify/functions/thongthai-chat.ts','utf8');
  const line=readFileSync('netlify/functions/_line-webhook-core.ts','utf8');
  const facebook=readFileSync('netlify/functions/facebook-webhook.mts','utf8');

  assert.equal(core.includes('const result = await processThongthaiChatCore(request, rawEventId ?? headerEventId);'),true);
  assert.equal(line.includes("import { processThongthaiChatCore } from './thongthai-chat';"),true);
  assert.equal(line.includes('const result = await processThongthaiChatCore({'),true);
  assert.equal(line.includes("pageContext: { section: 'line' }"),true);
  assert.equal(facebook.includes("const { processThongthaiChatCore } = await import('./thongthai-chat');"),true);
  assert.equal(facebook.includes('const result = await processThongthaiChatCore({'),true);
  assert.equal(facebook.includes("pageContext: { section: 'facebook' }"),true);
});

test('Cafe menu grounding lives in the canonical core, not in a Messenger-only adapter',()=>{
  const core=readFileSync('netlify/functions/thongthai-chat.ts','utf8');
  const facebook=readFileSync('netlify/functions/facebook-webhook.mts','utf8');
  const line=readFileSync('netlify/functions/_line-webhook-core.ts','utf8');

  assert.equal(core.includes("listCafeMasterMenu"),true);
  assert.equal(core.includes("listCafeBranchModifiers('inthanin_tadtone')"),true);
  assert.equal(core.includes('cafeGroundedAnswer'),true);
  assert.equal(core.includes('ยังไม่มีข้อมูลยืนยันเรื่องเมนู ราคา หรือสต็อกเครื่องดื่ม'),false);

  assert.equal(facebook.includes('listCafeMasterMenu'),false);
  assert.equal(line.includes('listCafeMasterMenu'),false);
});

test('Cafe fast path is channel-neutral and executes before channel presentation layers',()=>{
  const core=readFileSync('netlify/functions/thongthai-chat.ts','utf8');
  const blockStart=core.indexOf('async function deterministicCafeResponse(');
  const blockEnd=core.indexOf('function deterministicExperienceDiscoveryResponse(',blockStart);

  assert.ok(blockStart>=0 && blockEnd>blockStart);
  const cafeBlock=core.slice(blockStart,blockEnd);

  assert.equal(cafeBlock.includes('request.pageContext'),false);
  assert.equal(cafeBlock.includes("channel === 'facebook'"),false);
  assert.equal(cafeBlock.includes("channel === 'line'"),false);
  assert.equal(cafeBlock.includes("channel === 'web'"),false);
  assert.equal(cafeBlock.includes('listCafeMasterMenu()'),true);
  assert.equal(cafeBlock.includes("listCafeBranchModifiers('inthanin_tadtone')"),true);
});
