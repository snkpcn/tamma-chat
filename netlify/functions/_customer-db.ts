type GuestContextShape = {
  tripDuration: string | null;
  travelerType: string | null;
  group: { adults: number | null; children: number | null; elderly: number | null };
  interests: string[];
  pace: string | null;
  budget: number | null;
  constraints: string[];
};

type ChatResultShape = {
  intent: string;
  contextUpdates: Partial<GuestContextShape>;
  journeyAction: { type: 'none' | 'create' | 'modify' | 'replace'; journey: unknown | null };
};

type JourneyContextShape = {
  currentPlan: unknown | null;
  savedPlan: unknown | null;
};

export interface CustomerState {
  guestDbId: string;
  guestContext: GuestContextShape;
}

const TRAVELER_TYPES = new Set(['solo', 'couple', 'friends', 'family', 'group']);
const TRIP_DURATIONS = new Set(['short', 'half', 'full', 'overnight', '2d1n', '3d2n']);
const PACES = new Set(['slow', 'relaxed', 'balanced', 'active']);
const INTERESTS = new Set([
  'food', 'nature', 'adventure', 'rest', 'culture', 'coffee',
  'local_community', 'family', 'photography', 'wellness',
]);
const CONSTRAINTS = new Set([
  'limited_walking', 'wheelchair_access', 'elderly_friendly', 'child_friendly',
  'vegetarian', 'no_spicy', 'rain_sensitive',
]);
const LANGUAGES = new Set(['th', 'en', 'zh', 'lo', 'vi']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeDbError(stage: string, err: unknown): void {
  const message = err instanceof Error ? err.message : 'Unknown database error';
  console.error('THONGTHAI_DB_ERROR', stage, message.slice(0, 240));
}

function configuration(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/$/, ''), key } : null;
}

async function dbFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const config = configuration();
  if (!config) throw new Error('Customer database is not configured');

  const res = await fetch(config.url + '/rest/v1/' + path, {
    ...init,
    headers: {
      apikey: config.key,
      Authorization: 'Bearer ' + config.key,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    throw new Error('Customer database request failed: ' + res.status);
  }

  return res;
}

function dedupeAllowed(value: unknown, allowed: Set<string>): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && allowed.has(item)))];
}

function finiteCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function sanitizeGroup(value: unknown): GuestContextShape['group'] | null {
  if (!value || typeof value !== 'object') return null;
  const group = value as Record<string, unknown>;
  const clean = {
    adults: finiteCount(group.adults),
    children: finiteCount(group.children),
    elderly: finiteCount(group.elderly),
  };
  return Object.values(clean).some(item => item !== null) ? clean : null;
}

function budgetBand(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  if (value < 3000) return 'under_3000';
  if (value < 8000) return '3000_8000';
  if (value < 15000) return '8000_15000';
  return '15000_plus';
}

function mergeGuestContext(
  current: GuestContextShape,
  rows: Array<{ memory_key: string; memory_value: unknown }>,
): GuestContextShape {
  const persisted = Object.fromEntries(rows.map(row => [row.memory_key, row.memory_value]));
  const storedGroup = sanitizeGroup(persisted.group);
  const currentGroup = current.group ?? { adults: null, children: null, elderly: null };

  return {
    tripDuration: current.tripDuration || (TRIP_DURATIONS.has(String(persisted.trip_duration)) ? String(persisted.trip_duration) : null),
    travelerType: current.travelerType || (TRAVELER_TYPES.has(String(persisted.traveler_type)) ? String(persisted.traveler_type) : null),
    group: {
      adults: currentGroup.adults ?? storedGroup?.adults ?? null,
      children: currentGroup.children ?? storedGroup?.children ?? null,
      elderly: currentGroup.elderly ?? storedGroup?.elderly ?? null,
    },
    interests: current.interests?.length ? dedupeAllowed(current.interests, INTERESTS) : dedupeAllowed(persisted.interests, INTERESTS),
    pace: current.pace || (PACES.has(String(persisted.pace)) ? String(persisted.pace) : null),
    budget: typeof current.budget === 'number' ? current.budget : null,
    constraints: current.constraints?.length ? dedupeAllowed(current.constraints, CONSTRAINTS) : dedupeAllowed(persisted.constraints, CONSTRAINTS),
  };
}

async function insertEvent(guestDbId: string, eventType: string, intent: string | null = null): Promise<void> {
  await dbFetch('guest_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      guest_id: guestDbId,
      event_type: eventType,
      intent,
      metadata: {},
    }),
  });
}

