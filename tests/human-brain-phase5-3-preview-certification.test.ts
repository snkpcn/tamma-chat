import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  handler,
  isDeployPreviewHost,
} from '../netlify/functions/thongthai-semantic-certification-preview';

test('Phase 5.3 preview cert host guard rejects production and spoof-like unrelated hosts',()=>{
  assert.equal(isDeployPreviewHost({host:'tamma-chat.netlify.app'}),false);
  assert.equal(isDeployPreviewHost({host:'example.com'}),false);
  assert.equal(isDeployPreviewHost({'x-forwarded-host':'main--tamma-chat.netlify.app'}),false);
});

test('Phase 5.3 preview cert host guard accepts only the project deploy-preview hostname shape',()=>{
  assert.equal(isDeployPreviewHost({host:'deploy-preview-122--tamma-chat.netlify.app'}),true);
  assert.equal(isDeployPreviewHost({'x-forwarded-host':'deploy-preview-999--tamma-chat.netlify.app'}),true);
  assert.equal(isDeployPreviewHost({host:'deploy-preview-122--other.netlify.app'}),false);
});

test('Phase 5.3 preview certification endpoint is invisible on production host', async()=>{
  const response=await handler({
    httpMethod:'GET',
    headers:{host:'tamma-chat.netlify.app'},
    queryStringParameters:{},
  } as any,{} as any);
  assert.equal(response?.statusCode,404);
});
