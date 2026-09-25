import { writeFile } from 'node:fs/promises';
import { SEMANTIC_INTERPRETER_VERSION } from '../netlify/functions/_semantic-interpreter';
import {
  SEMANTIC_BATCH_MODEL,
  buildGeminiSemanticBatchRequest,
  evaluateGeminiSemanticBatchOperation,
  semanticBatchName,
  semanticBatchState,
  semanticBatchSucceeded,
  semanticBatchTerminalFailure,
} from '../netlify/functions/_semantic-batch-certification';

const OUTPUT='semantic-certification-result.json';
const PUBLIC_ARTIFACT_URL='https://tamma-chat.netlify.app/semantic-certification-result.json';
const POLL_INTERVAL_MS=5_000;
const POLL_BUDGET_MS=8*60_000;
const MAX_INLINE_BATCH_BYTES=19_000_000;

function sleep(ms:number){
  return new Promise(resolve=>setTimeout(resolve,ms));
}

async function writeArtifact(body:Record<string,unknown>){
  await writeFile(OUTPUT,JSON.stringify(body,null,2),'utf8');
}

function safeMessage(value:unknown):string|null{
  return typeof value==='string'
    ? value.replace(/\s+/g,' ').trim().slice(0,240) || null
    : null;
}

async function safeHttpError(response:Response){
  let body:any=null;
  try{ body=await response.json(); }catch{}
  return {
    httpStatus:response.status,
    providerStatus:typeof body?.error?.status==='string' ? body.error.status : null,
    providerCode:body?.error?.code ?? null,
    message:safeMessage(body?.error?.message),
  };
}

async function previousPendingBatchName():Promise<string|null>{
  try{
    const response=await fetch(PUBLIC_ARTIFACT_URL+'?t='+Date.now(),{
      headers:{Accept:'application/json'},
      cache:'no-store',
    });
    if(!response.ok) return null;
    const previous=await response.json() as any;
    if(
      previous?.status==='pending'
      && previous?.transport==='gemini_batch'
      && previous?.model===SEMANTIC_BATCH_MODEL
      && previous?.semanticVersion===SEMANTIC_INTERPRETER_VERSION
      && typeof previous?.batchName==='string'
      && previous.batchName.trim()
    ){
      return previous.batchName.trim();
    }
  }catch{}
  return null;
}

async function getBatch(apiKey:string,batchName:string){
  const response=await fetch(
    'https://generativelanguage.googleapis.com/v1beta/'+batchName,
    {headers:{'x-goog-api-key':apiKey,Accept:'application/json'}},
  );
  if(!response.ok){
    throw Object.assign(new Error('Gemini batch poll failed'),{
      safe:await safeHttpError(response),
    });
  }
  return response.json();
}

async function createBatch(apiKey:string){
  const request=buildGeminiSemanticBatchRequest(
    'full',
    'thongthai-semantic-'+Date.now(),
  );
  const payload=JSON.stringify(request.body);
  const bytes=Buffer.byteLength(payload,'utf8');
  if(bytes>MAX_INLINE_BATCH_BYTES){
    throw Object.assign(new Error('Gemini batch payload too large'),{
      safe:{bytes,maxBytes:MAX_INLINE_BATCH_BYTES},
    });
  }

  const response=await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/'
      +SEMANTIC_BATCH_MODEL+':batchGenerateContent',
    {
      method:'POST',
      headers:{
        'x-goog-api-key':apiKey,
        'Content-Type':'application/json',
        Accept:'application/json',
      },
      body:payload,
    },
  );

  if(!response.ok){
    throw Object.assign(new Error('Gemini batch create failed'),{
      safe:await safeHttpError(response),
    });
  }

  const operation=await response.json();
  const batchName=semanticBatchName(operation);
  if(!batchName){
    throw Object.assign(new Error('Gemini batch create returned no batch name'),{
      safe:{state:semanticBatchState(operation)},
    });
  }
  return {operation,batchName,totalCorpusCases:request.cases.length,requestBytes:bytes};
}