export async function loadCustomerMemory(
  anonymousId: string | undefined,
  language: string,
  current: GuestContextShape,
): Promise<CustomerState | null> {
  if (!anonymousId || !UUID_RE.test(anonymousId) || !configuration()) return null;

  try {
    const query = 'guests?anonymous_id=eq.' + encodeURIComponent(anonymousId)
      + '&select=id,anonymous_id,last_seen_at&limit=1';
    const existingRes = await dbFetch(query);
    const existing = await existingRes.json() as Array<{ id: string; last_seen_at: string }>;
    const now = new Date().toISOString();
    let guestDbId: string;

    if (existing[0]) {
      guestDbId = existing[0].id;
      await dbFetch('guests?id=eq.' + encodeURIComponent(guestDbId), {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          last_seen_at: now,
          language: LANGUAGES.has(language) ? language : null,
        }),
      });
      const previousVisit = Date.parse(existing[0].last_seen_at);
      if (Number.isFinite(previousVisit) && Date.now() - previousVisit > 30 * 60 * 1000) {
        await insertEvent(guestDbId, 'return_visit');
      }
    } else {
      const createdRes = await dbFetch('guests', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          anonymous_id: anonymousId,
          language: LANGUAGES.has(language) ? language : null,
          last_seen_at: now,
        }),
      });
      const created = await createdRes.json() as Array<{ id: string }>;
      if (!created[0]?.id) throw new Error('Customer database did not return a guest id');
      guestDbId = created[0].id;
    }

    const memoryRes = await dbFetch(
      'guest_memory?guest_id=eq.' + encodeURIComponent(guestDbId)
      + '&select=memory_key,memory_value',
    );
    const rows = await memoryRes.json() as Array<{ memory_key: string; memory_value: unknown }>;

    return {
      guestDbId,
      guestContext: mergeGuestContext(current, rows),
    };
  } catch (err) {
    safeDbError('load', err);
    return null;
  }
}

export async function persistCustomerResult(
  guestDbId: string | null,
  response: ChatResultShape,
  journeyContext: JourneyContextShape,
  language: string,
): Promise<void> {
  if (!guestDbId || !configuration()) return;

  try {
    const updates = response.contextUpdates as Record<string, unknown>;
    const memoryRows: Array<{ guest_id: string; memory_key: string; memory_value: unknown; updated_at: string }> = [];
    const add = (memoryKey: string, value: unknown) => {
      if (value !== null && value !== undefined && value !== '') {
        memoryRows.push({
          guest_id: guestDbId,
          memory_key: memoryKey,
          memory_value: value,
          updated_at: new Date().toISOString(),
        });
      }
    };

    if (TRAVELER_TYPES.has(String(updates.travelerType))) add('traveler_type', updates.travelerType);
    if (TRIP_DURATIONS.has(String(updates.tripDuration))) add('trip_duration', updates.tripDuration);
    if (PACES.has(String(updates.pace))) add('pace', updates.pace);

    const group = sanitizeGroup(updates.group);
    if (group) add('group', group);

    const interests = dedupeAllowed(updates.interests, INTERESTS);
    if (Array.isArray(updates.interests) && interests.length) add('interests', interests);

    const constraints = dedupeAllowed(updates.constraints, CONSTRAINTS);
    if (Array.isArray(updates.constraints) && constraints.length) add('constraints', constraints);

    const band = budgetBand(updates.budget);
    if (band) add('budget_band', band);
    if (LANGUAGES.has(language)) add('preferred_language', language);

    if (memoryRows.length) {
      await dbFetch('guest_memory?on_conflict=guest_id,memory_key', {
        method: 'POST',
        headers: {
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(memoryRows),
      });
    }

    let journeyAction: 'create' | 'modify' | 'replace' | 'save' | null = null;
    let journey: unknown | null = null;

    if (
      ['create', 'modify', 'replace'].includes(response.journeyAction.type)
      && response.journeyAction.journey
    ) {
      journeyAction = response.journeyAction.type as 'create' | 'modify' | 'replace';
      journey = response.journeyAction.journey;
    } else if (response.intent === 'save_journey' && journeyContext.currentPlan) {
      journeyAction = 'save';
      journey = journeyContext.currentPlan;
    }

    await insertEvent(
      guestDbId,
      response.intent === 'information' ? 'information_request' : 'chat_request',
      response.intent,
    );

    if (journeyAction && journey) {
      await dbFetch('journeys', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          guest_id: guestDbId,
          action: journeyAction,
          intent: response.intent,
          journey,
        }),
      });
      await insertEvent(
        guestDbId,
        journeyAction === 'create'
          ? 'journey_created'
          : journeyAction === 'save'
            ? 'journey_saved'
            : 'journey_modified',
        response.intent,
      );
    }
  } catch (err) {
    safeDbError('persist', err);
  }
}
