import type { Handler, HandlerEvent } from '@netlify/functions';
import {
  LLMAvailabilityError,
  ProviderNotConfiguredError,
  availabilityBrainResponse,
  getBrainChannel,
  runThongthaiBrain,
  type AgentStateUpdate,
  type BrainRequest,
  type BrainResponse,
  type BrainToolResult,
  type ChatTurn,
  type GuestContext,
  type JourneyContext,
} from './_thongthai-brain-v3';
import {
  loadCustomerMemory,
  loadVerifiedCommunityOfferings,
  persistCustomerResult,
} from './_customer-db';
import { resolveCanonicalGuestId } from './_thongthai-identity';
import {
  executeBrainTools,
  loadBrainRuntime,
  persistBrainRuntime,
  registerGuestIdentity,
} from './_thongthai-runtime-v3';

export type {
  BrainRequest as ChatRequest,
  BrainResponse as ChatResponse,
  ChatTurn,
  GuestContext,
  JourneyContext,
} from './_thongthai-brain-v3';

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
    .map(item => ({ role: item.role as ChatTurn['role'], content: item.content as string }));
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
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

function mergeAgentState(
  first: AgentStateUpdate | undefined,
  second: AgentStateUpdate | undefined,
): AgentStateUpdate | undefined {
  const merged = { ...(first ?? {}), ...(second ?? {}) };
  return Object.keys(merged).length ? merged : undefined;
}

