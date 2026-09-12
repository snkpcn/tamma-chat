import type { Handler, HandlerEvent } from '@netlify/functions';
import {
  LLMAvailabilityError,
  ProviderNotConfiguredError,
  availabilityBrainResponse,
  runThongthaiBrain,
  type BrainRequest,
  type BrainResponse,
  type ChatTurn,
  type GuestContext,
  type JourneyContext,
} from './_thongthai-brain';
import {
  loadCustomerMemory,
  loadVerifiedCommunityOfferings,
  persistCustomerResult,
} from './_customer-db';

export type {
  BrainRequest as ChatRequest,
  BrainResponse as ChatResponse,
  ChatTurn,
  GuestContext,
  JourneyContext,
} from './_thongthai-brain';

const LANGUAGES = new Set(['th', 'en', 'zh', 'lo', 'vi']);

function emptyGuestContext(): GuestContext {
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

function emptyJourneyContext(): JourneyContext {
  return {
    currentPlan: null,
    savedPlan: null,
    visitedExperiences: [],
    favorites: [],
    journalEntries: [],
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeGuestContext(value: unknown): GuestContext {
  if (!isObject(value)) return emptyGuestContext();
  const group = isObject(value.group) ? value.group : {};

  return {
    tripDuration: typeof value.tripDuration === 'string' ? value.tripDuration : null,
    travelerType: typeof value.travelerType === 'string' ? value.travelerType : null,
    group: {
      adults: typeof group.adults === 'number' ? group.adults : null,
      children: typeof group.children === 'number' ? group.children : null,
      elderly: typeof group.elderly === 'number' ? group.elderly : null,
    },
    interests: Array.isArray(value.interests)
      ? value.interests.filter((item): item is string => typeof item === 'string')
      : [],
    pace: typeof value.pace === 'string' ? value.pace : null,
    budget: typeof value.budget === 'number' ? value.budget : null,
    constraints: Array.isArray(value.constraints)
      ? value.constraints.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

function normalizeJourneyContext(value: unknown): JourneyContext {
  if (!isObject(value)) return emptyJourneyContext();
  return {
    currentPlan: value.currentPlan ?? null,
    savedPlan: value.savedPlan ?? null,
    visitedExperiences: Array.isArray(value.visitedExperiences)
      ? value.visitedExperiences.filter((item): item is string => typeof item === 'string')
      : [],
    favorites: Array.isArray(value.favorites)
      ? value.favorites.filter((item): item is string => typeof item === 'string')
      : [],
    journalEntries: Array.isArray(value.journalEntries) ? value.journalEntries : [],
  };
}

function normalizeChatHistory(value: unknown): ChatTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => isObject(item))
    .filter(item => (item.role === 'user' || item.role === 'assistant') && isNonEmptyString(item.content))
    .map(item => ({
      role: item.role as ChatTurn['role'],
      content: item.content as string,
    }));
}

function normalizeRequest(body: unknown): BrainRequest | null {
  if (!isObject(body) || !isNonEmptyString(body.message)) return null;

  const language = isNonEmptyString(body.language) && LANGUAGES.has(body.language)
    ? body.language as BrainRequest['language']
    : 'th';

  const pageContext = isObject(body.pageContext)
    ? { section: typeof body.pageContext.section === 'string' ? body.pageContext.section : null }
    : { section: null };

  return {
    guestId: typeof body.guestId === 'string' ? body.guestId : undefined,
    message: body.message.trim(),
    language,
    chatHistory: normalizeChatHistory(body.chatHistory),
    guestContext: normalizeGuestContext(body.guestContext),
    journeyContext: normalizeJourneyContext(body.journeyContext),
    pageContext,
  };
}

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  let rawBody: unknown;
  try {
    rawBody = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Malformed JSON body' });
  }

  let request = normalizeRequest(rawBody);
  if (!request) {
    return json(400, { error: 'Missing required field: message' });
  }

  let guestDbId: string | null = null;
  const customerState = await loadCustomerMemory(
    request.guestId,
    request.language,
    request.guestContext,
  );

  if (customerState) {
    guestDbId = customerState.guestDbId;
    request = {
      ...request,
      guestContext: customerState.guestContext,
      journeyContext: {
        ...request.journeyContext,
        savedPlan: request.journeyContext.savedPlan || customerState.journeyContext.savedPlan,
        visitedExperiences: request.journeyContext.visitedExperiences.length
          ? request.journeyContext.visitedExperiences
          : customerState.journeyContext.visitedExperiences,
        favorites: request.journeyContext.favorites.length
          ? request.journeyContext.favorites
          : customerState.journeyContext.favorites,
      },
    };
  }

  const communityOfferings = await loadVerifiedCommunityOfferings();

  const history = request.chatHistory.slice(-16);
  const lastTurn = history[history.length - 1];
  const currentAlreadyIncluded = Boolean(
    lastTurn
    && lastTurn.role === 'user'
    && lastTurn.content.trim() === request.message.trim(),
  );

  const messages: ChatTurn[] = currentAlreadyIncluded
    ? history
    : [...history, { role: 'user', content: request.message }];

  let response: BrainResponse;
  try {
    response = await runThongthaiBrain(request, communityOfferings, messages);
  } catch (error) {
    console.error('THONGTHAI_BRAIN_ERROR', error);

    if (error instanceof ProviderNotConfiguredError) {
      return json(503, {
        error: 'AI provider not configured',
        message: 'This deployment has no LLM API key configured.',
      });
    }

    if (error instanceof LLMAvailabilityError) {
      return json(200, availabilityBrainResponse());
    }

    return json(502, { error: 'Thongthai brain request failed. Please try again.' });
  }

  await persistCustomerResult(
    guestDbId,
    response,
    request.journeyContext,
    request.language,
  );

  return json(200, response);
};
