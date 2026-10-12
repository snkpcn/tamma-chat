#!/usr/bin/env python3
"""Prepared, NOT EXECUTED. Actual-writer PostgreSQL races on an authorized disposable database.
Requires preexisting anon/authenticated/service_role roles; creates no cluster roles.
Refuses remote hosts, generic database names, nonempty public schemas, and writes without opt-in.
Uses observed pg_blocking_pids, not elapsed sleeps, as evidence that operations contend.
Run build-actual-fixture.mjs first. Never supply production credentials or a port-forward.
"""
import argparse, concurrent.futures, importlib.util, json, os, re, shutil, subprocess, time
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('legacy_runner',HERE/'run-postgres-concurrency.py')
legacy=importlib.util.module_from_spec(spec);spec.loader.exec_module(legacy)
Session=legacy.Session
A,B,C=[f'00000000-0000-4000-8000-{n:012}' for n in (1,2,3)]
BRANCH='00000000-0000-4000-8000-000000000100'
E,E2,L,L2,CLAIM=[f'00000000-0000-4000-8000-{n:012}' for n in (200,201,300,301,400)]
ACTOR='a'*64

def main():
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--host',required=True);p.add_argument('--port',type=int,default=5432)
 p.add_argument('--database',required=True);p.add_argument('--user');p.add_argument('--psql',default='psql')
 p.add_argument('--allow-local-fixture-writes',action='store_true');a=p.parse_args()
 if not a.allow_local_fixture_writes:p.error('Explicit --allow-local-fixture-writes is required.')
 if a.host not in ('localhost','127.0.0.1','::1') and not (os.path.isabs(a.host) and os.path.isdir(a.host)):p.error('Only a local host or existing Unix socket is accepted.')
 if not re.fullmatch('guard_revision_test_[A-Za-z0-9_]+',a.database):p.error('Use an empty guard_revision_test_* disposable database.')
 exe=shutil.which(a.psql)
 if not exe:p.error('Existing psql required. No installation or server startup attempted.')
 command=[exe,'-X','-q','-A','-t','-w','-P','pager=off','-h',a.host,'-p',str(a.port),'-d',a.database]
 if a.user:command+=['-U',a.user]
 def scalar(sql):
  r=subprocess.run(command+['-v','ON_ERROR_STOP=1','-c',sql],capture_output=True,text=True,timeout=15)
  if r.returncode:raise RuntimeError(r.stderr)
  return r.stdout.strip()
 if scalar("select (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public')+(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')")!='0':raise SystemExit('Refusing nonempty public schema.')
 if scalar("select count(*) from pg_roles where rolname in ('anon','authenticated','service_role')")!='3':raise SystemExit('Disposable cluster must already have fixture roles; this runner creates no roles.')
 # Exact generated fixture except cluster role creation is omitted. Existing service_role
 # must have BYPASSRLS as in Supabase; no role attributes are changed here.
 if scalar("select rolbypassrls from pg_roles where rolname='service_role'")!='t':raise SystemExit('Existing disposable service_role must already have BYPASSRLS.')
 sql=(HERE/'actual-schema-fixture.sql').read_text().replace('create role anon;create role authenticated;create role service_role bypassrls;','')
 setup=subprocess.run(command+['-v','ON_ERROR_STOP=1'],input=sql,capture_output=True,text=True,timeout=60)
 if setup.returncode:raise SystemExit('Fixture setup failed: '+setup.stderr)
 if scalar("select count(*) from pg_class where relnamespace='public'::regnamespace and relname in ('financial_daily_close_effective_v1','financial_expense_claim_summary','financial_daily_expense_rollup') and reloptions @> array['security_invoker=true']")!='3':raise SystemExit('Fixture requires all three invoker views.')
 if scalar("select bool_and(has_table_privilege('service_role',oid,'SELECT') and not has_table_privilege('anon',oid,'SELECT') and not has_table_privilege('authenticated',oid,'SELECT')) from pg_class where relnamespace='public'::regnamespace and relname in ('financial_expense_claim_summary','financial_daily_expense_rollup')")!='t':raise SystemExit('Fixture requires service-only summary view reads.')
 observer=Session(command);results=[];locks=[]
 def revision(id=A):return int(observer.scalar(f"select revision from financial_daily_closes where id='{id}'"))
 def reset():
  observer.ok('truncate financial_daily_close_adjustments,financial_daily_close_evidence,financial_daily_ledger_entries,financial_expense_claims,financial_cash_custody_movements,financial_transfer_followups,financial_daily_closes,operations_business_branches cascade')
  observer.ok(f"insert into operations_business_branches(id,business_unit_code,code,name) values('{BRANCH}','inthanin','inthanin_tadtone','Synthetic cafe')")
  observer.ok(f"insert into financial_daily_closes(id,branch_id,local_date,environment,gross_sales,payment_cash,cash_opening_float,cash_counted_closing) values('{A}','{BRANCH}','2037-01-09','live',100,100,20,120),('{B}','{BRANCH}','2037-01-10','live',100,100,20,120),('{C}','{BRANCH}','2037-03-01','live',100,100,20,120)")
  observer.ok(f"insert into financial_daily_close_evidence(id,daily_close_id,evidence_type,extraction_status,extraction_confidence,match_status,extracted_data) values('{E}','{A}','pos_close','extracted',0.99,'informational','{{\"pos_net_sales\":100}}'),('{E2}','{B}','pos_close','extracted',0.99,'informational','{{\"pos_net_sales\":100}}')")
  observer.ok(f"insert into financial_daily_ledger_entries(id,daily_close_id,entry_type,accounting_role,direction,amount) values('{L}','{A}','expense','memo','noncash',10),('{L2}','{B}','expense','memo','noncash',10)")
  observer.ok(f"insert into financial_expense_claims(id,origin_daily_close_id,claim_type,approval_status,claimed_amount,approved_amount) values('{CLAIM}','{A}','employee_reimbursement','approved',10,10)")
 def card(rev,id=A,date='2037-01-09'):return f"select financial_confirm_inthanin_daily_close_card_v1('{id}','{date}',{rev},'{ACTOR}')"
 def attach(message='synthetic-slip'):return f"select financial_attach_inthanin_live_evidence_v1('{message}','{ACTOR}','2037-01-10','{message}-sha','financial-evidence','synthetic/{message}.jpg','image/jpeg','{{\"document_type\":\"transfer_slip\",\"amount_total\":10,\"confidence\":0.99,\"document_date_local\":\"2037-01-10\"}}')"
 def wait_lock(waiter,blocker):
  deadline=time.monotonic()+8
  while time.monotonic()<deadline:
   r=observer.json(f"select json_build_object('pid',pid,'wait_event_type',wait_event_type,'wait_event',wait_event,'blockers',pg_blocking_pids(pid)) from pg_stat_activity where pid={waiter.pid}")
   if r['wait_event_type']=='Lock' and blocker.pid in r['blockers']:locks.append(r);return
   time.sleep(.025)
  raise AssertionError('No observed PostgreSQL lock wait')
 def race(name,fn):
  x=y=None;start=len(locks)
  try:
   reset();x=Session(command);y=Session(command)
   x.ok('set role service_role');y.ok('set role service_role')
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:fn(x,y,pool)
   results.append({'name':name,'passed':True,'observedLocks':locks[start:]});print('PASS '+name,flush=True)
  except Exception as e:results.append({'name':name,'passed':False,'error':str(e),'observedLocks':locks[start:]});print('FAIL '+name+': '+str(e),flush=True)
  finally:
   if x:x.close()
   if y:y.close()
 mutations={
  'ledger':lambda:f"update financial_daily_ledger_entries set amount=11 where id='{L}'",
  'evidence':lambda:f"update financial_daily_close_evidence set extracted_data=extracted_data||'{{\"synthetic\":true}}'::jsonb where id='{E}'",
  'claim':lambda:f"update financial_expense_claims set claimed_amount=11 where id='{CLAIM}'",
  'parent':lambda:f"update financial_daily_closes set cup_count=11 where id='{A}'",
  'actual ingest':lambda:f"select financial_ingest_inthanin_live_text_v1('synthetic-report','{ACTOR}','2037-01-09','{{\"gross_sales\":100,\"payment_cash\":100,\"cash_opening_float\":20,\"cash_counted_closing\":120}}')",
  'actual attach informational evidence':lambda:f"select financial_attach_inthanin_live_evidence_v1('synthetic-photo','{ACTOR}','2037-01-09','synthetic-photo-sha','financial-evidence','synthetic/photo.jpg','image/jpeg','{{\"document_type\":\"stock_photo\",\"confidence\":0.99,\"document_date_local\":\"2037-01-09\"}}')",
  'actual cash sweep':lambda:f"select financial_record_cash_sweep_live_v1('{A}',10,'{ACTOR}','line')",
  'actual atomic save':lambda:f"select financial_save_inthanin_daily_close_draft_v1('{A}','2037-01-09','live',{revision()},'{{\"notes\":\"Synthetic edit\"}}','{ACTOR}')",
 }
 for name,mutation in mutations.items():
  def edit_first(x,y,pool,mutation=mutation):
   shown=revision();statement=mutation();x.ok('begin');x.ok(statement);pending=pool.submit(y.json,card(shown));wait_lock(y,x);x.ok('commit');assert pending.result(timeout=20).get('reason')=='stale_revision'
  race(name+' first makes previous card stale',edit_first)
  def confirm_first(x,y,pool,mutation=mutation,name=name):
   shown=revision();statement=mutation();x.ok('begin');assert x.json(card(shown))['confirmed'];pending=pool.submit(y.execute,statement);wait_lock(y,x);x.ok('commit');r=pending.result(timeout=20)
   if name=='actual atomic save':assert r['sqlstate']=='00000' and 'stale_revision' in r['text'],r
   else:assert r['sqlstate']=='P0001' and ('immutable' in r['text'] or 'confirmed' in r['text']),r
  race('confirmation first rejects '+name,confirm_first)
 cancel=f"update financial_expense_claims set approval_status='cancelled' where id='{CLAIM}'"
 def cancellation_first(x,y,pool):
  x.ok('begin');x.ok(cancel);pending=pool.submit(y.json,attach());wait_lock(y,x);x.ok('commit');r=pending.result(timeout=20);assert r['match_status']=='unmatched',r;assert r['match_reason']=='claim_changed_before_automatic_settlement',r
  assert observer.scalar("select count(*) from financial_daily_ledger_entries where accounting_role='cash_settlement'")=='0'
 race('cancellation first makes actual attach revalidate and retain unmatched evidence',cancellation_first)
 def settlement_first(x,y,pool):
  x.ok('begin');assert x.json(attach())['match_status']=='matched_claim';pending=pool.submit(y.ok,cancel);wait_lock(y,x);x.ok('commit');pending.result(timeout=20);assert observer.scalar(f"select approval_status from financial_expense_claims where id='{CLAIM}'")=='needs_review'
 race('actual attach first blocks cancellation and preserves needs_review',settlement_first)
 def reparent_first(x,y,pool):
  x.ok('begin');x.ok(f"update financial_expense_claims set origin_daily_close_id='{C}' where id='{CLAIM}'");pending=pool.submit(y.json,attach());wait_lock(y,x);x.ok('commit');assert pending.result(timeout=20)['match_status']=='unmatched'
 race('claim reparent first makes actual attach revalidate current origin',reparent_first)
 def attach_reparent(x,y,pool):
  x.ok('begin');assert x.json(attach())['match_status']=='matched_claim';pending=pool.submit(y.ok,f"update financial_expense_claims set origin_daily_close_id='{C}' where id='{CLAIM}'");wait_lock(y,x);x.ok('commit');pending.result(timeout=20);assert observer.scalar(f"select origin_daily_close_id from financial_expense_claims where id='{CLAIM}'")==C
 race('actual attach first serializes later claim reparent',attach_reparent)
 def double_attach(x,y,pool):
  x.ok('begin');assert x.json(attach())['match_status']=='matched_claim';pending=pool.submit(y.json,attach('synthetic-second'));wait_lock(y,x);x.ok('commit');assert pending.result(timeout=20)['match_status']=='unmatched';assert observer.scalar("select count(*) from financial_daily_ledger_entries where accounting_role='cash_settlement'")=='1'
 race('two distinct actual slips cannot double-settle one claim',double_attach)
 def pending_evidence():
  observer.ok(f"insert into financial_daily_close_evidence(daily_close_id,evidence_type,extraction_status,extraction_confidence,match_status,extracted_data,source_message_id,image_sha256) values('{B}','transfer_slip','needs_review',0.99,'unmatched','{{\"amount_total\":10,\"effective_date\":\"2037-01-10\"}}','synthetic-rematch','synthetic-rematch-sha')")
 rematch=f"select financial_rematch_inthanin_live_day_evidence_v1('{B}')"
 def cancel_rematch(x,y,pool):
  pending_evidence();x.ok('begin');x.ok(cancel);pending=pool.submit(y.json,rematch);wait_lock(y,x);x.ok('commit');assert pending.result(timeout=20)['matched_count']==0;assert observer.scalar("select match_reason from financial_daily_close_evidence where source_message_id='synthetic-rematch'")=='claim_changed_before_automatic_settlement'
 race('cancellation first makes actual rematch retain unmatched evidence',cancel_rematch)
 def rematch_before_cancel(x,y,pool):
  pending_evidence();x.ok('begin');assert x.json(rematch)['matched_count']==1;pending=pool.submit(y.ok,cancel);wait_lock(y,x);x.ok('commit');pending.result(timeout=20);assert observer.scalar(f"select approval_status from financial_expense_claims where id='{CLAIM}'")=='needs_review'
 race('actual rematch first blocks cancellation and preserves needs_review',rematch_before_cancel)
 def double_rematch(x,y,pool):
  pending_evidence();x.ok('begin');assert x.json(rematch)['matched_count']==1;pending=pool.submit(y.json,rematch);wait_lock(y,x);x.ok('commit');assert pending.result(timeout=20)['matched_count']==0;assert observer.scalar("select match_status from financial_daily_close_evidence where source_message_id='synthetic-rematch'")=='matched_claim'
 race('repeated actual rematch rechecks locked evidence and retains first match',double_rematch)
 def origin_first(x,y,pool):
  shown=revision();x.ok('begin');assert x.json(card(shown))['confirmed'];pending=pool.submit(y.json,attach());wait_lock(y,x);x.ok('commit');assert pending.result(timeout=20)['match_status']=='matched_claim';assert revision()==shown+1
 race('confirmed origin still permits later legitimate automatic reimbursement',origin_first)
 def rollback(x,y,pool):
  shown=revision();x.ok('begin');x.ok(mutations['ledger']());pending=pool.submit(y.json,card(shown));wait_lock(y,x);x.ok('rollback');assert pending.result(timeout=20)['confirmed'];assert revision()==shown+1
 race('rolled-back writer leaves original card valid',rollback)
 def opposite(x,y,pool):
  ar,br=revision(A),revision(B);x.ok('begin');x.ok(f"update financial_daily_ledger_entries set daily_close_id='{B}' where id='{L}'");pending=pool.submit(y.ok,f"update financial_daily_ledger_entries set daily_close_id='{A}' where id='{L2}'");wait_lock(y,x);x.ok('commit');pending.result(timeout=20);assert revision(A)==ar+2 and revision(B)==br+2
 race('opposite child reparent operations retain both parent revisions',opposite)
 def rematch_origin_first(x,y,pool):
  pending_evidence();shown=revision();x.ok('begin');assert x.json(rematch)['matched_count']==1;pending=pool.submit(y.json,card(shown));wait_lock(y,x);x.ok('commit');assert pending.result(timeout=20).get('reason')=='stale_revision'
 race('actual rematch first invalidates origin confirmation',rematch_origin_first)
 def confirm_before_rematch(x,y,pool):
  pending_evidence();shown=revision();x.ok('begin');assert x.json(card(shown))['confirmed'];pending=pool.submit(y.json,rematch);wait_lock(y,x);x.ok('commit');assert pending.result(timeout=20)['matched_count']==1;assert revision()==shown+1
 race('origin confirmation first permits actual later rematch',confirm_before_rematch)
 def double_save(x,y,pool):
  statement=mutations['actual atomic save']();x.ok('begin');assert x.json(statement)['saved'];pending=pool.submit(y.json,statement);wait_lock(y,x);x.ok('commit');assert pending.result(timeout=20).get('reason')=='stale_revision'
 race('two atomic saves with identical expected revision cannot overwrite each other',double_save)
 def amount_first(x,y,pool):
  x.ok('begin');x.ok(f"update financial_expense_claims set approved_amount=12 where id='{CLAIM}'");pending=pool.submit(y.json,attach());wait_lock(y,x);x.ok('commit');assert pending.result(timeout=20)['match_status']=='unmatched'
 race('claim amount change first makes actual attach revalidate outstanding amount',amount_first)
 def prepare_dedupe():
  observer.ok(f"update financial_daily_ledger_entries set entry_type='purchase',accounting_role='economic_event',source_message_id='synthetic-dedupe-report',source_item_key='expense:1' where id='{L}'")
  observer.ok(f"insert into financial_daily_ledger_entries(daily_close_id,entry_type,accounting_role,direction,amount,category,source_message_id,source_item_key,metadata) values('{A}','vendor_payment','economic_event','outflow',10,'other','synthetic-dedupe-transfer','transfer_purpose','{{\"transfer_followup_id\":\"synthetic\"}}')")
 dedupe=f"select financial_dedupe_transfer_followup_expenses_v1('{A}')"
 def dedupe_first(x,y,pool):
  prepare_dedupe();shown=revision();x.ok('begin');assert x.json(dedupe)['deduped_count']==1;pending=pool.submit(y.json,card(shown));wait_lock(y,x);x.ok('commit');assert pending.result(timeout=20).get('reason')=='stale_revision'
 race('actual dedupe first invalidates confirmation',dedupe_first)
 def confirm_before_dedupe(x,y,pool):
  prepare_dedupe();shown=revision();x.ok('begin');assert x.json(card(shown))['confirmed'];pending=pool.submit(y.execute,dedupe);wait_lock(y,x);x.ok('commit');r=pending.result(timeout=20);assert r['sqlstate']=='P0001' and 'immutable' in r['text'],r
 race('confirmation first rolls back competing actual dedupe',confirm_before_dedupe)
 def rollback_attach(x,y,pool):
  shown=revision();x.ok('begin');assert x.json(attach())['match_status']=='matched_claim';pending=pool.submit(y.json,card(shown));wait_lock(y,x);x.ok('rollback');assert pending.result(timeout=20)['confirmed'];assert observer.scalar("select count(*) from financial_daily_ledger_entries where accounting_role='cash_settlement'")=='0'
 race('rolled-back actual attach restores both settlement and origin revision',rollback_attach)
 def deadlock(x,y,pool):
  ar,br=revision(A),revision(B);x.ok('begin');y.ok('begin');x.ok(f"select id from financial_daily_closes where id='{A}' for update");y.ok(f"select id from financial_daily_closes where id='{B}' for update")
  xp=pool.submit(x.execute,f"insert into financial_daily_ledger_entries(daily_close_id,entry_type,accounting_role,amount,source_message_id) values('{B}','other','memo',1,'synthetic-deadlock-x')");wait_lock(x,y)
  yp=pool.submit(y.execute,f"insert into financial_daily_ledger_entries(daily_close_id,entry_type,accounting_role,amount,source_message_id) values('{A}','other','memo',1,'synthetic-deadlock-y')")
  xr,yr=xp.result(timeout=20),yp.result(timeout=20);assert sorted([xr['sqlstate'],yr['sqlstate']])==['00000','40P01'],(xr,yr)
  x.ok('commit' if xr['sqlstate']=='00000' else 'rollback');y.ok('commit' if yr['sqlstate']=='00000' else 'rollback')
  assert observer.scalar("select count(*) from financial_daily_ledger_entries where source_message_id like 'synthetic-deadlock-%'")=='1';assert revision(A)+revision(B)==ar+br+1
 race('opposite externally held parent locks safely abort one entire deadlocked transaction',deadlock)
 observer.close();(HERE/'actual-postgres-concurrency-results.json').write_text(json.dumps({'writerRole':'service_role','viewSecurity':'security_invoker with service-only summary reads','sources':json.loads((HERE/'actual-schema-sources.json').read_text()),'results':results},indent=2)+'\n')
 print(f"{sum(r['passed'] for r in results)}/{len(results)} passed")
 if not all(r['passed'] for r in results):raise SystemExit(1)
if __name__=='__main__':main()
