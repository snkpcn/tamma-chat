import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveSemanticMeaning } from '../netlify/functions/_semantic-meaning';
import {
  deriveCanonicalKnowledgeScope,
  filterFactsByCanonicalScope,
  resolveCanonicalScopeAgainstFacts,
} from '../netlify/functions/_canonical-knowledge-scope';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';

function turn(entities:Record<string, unknown>, action:SemanticTurn['action']='discover'):SemanticTurn {
  return { domain:'stay', intent:'holdout_stay', action, informationNeed:'catalog', entities, references:[], constraints:[], confidence:.91, needsClarification:false };
}
const facts = [
  { key:'stay:baan-a:name', value:'บ้านลมเย็น' },
  { key:'stay:baan-a:bedrooms', value:1 },
  { key:'stay:baan-a:capacity', value:2 },
  { key:'stay:baan-b:name', value:'บ้านชมดาว' },
  { key:'stay:baan-b:bedrooms', value:2 },
  { key:'stay:baan-b:capacity', value:5 },
  { key:'stay:new-loft:name', value:'ลอฟต์ทดลอง' },
  { key:'stay:new-loft:roomType', value:'loft' },
  { key:'availability:baan-a:2026-10-10T14:00:00+07:00:available', value:true },
  { key:'availability:baan-b:2026-10-10T14:00:00+07:00:available', value:true },
];

test('Stay focused bedroom scope filters contaminated cross-type catalog and availability facts', () => {
  const scope=deriveCanonicalKnowledgeScope(deriveSemanticMeaning(turn({bedrooms:1})));
  assert.equal(scope.status,'resolved');
  const keys=filterFactsByCanonicalScope(facts,scope).map(f=>f.key);
  assert.ok(keys.every(key=>!key.includes('baan-b') && !key.includes('new-loft')));
  assert.ok(keys.some(key=>key.includes('baan-a:name')));
  assert.ok(keys.some(key=>key.startsWith('availability:baan-a:')));
});

test('specific Stay entity and named entity resolve through canonical live relationships', () => {
  const direct=deriveCanonicalKnowledgeScope(deriveSemanticMeaning(turn({resourceCode:'baan-b'},'ask')));
  assert.deepEqual(direct.canonicalEntityIds,['stay:baan-b']);
  const directKeys=filterFactsByCanonicalScope(facts,resolveCanonicalScopeAgainstFacts(direct,facts)).map(f=>f.key);
  assert.ok(directKeys.every(key=>!key.includes('baan-a') && !key.includes('new-loft')));

  const named=deriveCanonicalKnowledgeScope(deriveSemanticMeaning(turn({accommodationName:'บ้านลมเย็น'},'ask')));
  const resolved=resolveCanonicalScopeAgainstFacts(named,facts);
  assert.equal(resolved.status,'resolved');
  assert.deepEqual(resolved.canonicalEntityIds,['stay:baan-a']);
});

test('focused unresolved Stay fails closed; domain-wide stays broad; unseen type needs no renderer keyword', () => {
  const missing=deriveCanonicalKnowledgeScope(deriveSemanticMeaning(turn({accommodationName:'บ้านที่ยังไม่อยู่ในระบบ'},'ask')));
  assert.deepEqual(filterFactsByCanonicalScope(facts,resolveCanonicalScopeAgainstFacts(missing,facts)),[]);
  const broad=deriveCanonicalKnowledgeScope(deriveSemanticMeaning(turn({},'discover')));
  assert.equal(filterFactsByCanonicalScope(facts,broad).length,facts.length);
  const unseen=deriveCanonicalKnowledgeScope(deriveSemanticMeaning(turn({roomType:'loft'},'discover')));
  const unseenKeys=filterFactsByCanonicalScope(facts,unseen).map(f=>f.key);
  assert.ok(unseenKeys.some(key=>key.includes('new-loft:name')));
  assert.ok(unseenKeys.every(key=>!key.includes('baan-a') && !key.includes('baan-b')));
});
