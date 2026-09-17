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
  visitedExperiences?: unknown;
  favorites?: unknown;
};

export interface CustomerState {
  guestDbId: string;
  guestContext: GuestContextShape;
  journeyContext: {
    currentPlan: unknown | null;
    savedPlan: unknown | null;
    visitedExperiences: string[];
    favorites: string[];
  };
}

export type CustomerSnapshotAction = 'profile' | 'favorite' | 'visited' | 'save_journey';

export interface CustomerSnapshot {
  guestContext: GuestContextShape;
  visitedExperiences: unknown;
  favorites: unknown;
  savedPlan?: unknown | null;
}

export type VerifiedCommunityOffering = {
  offering_id: string;
  partner_id: string;
  offering_name: string;
  offering_type: string;
  description: string | null;
  tags: string[];
  suitable_for: string[];
  duration_minutes: number | null;
  price_min: number | null;
  price_max: number | null;
  booking_required: boolean | null;
  location_text: string | null;
  external_url: string | null;
};

export async function loadVerifiedCommunityOfferings(): Promise<VerifiedCommunityOffering[]> {
  if (!configuration()) return [];
  try {
    const res = await dbFetch(
      'community_offerings?active=eq.true&verified=eq.true'
      + '&select=offering_id,partner_id,offering_name,offering_type,description,tags,suitable_for,duration_minutes,price_min,price_max,booking_required,location_text,external_url',
    );
    const rows = await res.json() as Array<Record<string, unknown>>;
    return rows.map(row => ({
      offering_id: String(row.offering_id ?? ''),
      partner_id: String(row.partner_id ?? ''),
      offering_name: String(row.offering_name ?? ''),
      offering_type: String(row.offering_type ?? ''),
      description: typeof row.description === 'string' ? row.description : null,
      tags: Array.isArray(row.tags) ? row.tags.filter((item): item is string => typeof item === 'string') : [],
      suitable_for: Array.isArray(row.suitable_for) ? row.suitable_for.filter((item): item is string => typeof item === 'string') : [],
      duration_minutes: typeof row.duration_minutes === 'number' ? row.duration_minutes : null,
      price_min: typeof row.price_min === 'number' ? row.price_min : null,
      price_max: typeof row.price_max === 'number' ? row.price_max : null,
      booking_required: typeof row.booking_required === 'boolean' ? row.booking_required : null,
      location_text: typeof row.location_text === 'string' ? row.location_text : null,
      external_url: typeof row.external_url === 'string' ? row.external_url : null,
    })).filter(row => row.offering_id && row.offering_name);
  } catch (err) {
    safeDbError('community_offerings', err);
    return [];
  }
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
  'no_pork', 'no_beef', 'no_chicken', 'no_fish', 'no_egg',
  'no_plara', 'no_peanut', 'no_shrimp', 'mild_spice',
  'peanut_allergy', 'shrimp_allergy', 'fish_allergy', 'egg_allergy',
  'authentic_isan', 'beginner_friendly', 'kid_friendly',
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

function sanitizeExperienceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(
    (item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 120,
  ))];
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

async function insertEvent(
  guestDbId: string,
  eventType: string,
  intent: string | null = null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await dbFetch('guest_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      guest_id: guestDbId,
      event_type: eventType,
      intent,
      metadata,
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

    const [memoryRes, latestJourneyRes, savedJourneyRes] = await Promise.all([
      dbFetch(
        'guest_memory?guest_id=eq.' + encodeURIComponent(guestDbId)
        + '&select=memory_key,memory_value',
      ),
      dbFetch(
        'journeys?guest_id=eq.' + encodeURIComponent(guestDbId)
        + '&select=journey&order=created_at.desc&limit=1',
      ),
      dbFetch(
        'journeys?guest_id=eq.' + encodeURIComponent(guestDbId)
        + '&action=eq.save&select=journey&order=created_at.desc&limit=1',
      ),
    ]);
    const rows = await memoryRes.json() as Array<{ memory_key: string; memory_value: unknown }>;
    const persisted = Object.fromEntries(rows.map(row => [row.memory_key, row.memory_value]));
    const latestJourneys = await latestJourneyRes.json() as Array<{ journey: unknown }>;
    const savedJourneys = await savedJourneyRes.json() as Array<{ journey: unknown }>;

    return {
      guestDbId,
      guestContext: mergeGuestContext(current, rows),
      journeyContext: {
        currentPlan: latestJourneys[0]?.journey ?? null,
        savedPlan: savedJourneys[0]?.journey ?? null,
        visitedExperiences: sanitizeExperienceIds(persisted.visited_experiences),
        favorites: sanitizeExperienceIds(persisted.favorites),
      },
    };
  } catch (err) {
    safeDbError('load', err);
    return null;
  }
}

