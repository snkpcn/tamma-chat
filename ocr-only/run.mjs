import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const report = status => console.log(JSON.stringify({ocrOnly:true,status,providerRequests:0}));
export function preflight(env) {
  if (env.CONTEXT !== 'deploy-preview' || env.BRANCH !== 'codex/ocr-only-preview-once'
      || env.SITE_ID !== '8c1f4d60-68c9-4940-9152-89e9c967e22c' || env.NETLIFY !== 'true') return 'BLOCKED_CONTEXT';
  if (Object.entries(env).some(([key,value]) => value && (
    /^(LINE_|OPENAI_API_KEY$|DATABASE_URL$|POSTGRES_URL$|PGPASSWORD$)/.test(key)
    || (/^SUPABASE_/.test(key) && key !== 'SUPABASE_URL')))) return 'BLOCKED_CREDENTIALS';
  if (!env.GEMINI_API_KEY) return 'BLOCKED_MISSING_GEMINI';
  return null;
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const blocked=preflight(process.env);
  if(blocked){report(blocked);process.exit(1);}
  try {
    const manifest=JSON.parse(readFileSync(new URL('./manifest.json',import.meta.url),'utf8'));
    const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
    if(hash(readFileSync(new URL('./extractor.mjs',import.meta.url)))!==manifest.bundleSha256
      || hash(readFileSync(new URL('../'+manifest.sourcePath,import.meta.url)))!==manifest.sourceSha256
      || hash(Buffer.from(readFileSync(new URL('./synthetic-slip.base64',import.meta.url),'utf8'),'base64'))!==manifest.fixtureSha256) throw new Error();
    writeFileSync(new URL('./.provider-run-started',import.meta.url),'single approved invocation',{flag:'wx'});
    // No database, LINE, OpenAI, proxy, diagnostic, or Netlify credentials reach OCR.
    const child=spawnSync(process.execPath,[new URL('./worker.mjs',import.meta.url).pathname],{
      env:{GEMINI_API_KEY:process.env.GEMINI_API_KEY},encoding:'utf8',timeout:45000,maxBuffer:8192,
    });
    // The worker exports only fixed booleans, bounded counters, and enum statuses.
    // Never relay raw stdout/stderr or exception/provider strings.
    const result=JSON.parse(child.stdout);
    const statuses=['PASS','CHECKS_FAILED','PROVIDER_FAILED','KEY_REJECTED','NETWORK_BLOCKED'];
    if(!statuses.includes(result.status)||!Number.isInteger(result.providerRequests)
      ||result.providerRequests<0||result.providerRequests>2) throw new Error();
    const safe={ocrOnly:true,status:result.status,providerRequests:result.providerRequests,
      checks:Object.fromEntries(['amount','date','reference','bottomNote','singleSlip'].map(k=>[k,result.checks?.[k]===true])),
      httpStatuses:(result.httpStatuses||[]).filter(n=>Number.isInteger(n)&&n>=100&&n<=599).slice(0,2)};
    console.log('OCR_ONLY_RESULT '+JSON.stringify(safe));
    if(child.status!==0||safe.status!=='PASS'){process.exitCode=1;}
    else {
      mkdirSync(new URL('./public',import.meta.url),{recursive:true});
      writeFileSync(new URL('./public/index.html',import.meta.url),'<!doctype html><meta charset="utf-8"><title>Synthetic OCR check</title><p>Synthetic OCR check passed. No API endpoints are published.</p>');
    }
  } catch {report('BLOCKED_HARNESS');process.exitCode=1;}
}
