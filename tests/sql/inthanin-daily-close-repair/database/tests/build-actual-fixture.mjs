import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
const repository=path.resolve(here,'../../../../..');
const migrations=path.join(repository,'supabase/migrations');
export function buildActualFixture(){
 const entries=[];
 const proposal=fs.readFileSync(path.join(repository,'supabase/proposals/inthanin_daily_close_revision_repair_v1.sql'),'utf8');
 for(const name of ['guard-repair','financial_attach_inthanin_live_evidence_v1','financial_rematch_inthanin_live_day_evidence_v1','save-draft']){if(!proposal.includes(fs.readFileSync(path.join(root,'database',name+'.sql'),'utf8').trim()))throw new Error('Proposal/source mismatch: '+name);}

 const add=(file,transform)=>{let raw=fs.readFileSync(file,'utf8');const selected=transform?transform(raw):raw; const sql=selected.replace(/^(\$(?:function)?\$)\s*$/gm,'$1;');entries.push({path:path.relative(root,file),sha256:createHash('sha256').update(raw).digest('hex'),loadedSha256:createHash('sha256').update(sql).digest('hex'),transformation:(transform?'Omit unrelated owner-payroll section; ':'')+'Normalize missing terminator after function dollar quote (body unchanged)',sql});};
 const prefix=`-- Disposable PGlite fixture only. No production connection.\ncreate role anon;create role authenticated;create role service_role bypassrls;\ngrant usage on schema public to anon,authenticated,service_role;\nalter default privileges in schema public grant all on tables to anon,authenticated,service_role;\n-- Only unrelated foundational dependencies below are minimal fixture tables.\ncreate table public.operations_business_units(code text primary key,name text);\ninsert into public.operations_business_units values('inthanin','Synthetic cafe');\ncreate schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);\n`;
 for(const file of fs.readdirSync(migrations).filter(f=>/^20261002.*_financial_/.test(f)).sort()){
  if(file.startsWith('20261002141000'))continue; // unrelated employee payroll guard
  if(file.startsWith('20261002134500'))add(path.join(migrations,file),s=>s.split('-- Salary/payroll evidence')[0]);
  else add(path.join(migrations,file));
 }
 for(const name of ['financial_reconcile_daily_close_v1','financial_confirm_inthanin_live_daily_close_v1','financial_ingest_inthanin_live_text_v1','financial_record_cash_sweep_live_v1','financial_dedupe_transfer_followup_expenses_v1'])add(path.join(root,'deployment-preflight',name+'.sql'));
 add(path.join(root,'deployment-preflight/remote-wrapper.sql'));
 for(const name of ['guard-repair','financial_attach_inthanin_live_evidence_v1','financial_rematch_inthanin_live_day_evidence_v1','save-draft'])add(path.join(root,'database',name+'.sql'));
 const sql=prefix+entries.map(e=>'\n-- SOURCE '+e.path+'\n'+e.sql+'\n;\n').join('');
 return {sql,entries:entries.map(({sql,...e})=>e)};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const f=buildActualFixture();fs.writeFileSync(path.join(here,'actual-schema-fixture.sql'),f.sql);fs.writeFileSync(path.join(here,'actual-schema-sources.json'),JSON.stringify(f.entries,null,2)+'\n');console.log(`Built ${f.entries.length} financial source sections, without a database connection.`);
}
