// Local preview of the actual website and canonical chat handler. Backend
// data stays in memory; --ai optionally enables paid OpenAI requests only.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { withHarness, defaultCatalog } from '../tests/helpers/canonical-core-harness';
import { handler as chatHandler } from '../netlify/functions/thongthai-chat';
import { handler as menuHandler } from '../netlify/functions/restaurant-menu';
import { handler as memoryHandler } from '../netlify/functions/customer-memory';
import { createPreviewFetch } from './_preview-fetch';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const kkuEnabled=process.argv.includes('--kku');
const aiEnabled=process.argv.includes('--ai') || kkuEnabled;
const providerName=kkuEnabled?'KKU IntelSphere':'OpenAI';
const apiKey=(kkuEnabled?process.env.KKU_API_KEY:process.env.OPENAI_API_KEY)?.trim();
const networkFetch=global.fetch;
const port = Number(process.env.THONGTHAI_PREVIEW_PORT || (aiEnabled?4174:4173));
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid preview port');
const contentTypes: Record<string,string> = {
  '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg',
  '.jpeg':'image/jpeg','.gif':'image/gif','.woff2':'font/woff2','.ico':'image/x-icon',
};
const banner = `<aside id="local-preview-banner" style="position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#fff2c9;color:#38291b;padding:8px 12px;text-align:center;font:13px/1.5 sans-serif">ทดลองในเครื่อง · เมนูจำลอง · ${aiEnabled?`เปิด ${providerName} จริง ใช้โควตา API`:'ไม่เรียก AI'} · ไม่ส่งรายการจริง <a href="/preview-info" style="color:inherit;text-decoration:underline">ดูข้อมูลทดลอง</a></aside>`;

function json(response:ServerResponse,status:number,body:unknown) {
  response.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});
  response.end(JSON.stringify(body));
}

async function requestBody(request:IncomingMessage):Promise<string> {
  const chunks:Buffer[]=[];
  let size=0;
  for await (const chunk of request) {
    const bytes=Buffer.from(chunk);
    size+=bytes.length;
    if(size>128*1024) throw new Error('Request body too large');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function start() {
  if(aiEnabled && !apiKey)throw new Error(`ใส่ ${kkuEnabled?'KKU_API_KEY':'OPENAI_API_KEY'} ใน .env.local ก่อนเปิดโหมด AI`);
  await withHarness(async harness => {
    // Never use a real key accidentally inherited from the terminal.
    if(aiEnabled)process.env.OPENAI_API_KEY=kkuEnabled?'kku-preview-transport':apiKey;
    else delete process.env.OPENAI_API_KEY;
    process.env.THONGTHAI_VISITOR_UNDERSTANDING ??= '1';
    process.env.THONGTHAI_LOCAL_PREVIEW='1';
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    delete process.env.THONGTHAI_TEST_BYPASS_COST_CAP;
    delete process.env.THONGTHAI_SEMANTIC_CERTIFICATION_MODE;
    const webSearchEnabled=process.env.THONGTHAI_VISITOR_WEB_SEARCH==='1' && !!process.env.TAVILY_API_KEY?.trim();
    global.fetch=createPreviewFetch({aiEnabled,webSearchEnabled,mockFetch:harness.fetchMock,networkFetch,...(kkuEnabled?{kku:{apiKey:apiKey!}}:{})});
    const server=createServer(async(request,response)=>{
      response.setHeader('Cache-Control','no-store');
      response.setHeader('X-Content-Type-Options','nosniff');
      response.setHeader('Content-Security-Policy',"connect-src 'self'; form-action 'self'");
      try {
        const url=new URL(request.url || '/',`http://127.0.0.1:${port}`);
        if(url.pathname==='/preview-info') {
          json(response,200,{
            mode:aiEnabled?'local-ai-with-fixtures':'offline-local-preview',realChatCode:true,realBackend:false,paidModel:aiEnabled,
            provider:aiEnabled?providerName:null,
            visitorUnderstanding:process.env.THONGTHAI_VISITOR_UNDERSTANDING==='1',
            webSearch:webSearchEnabled?'tavily':'not_configured',
            costAccounting:kkuEnabled?'token usage from KKU; THB estimates use application pricing, not verified KKU billing':'application pricing',
            model:aiEnabled?(process.env.THONGTHAI_SEMANTIC_MODEL || 'gpt-5.6-terra'):null,
            menu:defaultCatalog().restaurantMenu.map(item=>({name:item.name,price:item.selling_price})),
            note:'เมนูและข้อมูลทั้งหมดเป็นชุดจำลอง เก็บในหน่วยความจำและหายเมื่อปิด server ไม่ใช่ราคา สต๊อก หรือผลการจองจริง',
          });
          return;
        }
        const handlers:Record<string,typeof chatHandler>={
          '/.netlify/functions/thongthai-chat':chatHandler,
          '/.netlify/functions/restaurant-menu':menuHandler,
          '/.netlify/functions/customer-memory':memoryHandler,
        };
        const handler=handlers[url.pathname];
        if(handler) {
          let body=await requestBody(request);
          if(url.pathname.endsWith('/thongthai-chat')) {
            const input=JSON.parse(body || '{}');
            body=JSON.stringify({...input,environment:'test',pageContext:{section:'web'}});
          }
          const result=await handler({
            httpMethod:request.method,headers:{'x-request-id':randomUUID()},body,
            queryStringParameters:Object.fromEntries(url.searchParams),
          } as any,{} as any,()=>{});
          if(!result) { json(response,500,{error:'preview_handler_empty'}); return; }
          response.writeHead(result.statusCode,result.headers as Record<string,string>);
          response.end(result.body);
          return;
        }
        if(url.pathname.startsWith('/.netlify/')) {
          json(response,503,{error:'not_available_in_offline_preview'});
          return;
        }
        if(request.method!=='GET' && request.method!=='HEAD') {json(response,405,{error:'method_not_allowed'});return;}
        const path=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
        const allowed=path.startsWith('/assets/') || /^\/(?:index|menu|chess|otop|otop-map|account)\.html$/u.test(path);
        if(!allowed || path.split('/').some(segment=>segment.startsWith('.'))) {json(response,404,{error:'not_found'});return;}
        const file=await realpath(resolve(root,'.'+path));
        if(!file.startsWith(root+sep) || !(await stat(file)).isFile()) {json(response,404,{error:'not_found'});return;}
        const type=contentTypes[extname(file)];
        if(!type) {json(response,404,{error:'not_found'});return;}
        let content=await readFile(file);
        if(extname(file)==='.html') {
          const html=content.toString('utf8').replace(/<body\b[^>]*>/u,match=>match+banner);
          content=Buffer.from(html);
        }
        response.writeHead(200,{'Content-Type':type});
        response.end(request.method==='HEAD'?undefined:content);
      } catch(error) {
        if(!response.headersSent)json(response,error instanceof SyntaxError?400:404,{error:'preview_request_failed'});
        else response.end();
      }
    });
    await new Promise<void>((resolveStarted,reject)=>{
      server.once('error',reject);
      server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolveStarted();});
    });
    console.log(`Thongthai ${aiEnabled?'AI':'offline'} preview: http://127.0.0.1:${port}`);
    console.log(aiEnabled?`${providerName} enabled: API quota/charges apply. Backend data is simulated; no production writes.`:'Uses fixture data and the edited chat code. No AI calls or production writes.');
    await new Promise<void>(resolveClosed=>{
      server.once('close',resolveClosed);
      for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>server.close());
    });
  });
}

start().catch(error=>{
  console.error(error instanceof Error?error.message:'Preview startup failed');
  process.exitCode=1;
});