function restaurantSetFromToolResults(toolResults: BrainToolResult[]): AgentStateUpdate | undefined {
  for (const result of toolResults) {
    if (result.name !== 'list_restaurant_menu' || !result.ok) continue;
    try {
      const detail = JSON.parse(result.detail) as Record<string, unknown>;
      const advisor = detail.advisor && typeof detail.advisor === 'object' ? detail.advisor as Record<string, unknown> : {};
      const set = advisor.set && typeof advisor.set === 'object' ? advisor.set as Record<string, unknown> : null;
      const rawItems = set && Array.isArray(set.items) ? set.items : [];
      const items = rawItems.slice(0,20)
        .map(item => item && typeof item === 'object' ? item as Record<string, unknown> : {})
        .map(item => ({
          name: typeof item.name === 'string' ? item.name.slice(0,160) : '',
          quantity: typeof item.quantity === 'number' && Number.isFinite(item.quantity) ? Math.max(1, Math.floor(item.quantity)) : 1,
        }))
        .filter(item => item.name);
      if (advisor.mode === 'compose_set' && items.length) {
        return {
          restaurantProposedSet: {
            source: 'restaurant_menu_advisor_v1',
            items,
            total: typeof set?.total === 'number' && Number.isFinite(set.total) ? Math.max(0, Math.floor(set.total)) : 0,
            budget: typeof set?.budget === 'number' && Number.isFinite(set.budget) ? Math.max(0, Math.floor(set.budget)) : null,
            partySize: typeof set?.partySize === 'number' && Number.isFinite(set.partySize) ? Math.max(1, Math.floor(set.partySize)) : null,
            createdAt: new Date().toISOString(),
          },
        };
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

function mergeAfterTools(first: BrainResponse, second: BrainResponse, toolResults: BrainToolResult[]): BrainResponse {
  return {
    ...first,
    message: second.message,
    responseStyle: second.responseStyle,
    suggestedActions: second.suggestedActions.length ? second.suggestedActions : first.suggestedActions,
    agentStateUpdate: mergeAgentState(mergeAgentState(first.agentStateUpdate, second.agentStateUpdate), restaurantSetFromToolResults(toolResults)),
    semanticMemoryUpdates: first.semanticMemoryUpdates,
    toolCalls: [],
  };
}

function duplicateRestaurantPreorderMessage(
  language: BrainRequest['language'],
  toolResults: Array<{ name: string; ok: boolean; detail: string }>,
): string | null {
  const result = toolResults.find(item => item.name === 'create_restaurant_preorder' && item.ok);
  if (!result) return null;
  try {
    const detail = JSON.parse(result.detail) as Record<string, unknown>;
    if (detail.duplicate !== true || typeof detail.preorderCode !== 'string') return null;
    const code = detail.preorderCode;
    const messages: Record<BrainRequest['language'], string> = {
      th: [
        'รายการนี้มีอยู่แล้วครับ ✅',
        'ทองไทยไม่ได้สร้างออเดอร์ซ้ำ',
        `รหัสเดิม: ${code}`,
        'สถานะ: รอร้านรับออเดอร์',
        '',
        'ระบบใช้คำขอเดิมของคุณครับ รอทีมร้านกดรับออเดอร์ได้เลย',
      ].join('\n'),
      en: `This preorder already exists ✅\nNo duplicate order was created.\nExisting code: ${code}\nStatus: waiting for the restaurant to accept.`,
      zh: `这笔预订单已经存在 ✅\n系统没有重复创建订单。\n原订单号：${code}\n状态：等待餐厅接单。`,
      lo: `ລາຍການນີ້ມີຢູ່ແລ້ວ ✅\nລະບົບບໍ່ໄດ້ສ້າງອໍເດີຊ້ຳ\nລະຫັດເດີມ: ${code}\nສະຖານະ: ລໍຖ້າຮ້ານຮັບອໍເດີ`,
      vi: `Đơn đặt trước này đã tồn tại ✅\nHệ thống không tạo đơn trùng.\nMã cũ: ${code}\nTrạng thái: đang chờ nhà hàng nhận đơn.`,
    };
    return messages[language];
  } catch {
    return null;
  }
}

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let rawBody: unknown;
  try {
    rawBody = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Malformed JSON body' });
  }

  let request = normalizeRequest(rawBody);
  if (!request) return json(400, { error: 'Missing required field: message' });

  const channel = getBrainChannel(request.pageContext.section);
  const providerUserKey = request.guestId;
  const canonicalGuestId = await resolveCanonicalGuestId(channel, providerUserKey);
  if (canonicalGuestId && canonicalGuestId !== request.guestId) {
    request = { ...request, guestId: canonicalGuestId };
  }

  let guestDbId: string | null = null;
  const customerState = await loadCustomerMemory(request.guestId, request.language, request.guestContext);
  if (customerState) {
    guestDbId = customerState.guestDbId;
    request = {
      ...request,
      guestContext: customerState.guestContext,
      journeyContext: {
        ...request.journeyContext,
        currentPlan: request.journeyContext.currentPlan || customerState.journeyContext.currentPlan,
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

  await registerGuestIdentity(guestDbId, channel, providerUserKey ?? request.guestId);

  const [communityOfferings, runtime] = await Promise.all([
    loadVerifiedCommunityOfferings(),
    loadBrainRuntime(guestDbId),
  ]);

  const history = request.chatHistory.slice(-16);
  const lastTurn = history[history.length - 1];
  const currentAlreadyIncluded = Boolean(
    lastTurn && lastTurn.role === 'user' && lastTurn.content.trim() === request.message.trim(),
  );
  const messages: ChatTurn[] = currentAlreadyIncluded
    ? history
    : [...history, { role: 'user', content: request.message }];

  let firstResponse: BrainResponse;
  try {
    firstResponse = await runThongthaiBrain(request, communityOfferings, messages, runtime);
  } catch (error) {
    console.error('THONGTHAI_BRAIN_ERROR', error);
    if (error instanceof ProviderNotConfiguredError) {
      return json(503, { error: 'AI provider not configured', message: 'This deployment has no LLM API key configured.' });
    }
    if (error instanceof LLMAvailabilityError) return json(200, availabilityBrainResponse());
    return json(502, { error: 'Thongthai brain request failed. Please try again.' });
  }

  await persistCustomerResult(guestDbId, firstResponse, request.journeyContext, request.language);

  let finalResponse = firstResponse;
  const toolCalls = firstResponse.toolCalls ?? [];
  if (toolCalls.length) {
    const toolResults = await executeBrainTools(
      guestDbId,
      channel,
      toolCalls,
      firstResponse,
      request,
    );
    const duplicatePreorderNotice = duplicateRestaurantPreorderMessage(request.language, toolResults);
    if (duplicatePreorderNotice) {
      // This is an idempotent replay of an existing preorder. Answer deterministically so
      // the customer is never told a duplicate request was newly accepted.
      finalResponse = {
        ...firstResponse,
        toolCalls: [],
        suggestedActions: [],
        message: duplicatePreorderNotice,
      };
    } else {
      try {
        const afterTools = await runThongthaiBrain(
          request,
          communityOfferings,
          messages,
          { ...runtime, toolResults },
        );
        finalResponse = mergeAfterTools(firstResponse, afterTools, toolResults);
      } catch (error) {
        console.error('THONGTHAI_BRAIN_POST_TOOL_ERROR', error);
        finalResponse = {
          ...firstResponse,
          toolCalls: [],
          message: toolResults.every(result => result.ok)
            ? firstResponse.message
            : `${firstResponse.message}\n\nมีบางอย่างที่ทองไทยยังทำให้ไม่สำเร็จครับ ลองอีกครั้งได้เลย`,
        };
      }
    }
  }

  await persistBrainRuntime(guestDbId, channel, finalResponse);

  return json(200, {
    message: finalResponse.message,
    intent: finalResponse.intent,
    contextUpdates: finalResponse.contextUpdates,
    journeyAction: finalResponse.journeyAction,
    suggestedActions: finalResponse.suggestedActions,
  });
};
