import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
async function loadPGlite() {
  if (process.env.PGLITE_MODULE) return import(process.env.PGLITE_MODULE);
  try { return await import('@electric-sql/pglite'); }
  catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    return import('../../implementation/node_modules/@electric-sql/pglite/dist/index.js');
  }
}
const {PGlite} = await loadPGlite();
import {buildFixture, here} from './build-fixture.mjs';

const {sql, manifest} = buildFixture();
const db = new PGlite();
await db.exec(sql);
const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const A=uuid(1), B=uuid(2), C=uuid(3), OTHER=uuid(4), SANDBOX=uuid(5);
const BRANCH=uuid(100), OTHERBRANCH=uuid(101);
const E=uuid(200), L=uuid(300), CLAIM=uuid(400);
const actor='a'.repeat(64);
const rows=async (s,p=[]) => (await db.query(s,p)).rows;
const one=async (s,p=[]) => (await rows(s,p))[0];
const revision=async(id=A) => Number((await one('select revision from financial_daily_closes where id=$1',[id])).revision);
const closeRow=async(id=A) => one('select * from financial_daily_closes where id=$1',[id]);
const card=async(expected,id=A) => (await one('select financial_confirm_inthanin_daily_close_card_v1($1,$2,$3,$4) as r',[id,'2026-10-10',expected,actor])).r;
const canonical=async(id=A) => (await one('select financial_confirm_inthanin_live_daily_close_v1($1,$2) as r',[id,actor])).r;
async function reset() {
  await db.exec('truncate financial_daily_close_adjustments, financial_daily_close_evidence, financial_daily_ledger_entries, financial_expense_claims, financial_daily_closes, operations_business_branches cascade');
  await db.query('insert into operations_business_branches(id,code) values($1,$2),($3,$4)',[BRANCH,'inthanin_tadtone',OTHERBRANCH,'other_branch']);
  for (const [id,branch,env] of [[A,BRANCH,'live'],[B,BRANCH,'live'],[C,BRANCH,'live'],[OTHER,OTHERBRANCH,'live'],[SANDBOX,BRANCH,'sandbox']]) {
    await db.query('insert into financial_daily_closes(id,branch_id,environment) values($1,$2,$3)',[id,branch,env]);
  }
}
async function ready(id=A,evidence=E) {
  await db.query('insert into financial_daily_close_evidence(id,daily_close_id) values($1,$2)',[evidence,id]);
}
async function ledger(id=L,parent=A,extra={}) {
  await db.query(`insert into financial_daily_ledger_entries(id,daily_close_id,expense_claim_id,accounting_role,direction,metadata)
  values($1,$2,$3,$4,$5,$6)`,[id,parent,extra.claim||null,extra.role||'expense',extra.direction||'outflow',JSON.stringify(extra.metadata||{})]);
}
async function claim(parent=A,extra={}) {
  await db.query('insert into financial_expense_claims(id,origin_daily_close_id,approval_status,approved_amount) values($1,$2,$3,$4)',[CLAIM,parent,extra.status||'draft',extra.approved??null]);
}
async function rejects(s,p=[],re=/immutable/) {
  await assert.rejects(()=>db.query(s,p),re);
}
const tests=[];
const test=(name,fn) => tests.push({name,fn});

