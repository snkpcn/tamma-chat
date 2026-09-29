import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processDialogTurn } from '../netlify/functions/_dialog-manager';
import { emptyConversationContextState } from '../netlify/functions/_conversation-context';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';

const now = new Date('2026-09-30T00:00:00+07:00');
const fact = (key:string,value:unknown) => ({
  key,value,domain:'activity' as const,sourceId:'duration-regression',sourceType:'activity_live' as const,
  authoritative:true,fetchedAt:now.toISOString(),
});

test('unsupported 60-minute horse request is removed and cannot reach a proposal', async () => {
  const result = await processDialogTurn({
    semanticTurn:{
      domain:'activity',intent:'book_horse',action:'book',speechAct:'transaction_request',
      entities:{resourceCode:'activity-horse',horseName:'ภาราดร',date:'2026-10-06',time:'10:00',durationMinutes:60,partySize:1},
      references:[],constraints:[],confidence:0.99,needsClarification:false,
    },
    conversationContext:emptyConversationContextState(now),taskState:emptyTaskStateContainer(),
    channel:'line',eventId:'unsupported-duration',
  },{
    activity:{
      catalog:async()=>({status:'ok' as const,sourceId:'duration-regression',sourceType:'activity_live' as const,fetchedAt:now.toISOString(),data:[
        fact('activity_asset:horse-pharadon:name','ภาราดร'),fact('activity_asset:horse-pharadon:activityCode','horse'),
        fact('activity:horse:resourceCode','activity-horse'),fact('activity:horse:30min:price',300),fact('activity:horse:45min:price',500),
      ]}),
      availability:async()=>({status:'ok' as const,sourceId:'duration-regression',sourceType:'activity_live' as const,fetchedAt:now.toISOString(),data:[
        fact('availability:activity-horse:2026-10-06T10:00:00+07:00:available',true),
      ]}),
    },
  },now);
  assert.equal(result.actionProposal,undefined,'unsupported duration must fail closed before transaction proposal');
  assert.equal(result.taskStateContainer.activeTask?.slots.durationMinutes,undefined);
  assert.equal(result.taskStateContainer.activeTask?.commitmentIntent,false);
  assert.ok(result.reasons.includes('activity_duration_rejected'));
});
