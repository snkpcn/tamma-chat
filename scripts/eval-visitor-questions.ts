// Replay the customer-supplied acceptance corpus against the LOCAL preview.
// The banner/data mode is recorded; this does not certify live backend truth.
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { VISITOR_PARAPHRASES } from '../tests/fixtures/visitor-paraphrases';
import { VISITOR_BASIC_QUESTIONS } from '../tests/fixtures/visitor-basic-questions';

async function main() {
const origin=new URL(process.env.THONGTHAI_EVAL_ORIGIN || 'http://127.0.0.1:4174');
if(!['127.0.0.1','localhost','[::1]'].includes(origin.hostname) || origin.protocol!=='http:')throw new Error('Local preview only');
const info=await fetch(new URL('/preview-info',origin)).then(response=>response.json());
const results=[];
const continuous=process.argv.includes('--conversation');
const conversationGuest=randomUUID();
const history:Array<{role:'user'|'assistant';content:string}>=[];
const scenarios=process.argv.includes('--paraphrases')?VISITOR_PARAPHRASES.map((scenario,index)=>({id:index+1,question:scenario.question,mustMention:scenario.must})):VISITOR_BASIC_QUESTIONS;
for(const scenario of scenarios) {
  const started=Date.now();
  let answer='';let error:string|null=null;
  try {
    const response=await fetch(new URL('/.netlify/functions/thongthai-chat',origin),{
      method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(35000),
      body:JSON.stringify({guestId:continuous?conversationGuest:randomUUID(),language:'th',message:scenario.question,chatHistory:continuous?history.slice(-12):[],guestContext:{},journeyContext:{}}),
    });
    const body=await response.json();
    answer=String(body.message ?? '');
    if(!response.ok)error=`http_${response.status}`;
  } catch(caught) { error=caught instanceof Error?caught.name:'request_failed'; }
  const pass=!error && answer.includes(scenario.mustMention)
    && !/ยังตอบเรื่องนี้ให้แม่นไม่ได้|ลองอีกครั้งสักครู่|ขอรายละเอียดเพิ่มอีกนิด|บันทึกเรื่องไว้แล้ว/u.test(answer);
  results.push({...scenario,answer,error,pass,ms:Date.now()-started});
  if(continuous)history.push({role:'user',content:scenario.question},{role:'assistant',content:answer});
  console.log(`${pass?'PASS':'FAIL'} ${scenario.id}: ${scenario.question}`);
}
const output=process.env.THONGTHAI_EVAL_OUTPUT || '/private/tmp/thongthai-visitor-questions.json';
await writeFile(output,JSON.stringify({at:new Date().toISOString(),preview:info,continuous,passed:results.filter(row=>row.pass).length,total:results.length,results},null,2)+'\n');
console.log(`${results.filter(row=>row.pass).length}/${results.length}; report: ${output}`);
if(results.some(row=>!row.pass))process.exitCode=1;

}
main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;});
