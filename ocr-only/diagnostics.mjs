// HTTP status alone is not evidence that a particular key is invalid.
export function terminalHttpReason(status) {
  return ({400:'REQUEST_REJECTED',401:'AUTHENTICATION_REJECTED',403:'ACCESS_REJECTED',
    404:'MODEL_NOT_FOUND',429:'RATE_LIMITED'})[status]
    ||(status>=500?'PROVIDER_SERVER_ERROR':status>=300?'HTTP_REJECTED':null);
}

export function safeResult(result) {
  const statuses=['PASS','CHECKS_FAILED','PROVIDER_FAILED','REQUEST_REJECTED',
    'AUTHENTICATION_REJECTED','ACCESS_REJECTED','NETWORK_BLOCKED','REQUEST_LIMIT_REACHED',
    'TRANSPORT_FAILED','MODEL_NOT_FOUND','RATE_LIMITED','PROVIDER_SERVER_ERROR','HTTP_REJECTED'];
  if(!statuses.includes(result.status)||!Number.isInteger(result.providerRequests)
    ||result.providerRequests<0||result.providerRequests>1) throw new Error('Invalid result');
  const extracted=['PASS','CHECKS_FAILED'].includes(result.status);
  const keys=['amount','date','reference','bottomNote','singleSlip'];
  if(extracted&&keys.some(k=>typeof result.checks?.[k]!=='boolean'))throw new Error('Missing checks');
  return {ocrOnly:true,status:result.status,providerRequests:result.providerRequests,
    providerReason:PROVIDER_REASONS.has(result.providerReason)?result.providerReason:null,
    validation:extracted?'COMPLETED':'NOT_RUN',
    checks:Object.fromEntries(keys.map(k=>[k,extracted?result.checks[k]:null])),
    httpStatuses:(Array.isArray(result.httpStatuses)?result.httpStatuses:[])
      .filter(n=>Number.isInteger(n)&&n>=100&&n<=599).slice(0,1)};
}

// Fixed enums only. Never emit messages, metadata, request IDs, or raw bodies.
const PROVIDER_REASONS=new Set(['API_KEY_INVALID','API_KEY_EXPIRED','API_KEY_SERVICE_BLOCKED',
  'API_KEY_HTTP_REFERRER_BLOCKED','API_KEY_IP_ADDRESS_BLOCKED','SERVICE_DISABLED',
  'BILLING_DISABLED','CONSUMER_INVALID','RATE_LIMIT_EXCEEDED','QUOTA_EXCEEDED']);
export async function readProviderReason(response) {
  const reader=response.body?.getReader?.();
  if(!reader)return null;
  try {
    const chunks=[];let size=0;
    while(true){
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;if(size>65536)return null;
      chunks.push(Buffer.from(value));
    }
    const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const details=data?.error?.details;
    if(!Array.isArray(details))return null;
    return details.find(d=>d?.['@type']==='type.googleapis.com/google.rpc.ErrorInfo'
      &&d.domain==='googleapis.com'&&PROVIDER_REASONS.has(d.reason))?.reason||null;
  }catch{return null;}
  finally{try{await reader.cancel();}catch{}reader.releaseLock();}
}
