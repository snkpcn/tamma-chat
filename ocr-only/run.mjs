import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {preflight,ocrChildEnvironment} from './guard.mjs';
import {safeResult} from './diagnostics.mjs';
const report = status => console.log(JSON.stringify({ocrOnly:true,status,providerRequests:0}));
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const gate=preflight(process.env);
  console.log('OCR_ONLY_PREFLIGHT '+JSON.stringify({ocrOnly:true,...gate,providerRequests:0}));
  if(gate.status!=='READY')process.exit(1);
  try {
    const manifest=JSON.parse(readFileSync(new URL('./manifest.json',import.meta.url),'utf8'));
    const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
    if(hash(readFileSync(new URL('./extractor.mjs',import.meta.url)))!==manifest.bundleSha256
      || hash(readFileSync(new URL('../'+manifest.sourcePath,import.meta.url)))!==manifest.sourceSha256
      || hash(Buffer.from(readFileSync(new URL('./synthetic-slip.base64',import.meta.url),'utf8'),'base64'))!==manifest.fixtureSha256) throw new Error();
    writeFileSync(new URL('./.provider-run-started',import.meta.url),'single approved invocation',{flag:'wx'});
    // No database, LINE, OpenAI, proxy, diagnostic, or Netlify credentials reach OCR.
    const child=spawnSync(process.execPath,[new URL('./worker.mjs',import.meta.url).pathname],{
      env:ocrChildEnvironment(process.env),encoding:'utf8',timeout:45000,maxBuffer:8192,
    });
    // The worker exports only fixed booleans, bounded counters, and enum statuses.
    // Never relay raw stdout/stderr or exception/provider strings.
    const result=JSON.parse(child.stdout);
    const safe=safeResult(result);
    console.log('OCR_ONLY_RESULT '+JSON.stringify(safe));
    if(child.status!==0||safe.status!=='PASS'){process.exitCode=1;}
    else {
      mkdirSync(new URL('./public',import.meta.url),{recursive:true});
      writeFileSync(new URL('./public/index.html',import.meta.url),'<!doctype html><meta charset="utf-8"><title>Synthetic OCR check</title><p>Synthetic OCR check passed. No API endpoints are published.</p>');
    }
  } catch {report('BLOCKED_HARNESS');process.exitCode=1;}
}
