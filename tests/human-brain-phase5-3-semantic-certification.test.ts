import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../netlify/functions/thongthai-semantic-certification';
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

test('Phase 5.3 diagnostic endpoint is hidden when token is absent or wrong', async () => {
  const previous = process.env.THONGTHAI_SEMANTIC_CERT_TOKEN;
  process.env.THONGTHAI_SEMANTIC_CERT_TOKEN='expected-token';
  try {
    const missing = await handler({
      httpMethod:'GET',
      queryStringParameters:{},
    } as any, {} as any);
    assert.equal(missing?.statusCode,404);

    const wrong = await handler({
      httpMethod:'GET',
      queryStringParameters:{token:'wrong-token'},
    } as any, {} as any);
    assert.equal(wrong?.statusCode,404);
  } finally {
    if (previous === undefined) delete process.env.THONGTHAI_SEMANTIC_CERT_TOKEN;
    else process.env.THONGTHAI_SEMANTIC_CERT_TOKEN=previous;
  }
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
