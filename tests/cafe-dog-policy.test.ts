import test from 'node:test';
import assert from 'node:assert/strict';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { buildRealKnowledgeSourceAdapters } from '../netlify/functions/_dialog-source-adapters';
import { resolveKnowledge } from '../netlify/functions/_knowledge-resolver';
import { deriveDeterministicSemanticTurn } from '../netlify/functions/_deterministic-semantic-turn';
import { emptySemanticContext } from '../netlify/functions/_semantic-interpreter';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';
import { withHarness,guestId,brainRequest } from './helpers/canonical-core-harness';

function checkPolicy(text:string) {
  assert.match(text,/พาน้องหมา.*อินทนิล.*ตาดโตน.*ได้ครับ/);
  assert.match(text,/Outdoor.*แคมป์ปิ้ง/);
  assert.match(text,/ไม่นำเข้า.*ห้องแอร์.*พื้นที่ปิด/);
  assert.match(text,/สายจูงตลอดเวลา.*ม้า.*ลูกค้าคนอื่น/);
  assert.match(text,/ถุงเก็บขับถ่าย.*ทำความสะอาด/);
  assert.doesNotMatch(text,/ยังไม่มีข้อมูลยืนยัน|เข้าได้ทุกพื้นที่|เข้าที่พักได้|500/);
}
for(const channel of ['web','line'] as const) {
  test(`${channel}: dog access uses complete scoped policy without model calls`,async()=>{
    await withHarness(async harness=>{
      const result=await processThongthaiChatCore(brainRequest('พาหมาไปได้ไหม',guestId('dog-policy'),channel),'dog-policy');
      checkPolicy(String((result.payload as any).message));
      assert.equal(harness.modelCallCount(),0);
    });
  });
}
for(const domain of ['ecosystem','local','general','cafe'] as const) {
  test(`model-understood ${domain} dog policy uses confirmed outdoor scope`,async()=>{
    await withHarness(async harness=>{
      harness.programGeminiReply({domain,intent:'pet_access_policy',action:'ask',informationNeed:'policy',entities:{policyTopic:'dogs'},references:[],constraints:[],confidence:0.96,needsClarification:false});
      const result=await processThongthaiChatCore(brainRequest('สอบถามเงื่อนไขสัตว์เลี้ยงหน่อยครับ',guestId('dog-model-'+domain)),'dog-model');
      checkPolicy(String((result.payload as any).message));
      assert.equal(harness.modelCallCount(),1,'only semantic interpretation, no paid prose');
    });
  });
}

test('policy provenance is independent from profile, menu and other animal permissions',async()=>{
  const adapters=buildRealKnowledgeSourceAdapters('web');
  const request={domain:'cafe' as const,intent:'pet_access_policy',action:'ask' as const,entities:{policyTopic:'dogs'},constraints:[],needs:['stable_policy' as const]};
  const bundle=await resolveKnowledge(request,adapters);
  assert.equal(bundle.facts.length,1);
  assert.equal(bundle.facts[0].sourceId,'user_supplied_inthanin_tadtone_dog_policy_20261018');
  assert.equal(bundle.facts[0].key,'cafe_branch:dog_policy');
  for(const entities of [{policyTopic:'cats'},{policyTopic:'rabbits'},{policyTopic:'pets',species:'turtle'},{policyTopic:'dogs',accommodationName:'เฮือนสเตย์'},{policyTopic:'dogs',branchCode:'other_branch'}]) {
    assert.equal((await resolveKnowledge({...request,entities},adapters)).facts.length,0);
  }
  for(const domain of ['restaurant','stay','activity'] as const) {
    assert.equal((await resolveKnowledge({...request,domain},adapters)).facts.length,0);
  }
});
for(const message of ['พาหมาเข้าที่พักได้ไหม','พาหมาไปร้านอาหารได้ไหม','พาหมาและแมวไปได้ไหม','อินทนิลสาขาอื่นพาหมาไปได้ไหม','พาหมาไปได้ไหม เปิดกี่โมง']) {
  test(`dog shortcut does not authorize ${message}`,()=>{
    const turn=deriveDeterministicSemanticTurn(message,emptySemanticContext(),emptyTaskStateContainer());
    assert.notEqual(turn?.intent,'cafe_dog_access_policy_lookup');
  });
}
