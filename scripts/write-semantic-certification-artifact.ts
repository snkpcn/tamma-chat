import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import {
  runSemanticCertification,
  type SemanticCertificationFailure,
} from '../netlify/functions/_semantic-live-certification';
import { SEMANTIC_INTERPRETER_VERSION } from '../netlify/functions/_semantic-interpreter';

const OUTPUT='semantic-certification-result.json';
const PRODUCTION_CERT_URL='https://tamma-chat.netlify.app/semantic-certification-result.json';

type ResumeArtifact = {
  kind?: string;
  status?: string;
  semanticVersion?: string;
  totalCorpusCases?: number;
  semanticEvaluated?: number;
  pass?: number;
  semanticFailed?: number;
  providerFailed?: number;
  failures?: SemanticCertificationFailure[];
  resumeStart?: number;
  availabilityComplete?: boolean;
};

type ResumeBase = {
  start: number;
  totalCorpusCases: number;
  semanticEvaluated: number;
  pass: number;
  semanticFailed: number;
  failures: SemanticCertificationFailure[];
};

async function loadResumeBase(): Promise<ResumeBase|null> {
  if (process.env.SEMANTIC_CERT_DISABLE_RESUME === '1') return null;
  try {
    const response=await fetch(PRODUCTION_CERT_URL,{
      headers:{'cache-control':'no-cache'},
    });
    if(!response.ok) return null;
    const artifact=await response.json() as ResumeArtifact;
    if(
      artifact.kind!=='LIVE_MODEL_SEMANTIC_CERTIFICATION'
      || artifact.semanticVersion!==SEMANTIC_INTERPRETER_VERSION
      || artifact.status!=='incomplete_provider'
      || artifact.availabilityComplete===true
      || typeof artifact.resumeStart!=='number'
      || artifact.resumeStart<=0
      || typeof artifact.totalCorpusCases!=='number'
      || artifact.resumeStart>=artifact.totalCorpusCases
      || typeof artifact.semanticEvaluated!=='number'
      || typeof artifact.pass!=='number'
      || typeof artifact.semanticFailed!=='number'
      || !Array.isArray(artifact.failures)
    ){
      return null;
    }

    const semanticFailures=artifact.failures.filter(failure=>!failure.providerError);
    console.log('LIVE_SEMANTIC_CERTIFICATION_RESUME',JSON.stringify({
      semanticVersion:artifact.semanticVersion,
      resumeStart:artifact.resumeStart,
      semanticEvaluated:artifact.semanticEvaluated,
      pass:artifact.pass,
      semanticFailed:artifact.semanticFailed,
    }));

    return {
      start:artifact.resumeStart,
      totalCorpusCases:artifact.totalCorpusCases,
      semanticEvaluated:artifact.semanticEvaluated,
      pass:artifact.pass,
      semanticFailed:artifact.semanticFailed,
      failures:semanticFailures,
    };
  } catch {
    return null;
  }
}

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
  // Live evidence reached project quota after a short burst. Gemini rate
  // limits are project-scoped and vary by model/tier, so the cert runner keeps
  // deliberate headroom instead of assuming fallback model IDs provide fresh
  // project RPM. Override only for controlled certification runs.
  // Semantic-v6 production evidence hit the shared free-project quota at
  // exactly 10 successful cases with the old 4.25s cadence. Keep deliberate
  // headroom below ~10 RPM so certification observes semantics instead of
  // manufacturing 429s. Runtime customer traffic is unaffected.
  const configuredInterCaseDelayMs=Number(process.env.SEMANTIC_CERT_INTER_CASE_DELAY_MS ?? '6500');
  const interCaseDelayMs=Number.isFinite(configuredInterCaseDelayMs)
    ? Math.max(0,Math.min(15_000,Math.floor(configuredInterCaseDelayMs)))
    : 6_500;

  try {
    const resumeBase=await loadResumeBase();
    const batches=[];
    const initialStart=resumeBase?.start ?? 0;
    let start=initialStart;
    let totalCorpusCases:number|null=resumeBase?.totalCorpusCases ?? null;

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

    const newSemanticEvaluated=batches.reduce((sum,batch)=>sum+batch.semanticEvaluated,0);
    const newPass=batches.reduce((sum,batch)=>sum+batch.pass,0);
    const newSemanticFailed=batches.reduce((sum,batch)=>sum+batch.semanticFailed,0);
    const providerFailed=batches.reduce((sum,batch)=>sum+batch.providerFailed,0);

    const semanticEvaluated=(resumeBase?.semanticEvaluated ?? 0)+newSemanticEvaluated;
    const pass=(resumeBase?.pass ?? 0)+newPass;
    const semanticFailed=(resumeBase?.semanticFailed ?? 0)+newSemanticFailed;
    const failures:SemanticCertificationFailure[]=[
      ...(resumeBase?.failures ?? []),
      ...batches.flatMap(batch=>batch.failures),
    ];

    // A provider-failed case is intentionally NOT part of the durable prefix.
    // Resume from the next not-yet-semantically-evaluated corpus index, not
    // from raw evaluated count (which includes the provider failure itself).
    const resumeStart=initialStart+newSemanticEvaluated;
    const evaluated=semanticEvaluated+providerFailed;
    const failed=failures.length;
    const availabilityComplete=
      providerFailed===0
      && totalCorpusCases!==null
      && semanticEvaluated===totalCorpusCases;
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
      resumeStart:availabilityComplete ? (totalCorpusCases ?? semanticEvaluated) : resumeStart,
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
      resumeStart:artifact.resumeStart,
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
