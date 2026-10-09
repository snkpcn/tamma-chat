import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { routePrivateOpsEvents, type BridgeLineEvent } from '../netlify/functions/_snk-private-bridge';

const event=(id:string,text='สรุปมา',type='group'):BridgeLineEvent=>({type:'message',source:type==='room'?{type,roomId:id}:{type,groupId:id},message:{type:'text',text}});
// Synthetic IDs only. Production retirement metadata stays in runtime config.
const syntheticRetiredHash=createHash('sha256').update('personal').digest('hex');
const disconnectedEnv={SNK_OS_PRIVATE_TRANSPORT_ENABLED:'0',SNK_OS_RETIRED_GROUP_HASHES:syntheticRetiredHash};
const noProbe=async():Promise<never>=>{throw new Error('Disconnected transport must not probe SNK');};
const noDispatch=async():Promise<never>=>{throw new Error('Disconnected transport must not dispatch to SNK');};
test('business group requests bypass SNK completely, including when SNK is down',async()=>{
  let probes=0,dispatches=0;
  const handled=await routePrivateOpsEvents([event('business','ยอดจองร้านอาหาร')],
    async()=>{probes++;throw new Error('SNK unavailable')},async()=>true,async()=>{dispatches++;throw new Error('not allowed')});
  assert.equal(handled.size,0);assert.equal(probes,0);assert.equal(dispatches,0);
});
test('personal binding is probed with identifiers only; business contents are never forwarded into SNK',async()=>{
  const events=[event('business','BUSINESS_SECRET'),event('personal','PERSONAL_SECRET'),{type:'message',source:{type:'user'},message:{type:'text',text:'CUSTOMER_SECRET'}}];
  const forwarded:BridgeLineEvent[][]=[];
  const handled=await routePrivateOpsEvents(events,async(ids)=>{
    assert.deepEqual(ids,['personal']);return{ok:true,statuses:[{index:0,status:'ACTIVE',system:'snk'}]};
  },async(id)=>id==='business',async(items)=>{forwarded.push(items);return {ok:true,handledIndexes:[0]}});
  assert.deepEqual([...handled],[1]);assert.deepEqual(forwarded,[events.slice(1,2)]);
  assert.doesNotMatch(JSON.stringify(forwarded),/BUSINESS_SECRET|CUSTOMER_SECRET/);
});
test('unknown group is consumed and admin-logged as unconfigured; message content never enters either domain',async()=>{
  let dispatched=0;const logs:unknown[]=[];
  const handled=await routePrivateOpsEvents([event('unknown','PRIVATE_UNBOUND_TEXT')],
    async()=>({ok:true,statuses:[{index:0,status:'NONE'}]}),async()=>false,async()=>{dispatched++;return{ok:true,handledIndexes:[]}},(name,data)=>logs.push({name,data}));
  assert.deepEqual([...handled],[0]);assert.equal(dispatched,0);assert.match(JSON.stringify(logs),/unconfigured/);assert.doesNotMatch(JSON.stringify(logs),/PRIVATE_UNBOUND_TEXT|unknown/);
});
test('unknown non-business binding command is forwarded; a business group cannot be rebound as personal',async()=>{
  const items=[event('unknown','ยืนยันกลุ่มการเงิน SNK-12345678'),event('business','ยืนยันกลุ่มการเงิน SNK-12345678')];
  const handled=await routePrivateOpsEvents(items,async()=>({ok:true,statuses:[{index:0,status:'NONE'}]}),async(id)=>id==='business',async(events)=>{
    assert.equal(events.length,1);assert.equal(events[0].source?.groupId,'unknown');return{ok:true,handledIndexes:[0]};
  });
  assert.deepEqual([...handled],[0]);
});
test('known personal group fails closed when SNK is unavailable, without business fallback',async()=>{
  await assert.rejects(()=>routePrivateOpsEvents([event('personal')],async()=>{throw new Error('SNK unavailable')},async()=>false,async()=>({ok:true,handledIndexes:[]})),/SNK unavailable/);
});
test('an unconfigured join never chooses a domain; explicit business binding still reaches its existing handler',async()=>{
  let dispatched=0;
  const handled=await routePrivateOpsEvents([{type:'join',source:{type:'group',groupId:'new'}},event('new','ผูกทีม OPS-CODE')],
    async()=>({ok:true,statuses:[{index:0,status:'NONE'},{index:1,status:'NONE'}]}),async()=>false,async()=>{dispatched++;return{ok:true,handledIndexes:[]}});
  assert.deepEqual([...handled],[0]);assert.equal(dispatched,0);
});
test('paused/PENDING personal bindings are consumed; malformed routing responses cannot leak events',async()=>{
  await assert.rejects(()=>routePrivateOpsEvents([event('pending')],async()=>({ok:true,statuses:[{index:0,status:'PENDING'}]}),async()=>false,async()=>({ok:true,handledIndexes:[]})),/private_event_not_consumed/);
  await assert.rejects(()=>routePrivateOpsEvents([event('personal')],async()=>({ok:true,statuses:[{index:1,status:'ACTIVE'}]}),async()=>false,async()=>({ok:true,handledIndexes:[0]})),/private_route_probe_invalid/);
});
test('configured room uses its existing roomId and the same domain routing',async()=>{
  const handled=await routePrivateOpsEvents([event('room1','วันนี้มีอะไร','room')],async(ids)=>{
    assert.deepEqual(ids,['room1']);return{ok:true,statuses:[{index:0,status:'ACTIVE'}]};
  },async()=>false,async()=>({ok:true,handledIndexes:[0]}));
  assert.deepEqual([...handled],[0]);
});
test('shared webhook removes personal events before business logging and retains only a thin signed bridge',()=>{
  const source=readFileSync('netlify/functions/line-webhook.ts','utf8');
  assert.ok(source.indexOf('privateHandled=await routePrivateOsEvents')<source.indexOf('logEventReceived(item)'));
  assert.doesNotMatch(source,/routePersonalFinanceEvent|SNK_OS_SERVICE_ROLE_KEY|finance_get_|secretary_/);
  const config=readFileSync('netlify.toml','utf8');assert.doesNotMatch(config,/personal-finance-coach|personal-finance-reminders/);
});

