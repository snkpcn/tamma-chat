// Zero-cost architecture (Phase P): deterministic semantic-turn derivation
// for when the model provider is unavailable (circuit open / 429 / provider
// down). Reuses the EXISTING generic slot parsers, task state, and entity-
// reference resolution -- never a growing table of literal Thai phrases --
// so a turn that is structurally interpretable from context alone needs ZERO
// LLM calls. Returns null when the turn is genuinely not derivable this way;
// the caller then either falls back to the real model (if available) or asks
// ONE honest clarifying question -- it must never guess.
import type {
  SemanticContext, SemanticContextEntity, SemanticDomain, SemanticReference, SemanticTurn,
} from './_semantic-interpreter';
import { isTerminalTaskStatus, type ActiveTask, type TaskStateContainer } from './_task-state';
import {
  extractDate, extractDurationMinutes, extractPartySize, extractTime,
  hasCancelMarker, hasCommitMarker, hasCorrectionMarker,
} from './_slot-parsers';
import { isExperienceDiscoveryIntent } from './_experience-discovery';
import { findEcosystemNode } from './_ecosystem-entity-graph';

export const DETERMINISTIC_SEMANTIC_TURN_VERSION = 'deterministic-semantic-turn-v1';

// Closed, doctrine-level keyword per activity node -- exactly the real
// activities this ecosystem has today (see _ecosystem-entity-graph.ts, which
// the rest of the system already treats as canonical structure), not a
// growing table of customer phrasings.
const ACTIVITY_TOPIC_KEYWORDS: ReadonlyArray<{ nodeId: string; activityCode: string; keyword: RegExp }> = [
  { nodeId: 'activity-horse', activityCode: 'horse', keyword: /ม้า/u },
  { nodeId: 'activity-atv', activityCode: 'atv', keyword: /atv|เอทีวี/iu },
  { nodeId: 'activity-archery', activityCode: 'archery', keyword: /ยิงธนู|ธนู/u },
];

// Canonical named activity assets that are part of the owner-verified
// ecosystem vocabulary and the live activity_assets inventory. This is a
// bounded entity lexicon for selection continuity during provider outage,
// not a table of answers: it never carries temperament, price, availability,
// or any other mutable fact.
const ACTIVITY_ASSET_SELECTIONS: ReadonlyArray<{ pattern: RegExp; name: string; resourceCode: string; entityId: string }> = [
  { pattern: /ภาราดร/u, name: 'ภาราดร', resourceCode: 'activity-horse', entityId: 'activity_asset:paradon' },
  { pattern: /ทองไทย/u, name: 'ทองไทย', resourceCode: 'activity-horse', entityId: 'activity_asset:thongthai' },
];

function findEntityByName(message: string, entities: readonly SemanticContextEntity[]): SemanticContextEntity | null {
  const candidates = entities.filter(entity => entity.name && message.includes(entity.name));
  return candidates.length === 1 ? candidates[0]! : null;
}

/** For most domains (stay, restaurant, otop) the selected entity's own id
 *  IS the real bookable resourceCode, so landing it directly into
 *  entities.resourceCode is correct and lets a new/updated task start
 *  already filled. Activity is the one exception: service_resources (what
 *  create_booking actually keys off) has one resourceCode per ACTIVITY
 *  TYPE, not per named asset ("activity_asset:horse-01" is NOT
 *  "activity-horse") -- see _operations-db.ts. Setting it directly there
 *  would silently pass an invalid/wrong resourceCode. That resolution
 *  instead happens authoritatively, from the real catalog, in the Dialog
 *  Manager (see _activity-catalog-policy.ts) once selectedEntities carries
 *  the selection through the existing resolveSelectedEntities mechanism. */
function directResourceCode(entity: SemanticContextEntity): string | null {
  return entity.id.startsWith('activity_asset:') ? null : entity.id;
}

function findActivityTopic(message: string): { nodeId: string; activityCode: string } | null {
  const match = ACTIVITY_TOPIC_KEYWORDS.find(item => item.keyword.test(message) && Boolean(findEcosystemNode(item.nodeId)));
  return match ? { nodeId: match.nodeId, activityCode: match.activityCode } : null;
}

function findKnownActivityAssetSelection(message: string): typeof ACTIVITY_ASSET_SELECTIONS[number] | null {
  return ACTIVITY_ASSET_SELECTIONS.find(item => item.pattern.test(message)) ?? null;
}

