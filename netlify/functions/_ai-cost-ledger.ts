import {
  aiCostPolicy,
  calculateAiCostUsd,
  estimateInputTokens,
  reserveWorstCaseCostUsd,
  roundUsd,
  usdToThb,
  type AiUsage,
} from './_ai-cost-policy';
import {
  compareAndSwapGuestAgentState,
  loadGuestAgentStateSnapshot,
  type GuestAgentStateSnapshot,
} from './_guest-agent-state-store';
import { persistAiCallCost } from './_ai-cost-store';

export const AI_COST_LEDGER_VERSION = 'ai-cost-ledger-v1';
const STATE_KEY = 'aiCostLedger';
const MAX_LEDGER_EVENTS = 128;
const MAX_CAS_ATTEMPTS = 5;

export type AiCallContext = {
  conversationId: string;
  guestDbId: string | null;
  channel: string;
  eventId: string;
  callerLabel: string;
  certificationMode?: boolean;
};

export type AiCostEvent = {
  key: string;
  eventId: string;
  callerLabel: string;
  channel: string;
  provider: 'openai';
  model: string;
  status: 'reserved' | 'completed' | 'failed';
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reservedCostUsd: number;
  actualCostUsd: number;
  callIndexTurn: number;
  callIndexConversation: number;
  at: string;
  semanticOutput?: string;
};

export type ConversationAiLedger = {
  version: typeof AI_COST_LEDGER_VERSION;
  conversationId: string;
  startedAt: string;
  lastActivityAt: string;
  cumulativeCostUsd: number;
  reservedCostUsd: number;
  callCount: number;
  events: AiCostEvent[];
};

export type AiCallReservation = {
  kind: 'reserved';
  ledgerKey: string;
  context: AiCallContext;
  model: string;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  reservedCostUsd: number;
  callIndexTurn: number;
  callIndexConversation: number;
};

export type AiCallReplay = {
  kind: 'replay';
  output: string;
  event: AiCostEvent;
};

export class AiBudgetBlockedError extends Error {
  reason: 'budget' | 'turn_call_limit' | 'conversation_call_limit' | 'prompt_oversize' | 'ledger_unavailable' | 'duplicate_in_flight';
  constructor(reason: AiBudgetBlockedError['reason']) {
    super(`OpenAI call blocked by production cost guard: ${reason}`);
    this.name = 'AiBudgetBlockedError';
    this.reason = reason;
  }
}

function eventKey(context: AiCallContext): string {
  return `${context.eventId.slice(0, 180)}:${context.callerLabel.slice(0, 80)}`;
}

function freshLedger(context: AiCallContext, now: Date): ConversationAiLedger {
  const at = now.toISOString();
  return {
    version:AI_COST_LEDGER_VERSION,
    conversationId:context.conversationId.slice(0, 180),
    startedAt:at,
    lastActivityAt:at,
    cumulativeCostUsd:0,
    reservedCostUsd:0,
    callCount:0,
    events:[],
  };
}

function parseLedger(raw: unknown, context: AiCallContext, now: Date): ConversationAiLedger {
  const policy = aiCostPolicy();
  if (!raw || typeof raw !== 'object') return freshLedger(context, now);
  const value = raw as Partial<ConversationAiLedger>;
  const lastActivity = Date.parse(String(value.lastActivityAt ?? ''));
  if (
    value.version !== AI_COST_LEDGER_VERSION
    || value.conversationId !== context.conversationId.slice(0, 180)
    || !Number.isFinite(lastActivity)
    || now.getTime() - lastActivity >= policy.conversationIdleMs
  ) return freshLedger(context, now);

  const events = Array.isArray(value.events)
    ? value.events.filter((item): item is AiCostEvent => Boolean(item && typeof item === 'object')).slice(-MAX_LEDGER_EVENTS)
    : [];
  return {
    version:AI_COST_LEDGER_VERSION,
    conversationId:context.conversationId.slice(0, 180),
    startedAt:String(value.startedAt ?? now.toISOString()),
    lastActivityAt:String(value.lastActivityAt ?? now.toISOString()),
    cumulativeCostUsd:roundUsd(Number(value.cumulativeCostUsd) || 0),
    reservedCostUsd:roundUsd(Number(value.reservedCostUsd) || 0),
    callCount:Math.max(0, Math.floor(Number(value.callCount) || 0)),
    events,
  };
}