async function main(){
  const isProductionMain=
    process.env.CONTEXT==='production'
    && process.env.BRANCH==='main';

  if(process.env.RUN_SEMANTIC_CERTIFICATION!=='1' || !isProductionMain){
    console.log('LIVE_SEMANTIC_CERTIFICATION_SKIPPED',JSON.stringify({
      enabled:process.env.RUN_SEMANTIC_CERTIFICATION==='1',
      context:process.env.CONTEXT ?? null,
      branch:process.env.BRANCH ?? null,
    }));
    return;
  }

  const apiKey=process.env.GEMINI_API_KEY;
  if(!apiKey){
    await writeArtifact({
      kind:'LIVE_MODEL_SEMANTIC_CERTIFICATION',
      status:'error',
      transport:'gemini_batch',
      model:SEMANTIC_BATCH_MODEL,
      semanticVersion:SEMANTIC_INTERPRETER_VERSION,
      generatedAt:new Date().toISOString(),
      error:'GEMINI_API_KEY_NOT_CONFIGURED',
    });
    return;
  }

  try{
    let batchName=await previousPendingBatchName();
    let operation:any=null;
    let totalCorpusCases:number|null=null;
    let requestBytes:number|null=null;

    if(batchName){
      console.log('LIVE_SEMANTIC_BATCH_RESUME',batchName);
      operation=await getBatch(apiKey,batchName);
    }else{
      const created=await createBatch(apiKey);
      batchName=created.batchName;
      operation=created.operation;
      totalCorpusCases=created.totalCorpusCases;
      requestBytes=created.requestBytes;
      console.log('LIVE_SEMANTIC_BATCH_CREATED',JSON.stringify({
        batchName,
        totalCorpusCases,
        requestBytes,
      }));
    }

    const deadline=Date.now()+POLL_BUDGET_MS;
    while(
      !semanticBatchSucceeded(operation)
      && !semanticBatchTerminalFailure(operation)
      && Date.now()<deadline
    ){
      await sleep(POLL_INTERVAL_MS);
      operation=await getBatch(apiKey,batchName);
      console.log('LIVE_SEMANTIC_BATCH_STATE',semanticBatchState(operation));
    }

    const state=semanticBatchState(operation);

    if(semanticBatchSucceeded(operation)){
      const evaluation=evaluateGeminiSemanticBatchOperation(operation,'full');
      const artifact={
        ...evaluation,
        status:'completed',
        semanticVersion:SEMANTIC_INTERPRETER_VERSION,
        generatedAt:new Date().toISOString(),
        batchName,
        batchState:state,
        requestBytes,
      };
      await writeArtifact(artifact);
      console.log('LIVE_SEMANTIC_CERTIFICATION_WRITTEN',JSON.stringify({
        evaluated:evaluation.evaluated,
        pass:evaluation.pass,
        semanticMismatches:evaluation.semanticMismatches,
        transportErrors:evaluation.transportErrors,
        passPct:evaluation.passPct,
      }));
      return;
    }

    if(semanticBatchTerminalFailure(operation)){
      await writeArtifact({
        kind:'LIVE_MODEL_SEMANTIC_CERTIFICATION',
        status:'error',
        transport:'gemini_batch',
        model:SEMANTIC_BATCH_MODEL,
        semanticVersion:SEMANTIC_INTERPRETER_VERSION,
        generatedAt:new Date().toISOString(),
        batchName,
        batchState:state,
        error:'GEMINI_BATCH_TERMINAL_FAILURE',
      });
      console.error('LIVE_SEMANTIC_CERTIFICATION_ERROR',state);
      return;
    }

    await writeArtifact({
      kind:'LIVE_MODEL_SEMANTIC_CERTIFICATION',
      status:'pending',
      transport:'gemini_batch',
      model:SEMANTIC_BATCH_MODEL,
      semanticVersion:SEMANTIC_INTERPRETER_VERSION,
      generatedAt:new Date().toISOString(),
      batchName,
      batchState:state,
      totalCorpusCases:totalCorpusCases
        ?? buildGeminiSemanticBatchRequest('full').cases.length,
      requestBytes,
    });
    console.log('LIVE_SEMANTIC_CERTIFICATION_PENDING',JSON.stringify({
      batchName,
      state,
    }));
  }catch(error){
    const safe=(error && typeof error==='object' && 'safe' in error)
      ? (error as any).safe
      : null;
    await writeArtifact({
      kind:'LIVE_MODEL_SEMANTIC_CERTIFICATION',
      status:'error',
      transport:'gemini_batch',
      model:SEMANTIC_BATCH_MODEL,
      semanticVersion:SEMANTIC_INTERPRETER_VERSION,
      generatedAt:new Date().toISOString(),
      error:error instanceof Error ? error.message.slice(0,160) : 'unknown',
      diagnostic:safe,
    });
    console.error(
      'LIVE_SEMANTIC_CERTIFICATION_ERROR',
      error instanceof Error ? error.name : 'unknown',
    );
    // Certification diagnostics must never take customer production down.
  }
}

main().catch(error=>{
  console.error(
    'LIVE_SEMANTIC_CERTIFICATION_FATAL',
    error instanceof Error ? error.name : 'unknown',
  );
  process.exitCode=1;
});