for (const [table,id,field,value] of [
  ['financial_daily_close_evidence',E,'extraction_confidence','0.98'],
  ['financial_daily_ledger_entries',L,'amount','11']]) {
  test(`${table}: insert, update, delete each increment revision once`,async()=>{
    if (id===E) await ready(); else await ledger();
    assert.equal(await revision(),2);
    await db.query(`update ${table} set ${field}=${value} where id=$1`,[id]);
    assert.equal(await revision(),3);
    await db.query(`delete from ${table} where id=$1`,[id]);
    assert.equal(await revision(),4);
  });
  test(`${table}: no-op and updated_at-only updates preserve revision`,async()=>{
    if (id===E) await ready(); else await ledger();
    const rev=await revision();
    await db.query(`update ${table} set ${field}=${field} where id=$1`,[id]);
    await db.query(`update ${table} set updated_at=now()+interval '1 hour' where id=$1`,[id]);
    assert.equal(await revision(),rev);
  });
  test(`${table}: reparent bumps both old and new parents once`,async()=>{
    if (id===E) await ready(); else await ledger();
    await db.query(`update ${table} set daily_close_id=$2 where id=$1`,[id,B]);
    assert.equal(await revision(A),3); assert.equal(await revision(B),2);
  });
  test(`${table}: reparent away from confirmed scoped parent rejects`,async()=>{
    await ready(); if (id===L) await ledger();
    assert.equal((await canonical()).confirmed,true);
    const oldRev=await revision(A), newRev=await revision(B);
    await rejects(`update ${table} set daily_close_id=$2 where id=$1`,[id,B]);
    assert.equal(await revision(A),oldRev); assert.equal(await revision(B),newRev);
    assert.equal((await one(`select daily_close_id from ${table} where id=$1`,[id])).daily_close_id,A);
  });
  test(`${table}: reparent into confirmed scoped parent rejects`,async()=>{
    if (id===E) await ready(); else await ledger();
    await ready(B,uuid(201)); await canonical(B);
    const ar=await revision(A),br=await revision(B);
    await rejects(`update ${table} set daily_close_id=$2 where id=$1`,[id,B]);
    assert.equal(await revision(A),ar); assert.equal(await revision(B),br);
  });
  test(`${table}: confirmed parent blocks inserts, edits, no-ops and deletes`,async()=>{
    await ready(); if (id===L) await ledger(); await canonical();
    const r=await revision();
    await rejects(`insert into ${table}(id,daily_close_id) values($1,$2)`,[uuid(299),A]);
    await rejects(`update ${table} set ${field}=${value} where id=$1`,[id]);
    await rejects(`update ${table} set ${field}=${field} where id=$1`,[id]);
    await rejects(`delete from ${table} where id=$1`,[id]);
    assert.equal(await revision(),r);
  });
  test(`${table}: duplicate DO NOTHING conservatively invalidates once without a new child`,async()=>{
    if (id===E) await ready(); else await ledger();
    const r=await revision();
    await db.query(`insert into ${table}(id,daily_close_id) values($1,$2) on conflict(id) do nothing`,[id,A]);
    assert.equal(await revision(),r+1);
    assert.equal(Number((await one(`select count(*) as n from ${table}`)).n),1);
  });
}
test('stale card rejects after child mutation; current card executes actual canonical confirmation',async()=>{
  await ready(); const shown=await revision();
  await db.query("update financial_daily_close_evidence set metadata='{"+'"changed":true'+"}' where id=$1",[E]);
  const r=await card(shown); assert.equal(r.reason,'stale_revision'); assert.equal(r.confirmed,false);
  assert.equal((await closeRow()).status,'draft');
  assert.equal((await card(await revision())).confirmed,true);
});
test('direct meaningful parent edits bump once; updated_at-only and no-op do not',async()=>{
  await db.query('update financial_daily_closes set cup_count=11 where id=$1',[A]);
  assert.equal(await revision(),2);
  await db.query('update financial_daily_closes set cup_count=cup_count where id=$1',[A]);
  await db.query("update financial_daily_closes set updated_at=now()+interval '1 hour' where id=$1",[A]);
  assert.equal(await revision(),2);
});
test('explicit revision increment is not doubled; larger jumps survive; decreases are prevented',async()=>{
  await db.query('update financial_daily_closes set cup_count=11,revision=revision+1 where id=$1',[A]);
  assert.equal(await revision(),2);
  await db.query('update financial_daily_closes set cup_count=12,revision=20 where id=$1',[A]);
  assert.equal(await revision(),20);
  await db.query('update financial_daily_closes set revision=1 where id=$1',[A]);
  assert.equal(await revision(),20);
  await db.query('update financial_daily_closes set cup_count=13,revision=1 where id=$1',[A]);
  assert.equal(await revision(),21);
});
test('transaction rollback restores both child and parent revision',async()=>{
  const r=await revision(); await db.exec('begin');
  await ledger(); assert.equal(await revision(),r+1); await db.exec('rollback');
  assert.equal(await revision(),r);
  assert.equal(Number((await one('select count(*) as n from financial_daily_ledger_entries')).n),0);
});
test('failed child statement rolls back its BEFORE-trigger bump',async()=>{
  await ledger(); const r=await revision();
  await rejects('insert into financial_daily_ledger_entries(id,daily_close_id) values($1,$2)',[L,A],/duplicate key/);
  assert.equal(await revision(),r);
});
test('actual reconciliation blocks canonical confirmation when POS evidence is missing',async()=>{
  const r=await card(1); assert.equal(r.confirmed,false); assert.equal(r.reason,'reconciliation_blocked');
  assert.ok(r.blockers.some(x=>x.code==='pos_evidence_missing')); assert.equal(await revision(),1);
});
test('actual canonical confirmation advances exactly once and repeated canonical call is idempotent',async()=>{
  await ready(); const before=await revision(); const r=await card(before);
  assert.equal(r.confirmed,true); assert.equal(await revision(),before+1);
  assert.equal((await closeRow()).confirmed_by_hash,actor);
  assert.equal((await canonical()).already_confirmed,true); assert.equal(await revision(),before+1);
});
test('confirmed parent blocks meaningful update, no-op and delete',async()=>{
  await ready(); await canonical(); const r=await revision();
  await rejects('update financial_daily_closes set cup_count=11 where id=$1',[A]);
  await rejects('update financial_daily_closes set cup_count=cup_count where id=$1',[A]);
  await rejects('delete from financial_daily_closes where id=$1',[A]);
  assert.equal(await revision(),r);
});
test('claim insert, meaningful update, delete advance linked revision once',async()=>{
  await claim(); assert.equal(await revision(),2);
  await db.query('update financial_expense_claims set claimed_amount=11 where id=$1',[CLAIM]); assert.equal(await revision(),3);
  await db.query('delete from financial_expense_claims where id=$1',[CLAIM]); assert.equal(await revision(),4);
});
test('claim no-op and timestamp-only edits preserve linked revision',async()=>{
  await claim(); const r=await revision();
  await db.query('update financial_expense_claims set claimed_amount=claimed_amount where id=$1',[CLAIM]);
  await db.query("update financial_expense_claims set updated_at=now()+interval '1 hour' where id=$1",[CLAIM]);
  assert.equal(await revision(),r);
});
test('claim approved UPDATE defaults amount and timestamp without double revision bump',async()=>{
  await claim(); const r=await revision();
  await db.query("update financial_expense_claims set approval_status='approved' where id=$1",[CLAIM]);
  const c=await one('select * from financial_expense_claims where id=$1',[CLAIM]);
  assert.equal(Number(c.approved_amount),10); assert.ok(c.approved_at); assert.equal(await revision(),r+1);
});
test('claim approved INSERT retains existing insert-only behavior (no approval defaults)',async()=>{
  await claim(A,{status:'approved'});
  const c=await one('select * from financial_expense_claims where id=$1',[CLAIM]);
  assert.equal(c.approved_amount,null); assert.equal(c.approved_at,null);
  await db.query('update financial_expense_claims set approval_status=approval_status where id=$1',[CLAIM]);
  assert.equal(await revision(),3); // UPDATE fills defaults, so this becomes a real mutation.
});
test('claim approval preserves explicit approved amount and timestamp',async()=>{
  await claim();
  await db.query("update financial_expense_claims set approval_status='approved',approved_amount=7,approved_at='2026-10-01T00:00:00Z' where id=$1",[CLAIM]);
  const c=await one('select * from financial_expense_claims where id=$1',[CLAIM]);
  assert.equal(Number(c.approved_amount),7); assert.equal(new Date(c.approved_at).toISOString(),'2026-10-01T00:00:00.000Z');
});
test('settled claim cancellation becomes needs_review and preserves audit metadata',async()=>{
  await claim(); await ledger(L,A,{claim:CLAIM,role:'cash_settlement'}); const r=await revision();
  await db.query("update financial_expense_claims set approval_status='cancelled' where id=$1",[CLAIM]);
  const c=await one('select * from financial_expense_claims where id=$1',[CLAIM]);
  assert.equal(c.approval_status,'needs_review'); assert.equal(c.metadata.cancel_blocked_due_cash_settlement,true); assert.ok(c.metadata.cancel_blocked_at);
  assert.equal(await revision(),r+1);
});
test('superseded or inflow settlement does not block claim cancellation',async()=>{
  await claim(); await ledger(L,A,{claim:CLAIM,role:'cash_settlement',metadata:{superseded:true}});
  await ledger(uuid(301),A,{claim:CLAIM,role:'cash_settlement',direction:'inflow'});
  await db.query("update financial_expense_claims set approval_status='cancelled' where id=$1",[CLAIM]);
  assert.equal((await one('select approval_status from financial_expense_claims where id=$1',[CLAIM])).approval_status,'cancelled');
});
test('claim reparent guards both old and new scoped parents and bumps each once',async()=>{
  await claim(); await db.query('update financial_expense_claims set origin_daily_close_id=$2 where id=$1',[CLAIM,B]);
  assert.equal(await revision(A),3); assert.equal(await revision(B),2);
});
test('claim cannot be moved away from confirmed parent',async()=>{
  await ready(); await claim(A,{status:'approved',approved:10}); await canonical();
  const ar=await revision(A),br=await revision(B);
  await rejects('update financial_expense_claims set origin_daily_close_id=$2 where id=$1',[CLAIM,B]);
  assert.equal(await revision(A),ar); assert.equal(await revision(B),br);
});
test('claim cannot be moved into confirmed parent',async()=>{
  await ready(B,uuid(201)); await canonical(B); await claim();
  const ar=await revision(A),br=await revision(B);
  await rejects('update financial_expense_claims set origin_daily_close_id=$2 where id=$1',[CLAIM,B]);
  assert.equal(await revision(A),ar); assert.equal(await revision(B),br);
});
test('confirmed parent blocks claim insert, no-op and delete',async()=>{
  await ready(); await claim(A,{status:'approved',approved:10}); await canonical();
  await rejects('insert into financial_expense_claims(id,origin_daily_close_id) values($1,$2)',[uuid(401),A]);
  await rejects('update financial_expense_claims set claimed_amount=claimed_amount where id=$1',[CLAIM]);
  await rejects('delete from financial_expense_claims where id=$1',[CLAIM]);
});
test('claim unlink from draft parent bumps old parent; unlinked claims preserve business behavior',async()=>{
  await claim(); await db.query('update financial_expense_claims set origin_daily_close_id=null where id=$1',[CLAIM]);
  assert.equal(await revision(),3);
  await db.query("update financial_expense_claims set approval_status='approved' where id=$1",[CLAIM]);
  assert.equal(await revision(),3);
  assert.equal(Number((await one('select approved_amount from financial_expense_claims where id=$1',[CLAIM])).approved_amount),10);
});
test('claim duplicate DO NOTHING conservatively invalidates once without a new claim',async()=>{
  await claim(); const r=await revision();
  await db.query('insert into financial_expense_claims(id,origin_daily_close_id) values($1,$2) on conflict(id) do nothing',[CLAIM,A]);
  assert.equal(await revision(),r+1); assert.equal(Number((await one('select count(*) as n from financial_expense_claims')).n),1);
});
for(const [id,label] of [[OTHER,'other branch'],[SANDBOX,'sandbox environment']]) {
  test(`${label}: existing parent and child/claim revision behavior remains unchanged`,async()=>{
    await db.query('update financial_daily_closes set cup_count=11 where id=$1',[id]); await ready(id); await ledger(L,id); await claim(id);
    await db.query('update financial_expense_claims set claimed_amount=11 where id=$1',[CLAIM]);
    assert.equal(await revision(id),1);
  });
}
test('cross-scope child move invalidates only the in-scope parent',async()=>{
  await ledger(L,OTHER);
  await db.query('update financial_daily_ledger_entries set daily_close_id=$2 where id=$1',[L,A]);
  assert.equal(await revision(OTHER),1); assert.equal(await revision(A),2);
  await db.query('update financial_daily_ledger_entries set daily_close_id=$2 where id=$1',[L,OTHER]);
  assert.equal(await revision(OTHER),1); assert.equal(await revision(A),3);
});
test('adjustment guard remains append-only and available only after confirmation',async()=>{
  await rejects('insert into financial_daily_close_adjustments(id,daily_close_id) values($1,$2)',[uuid(500),A],/only after/);
  await ready(); await canonical(); const r=await revision();
  await db.query('insert into financial_daily_close_adjustments(id,daily_close_id) values($1,$2)',[uuid(500),A]);
  assert.equal(await revision(),r);
  await rejects('update financial_daily_close_adjustments set amount=1 where id=$1',[uuid(500)],/append-only/);
  await rejects('delete from financial_daily_close_adjustments where id=$1',[uuid(500)],/append-only/);
});

