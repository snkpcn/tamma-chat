import { writeFile } from 'node:fs/promises';
import {
  runSemanticCertification,
  type SemanticCertificationFailure,
} from '../netlify/functions/_semantic-live-certification';
import { SEMANTIC_INTERPRETER_VERSION } from '../netlify/functions/_semantic-interpreter';

const OUTPUT='semantic-certification-result.json';

async function main() {
  if (process.env.RUN_SEMANTIC_CERTIFICATION !== '1') {
    console.log('LIVE_SEMANTIC_CERTIFICATION_SKIPPED');
    return;
  }

  const chunkSize=10;
  const parallelBatches=4;

  try {
    const first=await runSemanticCertification({profile:'full',start:0,limit:chunkSize});
    const starts:number[]=[];
    for(let start=chunkSize; start<first.totalCorpusCases; start+=chunkSize) starts.push(start);

    const batches=[first];
    for(let i=0;i<starts.length;i+=parallelBatches){
      const group=starts.slice(i,i+parallelBatches);
      const results=await Promise.all(
        group.map(start=>runSemanticCertification({profile:'full',start,limit:chunkSize})),
      );
      batches.push(...results);
    }

    const evaluated=batches.reduce((sum,batch)=>sum+batch.evaluated,0);
    const pass=batches.reduce((sum,batch)=>sum+batch.pass,0);
    const failures:SemanticCertificationFailure[]=batches.flatMap(batch=>batch.failures);
    const failed=failures.length;

    const artifact={
      kind:'LIVE_MODEL_SEMANTIC_CERTIFICATION',
      status:'completed',
      semanticVersion:SEMANTIC_INTERPRETER_VERSION,
      generatedAt:new Date().toISOString(),
      totalCorpusCases:first.totalCorpusCases,
      evaluated,
      pass,
      failed,
      passPct:evaluated?Number((pass/evaluated*100).toFixed(2)):0,
      failures,
    };

    await writeFile(OUTPUT,JSON.stringify(artifact,null,2),'utf8');
    console.log('LIVE_SEMANTIC_CERTIFICATION_WRITTEN',JSON.stringify({
      evaluated,pass,failed,passPct:artifact.passPct,
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