export async function persistCustomerSnapshot(
  guestDbId: string,
  snapshot: CustomerSnapshot,
  language: string,
  action: CustomerSnapshotAction,
): Promise<boolean> {
  if (!guestDbId || !configuration()) return false;

  try {
    const context = snapshot.guestContext ?? {
      tripDuration: null,
      travelerType: null,
      group: { adults: null, children: null, elderly: null },
      interests: [],
      pace: null,
      budget: null,
      constraints: [],
    };
    const rows: Array<{ guest_id: string; memory_key: string; memory_value: unknown; updated_at: string }> = [];
    const add = (memoryKey: string, value: unknown) => {
      rows.push({
        guest_id: guestDbId,
        memory_key: memoryKey,
        memory_value: value,
        updated_at: new Date().toISOString(),
      });
    };

    if (TRAVELER_TYPES.has(String(context.travelerType))) add('traveler_type', context.travelerType);
    if (TRIP_DURATIONS.has(String(context.tripDuration))) add('trip_duration', context.tripDuration);
    if (PACES.has(String(context.pace))) add('pace', context.pace);
    const group = sanitizeGroup(context.group);
    if (group) add('group', group);
    if (Array.isArray(context.interests)) add('interests', dedupeAllowed(context.interests, INTERESTS));
    if (Array.isArray(context.constraints)) add('constraints', dedupeAllowed(context.constraints, CONSTRAINTS));
    const band = budgetBand(context.budget);
    if (band) add('budget_band', band);
    if (LANGUAGES.has(language)) add('preferred_language', language);
    if (Array.isArray(snapshot.visitedExperiences)) {
      add('visited_experiences', sanitizeExperienceIds(snapshot.visitedExperiences));
    }
    if (Array.isArray(snapshot.favorites)) {
      add('favorites', sanitizeExperienceIds(snapshot.favorites));
    }

    if (rows.length) {
      await dbFetch('guest_memory?on_conflict=guest_id,memory_key', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rows),
      });
    }

    if (action === 'save_journey' && snapshot.savedPlan) {
      await dbFetch('journeys', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          guest_id: guestDbId,
          action: 'save',
          intent: 'save_journey',
          journey: snapshot.savedPlan,
        }),
      });
      await insertEvent(guestDbId, 'journey_saved', 'save_journey');
    } else if (action === 'favorite') {
      await insertEvent(guestDbId, 'experience_favorited', null, {
        count: sanitizeExperienceIds(snapshot.favorites).length,
      });
    } else if (action === 'visited') {
      await insertEvent(guestDbId, 'experience_visited', null, {
        count: sanitizeExperienceIds(snapshot.visitedExperiences).length,
      });
    }

    return true;
  } catch (err) {
    safeDbError('snapshot', err);
    return false;
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
    if (Array.isArray(updates.interests)) add('interests', interests);

    const constraints = dedupeAllowed(updates.constraints, CONSTRAINTS);
    if (Array.isArray(updates.constraints)) add('constraints', constraints);

    const band = budgetBand(updates.budget);
    if (band) add('budget_band', band);
    if (LANGUAGES.has(language)) add('preferred_language', language);

    const visitedExperiences = sanitizeExperienceIds(journeyContext.visitedExperiences);
    if (Array.isArray(journeyContext.visitedExperiences)) add('visited_experiences', visitedExperiences);

    const favorites = sanitizeExperienceIds(journeyContext.favorites);
    if (Array.isArray(journeyContext.favorites)) add('favorites', favorites);

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