function withLedger(snapshot: GuestAgentStateSnapshot, ledger: ConversationAiLedger): Record<string, unknown> {
  return { ...snapshot.state, [STATE_KEY]:ledger };
}

async function casLedger(
  guestDbId: string,
  snapshot: GuestAgentStateSnapshot,
  ledger: ConversationAiLedger,
  now: Date,
): Promise<boolean> {
  const result = await compareAndSwapGuestAgentState(
    guestDbId,
    snapshot,
    { set:{ [STATE_KEY]:ledger } },
    now,
  );
  return result.status === 'applied';
}

function emitCostMetric(fields: Record<string, unknown>): void {
  console.log('THONGTHAI_AI_COST', JSON.stringify(fields));
}

function effectiveBudgetCapUsd(context: AiCallContext, customerCapUsd: number): number {
  return context.certificationMode === true
    || (Boolean(process.env.NODE_TEST_CONTEXT) && process.env.THONGTHAI_TEST_BYPASS_COST_CAP === '1')
      ? 5
      : customerCapUsd;
}

export async function reserveAiCall(
  context: AiCallContext,
  model: string,
  promptParts: readonly string[],
  maxOutputTokens: number,
  now: Date = new Date(),
): Promise<AiCallReservation | AiCallReplay> {
  // Certification is explicit code/config, never customer-controlled. It still
  // records usage, but may use isolated synthetic conversation ids.
  const policy = aiCostPolicy();
  // Real customer traffic is governed by the owner hard cap (<= 5 THB).
  // Explicit certification runs and the repository's network-free harness
  // are not customer conversations, so they may use the old generous
  // runaway ceiling while still exercising/recording the same call path.
  const budgetCapUsd = effectiveBudgetCapUsd(context, policy.maxConversationCostUsd);
  const estimatedInputTokens = estimateInputTokens(promptParts);
  if (estimatedInputTokens > policy.absoluteInputTokens) {
    emitCostMetric({
      conversation_id:context.conversationId, event_id:context.eventId, model,
      ai_prompt_oversize:1, estimated_input_tokens:estimatedInputTokens,
    });
    throw new AiBudgetBlockedError('prompt_oversize');
  }
  if (!context.guestDbId) {
    emitCostMetric({
      conversation_id:context.conversationId, event_id:context.eventId, model,
      ai_budget_block:1, reason:'ledger_unavailable',
    });
    throw new AiBudgetBlockedError('ledger_unavailable');
  }

  const key = eventKey(context);
  // Reserve against the configured absolute input ceiling, not the average
  // estimate. Correctness never depends on prompt caching or optimistic token
  // estimation; a request that could cross the cap is blocked before fetch.
  const reservedCostUsd = roundUsd(
    reserveWorstCaseCostUsd(model, policy.absoluteInputTokens, maxOutputTokens),
  );

  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const snapshot = await loadGuestAgentStateSnapshot(context.guestDbId);
    const ledger = parseLedger(snapshot.state[STATE_KEY], context, now);
    const existing = ledger.events.find(event => event.key === key);
    if (existing?.status === 'completed' && existing.semanticOutput) {
      emitCostMetric({
        conversation_id:context.conversationId, event_id:context.eventId, model,
        call_purpose:context.callerLabel,
        ai_duplicate_call_prevented:1, call_cost_usd:0, call_cost_thb:0,
        conversation_cost_usd:ledger.cumulativeCostUsd,
        conversation_cost_thb:usdToThb(ledger.cumulativeCostUsd),
      });
      return { kind:'replay', output:existing.semanticOutput, event:existing };
    }
    if (existing) throw new AiBudgetBlockedError('duplicate_in_flight');

    const turnCalls = ledger.events.filter(event => event.eventId === context.eventId).length;
    if (turnCalls >= policy.maxCallsPerTurn) throw new AiBudgetBlockedError('turn_call_limit');
    if (ledger.callCount >= policy.maxCallsPerConversation) throw new AiBudgetBlockedError('conversation_call_limit');

    const externalPrimaryAgentCostUsd = activePrimaryAgentSpendUsdFromSnapshot(snapshot, context, now);
    const projected = roundUsd(
      ledger.cumulativeCostUsd + ledger.reservedCostUsd + externalPrimaryAgentCostUsd + reservedCostUsd,
    );
    if (projected > budgetCapUsd + Number.EPSILON) {
      emitCostMetric({
        conversation_id:context.conversationId, event_id:context.eventId, model,
        call_purpose:context.callerLabel,
        ai_budget_block:1, reason:'budget',
        reserved_cost_usd:reservedCostUsd, reserved_cost_thb:usdToThb(reservedCostUsd),
        conversation_cost_usd:roundUsd(ledger.cumulativeCostUsd + externalPrimaryAgentCostUsd),
        conversation_cost_thb:usdToThb(ledger.cumulativeCostUsd + externalPrimaryAgentCostUsd),
        external_primary_agent_cost_usd:roundUsd(externalPrimaryAgentCostUsd),
        external_primary_agent_cost_thb:usdToThb(externalPrimaryAgentCostUsd),
        budget_remaining_usd:roundUsd(
          budgetCapUsd - ledger.cumulativeCostUsd - ledger.reservedCostUsd - externalPrimaryAgentCostUsd,
        ),
        budget_remaining_thb:usdToThb(
          budgetCapUsd - ledger.cumulativeCostUsd - ledger.reservedCostUsd - externalPrimaryAgentCostUsd,
        ),
      });
      throw new AiBudgetBlockedError('budget');
    }

    const callIndexTurn = turnCalls + 1;
    const callIndexConversation = ledger.callCount + 1;
    const event: AiCostEvent = {
      key,
      eventId:context.eventId,
      callerLabel:context.callerLabel,
      channel:context.channel,
      provider:'openai',
      model,
      status:'reserved',
      inputTokens:estimatedInputTokens,
      cachedInputTokens:0,
      outputTokens:0,
      reservedCostUsd,
      actualCostUsd:0,
      callIndexTurn,
      callIndexConversation,
      at:now.toISOString(),
    };
    const next:ConversationAiLedger = {
      ...ledger,
      lastActivityAt:now.toISOString(),
      reservedCostUsd:roundUsd(ledger.reservedCostUsd + reservedCostUsd),
      callCount:callIndexConversation,
      events:[...ledger.events, event].slice(-MAX_LEDGER_EVENTS),
    };
    if (await casLedger(context.guestDbId, snapshot, next, now)) {
      return {
        kind:'reserved', ledgerKey:key, context, model, estimatedInputTokens,
        maxOutputTokens, reservedCostUsd, callIndexTurn, callIndexConversation,
      };
    }
  }
  throw new AiBudgetBlockedError('ledger_unavailable');
}

