process.env.THONGTHAI_SEMANTIC_CERTIFICATION_MODE='1';

import assert from 'node:assert/strict';
import {
  buildResponseComposerPrompt,
  parseComposedResponse,
  type ResponseComposerInput,
  type ResponseLanguage,
} from '../netlify/functions/_response-composer';
import { callResponseComposer } from '../netlify/functions/_thongthai-model-provider';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';

type Probe={
  id:string;
  language:ResponseLanguage;
  message:string;
  activityName:string;
  languagePattern:RegExp;
  forbidden:RegExp[];
};

const probes:Probe[]=[
  {
    id:'thai',
    language:'th',
    message:'ขี่ม้า 30 นาทีราคาเท่าไหร่ครับ',
    activityName:'ขี่ม้า',
    languagePattern:/[ก-๙]/u,
    forbidden:[/AUTHORITATIVE|sourceId|intent|domain|ระบบระบุว่า|จากข้อมูลที่มี/iu],
  },
  {
    id:'english',
    language:'en',
    message:'How much is a 30-minute horse ride?',
    activityName:'horse riding',
    languagePattern:/(?:horse|ride|baht|THB|price)/iu,
    forbidden:[/[ก-๙]/u,/AUTHORITATIVE|sourceId|intent|domain/iu],
  },
  {
    id:'chinese',
    language:'zh',
    message:'骑马30分钟多少钱？',
    activityName:'骑马',
    languagePattern:/[㐀-鿿]/u,
    forbidden:[/I can|The price|According to/iu,/AUTHORITATIVE|sourceId|intent|domain/iu],
  },
  {
    id:'lao',
    language:'lo',
    message:'ຂີ່ມ້າ 30 ນາທີ ລາຄາເທົ່າໃດ?',
    activityName:'ຂີ່ມ້າ',
    languagePattern:/[຀-໿]/u,
    forbidden:[/I can|The price|According to/iu,/AUTHORITATIVE|sourceId|intent|domain/iu],
  },
  {
    id:'vietnamese',
    language:'vi',
    message:'Cưỡi ngựa 30 phút giá bao nhiêu?',
    activityName:'cưỡi ngựa',
    languagePattern:/[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/iu,
    forbidden:[/I can|The price|According to/iu,/AUTHORITATIVE|sourceId|intent|domain/iu],
  },
];

function input(probe:Probe):ResponseComposerInput{
  const facts=[
    {
      key:'activity:horse:name',
      value:probe.activityName,
      domain:'activity',
      sourceId:'phase6-live',
      sourceType:'activity_live',
      authoritative:true,
      fetchedAt:new Date().toISOString(),
    },
    {
      key:'activity:horse:30min:price',
      value:300,
      domain:'activity',
      sourceId:'phase6-live',
      sourceType:'activity_live',
      authoritative:true,
      fetchedAt:new Date().toISOString(),
    },
  ];
  return {
    channel:'line',
    language:probe.language,
    userMessage:probe.message,
    semanticTurn:{
      semanticSource:'openai_supervisor',
      normalizedMeaning:'customer asks verified horse riding price',
      reply:'',
      speechAct:'question',
      domain:'activity',
      intent:'activity_price',
      action:'ask',
      informationNeed:'price',
      entities:{activityCode:'horse',durationMinutes:30},
      references:[],
      constraints:[],
      confidence:0.99,
      needsClarification:false,
    },
    dialogDecision:{
      mode:'query_knowledge',
      taskStateContainer:emptyTaskStateContainer(),
      knowledgeRequests:[{domain:'activity',needs:['price'],entities:{activityCode:'horse',durationMinutes:30}} as any],
      missingFields:[],
      responseIntent:'grounded_answer',
      reasons:[],
    },
    knowledgeBundles:[{
      domain:'activity',
      sources:[{need:'price',sourceId:'phase6-live',sourceType:'activity_live',status:'ok'}],
      facts,
      entities:[],
      missing:[],
      warnings:[],
      freshness:'live',
    } as any],
    degradation:{
      version:'phase6-live',
      condition:'none',
      level:'normal',
      reasonCodes:[],
      retryable:false,
      safeToExecuteTransaction:false,
      sourceStates:[],
    },
    operationalOutcome:null,
  };
}

async function main(){
  assert.ok(process.env.OPENAI_API_KEY,'OPENAI_API_KEY required');
  const results:Array<Record<string,unknown>>=[];

  for(const probe of probes){
    const composerInput=input(probe);
    const prompt=buildResponseComposerPrompt(composerInput);
    const raw=await callResponseComposer(
      prompt,
      [{role:'user',content:probe.message}],
      'phase6-live-natural-response-certification',
    );
    const parsed=parseComposedResponse(raw,composerInput);
    const response=parsed.message;
    const forbidden=probe.forbidden.filter(pattern=>pattern.test(response)).map(pattern=>pattern.source);
    const falseTransaction=/booked|reserved|confirmed|submitted|ordered|จองเรียบร้อย|ยืนยันการจองแล้ว|已预订|已确认预订|đã đặt|đã xác nhận đặt|ຈອງແລ້ວ/iu.test(response);
    const pass=
      /300/u.test(response)
      && probe.languagePattern.test(response)
      && forbidden.length===0
      && !falseTransaction
      && parsed.usedFactKeys.includes('activity:horse:30min:price')
      && parsed.usedFactKeys.every(key=>['activity:horse:name','activity:horse:30min:price'].includes(key))
      && response.length<=700;

    const row={
      id:probe.id,
      language:probe.language,
      response,
      usedFactKeys:parsed.usedFactKeys,
      forbidden,
      falseTransaction,
      pass,
    };
    results.push(row);
    console.log(JSON.stringify(row));
  }

  const failed=results.filter(row=>row.pass!==true);
  const summary={
    kind:'PHASE6_LIVE_NATURAL_RESPONSE',
    total:results.length,
    passed:results.length-failed.length,
    failed:failed.length,
    failures:failed,
  };
  console.log(JSON.stringify(summary,null,2));
  assert.equal(summary.failed,0,'Phase 6 live natural-response matrix failed');
}

main().catch(error=>{
  console.error('PHASE6_LIVE_NATURAL_RESPONSE_FAILED',error instanceof Error?error.message:String(error));
  process.exit(1);
});
