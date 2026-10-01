import type { BrainChannel } from './_thongthai-brain-v3';
import { THONGTHAI_PRODUCTION_AGENT_ID, THONGTHAI_STAGING_AGENT_ID } from './_thongthai-agent-profile';
import { executeThongthaiAgentTool } from './_thongthai-agent-tools';
import type { ThongthaiAgentTransactionMode } from './_thongthai-agent-transactions';
import { loadGuestAgentStateSnapshot, patchGuestAgentState } from './_guest-agent-state-store';
import { calculateAiCostUsd, usdToThb, aiCostPolicy, pricingForModel } from './_ai-cost-policy';
import { persistAiCallCost } from './_ai-cost-store';
import { readActiveAiLedgerSpendThb } from './_ai-cost-ledger';

const API_BASE = 'https://api.openai.com/v1';
const BETA_HEADER = 'agents=v1';
const STAGING_SESSION_STATE_KEY = 'thongthaiStagingAgentSession';
const PRODUCTION_SESSION_STATE_KEY = 'thongthaiProductionAgentSession';
export const AGENT_MAX_TOOL_ROUNDS = 8;
export const AGENT_MAX_TOOL_CALLS = 12;
const MAX_POLL_ROUNDS = 80;
const POLL_MS = 150;
const USAGE_SETTLE_ATTEMPTS = 12;
const USAGE_SETTLE_MS = 400;
export const AGENT_TURN_RESERVE_THB = 2.75;

type Usage = {
  input_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens?: number;
};

type AgentSession = {
  id: string;
  status: 'idle' | 'in_progress' | 'requires_action' | 'failed' | string;
  required_actions?: Array<{
    type?: string;
    turn_id?: string;
    call_id?: string;
    name?: string;
    arguments?: unknown;
  }>;
  error?: unknown;
};

type AgentTurn = {
  id: string;
  agent_id?: string;
  status: string;
  completed_at?: number | null;
  error?: { code?: string; message?: string } | null;
  usage?: Usage | null;
};

type SessionItem = {
  id?: string;
  type?: string;
  role?: string;
  turn_id?: string;
  status?: string;
  content?: Array<{ type?: string; text?: string }>;
};

type SessionState = {
  agentId: string;
  sessionId: string;
  createdAt: string;
  lastUsedAt: string;
  turnCount: number;
  cumulativeCostThb: number;
  costAccountingIncomplete: boolean;
  lastTurnId?: string;
  lastEventId?: string;
  lastConversationId?: string;
  lastChannel?: BrainChannel;
  lastEnvironment?: 'live' | 'test';
};

export type AgentRuntimeMode = 'shadow' | 'primary';

export type AgentShadowTurnInput = {
  guestDbId: string;
  conversationId: string;
  eventId: string;
  channel: BrainChannel;
  message: string;
  environment?: 'live' | 'test';
  transactionMode?: ThongthaiAgentTransactionMode;
  runtimeMode?: AgentRuntimeMode;
};

export type AgentShadowTurnResult = {
  sessionId: string;
  turnId: string;
  output: string;
  toolCalls: string[];
  createdSession: boolean;
  usage: {
    available: boolean;
    inputTokens: number | null;
    cachedInputTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
    costThb: number | null;
  };
  cumulativeCostThb: number;
};

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error('OPENAI_API_KEY is required for Thongthai Agent shadow mode.');
  return key;
}