export async function finalizeAiCall(
  reservation: AiCallReservation,
  usage: AiUsage | null,
  semanticOutput: string | null,
  succeeded: boolean,
  now: Date = new Date(),
  chargedCostUsdOverride?: number,
): Promise<void> {
  const { context } = reservation;
  if (!context.guestDbId) return;
  const chargedCostUsd = roundUsd(
    Number.isFinite(chargedCostUsdOverride)
      ? Math.max(0, Number(chargedCostUsdOverride))
      : usage
        ? calculateAiCostUsd(reservation.model, usage)
        : reservation.reservedCostUsd,
  );

  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const snapshot = await loadGuestAgentStateSnapshot(context.guestDbId);
    const ledger = parseLedger(snapshot.state[STATE_KEY], context, now);
    const index = ledger.events.findIndex(event => event.key === reservation.ledgerKey);
    if (index < 0) return;
    if (ledger.events[index]!.status !== 'reserved') return;

    const previous = ledger.events[index]!;
    const updated:AiCostEvent = {
      ...previous,
      status:succeeded ? 'completed' : 'failed',
      inputTokens:usage?.inputTokens ?? previous.inputTokens,
      cachedInputTokens:usage?.cachedInputTokens ?? 0,
      outputTokens:usage?.outputTokens ?? 0,
      actualCostUsd:chargedCostUsd,
      semanticOutput:succeeded && semanticOutput ? semanticOutput.slice(0, 12_000) : undefined,
      at:now.toISOString(),
    };
    const events = [...ledger.events];
    events[index] = updated;
    const next:ConversationAiLedger = {
      ...ledger,
      lastActivityAt:now.toISOString(),
      cumulativeCostUsd:roundUsd(ledger.cumulativeCostUsd + chargedCostUsd),
      reservedCostUsd:roundUsd(Math.max(0, ledger.reservedCostUsd - previous.reservedCostUsd)),
      events,
    };
    if (await casLedger(context.guestDbId, snapshot, next, now)) {
      const policy = aiCostPolicy();
      const budgetCapUsd = effectiveBudgetCapUsd(context, policy.maxConversationCostUsd);
      const latencyMs = Math.max(0, now.getTime() - Date.parse(previous.at || now.toISOString()));
      await persistAiCallCost({
        conversationId:context.conversationId,
        eventId:context.eventId,
        channel:context.channel,
        model:reservation.model,
        callPurpose:context.callerLabel,
        inputTokens:updated.inputTokens,
        cachedInputTokens:updated.cachedInputTokens,
        outputTokens:updated.outputTokens,
        costUsd:updated.actualCostUsd,
        costThb:usdToThb(updated.actualCostUsd),
        callIndexTurn:updated.callIndexTurn,
        callIndexConversation:updated.callIndexConversation,
        status:updated.status === 'failed' ? 'failed' : 'completed',
        latencyMs,
        certificationMode:context.certificationMode,
        occurredAt:now.toISOString(),
      }).catch(error=>{
        console.error('AI_COST_PERSIST_ERROR', error instanceof Error ? error.message.slice(0,180) : 'unknown');
      });
      emitCostMetric({
        conversation_id:context.conversationId,
        event_id:context.eventId,
        channel:context.channel,
        provider:'openai',
        model:reservation.model,
        input_tokens:updated.inputTokens,
        cached_input_tokens:updated.cachedInputTokens,
        output_tokens:updated.outputTokens,
        call_cost_usd:updated.actualCostUsd,
        call_cost_thb:usdToThb(updated.actualCostUsd),
        conversation_cost_usd:next.cumulativeCostUsd,
        conversation_cost_thb:usdToThb(next.cumulativeCostUsd),
        call_index_turn:updated.callIndexTurn,
        call_index_conversation:updated.callIndexConversation,
        call_purpose:context.callerLabel,
        semantic_supervisor_caller_label:context.callerLabel,
        budget_remaining_usd:roundUsd(budgetCapUsd - next.cumulativeCostUsd - next.reservedCostUsd),
        budget_remaining_thb:usdToThb(budgetCapUsd - next.cumulativeCostUsd - next.reservedCostUsd),
        deterministic_turn:false,
        paid_call_used:true,
        ai_paid_call:1,
        timestamp:now.toISOString(),
      });
      return;
    }
  }
}

