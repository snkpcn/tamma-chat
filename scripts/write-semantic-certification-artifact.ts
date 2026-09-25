import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import {
  runSemanticCertification,
  type SemanticCertificationFailure,
} from '../netlify/functions/_semantic-live-certification';
import { SEMANTIC_INTERPRETER_VERSION } from '../netlify/functions/_semantic-interpreter';
import {
  resumableCertificationState,
  type PriorCertificationArtifact,
} from './_semantic-certification-resume';

const OUTPUT='semantic-certification-result.json';
const PRIOR_PRODUCTION_ARTIFACT='https://tamma-chat.netlify.app/semantic-certification-result.json';
const CONTRACT_FILES=[
  'netlify/functions/_semantic-interpreter.ts',
  'netlify/functions/_semantic-live-certification.ts',
  'tests/fixtures/semantic-eval-corpus.ts',
  'tests/fixtures/phase-l-semantic-cases.ts',
] as const;

function currentCommitMessage(): string {
  try {
    return execFileSync('git',['log','-1','--pretty=%B'],{
      encoding:'utf8',
      stdio:['ignore','pipe','ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function certificationContractHash():string{
  const hash=createHash('sha256');
  for(const path of CONTRACT_FILES){
    hash.update(path);
    hash.update('\0');
    hash.update(readFileSync(path));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0,16);
}

async function loadPriorState(contractHash:string){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),5_000);
  try{
    const response=await fetch(PRIOR_PRODUCTION_ARTIFACT,{
      signal:controller.signal,
      headers:{accept:'application/json'},
    });
    if(!response.ok) return null;
    const prior=await response.json() as PriorCertificationArtifact;
    return resumableCertificationState(prior,contractHash);
  }catch{
    return null;
  }finally{
    clearTimeout(timeout);
  }
}

async function main() {
  const isProductionMain =
    process.env.CONTEXT === 'production'
    && process.env.BRANCH === 'main';
  const commitMessage=currentCommitMessage();
  const explicitOneShot=
    process.env.RUN_SEMANTIC_CERTIFICATION === '1'
    || commitMessage.includes('[semantic-cert]');

  if (!explicitOneShot || !isProductionMain) {
    console.log('LIVE_SEMANTIC_CERTIFICATION_SKIPPED', JSON.stringify({
      enabled: explicitOneShot,
      context: process.env.CONTEXT ?? null,
      branch: process.env.BRANCH ?? null,
    }));
    return;
  }

  const chunkSize=20;
  // Free-tier limits are project-scoped and can be lower than a bursty serial
  // loop. Keep the evaluator observational and deliberately pace successful
  // calls; runtime customer traffic is NOT delayed by this build-only setting.
  const interCaseDelayMs=2_000;
  const availabilityRetryDelayMs=61_000;
  const contractHash=certificationContractHash();

  try {
    const prior=await loadPriorState(contractHash);
    const batches=[];
    let start=prior?.start ?? 0;
    let totalCorpusCases:number|null=prior?.totalCorpusCases ?? null;

    while(totalCorpusCases===null || start<totalCorpusCases){
      const batch=await runSemanticCertification({
        profile:'full',
        start,
        limit:chunkSize,
        availabilityRetries:1,
        availabilityRetryDelayMs,
        stopOnProviderFailure:true,
        interCaseDelayMs,
      });
      batches.push(batch);
      totalCorpusCases=batch.totalCorpusCases;

      if(batch.evaluated<=0) break;
      start += batch.semanticEvaluated;

      if(batch.providerFailed>0){
        console.error('LIVE_SEMANTIC_CERTIFICATION_PROVIDER_BLOCK',JSON.stringify({
          start:batch.start,
          evaluated:batch.evaluated,
          semanticEvaluated:batch.semanticEvaluated,
          providerFailed:batch.providerFailed,
        }));
        break;
      }
    }

    const carriedPass=prior?.pass ?? 0;
    const carriedSemanticFailed=prior?.semanticFailed ?? 0;
    const carriedFailures=prior?.failures ?? [];

    const batchSemanticEvaluated=batches.reduce((sum,batch)=>sum+batch.semanticEvaluated,0);
    const semanticEvaluated=(prior?.start ?? 0)+batchSemanticEvaluated;
    const pass=carriedPass+batches.reduce((sum,batch)=>sum+batch.pass,0);
    const semanticFailed=carriedSemanticFailed+batches.reduce((sum,batch)=>sum+batch.semanticFailed,0);
    const providerFailed=batches.reduce((sum,batch)=>sum+batch.providerFailed,0);
    const failures:SemanticCertificationFailure[]=[
      ...carriedFailures,
      ...batches.flatMap(batch=>batch.failures),
    ];
    const failed=failures.length;
    const evaluated=semanticEvaluated+providerFailed;
    const availabilityComplete=
      providerFailed===0
      && totalCorpusCases!==null
      && semanticEvaluated===totalCorpusCases;
    const status=availabilityComplete?'completed':'incomplete_provider';

    const artifact={
      kind:'LIVE_MODEL_SEMANTIC_CERTIFICATION',
      status,
      semanticVersion:SEMANTIC_INTERPRETER_VERSION,
      contractHash,
      generatedAt:new Date().toISOString(),
      resumedFrom:prior?.generatedAt ?? null,
      resumeStart:prior?.start ?? 0,
      totalCorpusCases:totalCorpusCases ?? 0,
      evaluated,
      semanticEvaluated,
      pass,
      failed,
      semanticFailed,
      providerFailed,
      passPct:semanticEvaluated?Number((pass/semanticEvaluated*100).toFixed(2)):0,
      availabilityComplete,
      failures,
    };

    await writeFile(OUTPUT,JSON.stringify(artifact,null,2),'utf8');
    console.log('LIVE_SEMANTIC_CERTIFICATION_WRITTEN',JSON.stringify({
      status,
      contractHash,
      resumedFrom:artifact.resumedFrom,
      resumeStart:artifact.resumeStart,
      evaluated,
      semanticEvaluated,
      pass,
      semanticFailed,
      providerFailed,
      passPct:artifact.passPct,
      availabilityComplete,
    }));
  } catch (error) {
    const artifact={
      kind:'LIVE_MODEL_SEMANTIC_CERTIFICATION',
      status:'error',
      semanticVersion:SEMANTIC_INTERPRETER_VERSION,
      contractHash,
      generatedAt:new Date().toISOString(),
      error:error instanceof Error ? error.name : 'unknown',
    };
    await writeFile(OUTPUT,JSON.stringify(artifact,null,2),'utf8');
    console.error('LIVE_SEMANTIC_CERTIFICATION_ERROR',artifact.error);
    // Baseline collection must never take production down. A later checkpoint
    // may promote a proven threshold into a build gate.
  }
}

main().catch(error => {
  console.error(
    'LIVE_SEMANTIC_CERTIFICATION_FATAL',
    error instanceof Error ? error.name : 'unknown',
  );
  process.exitCode=1;
});
