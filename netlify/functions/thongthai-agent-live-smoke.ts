import type { Handler } from '@netlify/functions';
import { loadCustomerMemory } from './_customer-db';
import { loadGuestAgentStateSnapshot, patchGuestAgentState } from './_guest-agent-state-store';
import { runThongthaiAgentShadowTurn } from './_thongthai-agent-session';

const SMOKE_ANONYMOUS_ID = 'a11e7c58-6c4f-4a4d-9e2d-202610010001';
const SMOKE_STATE_KEY = 'thongthaiAgentShadowSmokeResult';
const SMOKE_CONVERSATION_ID = 'thongthai-agent-shadow-smoke-20261001';
const SMOKE_EVENT_ID = 'thongthai-agent-shadow-smoke-20261001-turn1';
const SMOKE_MESSAGE = 'ขี่ม้ามีกี่ตัว แต่ละตัวชื่ออะไร แล้วราคาเท่าไหร่ครับ';

type SmokeState = {
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt?: string;
  message?: string;
  output?: string;
  toolCalls?: string[];
  costThb?: number;
  cumulativeCostThb?: number;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  error?: string;
};

function emptyGuestContext() {
  return {
    tripDuration: null,
    travelerType: null,
    group: { adults: null, children: null, elderly: null },
    interests: [],
    pace: null,
    budget: null,
    constraints: [],
  };
}

function json(statusCode: number, body: Record<string, unknown>) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

function readSmokeState(raw: unknown): SmokeState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Partial<SmokeState>;
  if (!['running', 'completed', 'failed'].includes(String(value.status))) return null;
  return value as SmokeState;
}

export const handler: Handler = async event => {
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'method_not_allowed' });
  const customer = await loadCustomerMemory(SMOKE_ANONYMOUS_ID, 'th', emptyGuestContext());
  if (!customer?.guestDbId) {
    return json(503, { ok: false, error: 'synthetic_guest_unavailable' });
  }

  const snapshot = await loadGuestAgentStateSnapshot(customer.guestDbId);
  const existing = readSmokeState(snapshot.state[SMOKE_STATE_KEY]);

  if (existing?.status === 'completed') {
    return json(200, { ok: true, mode: 'read_only_live_shadow_smoke', reused: true, ...existing });
  }
  if (existing?.status === 'running') {
    const started = Date.parse(existing.startedAt);
    if (Number.isFinite(started) && Date.now() - started < 10 * 60 * 1000) {
      return json(202, { ok: false, mode: 'read_only_live_shadow_smoke', ...existing });
    }
  }

  const startedAt = new Date().toISOString();
  await patchGuestAgentState(customer.guestDbId, {
    set: {
      [SMOKE_STATE_KEY]: {
        status: 'running',
        startedAt,
        message: SMOKE_MESSAGE,
      } satisfies SmokeState,
    },
  });

  try {
    const result = await runThongthaiAgentShadowTurn({
      guestDbId: customer.guestDbId,
      conversationId: SMOKE_CONVERSATION_ID,
      eventId: SMOKE_EVENT_ID,
      channel: 'web',
      message: SMOKE_MESSAGE,
      environment: 'live',
    });

    const completed: SmokeState = {
      status: 'completed',
      startedAt,
      finishedAt: new Date().toISOString(),
      message: SMOKE_MESSAGE,
      output: result.output,
      toolCalls: result.toolCalls,
      costThb: result.usage.costThb,
      cumulativeCostThb: result.cumulativeCostThb,
      inputTokens: result.usage.inputTokens,
      cachedInputTokens: result.usage.cachedInputTokens,
      outputTokens: result.usage.outputTokens,
    };
    await patchGuestAgentState(customer.guestDbId, { set: { [SMOKE_STATE_KEY]: completed } });
    return json(200, { ok: true, mode: 'read_only_live_shadow_smoke', reused: false, ...completed });
  } catch (error) {
    const failed: SmokeState = {
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      message: SMOKE_MESSAGE,
      error: error instanceof Error ? error.message.slice(0, 500) : 'unknown',
    };
    await patchGuestAgentState(customer.guestDbId, { set: { [SMOKE_STATE_KEY]: failed } });
    return json(502, { ok: false, mode: 'read_only_live_shadow_smoke', ...failed });
  }
};