function isInventoryCountQuestion(message: string): boolean {
  // Generic quantity-question structure, not a phrase answer table. The
  // activity topic itself comes from the canonical ecosystem graph above.
  return /(?:กี่(?:ตัว|คัน|ชุด|อัน|รายการ)?|จำนวน(?:เท่าไร|เท่าไหร่|กี่)|มีกี่)/u.test(message);
}

/** "ร้าน...กิน/อาหาร/เมนู" -- a restaurant-topic marker, reusing the SAME
 *  doctrine-level business-unit structure as ACTIVITY_TOPIC_KEYWORDS (see
 *  _ecosystem-entity-graph.ts's 'thamma-chat-restaurant' node), not a
 *  growing phrase table. Exists so a topic switch AWAY from an active task
 *  toward the restaurant domain ("ร้านมีไรกิน" while mid-booking) is
 *  recognized structurally -- see detectCrossDomainTopicSwitch below. */
const RESTAURANT_TOPIC_MARKER = /ร้าน.*(?:กิน|อาหาร|เมนู)|(?:กิน|อาหาร|เมนู).*ร้าน/u;

function findRestaurantTopicNarrow(message: string): boolean {
  return RESTAURANT_TOPIC_MARKER.test(message) && Boolean(findEcosystemNode('thamma-chat-restaurant'));
}

const STAY_TOPIC_MARKER = /ห้อง|ที่พัก|เฮือน|บ้านพัก|เช[็็]?คอิน|เช็คอิน|เช็คเอาท์|เช็กเอาต์|room\s*service|รูม\s*เซอร์วิส/iu;
const OTOP_TOPIC_MARKER = /otop|โอทอป|ของฝาก|สินค้าชุมชน/iu;
const CAFE_TOPIC_MARKER = /กาแฟ|คาเฟ่|อินทนิน|inthanin|ลาเต้|latte|เครื่องดื่ม/iu;
const MEMBERSHIP_TOPIC_MARKER = /สมาชิก|member|membership/iu;

function findStayTopic(message: string): boolean {
  return STAY_TOPIC_MARKER.test(message) && Boolean(findEcosystemNode('thamma-chat-stay'));
}

function findOtopTopic(message: string): boolean {
  return OTOP_TOPIC_MARKER.test(message) && Boolean(findEcosystemNode('otop-community'));
}

function findCafeTopic(message: string): boolean {
  return CAFE_TOPIC_MARKER.test(message) && Boolean(findEcosystemNode('inthanin'));
}

function findMembershipTopic(message: string): boolean {
  return MEMBERSHIP_TOPIC_MARKER.test(message);
}

/** A structural fallback, tried only once nothing task-specific matches
 *  (see deriveDeterministicSemanticTurn below): does this message name a
 *  DIFFERENT supported topic than whatever is currently active? If so, it's
 *  a topic switch, not an unparseable message -- the resulting 'discover'
 *  turn naturally triggers the Dialog Manager's existing suspend/resume
 *  mechanism (detectTopicTransition in _dialog-manager.ts) once its domain
 *  differs from the active task's. Reuses the SAME topic-narrow markers
 *  already used for the no-task case, never a new phrase table. */
