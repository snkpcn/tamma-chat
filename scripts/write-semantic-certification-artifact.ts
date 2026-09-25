import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import {
  runSemanticCertification,
  type SemanticCertificationFailure,
} from '../netlify/functions/_semantic-live-certification';
import { SEMANTIC_INTERPRETER_VERSION } from '../netlify/functions/_semantic-interpreter';

const OUTPUT='semantic-certification-result.json';

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
  const availabilityRetryDelayMs=61_000;

  try {
    const batches=[];
    let start=0;
    let totalCorpusCases:number|null=null;

    while(totalCorpusCases===null || start<totalCorpusCases){
      const batch=await runSemanticCertification({
        profile:'full',
        start,
        limit:chunkSize,
        availabilityRetries:1,
        availabilityRetryDelayMs,
        stopOnProviderFailure:true,
      });
      batches.push(batch);
      totalCorpusCases=batch.totalCorpusCases;

      if(batch.evaluated<=0) break;
      start += batch.evaluated;

      if(batch.providerFailed>0){
        console.error('LIVE_SEMANTIC_CERTIFICATION_PROVIDER_BLOCK',JSON.stringify({
          start:batch.start,
          evaluated:batch.evaluated,
          providerFailed:batch.providerFailed,
        }));
        break;
      }
    }

    const evaluated=batches.reduce((sum,batch)=>sum+batch.evaluated,0);
    const semanticEvaluated=batches.reduce((sum,batch)=>sum+batch.semanticEvaluated,0);
    const pass=batches.reduce((sum,batch)=>sum+batch.pass,0);
    const semanticFailed=batches.reduce((sum,batch)=>sum+batch.semanticFailed,0);
    const providerFailed=batches.reduce((sum,batch)=>sum+batch.providerFailed,0);
    const failures:SemanticCertificationFailure[]=batches.flatMap(batch=>batch.failures);
    const failed=failures.length;
    const availabilityComplete=
      providerFailed===0
      && totalCorpusCases!==null
      && evaluated===totalCorpusCases;
    const status=availabilityComplete?'completed':'incomplete_provider';

    const artifact={
      kind:'LIVE_MODEL_SEMANTIC_CERTIFICATION',
      status,
      semanticVersion:SEMANTIC_INTERPRETER_VERSION,
      generatedAt:new Date().toISOString(),
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