async function openai<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
      'OpenAI-Beta': BETA_HEADER,
      ...(init.headers ?? {}),
    },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`OpenAI Agents API ${response.status} ${path}: ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) as T : ({} as T);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseState(raw: unknown, expectedAgentId: string): SessionState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Partial<SessionState>;
  if (value.agentId !== expectedAgentId || typeof value.sessionId !== 'string' || !value.sessionId) return null;
  return {
    agentId: value.agentId,
    sessionId: value.sessionId,
    createdAt: String(value.createdAt ?? new Date().toISOString()),
    lastUsedAt: String(value.lastUsedAt ?? new Date().toISOString()),
    turnCount: Math.max(0, Math.floor(Number(value.turnCount) || 0)),
    cumulativeCostThb: Math.max(0, Number(value.cumulativeCostThb) || 0),
    costAccountingIncomplete: value.costAccountingIncomplete === true,
    ...(typeof value.lastTurnId === 'string' && value.lastTurnId ? { lastTurnId: value.lastTurnId } : {}),
    ...(typeof value.lastEventId === 'string' && value.lastEventId ? { lastEventId: value.lastEventId } : {}),
    ...(typeof value.lastConversationId === 'string' && value.lastConversationId ? { lastConversationId: value.lastConversationId } : {}),
    ...(value.lastChannel === 'line' || value.lastChannel === 'web' || value.lastChannel === 'facebook' || value.lastChannel === 'backoffice'
      ? { lastChannel: value.lastChannel } : {}),
    ...(value.lastEnvironment === 'test' ? { lastEnvironment: 'test' as const } : { lastEnvironment: 'live' as const }),
  };
}

type AgentRuntimeConfig = {
  mode: AgentRuntimeMode;
  agentId: string;
  stateKey: string;
  callPurpose: string;
};

function runtimeConfig(input: AgentShadowTurnInput): AgentRuntimeConfig {
  if (input.runtimeMode === 'primary') {
    if (!THONGTHAI_PRODUCTION_AGENT_ID) {
      throw new Error('THONGTHAI_PRODUCTION_AGENT_ID is required for primary Agent mode.');
    }
    return {
      mode: 'primary',
      agentId: THONGTHAI_PRODUCTION_AGENT_ID,
      stateKey: PRODUCTION_SESSION_STATE_KEY,
      callPurpose: 'agent_primary_turn_aggregate',
    };
  }
  return {
    mode: 'shadow',
    agentId: THONGTHAI_STAGING_AGENT_ID,
    stateKey: STAGING_SESSION_STATE_KEY,
    callPurpose: runtime.callPurpose,
  };
}

async function loadPersistedSession(
  guestDbId: string,
  runtime: AgentRuntimeConfig,
): Promise<SessionState | null> {
  const snapshot = await loadGuestAgentStateSnapshot(guestDbId);
  return parseState(snapshot.state[runtime.stateKey], runtime.agentId);
}

async function saveSessionState(
  guestDbId: string,
  runtime: AgentRuntimeConfig,
  state: SessionState,
): Promise<void> {
  const ok = await patchGuestAgentState(guestDbId, { set: { [runtime.stateKey]: state } });
  if (!ok) throw new Error('Could not persist Thongthai Agent session state.');
}

async function createSession(
  input: AgentShadowTurnInput,
  runtime: AgentRuntimeConfig,
): Promise<AgentSession> {
  return openai<AgentSession>('/agents/sessions', {
    method: 'POST',
    body: JSON.stringify({
      agent_id: runtime.agentId,
      environment: { type: 'none' },
      input: input.message,
      metadata: {
        app: 'thammachat',
        mode: runtime.mode,
        guest_id: input.guestDbId.slice(0, 64),
        channel: input.channel,
      },
    }),
  });
}

async function sendMessage(sessionId: string, input: AgentShadowTurnInput): Promise<void> {
  await openai<void>(`/agents/sessions/${sessionId}/events`, {
    method: 'POST',
    body: JSON.stringify({
      events: [{
        type: 'agent.session.input.message',
        input: [{
          role: 'user',
          content: [{ type: 'input_text', text: input.message }],
        }],
      }],
    }),
  });
}

async function retrieveSession(sessionId: string): Promise<AgentSession> {
  return openai<AgentSession>(`/agents/sessions/${sessionId}`);
}

async function latestTurn(sessionId: string): Promise<AgentTurn | null> {
  const page = await openai<{ data?: AgentTurn[] }>(`/agents/sessions/${sessionId}/turns?order=desc&limit=1`);
  return page.data?.[0] ?? null;
}

async function retrieveTurn(sessionId: string, turnId: string): Promise<AgentTurn> {
  return openai<AgentTurn>(`/agents/sessions/${sessionId}/turns/${turnId}`);
}

async function retrieveTurnWithSettledUsage(sessionId: string, turnId: string): Promise<AgentTurn> {
  let turn = await retrieveTurn(sessionId, turnId);
  for (let attempt = 0; attempt < USAGE_SETTLE_ATTEMPTS && !turn.usage; attempt += 1) {
    await sleep(USAGE_SETTLE_MS);
    turn = await retrieveTurn(sessionId, turnId);
  }
  return turn;
}

async function submitToolResults(
  sessionId: string,
  actions: NonNullable<AgentSession['required_actions']>,
  input: AgentShadowTurnInput,
  toolCalls: string[],
  toolCache: Map<string, string>,
): Promise<void> {
  const events = [];
  for (const action of actions) {
    if (action.type !== 'function_call' || !action.turn_id || !action.call_id || !action.name) {
      throw new Error(`Unsupported Agent required action: ${String(action.type ?? 'unknown')}`);
    }
    if (toolCalls.length >= AGENT_MAX_TOOL_CALLS) {
      throw new Error('Agent tool call count exceeded safe shadow limit.');
    }
    toolCalls.push(action.name);
    let parsedArgs: unknown = {};
    if (typeof action.arguments === 'string') {
      try { parsedArgs = JSON.parse(action.arguments); } catch { parsedArgs = {}; }
    } else if (action.arguments && typeof action.arguments === 'object') {
      parsedArgs = action.arguments;
    }
    try {
      const cacheKey = `${action.name}:${JSON.stringify(parsedArgs)}`;
      let output = toolCache.get(cacheKey);
      if (output === undefined) {
        output = await executeThongthaiAgentTool(action.name, parsedArgs, {
          guestDbId: input.guestDbId,
          channel: input.channel,
          environment: input.environment ?? 'live',
          eventId: input.eventId,
          message: input.message,
          transactionMode: input.transactionMode ?? 'off',
        });
        toolCache.set(cacheKey, output);
      }
      events.push({
        type: 'agent.session.input.tool_result',
        turn_id: action.turn_id,
        call_id: action.call_id,
        success: true,
        output,
      });
    } catch (error) {
      events.push({
        type: 'agent.session.input.tool_result',
        turn_id: action.turn_id,
        call_id: action.call_id,
        success: false,
        error: error instanceof Error ? error.message.slice(0, 300) : 'tool_failed',
      });
    }
  }
  if (events.length) {
    await openai<void>(`/agents/sessions/${sessionId}/events`, {
      method: 'POST',
      body: JSON.stringify({ events }),
    });
  }
}

async function waitForCompletedTurn(
  sessionId: string,
  input: AgentShadowTurnInput,
  previousTurnId: string | null,
): Promise<{ turn: AgentTurn; toolCalls: string[] }> {
  const toolCalls: string[] = [];
  const toolCache = new Map<string, string>();
  let toolRounds = 0;
  for (let poll = 0; poll < MAX_POLL_ROUNDS; poll += 1) {
    const session = await retrieveSession(sessionId);
    if (session.status === 'failed') {
      throw new Error(`Agent session failed: ${JSON.stringify(session.error ?? 'unknown').slice(0, 300)}`);
    }
    if (session.status === 'requires_action' || (session.required_actions?.length ?? 0) > 0) {
      toolRounds += 1;
      if (toolRounds > AGENT_MAX_TOOL_ROUNDS) throw new Error('Agent tool loop exceeded safe shadow limit.');
      await submitToolResults(sessionId, session.required_actions ?? [], input, toolCalls, toolCache);
      continue;
    }

    const turn = await latestTurn(sessionId);
    // POST /events is accepted asynchronously. Immediately after sending a
    // new message, the session can still be idle and /turns?order=desc can
    // still return the PREVIOUS completed turn. Never mistake that stale
    // turn for completion of the newly-submitted customer message.
    if (turn?.id && previousTurnId && turn.id === previousTurnId) {
      await sleep(POLL_MS);
      continue;
    }
    if (turn?.status === 'completed') return { turn, toolCalls };
    if (turn?.status === 'failed' || turn?.status === 'cancelled') {
      throw new Error(`Agent turn ${turn.status}: ${turn.error?.message ?? turn.error?.code ?? 'unknown'}`);
    }
    await sleep(POLL_MS);
  }
  throw new Error('Agent shadow turn timed out before completion.');
}

export function finalAssistantTextFromItems(items: SessionItem[], turnId: string): string | null {
  // A tool-using Agent turn can emit one or more intermediate assistant
  // messages before function calls, then a final answer after tool results.
  // Only the LAST assistant message is customer-facing. Joining every
  // assistant message leaks internal progress narration and duplicates text.
  const messages = items.filter(item =>
    item.type === 'message' && item.role === 'assistant' && item.turn_id === turnId
  );
  const finalMessage = messages.at(-1);
  const parts = (finalMessage?.content ?? [])
    .filter(part => part.type === 'output_text' && typeof part.text === 'string')
    .map(part => part.text!.trim())
    .filter(Boolean);
  return parts.length ? parts.join('\n').trim() : null;
}

async function outputForTurn(sessionId: string, turnId: string): Promise<string> {
  const page = await openai<{ data?: SessionItem[] }>(`/agents/sessions/${sessionId}/items?order=asc&limit=100`);
  const output = finalAssistantTextFromItems(page.data ?? [], turnId);
  if (!output) throw new Error('Agent completed without customer-facing output text.');
  return output;
}

export function conservativeAgentCostUsd(model: string, usage: { inputTokens:number; cachedInputTokens:number; outputTokens:number }): number {
  // Agents API usage does not expose cache-write tokens separately. GPT-5.6
  // cache writes can cost 1.25x standard input, so treat ALL uncached input
  // as cache-write eligible. This intentionally overestimates rather than
  // letting the 5 THB owner cap depend on an unknowable cheaper assumption.
  const base = calculateAiCostUsd(model, usage);
  const pricing = pricingForModel(model);
  const uncached = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  const possibleCacheWriteUplift = uncached * pricing.inputUsdPerMillion * 0.25 / 1_000_000;
  return base + possibleCacheWriteUplift;
}

function usageFromTurn(turn: AgentTurn): AgentShadowTurnResult['usage'] {
  if (!turn.usage) {
    return {
      available: false,
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      costUsd: null,
      costThb: null,
    };
  }
  const inputTokens = Math.max(0, Math.floor(Number(turn.usage.input_tokens) || 0));
  const cachedInputTokens = Math.min(inputTokens, Math.max(0, Math.floor(Number(turn.usage.input_tokens_details?.cached_tokens) || 0)));
  const outputTokens = Math.max(0, Math.floor(Number(turn.usage.output_tokens) || 0));
  const model = process.env.THONGTHAI_AGENT_MODEL?.trim() || 'gpt-5.6-terra';
  const costUsd = conservativeAgentCostUsd(model, { inputTokens, cachedInputTokens, outputTokens });
  return { available: true, inputTokens, cachedInputTokens, outputTokens, costUsd, costThb: usdToThb(costUsd) };
}

async function persistAgentCost(input: AgentShadowTurnInput, runtime: AgentRuntimeConfig, turn: AgentTurn, usage: AgentShadowTurnResult['usage']): Promise<void> {
  if (!usage.available
      || usage.inputTokens === null
      || usage.cachedInputTokens === null
      || usage.outputTokens === null
      || usage.costUsd === null
      || usage.costThb === null) return;
  const model = process.env.THONGTHAI_AGENT_MODEL?.trim() || 'gpt-5.6-terra';
  await persistAiCallCost({
    conversationId: input.conversationId,
    eventId: input.eventId,
    channel: input.channel,
    model,
    callPurpose: 'agent_shadow_turn_aggregate',
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    outputTokens: usage.outputTokens,
    costUsd: usage.costUsd,
    costThb: usage.costThb,
    callIndexTurn: 1,
    callIndexConversation: 1,
    status: turn.status === 'completed' ? 'completed' : 'failed',
    latencyMs: 0,
    certificationMode: input.environment === 'test',
    occurredAt: new Date().toISOString(),
  }).catch(() => {});
}

async function reconcilePendingUsage(
  input: AgentShadowTurnInput,
  runtime: AgentRuntimeConfig,
  state: SessionState,
): Promise<SessionState> {
  if (!state.costAccountingIncomplete) return state;
  if (!state.lastTurnId || !state.lastEventId) {
    throw new Error('Thongthai Agent shadow usage accounting is pending without a recoverable turn reference.');
  }

  const settledTurn = await retrieveTurnWithSettledUsage(state.sessionId, state.lastTurnId);
  const usage = usageFromTurn(settledTurn);
  if (!usage.available || usage.costThb === null) {
    throw new Error('Thongthai Agent shadow usage accounting is still pending; refusing another paid turn.');
  }

  const priorInput: AgentShadowTurnInput = {
    ...input,
    conversationId: state.lastConversationId ?? input.conversationId,
    eventId: state.lastEventId,
    channel: state.lastChannel ?? input.channel,
    environment: state.lastEnvironment ?? input.environment ?? 'live',
  };
  await persistAgentCost(priorInput, runtime, settledTurn, usage);

  const reconciled: SessionState = {
    ...state,
    cumulativeCostThb: Math.round((state.cumulativeCostThb + usage.costThb) * 10_000) / 10_000,
    costAccountingIncomplete: false,
    lastUsedAt: new Date().toISOString(),
  };
  await saveSessionState(input.guestDbId, runtime, reconciled);
  return reconciled;
}

export function shouldStartNewAgentConversation(
  state: Pick<SessionState, 'lastUsedAt'|'lastConversationId'>,
  conversationId: string,
  now: Date = new Date(),
): boolean {
  if (state.lastConversationId && state.lastConversationId !== conversationId) return true;
  const lastUsed = Date.parse(state.lastUsedAt);
  if (!Number.isFinite(lastUsed)) return true;
  return now.getTime() - lastUsed >= aiCostPolicy().conversationIdleMs;
}

async function runThongthaiAgentTurn(input: AgentShadowTurnInput): Promise<AgentShadowTurnResult> {
  if (!input.guestDbId || !input.message.trim()) throw new Error('guestDbId and message are required.');
  const runtime = runtimeConfig(input);

  let existing = await loadPersistedSession(input.guestDbId, runtime);
  if (existing?.costAccountingIncomplete) {
    existing = await reconcilePendingUsage(input, runtime, existing);
  }
  if (existing && shouldStartNewAgentConversation(existing, input.conversationId)) {
    existing = null;
  }

  const capThb = aiCostPolicy().maxConversationCostUsd * (usdToThb(1));
  const externalLegacySpendThb = runtime.mode === 'primary'
    ? await readActiveAiLedgerSpendThb(input.guestDbId, input.conversationId)
    : 0;
  const agentSpendThb = existing?.cumulativeCostThb ?? 0;
  const combinedSpendThb = agentSpendThb + externalLegacySpendThb;
  if (combinedSpendThb >= capThb) {
    throw new Error('Thongthai Agent conversation cost cap reached.');
  }
  if (capThb - combinedSpendThb < AGENT_TURN_RESERVE_THB) {
    throw new Error('Thongthai Agent remaining combined budget is below the safe per-turn reserve.');
  }

  let sessionId: string;
  let createdSession = false;
  if (existing) {
    sessionId = existing.sessionId;
    await sendMessage(sessionId, input);
  } else {
    const created = await createSession(input, runtime);
    sessionId = created.id;
    createdSession = true;
    await saveSessionState(input.guestDbId, runtime, {
      agentId: runtime.agentId,
      sessionId,
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
      turnCount: 0,
      cumulativeCostThb: 0,
      costAccountingIncomplete: false,
      lastEventId: input.eventId,
      lastConversationId: input.conversationId,
      lastChannel: input.channel,
      lastEnvironment: input.environment ?? 'live',
    });
  }

  const { turn, toolCalls } = await waitForCompletedTurn(
    sessionId,
    input,
    existing?.lastTurnId ?? null,
  );
  const output = await outputForTurn(sessionId, turn.id);
  const settledTurn = await retrieveTurnWithSettledUsage(sessionId, turn.id);
  const usage = usageFromTurn(settledTurn);
  await persistAgentCost(input, runtime, settledTurn, usage);

  const prior = existing?.cumulativeCostThb ?? 0;
  const turnCostThb = usage.costThb ?? 0;
  const cumulativeCostThb = Math.round((prior + turnCostThb) * 10_000) / 10_000;
  await saveSessionState(input.guestDbId, runtime, {
    agentId: runtime.agentId,
    sessionId,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    turnCount: (existing?.turnCount ?? 0) + 1,
    cumulativeCostThb,
    costAccountingIncomplete: !usage.available,
    lastTurnId: turn.id,
    lastEventId: input.eventId,
    lastConversationId: input.conversationId,
    lastChannel: input.channel,
    lastEnvironment: input.environment ?? 'live',
  });

  return {
    sessionId,
    turnId: turn.id,
    output,
    toolCalls,
    createdSession,
    usage,
    cumulativeCostThb,
  };
}

export async function runThongthaiAgentShadowTurn(
  input: AgentShadowTurnInput,
): Promise<AgentShadowTurnResult> {
  return runThongthaiAgentTurn({ ...input, runtimeMode: 'shadow' });
}

export async function runThongthaiAgentPrimaryTurn(
  input: Omit<AgentShadowTurnInput, 'environment'|'transactionMode'|'runtimeMode'>,
): Promise<AgentShadowTurnResult> {
  return runThongthaiAgentTurn({
    ...input,
    environment: 'live',
    transactionMode: 'off',
    runtimeMode: 'primary',
  });
}

