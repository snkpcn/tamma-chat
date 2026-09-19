import type {
  BrainChannel, BrainResponse, BrainToolCall, BrainToolResult, BrainRuntimeContext, BrainRequest,
} from './_thongthai-brain-v3';
import { THONGTHAI_BRAIN_VERSION, THONGTHAI_BIBLE_VERSION } from './_thongthai-brain-v3';
import {
  createBooking, createCafeInquiry, createOtopOrder, listBookingOptions, listOtopProducts,
  type OpsChannel, type ServiceType,
} from './_operations-db';
import { createRestaurantPreorder, listRestaurantMenu, loadRestaurantWorldFacts, restaurantMenuAdvice } from './_restaurant-sot';
import { loadActivePromotionsWorldFact, redeemPromotion } from './_promotions-runtime';
import { loadActivityWorldFacts } from './_activity-sot';
import { patchGuestAgentState } from './_guest-agent-state-store';

export const SAFE_MEMORY_KEYS = new Set([
  'discovery_style','preferred_moods','experience_preferences','stay_preferences','activity_preferences','avoid_experiences',
]);
const EXPERIENCE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,119}$/i;
type WorldFactRow = { fact_key: string; category: string; fact_value: unknown; source: string | null; updated_at: string };
type SemanticMemoryRow = { memory_key: string; memory_value: unknown; confidence: number; source_channel: string; evidence_count: number; last_observed_at: string };

