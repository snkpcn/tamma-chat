import type { Handler } from '@netlify/functions';
import { loadCustomerMemory } from './_customer-db';
import { loadGuestAgentStateSnapshot, patchGuestAgentState } from './_guest-agent-state-store';
import { runThongthaiAgentShadowTurn } from './_thongthai-agent-session';

const SMOKE_ANONYMOUS_ID = 'a11e7c58-6c4f-4a4d-9e2d-202610010005';
const SMOKE_STATE_KEY = 'thongthaiAgentMultiTurnSmokeV4';
const CONVERSATION_ID = 'thongthai-agent-multiturn-smoke-v4-20261001';

const TURNS = [
  'ขี่ม้ามีกี่ตัว แต่ละตัวชื่ออะไร แล้วราคาเท่าไหร่ครับ',
  'ผมไม่เอาทองไทยนะ ขออีกตัว แล้วตัวนั้น 45 นาทีเท่าไหร่ครับ',
  'โอเคเอาตัวนั้นไว้ก่อน แต่ยังไม่จองนะ แฟนผมแพ้กุ้ง มีเมนูอะไรแนะนำบ้างครับ',
  'แล้วเมื่อกี้ผมเลือกม้าตัวไหนนะครับ',
] as const;

type TurnResult = {
  turn: number;
  message: string;
  output?: string;
  toolCalls?: string[];
  usageAvailable?: boolean;
  inputTokens?: number | null;
  cachedInputTokens?: number | null;
  outputTokens?: number | null;
  costThb?: number | null;
  cumulativeCostThb?: number;
  error?: string;
};

type SmokeState = {
  status: 'running' | 'completed' | 'partial_failure';
  startedAt: string;
  finishedAt?: string;
  nextTurn: number;
  results: TurnResult[];
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

function readState(raw: unknown): SmokeState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Partial<SmokeState>;
  if (!['running', 'completed', 'partial_failure'].includes(String(value.status))) return null;
  return {
    status: value.status as SmokeState['status'],
    startedAt: String(value.startedAt ?? ''),
    finishedAt: value.finishedAt,
    nextTurn: Math.max(1, Math.floor(Number(value.nextTurn) || 1)),
    results: Array.isArray(value.results) ? value.results as TurnResult[] : [],
  };
}

export const handler: Handler = async event => {
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'method_not_allowed' });

  const requestedTurn = Math.floor(Number(event.queryStringParameters?.turn));
  if (!Number.isInteger(requestedTurn) || requestedTurn < 1 || requestedTurn > TURNS.length) {
    return json(400, { ok: false, error: 'turn_must_be_1_to_4' });
  }

  const customer = await loadCustomerMemory(SMOKE_ANONYMOUS_ID, 'th', emptyGuestContext());
  if (!customer?.guestDbId) return json(503, { ok: false, error: 'synthetic_guest_unavailable' });

  const snapshot = await loadGuestAgentStateSnapshot(customer.guestDbId);
  const existing = readState(snapshot.state[SMOKE_STATE_KEY]);
  const state: SmokeState = existing ?? {
    status: 'running',
    startedAt: new Date().toISOString(),
    nextTurn: 1,
    results: [],
  };

  const already = state.results.find(result => result.turn === requestedTurn);
  if (already) {
    return json(200, {
      ok: !already.error,
      reused: true,
      status: state.status,
      nextTurn: state.nextTurn,
      result: already,
      cumulativeResults: state.results,
    });
  }

  if (state.status === 'completed' || state.status === 'partial_failure') {
    return json(409, { ok: false, error: 'smoke_already_terminal', ...state });
  }
  if (requestedTurn !== state.nextTurn) {
    return json(409, {
      ok: false,
      error: 'turn_out_of_sequence',
      expectedTurn: state.nextTurn,
      requestedTurn,
      cumulativeResults: state.results,
    });
  }

  const message = TURNS[requestedTurn - 1]!;
  try {
    const result = await runThongthaiAgentShadowTurn({
      guestDbId: customer.guestDbId,
      conversationId: CONVERSATION_ID,
      eventId: `${CONVERSATION_ID}-turn${requestedTurn}`,
      channel: 'web',
      message,
      environment: 'live',
    });
    const row: TurnResult = {
      turn: requestedTurn,
      message,
      output: result.output,
      toolCalls: result.toolCalls,
      usageAvailable: result.usage.available,
      inputTokens: result.usage.inputTokens,
      cachedInputTokens: result.usage.cachedInputTokens,
      outputTokens: result.usage.outputTokens,
      costThb: result.usage.costThb,
      cumulativeCostThb: result.cumulativeCostThb,
    };
    const results = [...state.results, row];
    const completed = requestedTurn === TURNS.length;
    const next: SmokeState = {
      status: completed ? 'completed' : 'running',
      startedAt: state.startedAt,
      ...(completed ? { finishedAt: new Date().toISOString() } : {}),
      nextTurn: completed ? TURNS.length + 1 : requestedTurn + 1,
      results,
    };
    await patchGuestAgentState(customer.guestDbId, { set: { [SMOKE_STATE_KEY]: next } });
    return json(200, {
      ok: true,
      reused: false,
      status: next.status,
      nextTurn: next.nextTurn,
      result: row,
      cumulativeResults: results,
    });
  } catch (error) {
    const row: TurnResult = {
      turn: requestedTurn,
      message,
      error: error instanceof Error ? error.message.slice(0, 500) : 'unknown',
    };
    const failed: SmokeState = {
      status: 'partial_failure',
      startedAt: state.startedAt,
      finishedAt: new Date().toISOString(),
      nextTurn: requestedTurn,
      results: [...state.results, row],
    };
    await patchGuestAgentState(customer.guestDbId, { set: { [SMOKE_STATE_KEY]: failed } });
    return json(200, {
      ok: false,
      reused: false,
      status: failed.status,
      nextTurn: failed.nextTurn,
      result: row,
      cumulativeResults: failed.results,
    });
  }
};