test('disconnect consumes retired personal text, media, joins, and binding attempts without a network hop',async()=>{
  const events:BridgeLineEvent[]=[
    event('personal','PRIVATE_TEXT'),
    {...event('personal'),message:{type:'image'}},
    {type:'join',source:{type:'group',groupId:'personal'}},
    event('personal','ผูกทีม BUSINESS-CODE'),
    event('personal','ยืนยันกลุ่มการเงิน SNK-12345678'),
  ];
  const logs:unknown[]=[];
  const handled=await routePrivateOpsEvents(events,noProbe,async()=>false,noDispatch,
    (name,data)=>logs.push({name,data}),disconnectedEnv);
  assert.deepEqual([...handled],[0,1,2,3,4]);
  assert.doesNotMatch(JSON.stringify(logs),/PRIVATE_TEXT|BUSINESS-CODE|12345678|personal/);
  assert.doesNotMatch(JSON.stringify(logs),new RegExp(syntheticRetiredHash));
});

test('disconnect retains bound business, direct customer, and safe new-business binding in mixed batches',async()=>{
  const events:BridgeLineEvent[]=[
    event('business','BUSINESS_SECRET'),event('personal','PERSONAL_SECRET'),
    {type:'message',source:{type:'user'},message:{type:'text',text:'CUSTOMER_SECRET'}},
    event('new-business','ผูกทีม OPS-CODE'),event('unknown','UNBOUND_SECRET'),
    event('unknown','ยืนยันกลุ่มการเงิน SNK-12345678'),
  ];
  const checked:string[]=[];
  const handled=await routePrivateOpsEvents(events,noProbe,async(id)=>{checked.push(id);return id==='business';},noDispatch,undefined,disconnectedEnv);
  assert.deepEqual([...handled],[1,4,5]);
  assert.deepEqual(events.filter((_,index)=>!handled.has(index)),[events[0],events[2],events[3]]);
  assert.deepEqual(checked,['business','personal','new-business','unknown','unknown']);
});