function configuration(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/$/, ''), key } : null;
}
async function dbFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const c = configuration(); if (!c) throw new Error('Supabase configuration missing');
  const res = await fetch(`${c.url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) { const body = await res.text().catch(() => ''); throw new Error(`Supabase ${res.status}: ${body.slice(0,180)}`); }
  return res;
}

function provider(channel: BrainChannel): OpsChannel { return channel === 'facebook' ? 'facebook' : channel; }
function eq(value: string): string { return encodeURIComponent(value); }
function safeShort(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  let text = value.trim().replace(/\s+/g,' '); if (!text) return null;
  text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[contact removed]')
    .replace(/(?:\+?66|0)\d(?:[\s-]?\d){7,9}/g,'[contact removed]');
  return text.slice(0,max);
}
function safeMemoryValue(value: unknown): string | string[] | null {
  if (typeof value === 'string') return safeShort(value,120);
  if (!Array.isArray(value)) return null;
  return [...new Set(value.filter((x): x is string => typeof x === 'string').map(x => safeShort(x,80)).filter((x): x is string => Boolean(x)).slice(0,12))];
}
async function insertEvent(guestDbId: string, eventType: string, intent: string | null, metadata: Record<string, unknown> = {}): Promise<void> {
  await dbFetch('guest_events', { method:'POST', headers:{Prefer:'return=minimal'}, body:JSON.stringify({ guest_id:guestDbId,event_type:eventType,intent,metadata }) });
}

export async function registerGuestIdentity(guestDbId: string | null, channel: BrainChannel, providerUserKey: string | undefined): Promise<void> {
  if (!guestDbId || !providerUserKey || !configuration()) return;
  const key = providerUserKey.trim().slice(0,128); if (!key) return;
  try {
    await dbFetch('guest_identities?on_conflict=provider,provider_user_key', {
      method:'POST', headers:{Prefer:'resolution=merge-duplicates,return=minimal'},
      body:JSON.stringify({ guest_id:guestDbId,provider:provider(channel),provider_user_key:key,last_seen_at:new Date().toISOString() }),
    });
  } catch (error) { console.error('THONGTHAI_IDENTITY_ERROR', error instanceof Error ? error.message.slice(0,180) : 'unknown'); }
}

export async function loadBrainRuntime(guestDbId: string | null, channel: BrainChannel): Promise<BrainRuntimeContext> {
  const fallback: BrainRuntimeContext = { agentState:{}, semanticMemory:[], worldFacts:[], toolResults:[] };
  if (!configuration()) return fallback;
  try {
    const worldPromise = Promise.all([
    dbFetch('world_facts?active=eq.true&verified=eq.true&select=fact_key,category,fact_value,source,updated_at&order=fact_key.asc&limit=300').then(r => r.json() as Promise<WorldFactRow[]>),
    loadActivityWorldFacts(),
    loadRestaurantWorldFacts(),
    loadActivePromotionsWorldFact(channel),
  ]).then(([baseFacts, activityFacts, restaurantFacts, promotionFacts]) => [...baseFacts, ...activityFacts, ...restaurantFacts, ...promotionFacts]);
    if (!guestDbId) return { ...fallback, worldFacts:await worldPromise };
    const [states, memories, worldFacts] = await Promise.all([
      dbFetch(`guest_agent_state?guest_id=eq.${eq(guestDbId)}&select=state&limit=1`).then(r => r.json() as Promise<Array<{state:Record<string,unknown>}>>),
      dbFetch(`guest_semantic_memory?guest_id=eq.${eq(guestDbId)}&status=eq.active&select=memory_key,memory_value,confidence,source_channel,evidence_count,last_observed_at&order=last_observed_at.desc&limit=20`).then(r => r.json() as Promise<SemanticMemoryRow[]>),
      worldPromise,
    ]);
    return {
      agentState:states[0]?.state ?? {},
      semanticMemory:memories.map(row => ({ key:row.memory_key,value:row.memory_value,confidence:Number(row.confidence),sourceChannel:row.source_channel,evidenceCount:row.evidence_count,lastObservedAt:row.last_observed_at })),
      worldFacts, toolResults:[],
    };
  } catch (error) {
    console.error('THONGTHAI_RUNTIME_LOAD_ERROR', error instanceof Error ? error.message.slice(0,180) : 'unknown');
    return fallback;
  }
}

async function upsertMemoryArray(guestDbId: string, key: 'favorites'|'visited_experiences', experienceId: string, remove=false): Promise<void> {
  const res = await dbFetch(`guest_memory?guest_id=eq.${eq(guestDbId)}&memory_key=eq.${key}&select=memory_value&limit=1`);
  const rows = await res.json() as Array<{memory_value:unknown}>;
  const current = Array.isArray(rows[0]?.memory_value) ? rows[0].memory_value.filter((x):x is string => typeof x === 'string') : [];
  const next = remove ? current.filter(x => x !== experienceId) : [...new Set([...current,experienceId])];
  await dbFetch('guest_memory?on_conflict=guest_id,memory_key', { method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({guest_id:guestDbId,memory_key:key,memory_value:next,updated_at:new Date().toISOString()}) });
}

function toolErrorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : 'execution_failed';
  if (message.includes('no_matching_schedule')) return 'no_matching_schedule';
  if (message.includes('schedule_choice_required')) return 'schedule_choice_required';
  if (message.includes('schedule_full') || message.includes('capacity')) return 'schedule_full';
  if (message.includes('activity_resource_required')) return 'activity_resource_required';
  if (message.includes('activity_duration_required')) return 'activity_duration_required';
  if (message.includes('product_not_available')) return 'product_not_available';
  if (message.includes('insufficient_stock')) return 'insufficient_stock';
  if (message.includes('menu_item_not_found')) return 'menu_item_not_found';
  if (message.includes('menu_item_unavailable')) return 'menu_item_unavailable';
  if (message.includes('invalid_requested_time')) return 'invalid_requested_time';
  if (message.includes('promotion_not_found')) return 'promotion_not_found';
  if (message.includes('promotion_not_active')) return 'promotion_not_active';
  if (message.includes('promotion_not_started')) return 'promotion_not_started';
  if (message.includes('promotion_expired')) return 'promotion_expired';
  if (message.includes('promotion_redemption_limit_reached')) return 'promotion_redemption_limit_reached';
  if (message.includes('promotion_channel_not_allowed')) return 'promotion_channel_not_allowed';
  if (message.includes('promotion_has_no_items')) return 'promotion_has_no_items';
  if (message.includes('promotion_requires_date_time')) return 'promotion_requires_date_time';
  return 'execution_failed';
}

function knownPartySize(request: BrainRequest): number | null {
  const values = [request.guestContext.group.adults, request.guestContext.group.children, request.guestContext.group.elderly]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  if (!values.length) return null;
  const total = values.reduce((sum,value)=>sum+value,0);
  return total > 0 ? total : null;
}

export async function executeBrainTools(
  guestDbId: string | null,
  channel: BrainChannel,
  calls: BrainToolCall[],
  firstResponse: BrainResponse,
  request: BrainRequest,
): Promise<BrainToolResult[]> {
  if (!calls.length) return [];
  if (!guestDbId || !configuration()) return calls.map(call => ({ name:call.name,ok:false,detail:'customer_state_unavailable' }));
  const results: BrainToolResult[] = [];
  for (const call of calls.slice(0,4)) {
    try {
      if (call.name === 'save_journey') {
        const candidate = firstResponse.journeyAction.journey ?? request.journeyContext.currentPlan ?? request.journeyContext.savedPlan;
        if (!candidate) { results.push({name:call.name,ok:false,detail:'no_journey_to_save'}); continue; }
        await dbFetch('journeys',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({guest_id:guestDbId,action:'save',intent:'save_journey',journey:candidate})});
        results.push({name:call.name,ok:true,detail:'journey_saved'}); continue;
      }
      if (call.name === 'favorite_experience' || call.name === 'unfavorite_experience' || call.name === 'mark_visited') {
        const id = typeof call.args.experienceId === 'string' ? call.args.experienceId : '';
        if (!EXPERIENCE_ID_RE.test(id)) { results.push({name:call.name,ok:false,detail:'invalid_experience_id'}); continue; }
        if (call.name === 'favorite_experience') await upsertMemoryArray(guestDbId,'favorites',id,false);
        if (call.name === 'unfavorite_experience') await upsertMemoryArray(guestDbId,'favorites',id,true);
        if (call.name === 'mark_visited') await upsertMemoryArray(guestDbId,'visited_experiences',id,false);
        results.push({name:call.name,ok:true,detail:id}); continue;
      }
      if (call.name === 'request_handoff') {
        const reasonCode = ['booking_help','accessibility_help','complaint','other'].includes(String(call.args.reasonCode)) ? String(call.args.reasonCode) : 'other';
        await dbFetch('handoff_requests',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({guest_id:guestDbId,reason_code:reasonCode,source_channel:provider(channel),status:'pending'})});
        results.push({name:call.name,ok:true,detail:reasonCode}); continue;
      }
      if (call.name === 'list_booking_options') {
      const serviceType = String(call.args.serviceType) as ServiceType;
      const date = String(call.args.date ?? '');
      const resourceCode = typeof call.args.resourceCode === 'string' ? call.args.resourceCode : null;
      const durationMinutes = typeof call.args.durationMinutes === 'number' ? call.args.durationMinutes : null;
      const partySize = typeof call.args.partySize === 'number' ? call.args.partySize : null;
      const options = await listBookingOptions(serviceType,date,'live',resourceCode,durationMinutes,partySize);
      results.push({ name:call.name, ok:true, detail:JSON.stringify({ date, serviceType, resourceCode, durationMinutes, partySize, options:options.slice(0,24) }) });
      continue;
    }
      if (call.name === 'create_booking') {
        try {
          const created = await createBooking({
            guestDbId, channel:provider(channel), serviceType:String(call.args.serviceType) as ServiceType,
            resourceCode:typeof call.args.resourceCode === 'string' ? call.args.resourceCode : null,
            date:String(call.args.date ?? ''), time:typeof call.args.time === 'string' ? call.args.time : null,
            endDate:typeof call.args.endDate === 'string' ? call.args.endDate : null,
            durationMinutes:typeof call.args.durationMinutes === 'number' ? call.args.durationMinutes : null,
            partySize:typeof call.args.partySize === 'number' ? call.args.partySize : null,
            quantity:typeof call.args.quantity === 'number' ? call.args.quantity : null,
            customerName:typeof call.args.customerName === 'string' ? call.args.customerName : null,
            phone:typeof call.args.phone === 'string' ? call.args.phone : null,
            email:typeof call.args.email === 'string' ? call.args.email : null,
            note:typeof call.args.note === 'string' ? call.args.note : null,
            environment:'live',
          });
          await insertEvent(guestDbId,'agent_action','booking',{action:'create_booking',bookingCode:created.bookingCode,channel});
          results.push({name:call.name,ok:true,detail:JSON.stringify(created)});
        } catch (error) {
          const detail = toolErrorDetail(error);
          if (detail === 'schedule_choice_required' || detail === 'no_matching_schedule') {
            const serviceType = String(call.args.serviceType) as ServiceType;
            const date = String(call.args.date ?? '');
            const options = await listBookingOptions(
    serviceType,
    date,
    'live',
    typeof call.args.resourceCode === 'string' ? call.args.resourceCode : null,
    typeof call.args.durationMinutes === 'number' ? call.args.durationMinutes : null,
    typeof call.args.partySize === 'number' ? call.args.partySize : null,
  ).catch(() => []);
            results.push({name:call.name,ok:false,detail:JSON.stringify({reason:detail,options:options.slice(0,12)})});
          } else results.push({name:call.name,ok:false,detail});
        }
        continue;
      }
      if (call.name === 'list_restaurant_menu') {
        const [menu, advice] = await Promise.all([
          listRestaurantMenu(),
          restaurantMenuAdvice({
            query:request.message,
            partySize:knownPartySize(request),
            budget:typeof request.guestContext.budget === 'number' ? request.guestContext.budget : null,
            constraints:request.guestContext.constraints,
            recentMessages:request.chatHistory.slice(-6).map(turn=>turn.content),
          }),
        ]);
        results.push({name:call.name,ok:true,detail:JSON.stringify({
          menuUrl:'https://tamma-chat.netlify.app/menu.html',
          advisor:advice,
          items:menu.map(item=>({name:item.name,category:item.category_name,price:item.selling_price,description:item.description,signature:item.is_signature,orderable:item.is_orderable,availableServings:item.available_servings,ingredients:item.ingredient_names,unavailableIngredients:item.unavailable_ingredients})),
        })});
        continue;
      }
      if (call.name === 'create_restaurant_preorder') {
        try {
          const created = await createRestaurantPreorder({
            guestDbId, channel:provider(channel), date:String(call.args.date ?? ''), time:String(call.args.time ?? ''),
            items:Array.isArray(call.args.items) ? call.args.items as Array<{name:string;quantity:number}> : [],
            customerName:String(call.args.customerName ?? ''),
            phone:typeof call.args.phone==='string' ? call.args.phone : null,
            email:typeof call.args.email==='string' ? call.args.email : null,
            note:typeof call.args.note==='string' ? call.args.note : null,
          });
          await insertEvent(guestDbId,'agent_action','order',{action:'create_restaurant_preorder',preorderCode:created.preorderCode,channel});
          results.push({name:call.name,ok:true,detail:JSON.stringify(created)});
        } catch(error) { results.push({name:call.name,ok:false,detail:toolErrorDetail(error)}); }
        continue;
      }
      if (call.name === 'create_cafe_inquiry') {
        const created = await createCafeInquiry({
          guestDbId, channel:provider(channel), question:String(call.args.question ?? ''),
          customerName:typeof call.args.customerName === 'string' ? call.args.customerName : null,
          phone:typeof call.args.phone === 'string' ? call.args.phone : null,
          email:typeof call.args.email === 'string' ? call.args.email : null,
          environment:'live',
        });
        await insertEvent(guestDbId,'agent_action','customer_service',{action:'create_cafe_inquiry',inquiryCode:created.inquiryCode,channel});
        results.push({name:call.name,ok:true,detail:JSON.stringify(created)}); continue;
      }
      if (call.name === 'list_otop_products') {
        const products = await listOtopProducts('live');
        results.push({name:call.name,ok:true,detail:JSON.stringify({products:products.slice(0,20)})}); continue;
      }
      if (call.name === 'redeem_promotion') {
        try {
          const created = await redeemPromotion({
            guestDbId, channel, campaignId: String(call.args.campaignId ?? ''),
            date: typeof call.args.date === 'string' ? call.args.date : null,
            time: typeof call.args.time === 'string' ? call.args.time : null,
            customerName: String(call.args.customerName ?? ''),
            phone: typeof call.args.phone === 'string' ? call.args.phone : null,
            email: typeof call.args.email === 'string' ? call.args.email : null,
            note: typeof call.args.note === 'string' ? call.args.note : null,
          });
          await insertEvent(guestDbId,'agent_action','order',{action:'redeem_promotion',campaignCode:created.campaignCode,status:created.status,channel});
          results.push({name:call.name,ok:true,detail:JSON.stringify(created)});
        } catch (error) { results.push({name:call.name,ok:false,detail:toolErrorDetail(error)}); }
        continue;
      }
      if (call.name === 'create_otop_order') {
        const created = await createOtopOrder({
          guestDbId, channel:provider(channel), sku:String(call.args.sku ?? ''), quantity:Number(call.args.quantity ?? 1),
          customerName:typeof call.args.customerName === 'string' ? call.args.customerName : null,
          phone:typeof call.args.phone === 'string' ? call.args.phone : null,
          email:typeof call.args.email === 'string' ? call.args.email : null,
          fulfillmentType:String(call.args.fulfillmentType) === 'shipping' ? 'shipping' : 'pickup',
          shippingAddress:typeof call.args.shippingAddress === 'string' ? call.args.shippingAddress : null,
          note:typeof call.args.note === 'string' ? call.args.note : null,
          environment:'live',
        });
        await insertEvent(guestDbId,'agent_action','order',{action:'create_otop_order',orderCode:created.orderCode,channel});
        results.push({name:call.name,ok:true,detail:JSON.stringify(created)}); continue;
      }
      results.push({name:call.name,ok:false,detail:'unsupported_tool'});
    } catch (error) {
      console.error('THONGTHAI_TOOL_ERROR',call.name,error instanceof Error ? error.message.slice(0,180) : 'unknown');
      results.push({name:call.name,ok:false,detail:toolErrorDetail(error)});
    }
  }
  return results;
}

export async function persistBrainRuntime(guestDbId: string | null, channel: BrainChannel, response: BrainResponse): Promise<void> {
  if (!guestDbId || !configuration()) return;
  try {
    const now = new Date().toISOString();
    const set: Record<string,unknown> = {
      last_intent:response.intent,last_channel:channel,last_style_mode:response.responseStyle,
      updated_by_brain_version:THONGTHAI_BRAIN_VERSION,
      updated_by_bible_version:THONGTHAI_BIBLE_VERSION,
    };
    const removeKeys: string[] = [];
    const update = response.agentStateUpdate ?? {};
    const active = safeShort(update.activeTopic,80); const summary = safeShort(update.travelContextSummary,500); const unresolved = safeShort(update.unresolvedNeed,180);
    if (active !== null) set.active_topic=active;
    if (summary !== null) set.travel_context_summary=summary;
    if (unresolved !== null) set.unresolved_need=unresolved;
    if (update.clearUnresolvedNeed === true) removeKeys.push('unresolved_need');
    if (update.restaurantProposedSet) set.restaurantProposedSet = update.restaurantProposedSet;
    if (update.restaurantAdvisorContext) set.restaurantAdvisorContext = update.restaurantAdvisorContext;
    if (update.pendingPromotionRedemption) set.pendingPromotionRedemption = update.pendingPromotionRedemption;
    if (update.clearPendingPromotionRedemption === true) removeKeys.push('pendingPromotionRedemption');
    const patched = await patchGuestAgentState(guestDbId,{set,removeKeys});
    if (!patched) throw new Error('guest_agent_state_cas_exhausted');

    for (const memory of (response.semanticMemoryUpdates ?? []).slice(0,8)) {
      if (!SAFE_MEMORY_KEYS.has(memory.key)) continue;
      const value = safeMemoryValue(memory.value); if (value === null) continue;
      const existingRes = await dbFetch(`guest_semantic_memory?guest_id=eq.${eq(guestDbId)}&memory_key=eq.${eq(memory.key)}&select=evidence_count&limit=1`);
      const existing = await existingRes.json() as Array<{evidence_count:number}>;
      await dbFetch('guest_semantic_memory?on_conflict=guest_id,memory_key',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({
        guest_id:guestDbId,memory_key:memory.key,memory_value:value,confidence:Math.max(.5,Math.min(1,Number(memory.confidence)||.7)),source_channel:provider(channel),evidence_count:(existing[0]?.evidence_count??0)+1,status:'active',last_observed_at:now,
      })});
    }
    await insertEvent(guestDbId,'brain_decision',response.intent,{channel,responseStyle:response.responseStyle,journeyAction:response.journeyAction.type,toolCount:response.toolCalls?.length??0});
  } catch (error) { console.error('THONGTHAI_RUNTIME_PERSIST_ERROR',error instanceof Error ? error.message.slice(0,180) : 'unknown'); }
}
