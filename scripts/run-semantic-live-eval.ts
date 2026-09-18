// Phase L live semantic conformance runner.
// NOT part of npm test / normal CI. Run only in an acceptance environment with
// real provider credentials before Phase O.
//
// Usage:
//   npm run eval:semantic:live
// Optional:
//   LIVE_EVAL_LIMIT=20 LIVE_EVAL_MIN_PASS_PCT=95 npm run eval:semantic:live

import { interpretSemanticTurn, emptySemanticContext } from '../netlify/functions/_semantic-interpreter';
import { SEMANTIC_EVAL_CORPUS } from '../tests/fixtures/semantic-eval-corpus';
import { PHASE_L_SEMANTIC_CASES } from '../tests/fixtures/phase-l-semantic-cases';

const all=[...SEMANTIC_EVAL_CORPUS,...PHASE_L_SEMANTIC_CASES];
const limitRaw=Number(process.env.LIVE_EVAL_LIMIT||all.length);
const limit=Number.isFinite(limitRaw)?Math.max(1,Math.min(all.length,Math.floor(limitRaw))):all.length;
const minPctRaw=Number(process.env.LIVE_EVAL_MIN_PASS_PCT||95);
const minPct=Number.isFinite(minPctRaw)?Math.max(0,Math.min(100,minPctRaw)):95;

if(!process.env.GEMINI_API_KEY&&!process.env.OPENAI_API_KEY){
  console.error('LIVE_SEMANTIC_EVAL_NOT_RUN: GEMINI_API_KEY or OPENAI_API_KEY is required.');
  process.exitCode=2;
}else{
  let pass=0;
  let failed=0;
  const failures:Array<{id:string;expected:string;actual:string;message:string}>=[];
  const selected=all.slice(0,limit);

  for(const evalCase of selected){
    try{
      const turn=await interpretSemanticTurn(evalCase.message,evalCase.context??emptySemanticContext());
      const domainOk=turn.domain===evalCase.expected.domain;
      const actionOk=evalCase.expected.action===undefined||turn.action===evalCase.expected.action;
      const clarificationOk=evalCase.expected.needsClarification===undefined
        || turn.needsClarification===evalCase.expected.needsClarification;
      if(domainOk&&actionOk&&clarificationOk){
        pass+=1;
      }else{
        failed+=1;
        failures.push({
          id:evalCase.id,
          expected:`${evalCase.expected.domain}/${evalCase.expected.action??'*'}/clarify=${evalCase.expected.needsClarification??'*'}`,
          actual:`${turn.domain}/${turn.action}/clarify=${turn.needsClarification}`,
          message:evalCase.message,
        });
      }
    }catch(error){
      failed+=1;
      failures.push({
        id:evalCase.id,
        expected:`${evalCase.expected.domain}/${evalCase.expected.action??'*'}`,
        actual:'ERROR',
        message:error instanceof Error?error.message.slice(0,160):'unknown',
      });
    }
  }

  const pct=selected.length?pass/selected.length*100:0;
  console.log(JSON.stringify({
    kind:'LIVE_MODEL_SEMANTIC_CONFORMANCE',
    total:selected.length,
    pass,
    failed,
    passPct:Number(pct.toFixed(2)),
    requiredPct:minPct,
    failures:failures.slice(0,50),
  },null,2));

  if(pct<minPct)process.exitCode=1;
}