test('retirement hashing matches SNK trim/lowercase SHA-256 for group and room IDs',async()=>{
  const events=[event(' PERSONAL ','ผูกทีม CODE'),event('personal','ผูกทีม CODE','room')];
  const handled=await routePrivateOpsEvents(events,noProbe,async()=>false,noDispatch,undefined,
    {...disconnectedEnv,SNK_OS_RETIRED_GROUP_HASHES:syntheticRetiredHash.toUpperCase()});
  assert.deepEqual([...handled],[0,1]);
});

test('multiple retired groups are supported without putting IDs into logs',async()=>{
  const second=createHash('sha256').update('old-room').digest('hex');
  const handled=await routePrivateOpsEvents([event('personal','ผูกทีม CODE'),event('old-room','ผูกทีม CODE','room'),event('new','ผูกทีม CODE')],
    noProbe,async()=>false,noDispatch,undefined,
    {...disconnectedEnv,SNK_OS_RETIRED_GROUP_HASHES:` ${syntheticRetiredHash},\n${second} `});
  assert.deepEqual([...handled],[0,1]);
});

test('missing or malformed retirement metadata fails closed only for unbound groups',async()=>{
  for(const hashes of [undefined,'','raw-group-id',`${syntheticRetiredHash},bad`]){
    const handled=await routePrivateOpsEvents([event('business'),event('new','ผูกทีม CODE'),event('personal')],
      noProbe,async(id)=>id==='business',noDispatch,undefined,
      {SNK_OS_PRIVATE_TRANSPORT_ENABLED:'0',SNK_OS_RETIRED_GROUP_HASHES:hashes});
    assert.deepEqual([...handled],[1,2]);
  }
});

test('disconnect accepts explicit off values but re-enable restores the prior probe/dispatch flow',async()=>{
  for(const flag of ['0','false','OFF','no',' false ']){
    const handled=await routePrivateOpsEvents([event('personal')],noProbe,async()=>false,noDispatch,undefined,
      {...disconnectedEnv,SNK_OS_PRIVATE_TRANSPORT_ENABLED:flag});
    assert.deepEqual([...handled],[0]);
  }
  for(const flag of [undefined,'1','true']){
    let probes=0,dispatches=0;
    const handled=await routePrivateOpsEvents([event('personal')],async()=>{probes++;return{ok:true,statuses:[{index:0,status:'ACTIVE'}]};},
      async()=>false,async()=>{dispatches++;return{ok:true,handledIndexes:[0]};},undefined,
      {...disconnectedEnv,SNK_OS_PRIVATE_TRANSPORT_ENABLED:flag});
    assert.deepEqual([...handled],[0]);assert.equal(probes,1);assert.equal(dispatches,1);
  }
});

test('business-bound precedence and direct messages do not depend on retirement configuration',async()=>{
  const items:BridgeLineEvent[]=[event('personal','BUSINESS_BOUND'),{type:'message',source:{type:'user'},message:{type:'text',text:'DIRECT'}}];
  const handled=await routePrivateOpsEvents(items,noProbe,async()=>true,noDispatch,undefined,
    {SNK_OS_PRIVATE_TRANSPORT_ENABLED:'0'});
  assert.equal(handled.size,0);
});

test('business lookup errors fail closed before any personal probe, logging, or dispatch',async()=>{
  const logs:unknown[]=[];
  await assert.rejects(()=>routePrivateOpsEvents([event('personal')],noProbe,async()=>{throw new Error('business_lookup_failed');},noDispatch,
    (name,data)=>logs.push({name,data}),disconnectedEnv),/business_lookup_failed/);
  assert.equal(logs.length,0);
});

