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
import { isExperienceDiscoveryIntent, PRIOR_REFERENCE_MARKER } from './_experience-discovery';
import { isPromotionDiscoveryIntent } from './_promotion-dialog';
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
// or any other mutable fact. Exported so the legacy transactional booking
// executor (_operations-db.ts's handleLineBookingMessage) can record which
// named asset the customer actually selected onto the booking itself --
// without this, the specific horse chosen mid-conversation never reached the
// durable booking row at all (see ACTIVITY_ASSET_SELECTIONS usage there).
export const ACTIVITY_ASSET_SELECTIONS: ReadonlyArray<{ pattern: RegExp; name: string; resourceCode: string; entityId: string }> = [
  { pattern: /ภาราดร/u, name: 'ภาราดร', resourceCode: 'activity-horse', entityId: 'activity_asset:horse-pharadon' },
  { pattern: /ทองไทย/u, name: 'ทองไทย', resourceCode: 'activity-horse', entityId: 'activity_asset:horse-thongthai' },
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

// General "is this phrased as a question" structural signal, shared by
// every place in this file that must tell a genuine commitment/selection
// apart from someone merely asking about the same words. Not a phrase
// table for one sentence or one asset -- any message matching this is
// read-only, whatever domain or name it names.
const QUESTION_MARKER_RE = /[?？]|ไหม|ไหน|มั้ย|หรือเปล่า|รึเปล่า|ยังไง|อย่างไร|เมื่อไหร่|เมื่อไร|กี่โมง|เท่าไหร่|เท่าไร/u;

function hasStandaloneTransactionRequest(message:string):boolean {
  if (hasCommitMarker(message)) return true;
  if (!/(?:จอง|สั่ง)/u.test(message)) return false;
  // Conversational task control ("กลับมาจอง...ต่อ") resumes state; it is not
  // a new commitment. Questions and explicit negation remain read-only.
  if (/กลับ.*(?:จอง|สั่ง)|(?:จอง|สั่ง).*ต่อ/u.test(message)) return false;
  if (/ไม่ได้(?:คิด|จะ|ให้)?\s*(?:จอง|สั่ง)|ไม่(?:ได้)?\s*(?:จอง|สั่ง)|ยกเลิก/u.test(message)) return false;
  if (QUESTION_MARKER_RE.test(message)) return false;
  return true;
}

// A small, closed set of negation markers, not a growing phrase table --
// this is the same "correction marker" grammatical category
// hasCorrectionMarker (_slot-parsers.ts) already recognizes, applied here
// specifically to exclude a NAME immediately preceded by one of them.
const ASSET_NEGATION_BEFORE_NAME_RE = /(?:ไม่เอา|ไม่ใช่|ไม่รับ|ไม่ได้เอา)\s*$/u;

/**
 * A correction that mentions BOTH the old and new choice in one message
 * ("ไม่เอาภาราดรแล้ว เอาทองไทย") must resolve to the one being chosen, never
 * the one being turned down. Plain array order (ภาราดร listed first) used
 * to win regardless of which side of the sentence was negated -- a real
 * production bug: the rejected name silently became the "selection".
 * Structural, not phrase-specific: any known name whose immediately
 * preceding text ends with a negation marker is excluded before picking a
 * match, so this works regardless of which name is mentioned first.
 */
// One of the two known assets ("ทองไทย") is also the assistant/business's
// own name. A bare mention is not the same as choosing it -- "ทองไทยตอบเร็ว
// จังเลย" (a compliment to the assistant) or "ร้านทองไทยเปิดกี่โมง" (a
// question about the business) are not selections, but this lexicon match
// alone can't tell the difference from real text like "เอาทองไทย"/
// "ทองไทยครับ". A genuine selection is a short statement, never a question;
// this reuses the SAME general QUESTION_MARKER_RE structural signal
// hasStandaloneTransactionRequest above already uses, not a phrase specific
// to this one name -- so it protects both listed assets and any future one
// added to the same lexicon.
export function findKnownActivityAssetSelection(message: string): typeof ACTIVITY_ASSET_SELECTIONS[number] | null {
  if (QUESTION_MARKER_RE.test(message)) return null;
  const accepted = ACTIVITY_ASSET_SELECTIONS.flatMap(item => {
    const match = item.pattern.exec(message);
    if (!match) return [];
    const before = message.slice(Math.max(0, match.index - 12), match.index);
    if (ASSET_NEGATION_BEFORE_NAME_RE.test(before)) return [];
    return [{ item, index:match.index }];
  });
  if (!accepted.length) return null;

  // In a correction the human often states OLD choice first and NEW choice
  // after the correction clause ("had A, changed to B"). The last accepted
  // canonical name is the replacement. This is grammatical precedence, not
  // a sentence patch, and also makes provider-outage fallback agree with the
  // semantic model instead of resurrecting stale state.
  if (hasCorrectionMarker(message) && accepted.length > 1) {
    return accepted.reduce((latest, candidate) =>
      candidate.index > latest.index ? candidate : latest
    ).item;
  }
  return accepted[0]!.item;
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

/** "โต๊ะ...เต็ม/ว่าง" -- a live TABLE STATUS question, structurally distinct
 *  from RESTAURANT_TOPIC_MARKER above (which is about the menu/catalog, not
 *  seating capacity). Production incident this closes: "พรุ่งนี้หกโมงโต๊ะ
 *  เต็มยัง" matched neither RESTAURANT_TOPIC_MARKER (no กิน/อาหาร/เมนู word)
 *  nor any other deterministic pattern, so a genuine transient provider
 *  failure on this turn collapsed all the way to the generic "ระบบตอบช้า"
 *  apology instead of the honest "no live table source" answer. Must carry
 *  informationNeed:'availability' (not a bare 'discover') so the Dialog
 *  Manager routes it to the restaurant availability knowledge need (see
 *  planKnowledgeNeeds's restaurant case), which resolves to a real "cannot
 *  confirm" answer when -- as today -- no live table-capacity source is
 *  wired, never a guessed full/free status. */
const RESTAURANT_TABLE_STATUS_MARKER = /โต๊ะ.*(?:เต็ม|ว่าง|เหลือ)|(?:เต็ม|ว่าง|เหลือ).*โต๊ะ|โต๊ะ(?:ไหม|มั้ย|รึเปล่า|หรือเปล่า|หรือยัง|รึยัง)/u;

function findRestaurantTableStatusQuestion(message: string): boolean {
  return RESTAURANT_TABLE_STATUS_MARKER.test(message) && Boolean(findEcosystemNode('thamma-chat-restaurant'));
}

const STAY_TOPIC_MARKER = /ห้อง|ที่พัก|เฮือน|บ้านพัก|เช[็็]?คอิน|เช็คอิน|เช็คเอาท์|เช็กเอาต์|room\s*service|รูม\s*เซอร์วิส/iu;
const OTOP_TOPIC_MARKER = /otop|โอทอป|ของฝาก|สินค้าชุมชน/iu;
const CAFE_TOPIC_MARKER = /กาแฟ|คาเฟ่|อินทนิน|inthanin|ลาเต้|latte|เครื่องดื่ม/iu;
const MEMBERSHIP_TOPIC_MARKER = /สมาชิก|member|membership/iu;
// Distinguishes an actual status QUESTION ("เป็นสมาชิกหรือยัง" -- am I
// already a member?) from a generic membership mention, so it renders a
// real status answer instead of the "here's how to sign up" copy. The
// original version of this only recognized an explicit "สถานะ"/"เช็ค"/
// "ตรวจ"/"ดู" keyword -- "ตอนนี้ผมเป็นสมาชิกหรือยัง" is a completely
// natural, common way to ask the exact same question and contained none
// of them, so it was silently misrouted to the sign-up prompt instead of
// an actual status check. "หรือยัง"/"รึยัง"/"หรือเปล่า" are the ordinary
// Thai yes-already/not-yet question particles, not a phrase table.
const MEMBERSHIP_STATUS_ACTION_MARKER = /สถานะ|เช็ค|ตรวจ|ดู|หรือยัง|รึยัง|หรือเปล่า/u;

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
function detectCrossDomainTopicSwitch(message: string, now: Date = new Date()): SemanticTurn | null {
  // Promotion questions are cross-cutting by design. A current membership,
  // restaurant, stay, or activity context must never absorb a clear request
  // to browse promotions. Reuse the existing promotion dialog classifier so
  // this remains one shared intent class rather than a new phrase patch.
  if (isPromotionDiscoveryIntent(message)) {
    return {
      domain: 'promotion', intent: 'promotion_discovery', action: 'discover',
      informationNeed: 'catalog',
      entities: {}, references: [], constraints: [], confidence: 0.9, needsClarification: false,
    };
  }
  if (findRestaurantTableStatusQuestion(message)) {
    const entities: Record<string, unknown> = {};
    const date = extractDate(message, now);
    const time = extractTime(message);
    if (date) entities.date = date;
    if (time) entities.time = time;
    return {
      domain: 'restaurant', intent: 'restaurant_availability_check', action: 'ask',
      informationNeed: 'availability',
      entities, references: [], constraints: [], confidence: 0.85, needsClarification: false,
    };
  }
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
      domain: 'membership', intent: 'membership_topic_switch', action: MEMBERSHIP_STATUS_ACTION_MARKER.test(message) ? 'status' : 'ask',
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

/** The two structural halves of a conditional non-commit continuation (see
 *  deriveForActiveTask's own comment): an unavailability condition, and an
 *  explicit "so don't transact" consequence. Each is deliberately broad on
 *  its own (many real sentences say "ไม่ว่าง" without this pattern applying)
 *  -- only their CO-OCCURRENCE is treated as this structural class. */
const CONDITIONAL_UNAVAILABLE_MARKER = /ไม่ว่าง/u;
const NO_COMMIT_CONSEQUENCE_MARKER = /ไม่ต้อง(?:จอง|เลือก|ทำ|สั่ง)/u;

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
  if (!COMPARE_MARKER.test(message)) return null;
  const attribute = COMPARE_ATTRIBUTE_KEYWORDS.find(item => item.pattern.test(message))?.attribute;
  if (!attribute) return null;
  const effectiveDomain: SemanticDomain | null = domain ?? 'activity';
  if (!effectiveDomain) return null;
  const candidates = context.recentEntities.filter(entity => entity.domain === effectiveDomain);
  if (candidates.length < 2) {
    // Production gateway fast paths may occasionally answer the prior catalog
    // turn outside One-Mind, leaving no recent entity records even though the
    // customer is asking a structurally clear activity comparison ("ตัวไหน
    // นิสัยดีกว่า"). Keep this in the deterministic/grounded pipeline so the
    // resolver can check the authoritative source and honestly say "ไม่รู้"
    // instead of spending/failing a model call and returning a generic outage.
    if (effectiveDomain === 'activity') {
      return {
        domain: effectiveDomain, intent: 'compare_entities', action: 'compare',
        entities: { compareAttribute: attribute },
        references: [],
        constraints: [], confidence: 0.7, needsClarification: false,
      };
    }
    return null;
  }
  const ids = candidates.slice(0, 4).map(entity => entity.id);
  return {
    domain: effectiveDomain, intent: 'compare_entities', action: 'compare',
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
/** ActiveTask.slots.resourceCode (e.g. "activity-horse") IS an
 *  ACTIVITY_TOPIC_KEYWORDS nodeId -- the same identifier space, so this is
 *  a lookup, not a second lexicon. Lets a shortened follow-up on an
 *  already-open task ("มีกี่ตัว", no "ม้า" restated) resolve its topic from
 *  task context instead of requiring the keyword in every message. */
function activityTopicFromResourceCode(resourceCode: unknown): { nodeId: string; activityCode: string } | null {
  if (typeof resourceCode !== 'string') return null;
  const match = ACTIVITY_TOPIC_KEYWORDS.find(item => item.nodeId === resourceCode);
  return match ? { nodeId: match.nodeId, activityCode: match.activityCode } : null;
}

function detectActivitySideQuestion(
  message: string,
  domain: SemanticDomain | null,
  activeTaskTopic: { nodeId: string; activityCode: string } | null = null,
  now: Date = new Date(),
): SemanticTurn | null {
  if (domain !== 'activity') return null;
  // Inventory/count questions are read-only side questions even while an
  // activity booking task is active. Without this precedence, the active-task
  // path falls through to same-domain topic narrowing and gets mislabeled as
  // "resume_active_task", which makes the Dialog Manager ask the next missing
  // booking field (e.g. date) instead of answering "มีม้ากี่ตัว".
  // The topic itself comes from THIS message when it's there ("มีม้ากี่ตัว"),
  // falling back to the already-open task's own resourceCode when it isn't
  // ("มีกี่ตัว" mid-conversation) -- never guessed when neither is present.
  const activityTopic = findActivityTopic(message) ?? activeTaskTopic;
  if (activityTopic && isInventoryCountQuestion(message)) {
    return {
      domain,
      intent: 'activity_inventory_count',
      action: 'ask',
      entities: { activityCode: activityTopic.activityCode, inventoryCount: true },
      references: [],
      constraints: [],
      confidence: 0.9,
      needsClarification: false,
    };
  }
  if (PRICE_MARKER.test(message)) {
    return { domain, intent: 'ask_price', action: 'ask', entities: {}, references: [], constraints: [], confidence: 0.8, needsClarification: false };
  }
  if (AVAILABILITY_STATUS_MARKER.test(message)) {
    const entities: Record<string, unknown> = {};
    const date = extractDate(message, now);
    if (date) entities.date = date;
    return { domain, intent: 'ask_availability_status', action: 'status', entities, references: [], constraints: [], confidence: 0.8, needsClarification: false };
  }
  if (HOW_IT_WORKS_MARKER.test(message)) {
    return { domain, intent: 'ask_how_it_works', action: 'ask', entities: {}, references: [], constraints: [], confidence: 0.75, needsClarification: false };
  }
  return null;
}

function detectNonActivitySideQuestion(message: string, domain: SemanticDomain | null, now: Date = new Date()): SemanticTurn | null {
  if (!domain || domain === 'activity' || domain === 'unknown') return null;
  const entities: Record<string, unknown> = {};
  const date = extractDate(message, now);
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
    return { domain, intent:'membership_follow_up', action: MEMBERSHIP_STATUS_ACTION_MARKER.test(message) ? 'status' : 'ask', entities, references:[], constraints:[], confidence:0.75, needsClarification:false };
  }
  // Promotion incident: no follow-up branch existed here at all, so a
  // genuine follow-up question about a promotion just discussed ("อันเมื่อกี้
  // ใช้กับกิจกรรมได้ไหม") had no path back to the already-established
  // promotion domain and fell through to 'unknown' whenever the model was
  // unavailable. An applicability question ("ใช้...ได้ไหม") or a reference
  // back to what was just said both belong to the domain the conversation is
  // ALREADY anchored in (this function only runs when `domain` is already
  // the established effectiveDomain) -- routing it back to
  // renderPromotionRecommendation's existing action:'ask' handling answers
  // from the SAME real promotion_eligibility source turn 1 used, never a
  // new guess.
  if (domain === 'promotion'
    && (/ใช้.*ได้(?:ไหม|มั้ย|รึเปล่า|หรือเปล่า)|แลก.*ได้(?:ไหม|มั้ย)/u.test(message)
      || PRIOR_REFERENCE_MARKER.test(message))) {
    return { domain, intent:'promotion_follow_up', action:'ask', entities, references:[], constraints:[], confidence:0.75, needsClarification:false };
  }
  return null;
}

function deriveForActiveTask(
  message: string,
  context: SemanticContext,
  task: ActiveTask,
  now: Date = new Date(),
): SemanticTurn | null {
  // An explicit cancel ends the task outright, regardless of what other
  // slot-shaped content the message might also contain.
  if (hasCancelMarker(message)) {
    return {
      domain: task.domain, intent: 'task_cancel', action: 'cancel',
      entities: {}, references: [], constraints: [], confidence: 0.9, needsClarification: false,
    };
  }

  // A CONDITIONAL continuation of the already-selected task entity ("ถ้าตัว
  // นั้นไม่ว่าง เอาอีกตัวแทนได้ แต่ถ้าทั้งคู่ไม่ว่างไม่ต้องจอง"): structurally,
  // an unavailability condition PLUS an explicit "so don't transact"
  // consequence, never a phrase table for this one sentence. With an active
  // task's already-selected entity as the sole candidate, "ตัวนั้น" has a
  // unique, bounded referent -- the task itself -- so this must preserve
  // that selection and check availability, never guess a booking or ask an
  // unnecessary "which one" clarification. Production incident this closes:
  // this had no deterministic classification at all, so a genuine transient
  // provider failure on this exact turn collapsed to the generic "ระบบจอง
  // ตอบช้า" apology instead of an honest availability check that never
  // transacts without further confirmation.
  if (!hasCommitMarker(message)
    && CONDITIONAL_UNAVAILABLE_MARKER.test(message)
    && NO_COMMIT_CONSEQUENCE_MARKER.test(message)) {
    const entities: Record<string, unknown> = {};
    if (typeof task.slots.resourceCode === 'string') entities.resourceCode = task.slots.resourceCode;
    // The task's own slot key is `assetSelection` (see ACTIVITY_BOOKING_
    // REQUIRED_FIELDS in thongthai-chat.ts); renderActivityAvailability
    // reads the customer-facing name back under `entities.horseName`.
    if (typeof task.slots.assetSelection === 'string') entities.horseName = task.slots.assetSelection;
    return {
      domain: task.domain, intent: 'task_conditional_continuation', action: 'ask',
      informationNeed: 'availability',
      entities, references: [], constraints: ['no_transaction'], confidence: 0.8, needsClarification: false,
    };
  }

  // Side-questions must be answered on their own terms -- never silently
  // reduced to whatever slot value they might incidentally also contain
  // (see the Dialog Manager's SIDE_QUESTION_ACTIONS precedence, which
  // preserves the task untouched for exactly these actions).
  const sideQuestion = detectActivitySideQuestion(message, task.domain, activityTopicFromResourceCode(task.slots.resourceCode), now);
  if (sideQuestion) return sideQuestion;

  const entities: Record<string, unknown> = {};
  const date = extractDate(message, now);
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

  const correcting = hasCorrectionMarker(message);
  const committing = hasCommitMarker(message);
  if (!Object.keys(entities).length && !references.length && !committing) return null;
  return {
    domain: task.domain,
    intent: committing
      ? 'transaction_request_for_prior_entity'
      : correcting
        ? 'task_field_correction'
        : entityMatch
          ? 'select_prior_entity'
          : 'task_slot_update',
    action: committing
      ? 'book'
      : correcting
        ? 'correct_previous'
        : entityMatch
          ? 'confirm'
          : 'provide_information',
    speechAct: committing
      ? 'transaction_request'
      : correcting
        ? 'correction'
        : entityMatch
          ? 'selection'
          : undefined,
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
  now: Date = new Date(),
): SemanticTurn | null {
  const trimmed = message.trim();
  if (!trimmed) return null;

  const activeTask = taskState.activeTask && !isTerminalTaskStatus(taskState.activeTask.status)
    ? taskState.activeTask
    : null;
  const effectiveDomain = activeTask?.domain ?? context.activeDomain;

  // Explicit transaction commitment outranks every read-only topic shortcut.
  // The resource comes from the closed ecosystem activity graph; missing
  // booking slots remain follow-up fields and do not erase the commitment.
  const committedActivityTopic=!activeTask && hasStandaloneTransactionRequest(trimmed)
    ? findActivityTopic(trimmed)
    : null;
  if (committedActivityTopic) {
    const asset=findKnownActivityAssetSelection(trimmed);
    const entities:Record<string,unknown>={
      activityCode:committedActivityTopic.activityCode,
      resourceCode:committedActivityTopic.nodeId,
    };
    if (asset) entities.horseName=asset.name;
    const date=extractDate(trimmed,now);
    const time=extractTime(trimmed);
    const partySize=extractPartySize(trimmed);
    const durationMinutes=extractDurationMinutes(trimmed);
    if (date) entities.date=date;
    if (time) entities.time=time;
    if (partySize) entities.partySize=partySize;
    if (durationMinutes) entities.durationMinutes=durationMinutes;
    return {
      domain:'activity',
      intent:'activity_booking_request',
      action:'book',
      speechAct:'transaction_request',
      entities,
      references:asset
        ? [{type:'entity_selection',value:asset.name,refersToPriorContext:false,resolvedEntityId:asset.entityId}]
        : [],
      constraints:[],
      confidence:0.92,
      needsClarification:false,
    };
  }

  // A comparison among recently-shown entities can happen with or without an
  // open task (e.g. "ตัวไหนนิสัยดีกว่า" right after browsing, before any
  // selection is made) -- checked first, and it never touches task state.
  const compare = detectCompareEntities(trimmed, context, effectiveDomain);
  if (compare) return compare;

  if (activeTask && (activeTask.status === 'collecting' || activeTask.status === 'ready')) {
    const taskDerived = deriveForActiveTask(trimmed, context, activeTask, now);
    if (taskDerived) return taskDerived;
    // Nothing task-specific matched -- before giving up, check whether this
    // is actually a topic switch AWAY from the active task (e.g. "ร้านมีไรกิน"
    // while mid-activity-booking). A genuine switch must still surface as a
    // real turn (so the Dialog Manager's existing suspend mechanism fires),
    // not silently fall through to "genuinely unclassifiable".
    const topicSwitch = detectCrossDomainTopicSwitch(trimmed, now);
    if (topicSwitch && topicSwitch.domain !== activeTask.domain) return topicSwitch;
    if (topicSwitch && topicSwitch.domain === activeTask.domain) {
      const entities: Record<string, unknown> = {};
      if (typeof activeTask.slots.resourceCode === 'string') entities.resourceCode = activeTask.slots.resourceCode;
      return {
        domain: activeTask.domain,
        intent: 'resume_active_task',
        action: 'provide_information',
        entities,
        references: [],
        constraints: [],
        confidence: 0.8,
        needsClarification: false,
      };
    }
    return null;
  }

  // A message that structurally names a DIFFERENT domain than whatever is
  // currently "active" (from a prior turn's reply, not necessarily an open
  // task) must be recognized as a topic switch BEFORE any same-domain
  // side-question shortcut gets a chance to swallow it. Those shortcuts
  // (detectActivitySideQuestion's AVAILABILITY_STATUS_MARKER, detectNon
  // ActivitySideQuestion's per-domain regexes) intentionally use broad,
  // topic-agnostic words -- bare "มี", PRICE_MARKER, "ว่างไหม" -- that read
  // naturally across EVERY domain ("มีห้องพักไหม" mid a cafe conversation
  // contains cafe's own "มี" marker just as much as stay's "ห้อง" one), so
  // the only reliable way to tell them apart is which domain's own
  // STRUCTURAL marker the message actually names. Reuses the SAME per-
  // domain marker ladder detectCrossDomainTopicSwitch already checks for
  // the active-task case -- one topic-detection ladder, not two. Real
  // incident this closes: "มีห้องพักไหม" mid a cafe conversation (no active
  // task) stayed answered as an unresolved CAFE question instead of
  // switching to stay, because cafe's own "มี" follow-up marker matched
  // first and detectNonActivitySideQuestion never checked for a different
  // domain's marker before claiming the turn.
  if (effectiveDomain) {
    const crossDomainSwitch = detectCrossDomainTopicSwitch(trimmed, now);
    if (crossDomainSwitch && crossDomainSwitch.domain !== effectiveDomain) return crossDomainSwitch;
  }

  // No open task: a price/availability/how-it-works side-question about the
  // current topic, asked before any selection is made.
  const sideQuestion = detectActivitySideQuestion(trimmed, effectiveDomain, null, now);
  if (sideQuestion) return sideQuestion;

  // A CONDITIONAL continuation of a just-discussed entity ("ถ้าตัวนั้นไม่ว่าง
  // เอาอีกตัวแทนได้ แต่ถ้าทั้งคู่ไม่ว่างไม่ต้องจอง") can arise with NO open task
  // at all -- a prior turn may have only RECOMMENDED an entity (a real model
  // answering "เอาตัวที่นิสัยนิ่งกว่า" with a suggestion) without that
  // recommendation ever becoming a booking task. "ตัวนั้น" still has a
  // unique, bounded referent here: whichever single entity of this domain
  // the conversation most recently discussed. Mirrors the identically-
  // shaped active-task branch in deriveForActiveTask above -- same
  // structural markers, same "never guess, only resolve when unique"
  // discipline, just reading the entity from recentEntities instead of an
  // active task's own slots. Production incident this closes: this exact
  // shape was covered for the active-task case, but a prior turn resolved
  // by the real model as a plain recommendation (no task opened) left
  // nothing for deriveForActiveTask to ever reach, so a genuine transient
  // provider failure on this follow-up still collapsed to the generic
  // "ระบบจองตอบช้า" apology.
  if (effectiveDomain
    && !hasCommitMarker(trimmed)
    && CONDITIONAL_UNAVAILABLE_MARKER.test(trimmed)
    && NO_COMMIT_CONSEQUENCE_MARKER.test(trimmed)) {
    const candidates = context.recentEntities.filter(entity => entity.domain === effectiveDomain);
    // Discovery/recommendation turns can legitimately place several catalog
    // entities in recentEntities (for horse riding, both horses are grounded
    // facts). In that shape, "ตัวนั้น" is still uniquely resolvable when the
    // bounded assistant recommendation evidence names exactly one of them.
    // lastRecommendationReference is populated from the assistant's actual
    // composed recommendation, so this follows conversation evidence rather
    // than guessing from catalog order or customer keywords.
    const recommendationMatches = context.lastRecommendationReference
      ? candidates.filter(entity => context.lastRecommendationReference!.includes(entity.name))
      : [];
    const resolvedCandidate = recommendationMatches.length === 1
      ? recommendationMatches[0]!
      : candidates.length === 1
        ? candidates[0]!
        : null;
    if (resolvedCandidate) {
      const entities: Record<string, unknown> = { horseName: resolvedCandidate.name };
      const resourceCode = directResourceCode(resolvedCandidate);
      if (resourceCode) entities.resourceCode = resourceCode;
      return {
        domain: effectiveDomain, intent: 'task_conditional_continuation', action: 'ask',
        informationNeed: 'availability',
        entities, references: [], constraints: ['no_transaction'], confidence: 0.75, needsClarification: false,
      };
    }
  }

  // No active task: a selection among entities the customer already saw
  // this conversation ("เอาภาราดร" after being shown horse options).
  const entityMatch = findEntityByName(trimmed, context.recentEntities);
  if (entityMatch) {
    const resourceCode = directResourceCode(entityMatch);
    const domain = entityMatch.domain === 'unknown' ? (context.activeDomain ?? 'unknown') : entityMatch.domain;
    const committing = hasStandaloneTransactionRequest(trimmed);
    const action: SemanticTurn['action'] = committing
      ? domain === 'restaurant' ? 'order'
        : domain === 'activity' || domain === 'stay' ? 'book'
          : 'confirm'
      : 'confirm';
    return {
      domain,
      intent: committing ? 'transaction_request_for_prior_entity' : 'select_prior_entity',
      action,
      speechAct: committing ? 'transaction_request' : 'selection',
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

  const knownActivityAsset = findKnownActivityAssetSelection(trimmed);
  if (knownActivityAsset) {
    const entities: Record<string, unknown> = {
      resourceCode: knownActivityAsset.resourceCode,
      horseName: knownActivityAsset.name,
    };
    const date = extractDate(trimmed, now);
    const time = extractTime(trimmed);
    const partySize = extractPartySize(trimmed);
    const durationMinutes = extractDurationMinutes(trimmed);
    if (date) entities.date = date;
    if (time) entities.time = time;
    if (partySize) entities.partySize = partySize;
    if (durationMinutes) entities.durationMinutes = durationMinutes;
    const committing=hasCommitMarker(trimmed);
    const correcting=hasCorrectionMarker(trimmed);
    return {
      domain: 'activity',
      intent: 'select_known_activity_asset',
      action: committing ? 'book' : correcting ? 'correct_previous' : 'confirm',
      speechAct: committing ? 'transaction_request' : correcting ? 'correction' : 'selection',
      entities,
      references: [{ type: 'entity_selection', value: knownActivityAsset.name, refersToPriorContext: false, resolvedEntityId: knownActivityAsset.entityId }],
      constraints: [],
      confidence: 0.82,
      needsClarification: false,
    };
  }

  const nonActivitySideQuestion = detectNonActivitySideQuestion(trimmed, effectiveDomain, now);
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

  // A generic transaction commitment applies to the canonical activity
  // topic even before a named asset is selected. Missing asset/date/duration
  // are follow-up slots; they must never downgrade "book <activity>" into a
  // catalog browse. This is structural (shared commit marker + ecosystem
  // activity node), not a phrase table.
  if (activityTopic) {
    const committing=hasCommitMarker(trimmed);
    return {
      domain: 'activity',
      intent: committing ? 'activity_booking_request' : 'activity_topic_narrow',
      action: committing ? 'book' : 'discover',
      speechAct: committing ? 'transaction_request' : undefined,
      informationNeed: committing ? undefined : 'catalog',
      entities: {
        activityCode: activityTopic.activityCode,
        ...(committing ? {resourceCode:activityTopic.nodeId} : {}),
      },
      references: [],
      constraints: [],
      confidence: 0.9,
      needsClarification: false,
    };
  }

  // A live table-status question on a genuine cold start (no active task,
  // no prior domain at all) -- same structural marker as
  // detectCrossDomainTopicSwitch's own check above, checked here too since
  // that function is only reached when an active task or an established
  // effectiveDomain already exists. Without this, a first-message table
  // question had no classification path whatsoever.
  if (findRestaurantTableStatusQuestion(trimmed)) {
    const entities: Record<string, unknown> = {};
    const date = extractDate(trimmed, now);
    const time = extractTime(trimmed);
    if (date) entities.date = date;
    if (time) entities.time = time;
    return {
      domain: 'restaurant', intent: 'restaurant_availability_check', action: 'ask',
      informationNeed: 'availability',
      entities, references: [], constraints: [], confidence: 0.85, needsClarification: false,
    };
  }

  // A restaurant-topic marker with no active task (e.g. mid a stay
  // conversation that never created a task, since stay has no
  // task-creation mechanism today -- see THONGTHAI_HANDOFF.md). Without
  // this, findRestaurantTopicNarrow was only ever consulted inside
  // detectCrossDomainTopicSwitch's active-task branch above, so a
  // domain-only "active" conversation (context.activeDomain set from a
  // prior read-only reply, no task) had no path to recognize a genuine
  // topic switch to restaurant -- it fell through to null and, if the
  // model was unavailable, silently re-answered as the STALE domain
  // instead of switching. Reuses the same marker/intent shape
  // detectCrossDomainTopicSwitch already returns, never a new lexicon.
  if (findRestaurantTopicNarrow(trimmed)) {
    return {
      domain: 'restaurant', intent: 'restaurant_topic_switch', action: 'discover',
      entities: {}, references: [], constraints: [], confidence: 0.8, needsClarification: false,
    };
  }

  if (findStayTopic(trimmed)) {
    const entities: Record<string, unknown> = {};
    const date = extractDate(trimmed, now);
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

  if (isPromotionDiscoveryIntent(trimmed)) {
    return {
      domain: 'promotion',
      intent: 'promotion_discovery',
      action: 'discover',
      informationNeed: 'catalog',
      entities: {},
      references: [],
      constraints: [],
      confidence: 0.9,
      needsClarification: false,
    };
  }

  if (findMembershipTopic(trimmed)) {
    return {
      domain: 'membership',
      intent: MEMBERSHIP_STATUS_ACTION_MARKER.test(trimmed) ? 'membership_status' : 'membership_information',
      action: MEMBERSHIP_STATUS_ACTION_MARKER.test(trimmed) ? 'status' : 'ask',
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
