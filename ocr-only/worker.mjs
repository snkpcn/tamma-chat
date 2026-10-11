import {readFileSync} from 'node:fs';
export function guardedFetch(realFetch, stats) {
  return async(input, init={})=>{
    if(stats.halted) throw new Error('blocked');
    const url=new URL(String(input));
    if(url.origin!=='https://generativelanguage.googleapis.com'||url.username||url.password||url.search||url.hash
      ||!/^\/v1beta\/models\/gemini-3\.[56]-flash:generateContent$/.test(url.pathname)
      ||init.method!=='POST'||stats.calls>=2){stats.halted=true;stats.reason='NETWORK_BLOCKED';throw new Error('blocked');}
    stats.calls++;
    const response=await realFetch(url,{...init,redirect:'error'});
    stats.httpStatuses.push(response.status);
    // Authentication or invalid-key errors stop even the extractor's model fallback.
    if([400,401,403].includes(response.status)){stats.halted=true;stats.reason='KEY_REJECTED';}
    return response;
  };
}
export function checksFor(extraction) {
  const note=extraction.visible_payment_note||'';
  return {amount:extraction.amount_total===1000,date:extraction.document_date_local==='2026-10-11',
    reference:extraction.reference_number==='TEST-ONLY-0001',
    bottomNote:note.includes('ค่าอุปกรณ์ไฟฟ้า')&&/ตำมา[\s-]*ชาติ/.test(note)&&/งวด\s*2/.test(note),
    singleSlip:extraction.payment_document_count===1};
}
if(process.argv[1]===new URL(import.meta.url).pathname){
  const stats={calls:0,httpStatuses:[],halted:false,reason:null};
  let result;
  globalThis.fetch=guardedFetch(globalThis.fetch,stats);
  console.log=console.error=console.warn=console.info=console.debug=()=>{};
  try {
    const {extractFinancialEvidence}=await import('./extractor.mjs');
    const bytes=Buffer.from(readFileSync(new URL('./synthetic-slip.base64',import.meta.url),'utf8'),'base64');
    const extraction=await extractFinancialEvidence(bytes,'image/png');
    const checks=checksFor(extraction);
    result={status:Object.values(checks).every(Boolean)?'PASS':'CHECKS_FAILED',checks};
  }catch{result={status:stats.reason||'PROVIDER_FAILED'};}
  process.stdout.write(JSON.stringify({...result,providerRequests:stats.calls,httpStatuses:stats.httpStatuses}));
  process.exitCode=result.status==='PASS'?0:1;
}
