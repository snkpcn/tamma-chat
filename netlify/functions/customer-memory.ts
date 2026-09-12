import type { Handler, HandlerEvent } from '@netlify/functions';
import {
  loadCustomerMemory,
  loadVerifiedCommunityOfferings,
  persistCustomerSnapshot,
  type CustomerSnapshotAction,
} from './_customer-db';

type GuestContext = {
  tripDuration: string | null;
  travelerType: string | null;
  group: { adults: number | null; children: number | null; elderly: number | null };
  interests: string[];
  pace: string | null;
  budget: number | null;
  constraints: string[];
};

const ACTIONS = new Set<CustomerSnapshotAction>(['profile', 'favorite', 'visited', 'save_journey']);
const LANGUAGES = new Set(['th', 'en', 'zh', 'lo', 'vi']);
const FORBIDDEN_RAW_CHAT_KEYS = ['message', 'chat', 'chatHistory', 'transcript', 'prompt', 'journalEntries'];

function emptyContext(): GuestContext {
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

function normalizeContext(value: unknown): GuestContext {
  if (!value || typeof value !== 'object') return emptyContext();
  const input = value as Record<string, unknown>;
  const groupInput = input.group && typeof input.group === 'object'
    ? input.group as Record<string, unknown>
    : {};
  const count = (entry: unknown) => (
    typeof entry === 'number' && Number.isFinite(entry) && entry >= 0 ? Math.floor(entry) : null
  );
  return {
    tripDuration: typeof input.tripDuration === 'string' ? input.tripDuration : null,
    travelerType: typeof input.travelerType === 'string' ? input.travelerType : null,
    group: {
      adults: count(groupInput.adults),
      children: count(groupInput.children),
      elderly: count(groupInput.elderly),
    },
    interests: Array.isArray(input.interests)
      ? input.interests.filter((item): item is string => typeof item === 'string')
      : [],
    pace: typeof input.pace === 'string' ? input.pace : null,
    budget: typeof input.budget === 'number' && Number.isFinite(input.budget) ? input.budget : null,
    constraints: Array.isArray(input.constraints)
      ? input.constraints.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}') as Record<string, unknown>;
  } catch {
    return json(400, { error: 'Malformed JSON body' });
  }

  if (FORBIDDEN_RAW_CHAT_KEYS.some(key => key in body)) {
    return json(400, { error: 'Raw chat content is not accepted by this endpoint' });
  }

  // Read-only, no guest identity involved — the homepage OTOP/community
  // section reads this before (or without) any guest ever being created.
  if (body.action === 'community') {
    const offerings = await loadVerifiedCommunityOfferings();
    return json(200, { offerings });
  }

  const guestId = typeof body.guestId === 'string' ? body.guestId : undefined;
  const language = typeof body.language === 'string' && LANGUAGES.has(body.language)
    ? body.language
    : 'th';
  const guestContext = normalizeContext(body.guestContext);
  const customerState = await loadCustomerMemory(guestId, language, guestContext);
  if (!customerState) return json(503, { error: 'Customer memory unavailable' });

  if (body.action === 'load') {
    return json(200, {
      guestContext: customerState.guestContext,
      journeyContext: customerState.journeyContext,
    });
  }

  if (typeof body.action !== 'string' || !ACTIONS.has(body.action as CustomerSnapshotAction)) {
    return json(400, { error: 'Invalid action' });
  }

  const saved = await persistCustomerSnapshot(
    customerState.guestDbId,
    {
      guestContext,
      visitedExperiences: body.visitedExperiences,
      favorites: body.favorites,
      savedPlan: body.savedPlan ?? null,
    },
    language,
    body.action as CustomerSnapshotAction,
  );

  return saved ? json(200, { ok: true }) : json(503, { error: 'Customer memory unavailable' });
};
