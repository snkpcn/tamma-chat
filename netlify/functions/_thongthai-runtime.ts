import type { BrainChannel, BrainResponse, BrainToolCall, BrainToolResult, BrainRuntimeContext, BrainRequest } from './_thongthai-brain';

const SAFE_MEMORY_KEYS = new Set([
  'discovery_style',
  'preferred_moods',
  'experience_preferences',
  'stay_preferences',
  'activity_preferences',
  'avoid_experiences',
]);
const EXPERIENCE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,119}$/i;

type DbConfig = { url: string; key: string };
type WorldFactRow = { fact_key: string; category: string; fact_value: unknown; source: string | null; updated_at: string };
type SemanticMemoryRow = { memory_key: string; memory_value: unknown; confidence: number; source_channel: string; evidence_count: number; last_observed_at: string };

function configuration(): DbConfig | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/$/, ''), key } : null;
}

async function dbFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const config = configuration();
  if (!config) throw new Error('Supabase configuration missing');
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Supabase request failed ${response.status}: ${body.slice(0, 180)}`);
  }
  return response;
}

function channelProvider(channel: BrainChannel): 'web' | 'line' | 'facebook' | 'backoffice' {
  return channel === 'facebook' ? 'facebook' : channel;
}

function safeShortText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text) return null;
  const withoutEmail = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email removed]');
  const withoutPhone = withoutEmail.replace(/(?:\+?66|0)\d(?:[\s-]?\d){7,9}/g, '[phone removed]');
  return withoutPhone.slice(0, max);
}

function safeMemoryValue(value: unknown): string | string[] | null {
  if (typeof value === 'string') return safeShortText(value, 120);
  if (!Array.isArray(value)) return null;
  const out = value
    .filter((item): item is string => typeof item === 'string')
    .map(item => safeShortText(item, 80))
    .filter((item): item is string => Boolean(item))
    .slice(0, 12);
  return [...new Set(out)];
}

function encodeEq(value: string): string {
  return encodeURIComponent(value);
}

export async function registerGuestIdentity(
  guestDbId: string | null,
  channel: BrainChannel,
  providerUserKey: string | undefined,
): Promise<void> {
  if (!guestDbId || !providerUserKey || !configuration()) return;
  const key = providerUserKey.trim().slice(0, 128);
  if (!key) return;
  try {
    await dbFetch('guest_identities?on_conflict=provider,provider_user_key', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        guest_id: guestDbId,
        provider: channelProvider(channel),
        provider_user_key: key,
        last_seen_at: new Date().toISOString(),
      }),
    });
  } catch (error) {
    console.error('THONGTHAI_IDENTITY_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
  }
}

export async function loadBrainRuntime(guestDbId: string | null): Promise<BrainRuntimeContext> {
  const fallback: BrainRuntimeContext = { agentState: {}, semanticMemory: [], worldFacts: [], toolResults: [] };
  if (!configuration()) return fallback;
  try {
    const worldPromise = dbFetch(
      'world_facts?active=eq.true&verified=eq.true&select=fact_key,category,fact_value,source,updated_at&order=fact_key.asc',
    ).then(res => res.json() as Promise<WorldFactRow[]>);
    if (!guestDbId) return { ...fallback, worldFacts: await worldPromise };

    const [stateRows, memoryRows, worldFacts] = await Promise.all([
      dbFetch(`guest_agent_state?guest_id=eq.${encodeEq(guestDbId)}&select=state&limit=1`)
        .then(res => res.json() as Promise<Array<{ state: Record<string, unknown> }>>),
      dbFetch(`guest_semantic_memory?guest_id=eq.${encodeEq(guestDbId)}&status=eq.active&select=memory_key,memory_value,confidence,source_channel,evidence_count,last_observed_at&order=last_observed_at.desc&limit=20`)
        .then(res => res.json() as Promise<SemanticMemoryRow[]>),
      worldPromise,
    ]);

    return {
      agentState: stateRows[0]?.state ?? {},
      semanticMemory: memoryRows.map(row => ({
        key: row.memory_key,
        value: row.memory_value,
        confidence: Number(row.confidence),
        sourceChannel: row.source_channel,
        evidenceCount: row.evidence_count,
        lastObservedAt: row.last_observed_at,
      })),
      worldFacts,
      toolResults: [],
    };
  } catch (error) {
    console.error('THONGTHAI_RUNTIME_LOAD_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
    return fallback;
  }
}

async function upsertMemoryArray(
  guestDbId: string,
  key: 'favorites' | 'visited_experiences',
  experienceId: string,
  remove = false,
): Promise<void> {
  const response = await dbFetch(`guest_memory?guest_id=eq.${encodeEq(guestDbId)}&memory_key=eq.${key}&select=memory_value&limit=1`);
  const rows = await response.json() as Array<{ memory_value: unknown }>;
  const current = Array.isArray(rows[0]?.memory_value)
    ? rows[0].memory_value.filter((item): item is string => typeof item === 'string')
    : [];
  const next = remove ? current.filter(item => item !== experienceId) : [...new Set([...current, experienceId])];
  await dbFetch('guest_memory?on_conflict=guest_id,memory_key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ guest_id: guestDbId, memory_key: key, memory_value: next, updated_at: new Date().toISOString() }),
  });
}

async function insertEvent(
  guestDbId: string,
  eventType: string,
  intent: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await dbFetch('guest_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ guest_id: guestDbId, event_type: eventType, intent, metadata }),
  });
}

export async function executeBrainTools(
  guestDbId: string | null,
  channel: BrainChannel,
  calls: BrainToolCall[],
  firstResponse: BrainResponse,
  request: BrainRequest,
): Promise<BrainToolResult[]> {
  if (!calls.length) return [];
  if (!guestDbId || !configuration()) {
    return calls.map(call => ({ name: call.name, ok: false, detail: 'customer_state_unavailable' }));
  }
  const results: BrainToolResult[] = [];
  for (const call of calls.slice(0, 4)) {
    try {
      if (call.name === 'save_journey') {
        const candidate = firstResponse.journeyAction.journey ?? request.journeyContext.currentPlan ?? request.journeyContext.savedPlan;
        if (!candidate) {
          results.push({ name: call.name, ok: false, detail: 'no_journey_to_save' });
          continue;
        }
        await dbFetch('journeys', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ guest_id: guestDbId, action: 'save', intent: 'save_journey', journey: candidate }),
        });
        await insertEvent(guestDbId, 'agent_action', 'save_journey', { action: 'save_journey', channel });
        results.push({ name: call.name, ok: true, detail: 'journey_saved' });
        continue;
      }

      if (call.name === 'favorite_experience' || call.name === 'unfavorite_experience' || call.name === 'mark_visited') {
        const experienceId = typeof call.args.experienceId === 'string' ? call.args.experienceId : '';
        if (!EXPERIENCE_ID_RE.test(experienceId)) {
          results.push({ name: call.name, ok: false, detail: 'invalid_experience_id' });
          continue;
        }
        if (call.name === 'favorite_experience') await upsertMemoryArray(guestDbId, 'favorites', experienceId, false);
        if (call.name === 'unfavorite_experience') await upsertMemoryArray(guestDbId, 'favorites', experienceId, true);
        if (call.name === 'mark_visited') await upsertMemoryArray(guestDbId, 'visited_experiences', experienceId, false);
        await insertEvent(guestDbId, 'agent_action', firstResponse.intent, { action: call.name, experienceId, channel });
        results.push({ name: call.name, ok: true, detail: experienceId });
        continue;
      }

      if (call.name === 'request_handoff') {
        const allowed = new Set(['booking_help', 'accessibility_help', 'complaint', 'other']);
        const reasonCode = allowed.has(String(call.args.reasonCode)) ? String(call.args.reasonCode) : 'other';
        await dbFetch('handoff_requests', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ guest_id: guestDbId, reason_code: reasonCode, source_channel: channelProvider(channel), status: 'pending' }),
        });
        await insertEvent(guestDbId, 'handoff_requested', firstResponse.intent, { reasonCode, channel });
        results.push({ name: call.name, ok: true, detail: reasonCode });
        continue;
      }
      results.push({ name: call.name, ok: false, detail: 'unsupported_tool' });
    } catch (error) {
      console.error('THONGTHAI_TOOL_ERROR', call.name, error instanceof Error ? error.message.slice(0, 180) : 'unknown');
      results.push({ name: call.name, ok: false, detail: 'execution_failed' });
    }
  }
  return results;
}

export async function persistBrainRuntime(
  guestDbId: string | null,
  channel: BrainChannel,
  response: BrainResponse,
): Promise<void> {
  if (!guestDbId || !configuration()) return;
  try {
    const now = new Date().toISOString();
    const currentStateResponse = await dbFetch(`guest_agent_state?guest_id=eq.${encodeEq(guestDbId)}&select=state&limit=1`);
    const currentRows = await currentStateResponse.json() as Array<{ state: Record<string, unknown> }>;
    const current = currentRows[0]?.state ?? {};
    const update = response.agentStateUpdate ?? {};
    const nextState: Record<string, unknown> = {
      ...current,
      last_intent: response.intent,
      last_channel: channel,
      last_style_mode: response.responseStyle,
      updated_by_brain_version: '2026-09-agentic-core-v2',
    };
    const activeTopic = safeShortText(update.activeTopic, 80);
    const summary = safeShortText(update.travelContextSummary, 500);
    const unresolved = safeShortText(update.unresolvedNeed, 180);
    if (activeTopic !== null) nextState.active_topic = activeTopic;
    if (summary !== null) nextState.travel_context_summary = summary;
    if (unresolved !== null) nextState.unresolved_need = unresolved;
    if (update.clearUnresolvedNeed === true) delete nextState.unresolved_need;

    await dbFetch('guest_agent_state?on_conflict=guest_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ guest_id: guestDbId, state: nextState, updated_at: now }),
    });

    for (const memory of (response.semanticMemoryUpdates ?? []).slice(0, 8)) {
      if (!SAFE_MEMORY_KEYS.has(memory.key)) continue;
      const value = safeMemoryValue(memory.value);
      if (value === null) continue;
      const confidence = Math.max(0.5, Math.min(1, Number(memory.confidence) || 0.7));
      const existingResponse = await dbFetch(`guest_semantic_memory?guest_id=eq.${encodeEq(guestDbId)}&memory_key=eq.${encodeEq(memory.key)}&select=evidence_count&limit=1`);
      const existing = await existingResponse.json() as Array<{ evidence_count: number }>;
      await dbFetch('guest_semantic_memory?on_conflict=guest_id,memory_key', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          guest_id: guestDbId,
          memory_key: memory.key,
          memory_value: value,
          confidence,
          source_channel: channelProvider(channel),
          evidence_count: (existing[0]?.evidence_count ?? 0) + 1,
          status: 'active',
          last_observed_at: now,
        }),
      });
      await insertEvent(guestDbId, 'memory_learned', response.intent, { key: memory.key, channel });
    }

    await insertEvent(guestDbId, 'brain_decision', response.intent, {
      channel,
      responseStyle: response.responseStyle,
      journeyAction: response.journeyAction.type,
      toolCount: response.toolCalls?.length ?? 0,
    });
  } catch (error) {
    console.error('THONGTHAI_RUNTIME_PERSIST_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
  }
}

export async function mergeBrainGuestData(sourceGuestDbId: string, targetGuestDbId: string): Promise<void> {
  if (!sourceGuestDbId || !targetGuestDbId || sourceGuestDbId === targetGuestDbId || !configuration()) return;
  try {
    const [sourceMemoryResponse, targetMemoryResponse, sourceStateResponse, targetStateResponse] = await Promise.all([
      dbFetch(`guest_semantic_memory?guest_id=eq.${encodeEq(sourceGuestDbId)}&status=eq.active&select=memory_key,memory_value,confidence,source_channel,evidence_count,last_observed_at`),
      dbFetch(`guest_semantic_memory?guest_id=eq.${encodeEq(targetGuestDbId)}&status=eq.active&select=memory_key,memory_value,confidence,source_channel,evidence_count,last_observed_at`),
      dbFetch(`guest_agent_state?guest_id=eq.${encodeEq(sourceGuestDbId)}&select=state&limit=1`),
      dbFetch(`guest_agent_state?guest_id=eq.${encodeEq(targetGuestDbId)}&select=state&limit=1`),
    ]);
    const sourceMemory = await sourceMemoryResponse.json() as SemanticMemoryRow[];
    const targetMemory = await targetMemoryResponse.json() as SemanticMemoryRow[];
    const sourceState = await sourceStateResponse.json() as Array<{ state: Record<string, unknown> }>;
    const targetState = await targetStateResponse.json() as Array<{ state: Record<string, unknown> }>;
    const targetByKey = new Map(targetMemory.map(row => [row.memory_key, row]));

    for (const source of sourceMemory) {
      const target = targetByKey.get(source.memory_key);
      const preferred = !target || new Date(source.last_observed_at).getTime() > new Date(target.last_observed_at).getTime() ? source : target;
      await dbFetch('guest_semantic_memory?on_conflict=guest_id,memory_key', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          guest_id: targetGuestDbId,
          memory_key: preferred.memory_key,
          memory_value: preferred.memory_value,
          confidence: Math.max(Number(source.confidence), Number(target?.confidence ?? 0)),
          source_channel: preferred.source_channel,
          evidence_count: (source.evidence_count ?? 1) + (target?.evidence_count ?? 0),
          status: 'active',
          last_observed_at: preferred.last_observed_at,
        }),
      });
    }

    const mergedState = { ...(sourceState[0]?.state ?? {}), ...(targetState[0]?.state ?? {}) };
    if (Object.keys(mergedState).length) {
      await dbFetch('guest_agent_state?on_conflict=guest_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ guest_id: targetGuestDbId, state: mergedState, updated_at: new Date().toISOString() }),
      });
    }

    await dbFetch(`guest_identities?guest_id=eq.${encodeEq(sourceGuestDbId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ guest_id: targetGuestDbId, last_seen_at: new Date().toISOString() }),
    });
  } catch (error) {
    console.error('THONGTHAI_RUNTIME_MERGE_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
  }
}
