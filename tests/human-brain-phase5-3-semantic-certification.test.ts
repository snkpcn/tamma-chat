import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSemanticCertification } from '../netlify/functions/_semantic-live-certification';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';

test('Phase 5.3 semantic certification helper is stateless and supports injected model interpretation', async () => {
  const turn: SemanticTurn = {
    domain:'ecosystem',
    intent:'broad_experience_discovery',
    action:'discover',
    informationNeed:'none',
    entities:{},
    references:[],
    constraints:[],
    confidence:0.95,
    needsClarification:false,
  };

  const result = await runSemanticCertification({
    profile:'full',
    start:0,
    limit:1,
    interpret:async () => turn,
  });

  assert.equal(result.evaluated,1);
  assert.equal(result.pass,1);
  assert.equal(result.failed,0);
});

test('Phase 5.3 full certification corpus is large enough to be meaningful', async () => {
  const result = await runSemanticCertification({
    profile:'full',
    start:0,
    limit:1,
    interpret:async () => ({
      domain:'ecosystem',
      intent:'broad_experience_discovery',
      action:'discover',
      informationNeed:'none',
      entities:{},
      references:[],
      constraints:[],
      confidence:0.95,
      needsClarification:false,
    }),
  });
  assert.ok(result.totalCorpusCases >= 140);
});
