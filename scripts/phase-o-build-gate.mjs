import { spawnSync } from 'node:child_process';

if(process.env.THONGTHAI_RUN_LIVE_EVAL_ON_BUILD!=='1'){
  console.log('PHASE_O_LIVE_EVAL_GATE_SKIPPED');
  process.exit(0);
}

console.log('PHASE_O_LIVE_EVAL_GATE_START');
const result=spawnSync(
  process.platform==='win32'?'npx.cmd':'npx',
  ['tsx','scripts/run-semantic-live-eval.ts'],
  {
    stdio:'inherit',
    env:{
      ...process.env,
      LIVE_EVAL_PROFILE:process.env.LIVE_EVAL_PROFILE||'production-smoke',
      LIVE_EVAL_MIN_PASS_PCT:process.env.LIVE_EVAL_MIN_PASS_PCT||'90',
    },
  },
);
if(result.error) throw result.error;
if((result.status??1)!==0){
  console.error('PHASE_O_LIVE_EVAL_GATE_FAILED',result.status);
  process.exit(result.status??1);
}
console.log('PHASE_O_LIVE_EVAL_GATE_PASSED');