function detectCrossDomainTopicSwitch(message: string): SemanticTurn | null {
  if (findRestaurantTopicNarrow(message)) {
    return {
      domain: 'restaurant', intent: 'restaurant_topic_switch', action: 'discover',
      entities: {}, references: [], constraints: [], confidence: 0.8, needsClarification: false,
    };
  }
  if (findStayTopic(message)) {
    return {
      domain: 'stay', intent: 'stay_topic_switch', action: 'ask',
      entities: {}, references: [], constraints: [], confidence: 0.8, needsClarification: false,
    };
  }
  if (findOtopTopic(message)) {
    return {
      domain: 'otop', intent: 'otop_topic_switch', action: 'discover',
      entities: {}, references: [], constraints: [], confidence: 0.8, needsClarification: false,
    };
  }
  if (findCafeTopic(message)) {
    return {
      domain: 'cafe', intent: 'cafe_topic_switch', action: 'ask',
      entities: {}, references: [], constraints: [], confidence: 0.8, needsClarification: false,
    };
  }
  if (findMembershipTopic(message)) {
    return {
      domain: 'membership', intent: 'membership_topic_switch', action: /สถานะ|เช็ค|ตรวจ|ดู/u.test(message) ? 'status' : 'ask',
      entities: {}, references: [], constraints: [], confidence: 0.8, needsClarification: false,
    };
  }
  const activityTopic = findActivityTopic(message);
  if (activityTopic) {
    return {
      domain: 'activity', intent: 'activity_topic_narrow', action: 'discover',
      entities: { activityCode: activityTopic.activityCode }, references: [], constraints: [], confidence: 0.8, needsClarification: false,
    };
  }
  if (isExperienceDiscoveryIntent(message)) {
    return {
      domain: 'ecosystem', intent: 'broad_experience_discovery', action: 'discover',
      entities: {}, references: [], constraints: [], confidence: 0.8, needsClarification: false,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Side-question classes. An active/open task is INTERRUPTIBLE: having an
// unfinished task does not mean every following message is a slot fill. Each
// class below is a small, closed, STRUCTURAL marker set (a grammatical
// pattern or a bounded attribute vocabulary), never a growing table of full
// customer phrases -- matching hasCorrectionMarker/hasCommitMarker's
// existing precedent in _slot-parsers.ts.
// ---------------------------------------------------------------------------

/** "ตัวไหน" / "อันไหน" -- a classifier-based interrogative ("which [counted
 *  item]"), structural across any counted noun, not a specific phrase. */
const COMPARE_MARKER = /ตัวไหน|อันไหน|ชิ้นไหน/u;

/** A small, closed attribute vocabulary -- the SAME attributes the
 *  authoritative activity/asset source-of-truth is being asked to support
 *  (see _activity-catalog-policy.ts's ACTIVITY_ASSET_ATTRIBUTE_KEYS). A
 *  comparison is only ever derived when one of these is recognized, so it
 *  never falls back to a coarse "any fact exists" hallucination risk. */
const COMPARE_ATTRIBUTE_KEYWORDS: ReadonlyArray<{ pattern: RegExp; attribute: string }> = [
  { pattern: /นิสัย|อารมณ์/u, attribute: 'temperament' },
  { pattern: /มือใหม่|เริ่มต้น|หัดขี่/u, attribute: 'beginnerSuitability' },
  { pattern: /อายุ/u, attribute: 'age' },
  { pattern: /เพศ/u, attribute: 'sex' },
  { pattern: /ขนาด|ตัวใหญ่|ตัวเล็ก/u, attribute: 'size' },
  { pattern: /น้ำหนัก/u, attribute: 'maxRiderWeight' },
];

/** A comparison among recently-shown entities of the SAME domain ("ตัวไหน
 *  นิสัยดีกว่า" after being shown two horses). Requires BOTH the "which
 *  one" marker and a recognized attribute keyword -- without a recognized
 *  attribute, deferring (returning null) is safer than deriving an
 *  under-specified compare that would fall back to a coarse "any fact
 *  exists" check downstream (see resolveDialogDecision's anti-hallucination
 *  logic in _dialog-manager.ts). Never touches task state. */
function detectCompareEntities(message: string, context: SemanticContext, domain: SemanticDomain | null): SemanticTurn | null {
  if (!domain || !COMPARE_MARKER.test(message)) return null;
  const attribute = COMPARE_ATTRIBUTE_KEYWORDS.find(item => item.pattern.test(message))?.attribute;
  if (!attribute) return null;
  const candidates = context.recentEntities.filter(entity => entity.domain === domain);
  if (candidates.length < 2) return null;
  const ids = candidates.slice(0, 4).map(entity => entity.id);
  return {
    domain, intent: 'compare_entities', action: 'compare',
    entities: { compareAttribute: attribute },
    references: [{ type: 'entity_comparison', refersToPriorContext: true, resolvedEntityIds: ids }],
    constraints: [], confidence: 0.85, needsClarification: false,
  };
}

const PRICE_MARKER = /ราคา|เท่าไร|เท่าไหร่|กี่บาท/u;
const AVAILABILITY_STATUS_MARKER = /ว่างไหม|ว่างมั้ย|ว่างรึเปล่า|ว่างหรือเปล่า/u;
/** An informal or formal "how does this work" question -- "ยังไง"/
 *  "อย่างไร" (formal), or a bare sentence-final "ไง" (a common informal
 *  shorthand for the same, e.g. "จะขี่ม้าไง"). A structural, sentence-final
 *  grammatical particle, not a specific phrase. */
const HOW_IT_WORKS_MARKER = /ยังไง|อย่างไร|(?:^|\s)\S*ไง[\s?？]*$/u;

/** Price / availability-status / how-it-works questions about the CURRENT
 *  activity topic (whether or not a task exists yet). Scoped to 'activity'
 *  for now -- restaurant/otop price questions already have their own
 *  working zero-LLM paths (deterministicRestaurantResponse et al. in
 *  thongthai-chat.ts), so this only fills the gap the activity domain
 *  doesn't yet have one for. Never touches task state -- these are read-only
 *  side-questions (see TASK_WORTHY_ACTIONS in _dialog-manager.ts, which
 *  'ask'/'status' are deliberately excluded from). */
function detectActivitySideQuestion(message: string, domain: SemanticDomain | null): SemanticTurn | null {
  if (domain !== 'activity') return null;
  if (PRICE_MARKER.test(message)) {
    return { domain, intent: 'ask_price', action: 'ask', entities: {}, references: [], constraints: [], confidence: 0.8, needsClarification: false };
  }
  if (AVAILABILITY_STATUS_MARKER.test(message)) {
    const entities: Record<string, unknown> = {};
    const date = extractDate(message);
    if (date) entities.date = date;
    return { domain, intent: 'ask_availability_status', action: 'status', entities, references: [], constraints: [], confidence: 0.8, needsClarification: false };
  }
  if (HOW_IT_WORKS_MARKER.test(message)) {
    return { domain, intent: 'ask_how_it_works', action: 'ask', entities: {}, references: [], constraints: [], confidence: 0.75, needsClarification: false };
  }
  return null;
}

function detectNonActivitySideQuestion(message: string, domain: SemanticDomain | null): SemanticTurn | null {
  if (!domain || domain === 'activity' || domain === 'unknown') return null;
  const entities: Record<string, unknown> = {};
  const date = extractDate(message);
  const partySize = extractPartySize(message);
  if (date) entities.date = date;
  if (partySize) entities.partySize = partySize;

  if (domain === 'stay') {
    if (STAY_TOPIC_MARKER.test(message) || AVAILABILITY_STATUS_MARKER.test(message) || Object.keys(entities).length) {
      return { domain, intent:'stay_follow_up', action:'ask', entities, references:[], constraints:[], confidence:0.75, needsClarification:false };
    }
  }
  if (domain === 'otop') {
    if (PRICE_MARKER.test(message) || /อัน(?:ไหน|นี้|นั้น)|ไหนดี|ยังมี/u.test(message)) {
      return { domain, intent:'otop_follow_up', action: PRICE_MARKER.test(message) ? 'ask' : 'recommend', entities, references:[], constraints:[], confidence:0.75, needsClarification:false };
    }
  }
  if (domain === 'cafe') {
    if (PRICE_MARKER.test(message) || /เปิด|เมนู|มี|แก้ว|หวาน|เย็น|ร้อน/u.test(message)) {
      return { domain, intent:'cafe_follow_up', action:'ask', entities, references:[], constraints:[], confidence:0.75, needsClarification:false };
    }
  }
  if (domain === 'membership' && /สถานะ|สิทธิ|สมัคร|เช็ค|ตรวจ|ดู/u.test(message)) {
    return { domain, intent:'membership_follow_up', action:/สถานะ|เช็ค|ตรวจ|ดู/u.test(message) ? 'status' : 'ask', entities, references:[], constraints:[], confidence:0.75, needsClarification:false };
  }
  return null;
}

function deriveForActiveTask(
  message: string,
  context: SemanticContext,
  task: ActiveTask,
): SemanticTurn | null {
  // An explicit cancel ends the task outright, regardless of what other
  // slot-shaped content the message might also contain.
  if (hasCancelMarker(message)) {
    return {
      domain: task.domain, intent: 'task_cancel', action: 'cancel',
      entities: {}, references: [], constraints: [], confidence: 0.9, needsClarification: false,
    };
  }

  // Side-questions must be answered on their own terms -- never silently
  // reduced to whatever slot value they might incidentally also contain
  // (see the Dialog Manager's SIDE_QUESTION_ACTIONS precedence, which
  // preserves the task untouched for exactly these actions).
  const sideQuestion = detectActivitySideQuestion(message, task.domain);
  if (sideQuestion) return sideQuestion;

  // A commit signal ("จองเลย", "ยืนยันจอง") means the customer wants more
  // than a slot updated -- recognizing and acting on an explicit booking
  // commitment needs real understanding (and the transaction-executor
  // equivalence this deriver deliberately never touches -- see
  // TASK_CONTINUATION_SAFE_MODES). Defer rather than silently reduce the
  // message to just its slot value and drop the commit intent.
  if (hasCommitMarker(message)) return null;

  const entities: Record<string, unknown> = {};
  const date = extractDate(message);
  const time = extractTime(message);
  const partySize = extractPartySize(message);
  const durationMinutes = extractDurationMinutes(message);
  if (date) entities.date = date;
  if (time) entities.time = time;
  if (partySize) entities.partySize = partySize;
  if (durationMinutes) entities.durationMinutes = durationMinutes;

  const entityMatch = findEntityByName(message, context.recentEntities);
  const knownActivityAsset = !entityMatch && task.domain === 'activity'
    ? findKnownActivityAssetSelection(message)
    : null;
  const references: SemanticReference[] = entityMatch
    ? [{ type: 'entity_selection', value: entityMatch.name, refersToPriorContext: true, resolvedEntityId: entityMatch.id }]
    : knownActivityAsset
      ? [{ type: 'entity_selection', value: knownActivityAsset.name, refersToPriorContext: false, resolvedEntityId: knownActivityAsset.entityId }]
    : [];
  // A selection must also land as a slot value where that's directly valid
  // (stay/restaurant/otop) -- see directResourceCode. For an activity asset,
  // resourceCode resolution happens authoritatively downstream instead.
  if (entityMatch) {
    const resourceCode = directResourceCode(entityMatch);
    if (resourceCode) entities.resourceCode = resourceCode;
  } else if (knownActivityAsset) {
    entities.resourceCode = knownActivityAsset.resourceCode;
    entities.horseName = knownActivityAsset.name;
  }

  if (!Object.keys(entities).length && !references.length) return null;

  const correcting = hasCorrectionMarker(message);
  return {
    domain: task.domain,
    intent: correcting ? 'task_field_correction' : (entityMatch ? 'select_prior_entity' : 'task_slot_update'),
    action: correcting ? 'correct_previous' : (entityMatch ? 'confirm' : 'provide_information'),
    entities,
    references,
    constraints: [],
    confidence: 0.9,
    needsClarification: false,
  };
}

/**
 * Deterministically interpret a turn from context + generic parsers alone.
 * Returns null when the turn genuinely needs real language understanding
 * (the caller decides what to do then -- call the model if available, or ask
 * one honest clarifying question if not).
 */
export function deriveDeterministicSemanticTurn(
  message: string,
  context: SemanticContext,
  taskState: TaskStateContainer,
): SemanticTurn | null {
  const trimmed = message.trim();
  if (!trimmed) return null;

  const activeTask = taskState.activeTask && !isTerminalTaskStatus(taskState.activeTask.status)
    ? taskState.activeTask
    : null;
  const effectiveDomain = activeTask?.domain ?? context.activeDomain;

  // A comparison among recently-shown entities can happen with or without an
  // open task (e.g. "ตัวไหนนิสัยดีกว่า" right after browsing, before any
  // selection is made) -- checked first, and it never touches task state.
  const compare = detectCompareEntities(trimmed, context, effectiveDomain);
  if (compare) return compare;

  if (activeTask && (activeTask.status === 'collecting' || activeTask.status === 'ready')) {
    const taskDerived = deriveForActiveTask(trimmed, context, activeTask);
    if (taskDerived) return taskDerived;
    // Nothing task-specific matched -- before giving up, check whether this
    // is actually a topic switch AWAY from the active task (e.g. "ร้านมีไรกิน"
    // while mid-activity-booking). A genuine switch must still surface as a
    // real turn (so the Dialog Manager's existing suspend mechanism fires),
    // not silently fall through to "genuinely unclassifiable".
    const topicSwitch = detectCrossDomainTopicSwitch(trimmed);
    if (topicSwitch && topicSwitch.domain !== activeTask.domain) return topicSwitch;
    return null;
  }

  // No open task: a price/availability/how-it-works side-question about the
  // current topic, asked before any selection is made.
  const sideQuestion = detectActivitySideQuestion(trimmed, effectiveDomain);
  if (sideQuestion) return sideQuestion;

  // No active task: a selection among entities the customer already saw
  // this conversation ("เอาภาราดร" after being shown horse options).
  const entityMatch = findEntityByName(trimmed, context.recentEntities);
  if (entityMatch) {
    const resourceCode = directResourceCode(entityMatch);
    return {
      domain: entityMatch.domain === 'unknown' ? (context.activeDomain ?? 'unknown') : entityMatch.domain,
      intent: 'select_prior_entity',
      action: 'confirm',
      // Lands directly as resourceCode where that's valid (stay/restaurant/
      // otop); for an activity asset, resourceCode resolves authoritatively
      // downstream from selectedEntities instead (see directResourceCode).
      entities: resourceCode ? { resourceCode } : {},
      references: [{ type: 'entity_selection', value: entityMatch.name, refersToPriorContext: true, resolvedEntityId: entityMatch.id }],
      constraints: [],
      confidence: 0.9,
      needsClarification: false,
    };
  }

  const knownActivityAsset = (effectiveDomain === 'activity' || findActivityTopic(trimmed)?.activityCode === 'horse')
    ? findKnownActivityAssetSelection(trimmed)
    : null;
  if (knownActivityAsset) {
    return {
      domain: 'activity',
      intent: 'select_known_activity_asset',
      action: hasCorrectionMarker(trimmed) ? 'correct_previous' : 'confirm',
      entities: { resourceCode: knownActivityAsset.resourceCode, horseName: knownActivityAsset.name },
      references: [{ type: 'entity_selection', value: knownActivityAsset.name, refersToPriorContext: false, resolvedEntityId: knownActivityAsset.entityId }],
      constraints: [],
      confidence: 0.82,
      needsClarification: false,
    };
  }

  const nonActivitySideQuestion = detectNonActivitySideQuestion(trimmed, effectiveDomain);
  if (nonActivitySideQuestion) return nonActivitySideQuestion;

  const activityTopic = findActivityTopic(trimmed);

  // Quantity/inventory question for a known activity ("มีม้ากี่ตัว",
  // "ATV มีกี่คัน"). This remains zero-LLM: the semantic layer only
  // identifies the requested activity + information need; the actual count
  // comes later from the authoritative live activity catalog.
  if (activityTopic && isInventoryCountQuestion(trimmed)) {
    return {
      domain: 'activity',
      intent: 'activity_inventory_count',
      action: 'ask',
      entities: { activityCode: activityTopic.activityCode, inventoryCount: true },
      references: [],
      constraints: [],
      confidence: 0.9,
      needsClarification: false,
    };
  }

  // Narrowing to a specific known activity ("ม้าล่ะ" / "ATV ล่ะ").
  if (activityTopic) {
    return {
      domain: 'activity',
      intent: 'activity_topic_narrow',
      action: 'discover',
      entities: { activityCode: activityTopic.activityCode },
      references: [],
      constraints: [],
      confidence: 0.85,
      needsClarification: false,
    };
  }

  if (findStayTopic(trimmed)) {
    const entities: Record<string, unknown> = {};
    const date = extractDate(trimmed);
    const partySize = extractPartySize(trimmed);
    if (date) entities.date = date;
    if (partySize) entities.partySize = partySize;
    return {
      domain: 'stay',
      intent: 'stay_read_only_inquiry',
      action: 'ask',
      entities,
      references: [],
      constraints: [],
      confidence: 0.82,
      needsClarification: false,
    };
  }

  if (findOtopTopic(trimmed)) {
    return {
      domain: 'otop',
      intent: 'otop_product_discovery',
      action: PRICE_MARKER.test(trimmed) ? 'ask' : 'discover',
      entities: {},
      references: [],
      constraints: [],
      confidence: 0.82,
      needsClarification: false,
    };
  }

  if (findCafeTopic(trimmed)) {
    return {
      domain: 'cafe',
      intent: 'cafe_read_only_inquiry',
      action: 'ask',
      entities: {},
      references: [],
      constraints: [],
      confidence: 0.82,
      needsClarification: false,
    };
  }

  if (findMembershipTopic(trimmed)) {
    return {
      domain: 'membership',
      intent: /สถานะ|เช็ค|ตรวจ|ดู/u.test(trimmed) ? 'membership_status' : 'membership_information',
      action: /สถานะ|เช็ค|ตรวจ|ดู/u.test(trimmed) ? 'status' : 'ask',
      entities: {},
      references: [],
      constraints: [],
      confidence: 0.82,
      needsClarification: false,
    };
  }

  // Broad ecosystem discovery ("มีไรทำมั่ง") -- reuses the existing,
  // already-tested provider-outage discovery matcher instead of inventing a
  // second one (see _experience-discovery.ts's own header comment).
  if (isExperienceDiscoveryIntent(trimmed)) {
    return {
      domain: 'ecosystem',
      intent: 'broad_experience_discovery',
      action: 'discover',
      entities: {},
      references: [],
      constraints: [],
      confidence: 0.85,
      needsClarification: false,
    };
  }

  return null;
}
