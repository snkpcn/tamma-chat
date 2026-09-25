import type { SemanticCertificationFailure } from '../netlify/functions/_semantic-live-certification';

export type PriorCertificationArtifact = {
  kind:string;
  status:string;
  contractHash?:string;
  generatedAt?:string;
  totalCorpusCases:number;
  evaluated:number;
  semanticEvaluated:number;
  pass:number;
  semanticFailed:number;
  providerFailed:number;
  failures:SemanticCertificationFailure[];
};

export type ResumableCertificationState = {
  start:number;
  totalCorpusCases:number;
  pass:number;
  semanticFailed:number;
  failures:SemanticCertificationFailure[];
  generatedAt?:string;
};

export function resumableCertificationState(
  prior:PriorCertificationArtifact,
  contractHash:string,
):ResumableCertificationState|null{
  if(prior.kind!=='LIVE_MODEL_SEMANTIC_CERTIFICATION') return null;
  if(prior.status!=='incomplete_provider') return null;
  if(prior.contractHash!==contractHash) return null;
  if(!Number.isInteger(prior.totalCorpusCases) || prior.totalCorpusCases<=0) return null;
  if(!Number.isInteger(prior.semanticEvaluated) || prior.semanticEvaluated<0) return null;
  if(prior.semanticEvaluated>=prior.totalCorpusCases) return null;
  if(prior.providerFailed!==1) return null;
  if(prior.evaluated!==prior.semanticEvaluated+prior.providerFailed) return null;
  if(prior.semanticEvaluated!==prior.pass+prior.semanticFailed) return null;

  const semanticFailures=(prior.failures ?? []).filter(failure=>!failure.providerError);
  if(semanticFailures.length!==prior.semanticFailed) return null;

  return {
    start:prior.semanticEvaluated,
    totalCorpusCases:prior.totalCorpusCases,
    pass:prior.pass,
    semanticFailed:prior.semanticFailed,
    failures:semanticFailures,
    ...(prior.generatedAt ? {generatedAt:prior.generatedAt} : {}),
  };
}
