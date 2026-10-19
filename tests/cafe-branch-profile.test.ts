import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveKnowledge } from '../netlify/functions/_knowledge-resolver';
import { buildRealKnowledgeSourceAdapters } from '../netlify/functions/_dialog-source-adapters';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { deriveDeterministicSemanticTurn } from '../netlify/functions/_deterministic-semantic-turn';
import { emptySemanticContext } from '../netlify/functions/_semantic-interpreter';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';
import { withHarness,guestId,brainRequest } from './helpers/canonical-core-harness';

for(const channel of ['web','line'] as const) {
  for(const [message,expected] of [
    ['อินทนิล สาขาตาดโตนเปิดกี่โมง ปิดวันไหนบ้าง',/อินทนิล สาขาตาดโตน.*ทุกวัน 06:00–18:00/],
    ['อินทนิลอยู่ที่ไหน ส่งพิกัดให้หน่อย',/ตำบลนาฝาย อำเภอเมือง จังหวัดชัยภูมิ.*\n.*มหาวิทยาลัยราชภัฏชัยภูมิ.*ซ้ายมือ/],
    ['อินทนิลบรรยากาศเป็นยังไง',/แคมป์ปิ้ง.*สวนหย่อม.*น้ำตกจำลอง/],
  ] as const) {
    test(`${channel}: branch facts answer without a model: ${message}`,async()=>{
      await withHarness(async harness=>{
        const response=await processThongthaiChatCore(brainRequest(message,guestId('branch-profile'),channel),'branch-profile');
        const text=String((response.payload as any).message);
        assert.match(text,expected);
        assert.doesNotMatch(text,/500|90 นาที|1\.30|นั่งดื่ม|maps\./);
        assert.equal(harness.modelCallCount(),0);
      });
    });
  }
}

test('branch profile never establishes price, pet rules, another branch or evening availability',async()=>{
  const adapters=buildRealKnowledgeSourceAdapters('web');
  const base={domain:'cafe' as const,action:'ask' as const,intent:'profile',entities:{branchCode:'inthanin_tadtone'},constraints:[],needs:['entity_details' as const]};
  const profile=await resolveKnowledge(base,adapters);
  assert.ok(profile.facts.length>0);
  assert.ok(profile.facts.every(f=>f.sourceId==='user_supplied_inthanin_tadtone_20261018'));
  assert.doesNotMatch(JSON.stringify(profile.facts),/500|1\.30|horse_riding|evening_social|petsAllowed/);
  const elsewhere=await resolveKnowledge({...base,entities:{branchCode:'different_branch'}},adapters);
  assert.equal(elsewhere.facts.length,0);
  const policy=await resolveKnowledge({...base,needs:['stable_policy']},adapters);
  assert.equal(policy.facts.length,0);
});
for(const message of ['อินทนิลสาขาอื่นเปิดกี่โมง','อินทนิลสาขาขอนแก่นอยู่ไหน','อินทนิลเปิดกี่โมงพรุ่งนี้','อินทนิลเปิดกี่โมงและพาหมาได้ไหม','อินทนิลขี่ม้าราคาเท่าไหร่','อินทนิลช่วยจองให้หน่อย']) {
  test(`branch facts cannot settle ${message}`,()=>{
    const turn=deriveDeterministicSemanticTurn(message,emptySemanticContext(),emptyTaskStateContainer());
    assert.ok(!['cafe_regular_hours_lookup','cafe_branch_location_lookup','cafe_branch_profile_lookup'].includes(turn?.intent ?? ''));
  });
}
