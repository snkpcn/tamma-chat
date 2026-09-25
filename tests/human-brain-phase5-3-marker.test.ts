import { test } from 'node:test';
import assert from 'node:assert/strict';
import { semanticCertificationMarkerNames } from '../scripts/_semantic-certification-markers';

test('semantic certification marker names expose only bounded machine metadata',()=>{
  const names=semanticCertificationMarkerNames({
    evaluated:159,pass:148,failed:11,passPct:93.08,
    failures:[{
      id:'restaurant-table-availability-01',
      actual:{
        domain:'restaurant',
        action:'status',
        informationNeed:'availability',
        needsClarification:false,
        confidence:0.96,
      },
    }],
  });
  assert.equal(names[0],'semcert-s-p148-f11-t159-r9308');
  assert.match(names[1]!,/^semcert-f01-[a-z0-9-]+-dres-astat-navai-c0-q96$/);
  assert.ok(names.every(name=>name.length<64));
  assert.doesNotMatch(names.join(' '),/โต๊ะ|พรุ่งนี้|18:00/u);
});
