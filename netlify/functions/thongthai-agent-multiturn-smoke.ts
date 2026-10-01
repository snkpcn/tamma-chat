import type { Handler } from '@netlify/functions';
import { loadCustomerMemory } from './_customer-db';
import { loadGuestAgentStateSnapshot, patchGuestAgentState } from './_guest-agent-state-store';
import { runThongthaiAgentShadowTurn } from './_thongthai-agent-session';

const SMOKE_ANONYMOUS_ID = 'a11e7c58-6c4f-4a4d-9e2d-202610010002';
const SMOKE_STATE_KEY = 'thongthaiAgentMultiTurnSmokeV1';
const CONVERSATION_ID = 'thongthai-agent-multiturn-smoke-20261001';

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
    results: Array.isArray(value.results) ? value.results as TurnResult[] : [],
  };
}

export const handler: Handler = async event => {
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'method_not_allowed' });

  const customer = await loadCustomerMemory(SMOKE_ANONYMOUS_ID, 'th', emptyGuestContext());
  if (!customer?.guestDbId) return json(503, { ok: false, error: 'synthetic_guest_unavailable' });

  const snapshot = await loadGuestAgentStateSnapshot(customer.guestDbId);
  const existing = readState(snapshot.state[SMOKE_STATE_KEY]);
  if (existing?.status === 'completed' || existing?.status === 'partial_failure') {
    return json(200, { ok: existing.status === 'completed', reused: true, ...existing });
  }
  if (existing?.status === 'running') {
    const started = Date.parse(existing.startedAt);
    if (Number.isFinite(started) && Date.now() - started < 10 * 60 * 1000) {
      return json(202, { ok: false, reused: true, ...existing });
    }
  }

  const startedAt = new Date().toISOString();
  const results: TurnResult[] = [];
  await patchGuestAgentState(customer.guestDbId, {
    set: { [SMOKE_STATE_KEY]: { status: 'running', startedAt, results } satisfies SmokeState },
  });

  for (let i = 0; i < TURNS.length; i += 1) {
    const message = TURNS[i]!;
    try {
      const result = await runThongthaiAgentShadowTurn({
        guestDbId: customer.guestDbId,
        conversationId: CONVERSATION_ID,
        eventId: `${CONVERSATION_ID}-turn${i + 1}`,
        channel: 'web',
        message,
        environment: 'live',
      });
      results.push({
        turn: i + 1,
        message,
        output: result.output,
        toolCalls: result.toolCalls,
        usageAvailable: result.usage.available,
        inputTokens: result.usage.inputTokens,
        cachedInputTokens: result.usage.cachedInputTokens,
        outputTokens: result.usage.outputTokens,
        costThb: result.usage.costThb,
        cumulativeCostThb: result.cumulativeCostThb,
      });
    } catch (error) {
      results.push({
        turn: i + 1,
        message,
        error: error instanceof Error ? error.message.slice(0, 500) : 'unknown',
      });
      const failed: SmokeState = {
        status: 'partial_failure',
        startedAt,
        finishedAt: new Date().toISOString(),
        results,
      };
      await patchGuestAgentState(customer.guestDbId, { set: { [SMOKE_STATE_KEY]: failed } });
      return json(200, { ok: false, reused: false, ...failed });
    }
  }

  const completed: SmokeState = {
    status: 'completed',
    startedAt,
    finishedAt: new Date().toISOString(),
    results,
  };
  await patchGuestAgentState(customer.guestDbId, { set: { [SMOKE_STATE_KEY]: completed } });
  return json(200, { ok: true, reused: false, ...completed });
};