export async function readActiveAiLedgerSpendThb(
  guestDbId: string,
  conversationId: string,
  now: Date = new Date(),
): Promise<number> {
  const snapshot = await loadGuestAgentStateSnapshot(guestDbId);
  const context: AiCallContext = {
    conversationId,
    guestDbId,
    channel: 'agent_primary',
    eventId: 'agent-primary-budget-read',
    callerLabel: 'agent_primary_budget_read',
  };
  const ledger = parseLedger(snapshot.state[STATE_KEY], context, now);
  return usdToThb(ledger.cumulativeCostUsd + ledger.reservedCostUsd);
}

function activePrimaryAgentSpendUsdFromSnapshot(
  snapshot: GuestAgentStateSnapshot,
  context: AiCallContext,
  now: Date,
): number {
  const raw = snapshot.state.thongthaiProductionAgentSession;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 0;
  const value = raw as {
    cumulativeCostThb?: unknown;
    lastConversationId?: unknown;
    lastUsedAt?: unknown;
  };
  if (String(value.lastConversationId ?? '') !== context.conversationId.slice(0,180)) return 0;
  const lastUsed = Date.parse(String(value.lastUsedAt ?? ''));
  if (!Number.isFinite(lastUsed) || now.getTime() - lastUsed >= aiCostPolicy().conversationIdleMs) return 0;
  const thb = Math.max(0, Number(value.cumulativeCostThb) || 0);
  return thb / Math.max(0.000001, usdToThb(1));
}

export function emitZeroCallTurn(context: Pick<AiCallContext, 'conversationId'|'eventId'|'channel'>): void {
  emitCostMetric({
    conversation_id:context.conversationId,
    event_id:context.eventId,
    channel:context.channel,
    deterministic_turn:true,
    paid_call_used:false,
    ai_zero_call_turn:1,
    timestamp:new Date().toISOString(),
  });
}
