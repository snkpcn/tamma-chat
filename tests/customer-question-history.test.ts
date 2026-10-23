import test,{afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {persistCustomerQuestion,redactCustomerQuestion,pruneCustomerQuestions} from '../netlify/functions/_customer-question-store';
import {withTurnWrites} from '../netlify/functions/_turn-writes';
import {processThongthaiChatCore} from '../netlify/functions/thongthai-chat';
import {brainRequest,guestId,withHarness} from './helpers/canonical-core-harness';
const originalFetch=globalThis.fetch,originalEnv={...process.env};
afterEach(()=>{globalThis.fetch=originalFetch;process.env={...originalEnv}});
const question={conversationId:'guest-1',eventId:'message-1',channel:'web',message:'เปิดกี่โมง โทร 0812345678 email me@example.com'};
function configure(){process.env.SUPABASE_URL='https://db.invalid/';process.env.SUPABASE_SERVICE_ROLE_KEY='fixture'}
test('redacts contact details and common secrets while retaining the question',()=>{
  const redacted=redactCustomerQuestion('เปิดกี่โมง 0812345678 +66812345678 me@example.com รหัสผ่าน=abc123 api_key=secretvalue Bearer eyJ123.abc.def sk-abcdefghijklmno เลขบัตร 1234567890123');
  assert.match(redacted,/เปิดกี่โมง/);
  for(const secret of ['0812345678','66812345678','me@example.com','abc123','secretvalue','eyJ123','sk-abcdefghijklmno','1234567890123'])assert.ok(!redacted.includes(secret),secret);
});
test('writes only a redacted question and duplicate delivery cannot extend retention',async()=>{
  configure();const requests:any[]=[];
  globalThis.fetch=async(url,init)=>{requests.push({url:String(url),init});return new Response(null,{status:201})};
  await withTurnWrites(async()=>{await persistCustomerQuestion(question)},()=>1000);
  const {url,init}=requests[0],body=JSON.parse(init.body);
  assert.match(url,/on_conflict=channel,event_id,environment/);
  assert.equal(init.headers.Prefer,'resolution=ignore-duplicates,return=minimal');
  assert.equal(body.conversation_id,'guest-1');assert.equal(body.event_id,'message-1');
  assert.match(body.question_text,/\[phone\]/);assert.doesNotMatch(body.question_text,/0812345678|me@example/);
  assert.equal('expires_at' in body,false);assert.equal('occurred_at' in body,false);
  assert.equal('assistant_message' in body,false);
});
test('Unicode truncation never splits a surrogate pair and is marked',async()=>{
  configure();let body:any;
  globalThis.fetch=async(_url,init)=>{body=JSON.parse(String(init?.body));return new Response(null,{status:201})};
  await persistCustomerQuestion({...question,message:'ก'.repeat(3999)+'😀extra'});
  assert.equal([...body.question_text].length,4000);assert.ok(body.question_text.endsWith('😀'));assert.equal(body.text_truncated,true);
});
test('missing configuration, empty questions, and failed writes never fail the customer turn',async()=>{
  delete process.env.SUPABASE_URL;delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  globalThis.fetch=async()=>{throw Error('network unavailable')};
  await persistCustomerQuestion(question);configure();await persistCustomerQuestion({...question,message:' '});
  await assert.doesNotReject(persistCustomerQuestion(question));
});
test('cleanup deletes only expired history and reports database failure',async()=>{
  configure();let request:any;
  globalThis.fetch=async(url,init)=>{request={url:String(url),init};return new Response(null,{status:204})};
  assert.equal(await pruneCustomerQuestions(new Date('2026-10-24T00:00:00Z')),true);
  const url=new URL(request.url);assert.equal(url.searchParams.get('expires_at'),'lte.2026-10-24T00:00:00.000Z');
  assert.equal(request.init.method,'DELETE');
  globalThis.fetch=async()=>new Response(null,{status:503});assert.equal(await pruneCustomerQuestions(),false);
});
for(const channel of ['web','line'] as const)test(`${channel} shared core records the original question before semantic rewrites`,async()=>{
  await withHarness(async harness=>{
    const original=harness.fetchMock,recorded:any[]=[];
    globalThis.fetch=(async(url,init={})=>{
      if(String(url).includes('/rest/v1/customer_question_history')){
        recorded.push(JSON.parse(String(init.body)));return new Response(null,{status:201});
      }
      return original(url,init);
    }) as typeof fetch;
    const result=await processThongthaiChatCore(brainRequest('เปิดกี่โมง',guestId('question-'+channel),channel),'question-'+channel);
    assert.equal(result.statusCode,200);assert.equal(recorded.length,1);
    assert.equal(recorded[0].question_text,'เปิดกี่โมง');assert.equal(recorded[0].event_id,'question-'+channel);
    assert.equal(recorded[0].channel,channel);
  });
});
