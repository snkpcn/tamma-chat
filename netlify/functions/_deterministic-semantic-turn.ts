// Zero-cost architecture (Phase P): deterministic semantic-turn derivation
// for when the model provider is unavailable (circuit open / 429 / provider
// down). Reuses the EXISTING generic slot parsers, task state, and entity-
// reference resolution -- never a growing table of literal Thai phrases --
// so a turn that is structurally interpretable from context alone needs ZERO
// LLM calls. Returns null when the turn is genuinely not derivable this way;
// the caller then either falls back to the real model (if available) or asks
// ONE honest clarifying question -- it must never guess.
import type {
  SemanticContext, SemanticContextEntity, SemanticReference, SemanticTurn,
} from './_semantic-interpreter';
import type { ActiveTask, TaskStateContainer } from './_task-state';
import { extractDate, extractPartySize, extractTime, hasCommitMarker, hasCorrectionMarker } from './_slot-parsers';
import { isExperienceDiscoveryIntent } from './_experience-discovery';
import { findEcosystemNode } from './_ecosystem-entity-graph';

export const DETERMINISTIC_SEMANTIC_TURN_VERSION = 'deterministic-semantic-turn-v1';

// Closed, doctrine-level keyword per activity node -- exactly the real
// activities this ecosystem has today (see _ecosystem-entity-graph.ts, which
// the rest of the system already treats as canonical structure), not a
// growing table of customer phrasings.
const ACTIVITY_TOPIC_KEYWORDS: ReadonlyArray<{ nodeId: string; keyword: RegExp }> = [
  { nodeId: 'activity-horse', keyword: /ม้า/u },
  { nodeId: 'activity-atv', keyword: /atv/iu },
  { nodeId: 'activity-archery', keyword: /ยิงธนู|ธนู/u },
];

function findEntityByName(message: string, entities: readonly SemanticContextEntity[]): SemanticContextEntity | null {
  const candidates = entities.filter(entity => entity.name && message.includes(entity.name));
  return candidates.length === 1 ? candidates[0]! : null;
}

function findActivityTopicNarrow(message: string): boolean {
  return ACTIVITY_TOPIC_KEYWORDS.some(item => item.keyword.test(message) && Boolean(findEcosystemNode(item.nodeId)));
}

function deriveForActiveTask(
  message: string,
  context: SemanticContext,
  task: ActiveTask,
): SemanticTurn | null {
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
  if (date) entities.date = date;
  if (time) entities.time = time;
  if (partySize) entities.partySize = partySize;

  const entityMatch = findEntityByName(message, context.recentEntities);
  const references: SemanticReference[] = entityMatch
    ? [{ type: 'entity_selection', value: entityMatch.name, refersToPriorContext: true, resolvedEntityId: entityMatch.id }]
    : [];
  // A selection must also land as a slot value (e.g. resourceCode), not only
  // as a reference -- otherwise "retain selected horse" would show up in
  // selectedEntities but never satisfy the task's own missing-field check.
  if (entityMatch) entities.resourceCode = entityMatch.id;

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

  const activeTask = taskState.activeTask;
  if (activeTask && (activeTask.status === 'collecting' || activeTask.status === 'ready')) {
    return deriveForActiveTask(trimmed, context, activeTask);
  }

  // No active task: a selection among entities the customer already saw
  // this conversation ("เอาภาราดร" after being shown horse options).
  const entityMatch = findEntityByName(trimmed, context.recentEntities);
  if (entityMatch) {
    return {
      domain: entityMatch.domain === 'unknown' ? (context.activeDomain ?? 'unknown') : entityMatch.domain,
      intent: 'select_prior_entity',
      action: 'confirm',
      // Also land the selection as resourceCode so a new task created from
      // this turn (Dialog Manager seeds initialSlots from `entities`) starts
      // with the selection already filled, not just recorded as a reference.
      entities: { resourceCode: entityMatch.id },
      references: [{ type: 'entity_selection', value: entityMatch.name, refersToPriorContext: true, resolvedEntityId: entityMatch.id }],
      constraints: [],
      confidence: 0.9,
      needsClarification: false,
    };
  }

  // Narrowing to a specific known activity ("ม้าล่ะ" / "ATV ล่ะ").
  if (findActivityTopicNarrow(trimmed)) {
    return {
      domain: 'activity',
      intent: 'activity_topic_narrow',
      action: 'discover',
      entities: {},
      references: [],
      constraints: [],
      confidence: 0.85,
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