for (const [table,id,parentColumn] of [
  ['financial_daily_close_evidence',E,'daily_close_id'],
  ['financial_daily_ledger_entries',L,'daily_close_id'],
  ['financial_expense_claims',CLAIM,'origin_daily_close_id']]) {
  test(`${table}: conflict UPDATE no-op conservatively invalidates from BEFORE INSERT`,async()=>{
    await db.query(`insert into ${table}(id,${parentColumn}) values($1,$2)`,[id,A]);
    const r=await revision();
    await db.query(`insert into ${table}(id,${parentColumn}) values($1,$2) on conflict(id) do update set ${parentColumn}=excluded.${parentColumn}`,[id,A]);
    assert.equal(await revision(),r+1);
  });
}
for (const [table,id] of [['financial_daily_ledger_entries',L],['financial_daily_close_evidence',E]]) {
  test(`${table}: cross-day claim-linked insertion invalidates draft origin and direct parent`,async()=>{
    await claim(A,{status:'approved',approved:10});
    await db.query("update financial_daily_closes set local_date='2026-10-11' where id=$1",[B]);
    const ar=await revision(A),br=await revision(B);
    await db.query(`insert into ${table}(id,daily_close_id,expense_claim_id) values($1,$2,$3)`,[id,B,CLAIM]);
    assert.equal(await revision(A),ar+1); assert.equal(await revision(B),br+1);
  });
  test(`${table}: later child linked to confirmed claim origin remains permitted`,async()=>{
    await claim(A,{status:'approved',approved:10}); await ready(A,uuid(209)); await canonical(A);
    await db.query("update financial_daily_closes set local_date='2026-10-11' where id=$1",[B]);
    const ar=await revision(A),br=await revision(B);
    await db.query(`insert into ${table}(id,daily_close_id,expense_claim_id) values($1,$2,$3)`,[id,B,CLAIM]);
    assert.equal(await revision(A),ar); assert.equal(await revision(B),br+1);
  });
  test(`${table}: removing claim link invalidates old draft origin`,async()=>{
    await claim(A,{status:'approved',approved:10});
    await db.query(`insert into ${table}(id,daily_close_id,expense_claim_id) values($1,$2,$3)`,[id,B,CLAIM]);
    const ar=await revision(A),br=await revision(B);
    await db.query(`update ${table} set expense_claim_id=null where id=$1`,[id]);
    assert.equal(await revision(A),ar+1); assert.equal(await revision(B),br+1);
  });
}
const results=[];
for (const {name,fn} of tests) {
  try {await reset(); await fn(); results.push({name,status:'passed'}); console.log(`PASS ${name}`);}
  catch(error) {await db.exec('rollback').catch(()=>{}); results.push({name,status:'failed',error:String(error.stack||error)}); console.log(`FAIL ${name}\n${error.stack||error}`);}
}
const report={
  generatedAt:new Date().toISOString(), engine:'PGlite in-process PostgreSQL WASM',
  concurrencyTested:false,
  scope:'Synthetic tables/views; exact proposed guard functions, saved canonical confirmation/reconciliation, wrapper body and saved trigger bindings. Wrapper ACL statements omitted. No production connection or financial writes.',
  sourceManifest:manifest,
  knownLimitations:[
    'No real independent sessions, lock waits, deadlocks, or READ COMMITTED interleavings tested.',
    'Synthetic views do not establish production dependency closure or actual writer-path coverage.',
    'ACL, RLS, authenticated execution roles, and actual production constraints are not certified.',
    'BEFORE INSERT duplicate ON CONFLICT DO NOTHING conservatively advances revision; tokens are not exact mutation counts.',
  ],
  passed:results.filter(r=>r.status==='passed').length,
  failed:results.filter(r=>r.status==='failed').length,
  results,
};
fs.writeFileSync(path.join(here,'pglite-results.json'),JSON.stringify(report,null,2)+'\n');
console.log(`\n${report.passed}/${results.length} passed. Real multi-session concurrency: NOT TESTED.`);
await db.close();
if(report.failed) process.exitCode=1;
