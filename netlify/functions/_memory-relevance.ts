import type { SemanticTurn } from './_semantic-interpreter';

export type DurableMemorySnapshot = {
  travelerType?: string | null;
  pace?: string | null;
  interests?: string[];
  constraints?: string[];
  group?: { adults?: number | null; children?: number | null; elderly?: number | null } | null;
  favorites?: string[];
  visitedExperiences?: string[];
};

export type MemoryRelevancePlan = {
  relevantConstraints: string[];
  travelerType: string | null;
  pace: string | null;
  interests: string[];
  favorites: string[];
  visitedExperiences: string[];
  appliedKeys: string[];
  ignoredKeys: string[];
};

const FOOD_CONSTRAINTS = new Set([
  'vegetarian','no_spicy','mild_spice','no_pork','no_beef','no_chicken',
  'no_fish','no_egg','no_plara','no_peanut','no_shrimp',
  'peanut_allergy','shrimp_allergy','fish_allergy','egg_allergy',
  'food_allergy','authentic_isan',
]);

const ACTIVITY_CARE_CONSTRAINTS = new Set([
  'limited_walking','wheelchair_access','elderly_friendly','child_friendly',
  'kid_friendly','beginner_friendly','low_intensity','fear_of_falling',
  'fear_of_speed','rain_sensitive','prior_safety_concern',
]);

const ECOSYSTEM_CONSTRAINTS = new Set([
  'limited_walking','wheelchair_access','elderly_friendly','child_friendly',
  'kid_friendly','low_intensity','rain_sensitive',
]);

function safeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))];
}

function selectConstraints(source: string[], allowed: ReadonlySet<string>): string[] {
  return source.filter(item => allowed.has(item));
}

function emptyPlan(memory: DurableMemorySnapshot | null | undefined): MemoryRelevancePlan {
  return {
    relevantConstraints: [],
    travelerType: null,
    pace: null,
    interests: [],
    favorites: [],
    visitedExperiences: [],
    appliedKeys: [],
    ignoredKeys: memory ? Object.keys(memory) : [],
  };
}

function finalize(
  memory: DurableMemorySnapshot,
  selected: Omit<MemoryRelevancePlan, 'appliedKeys' | 'ignoredKeys'>,
): MemoryRelevancePlan {
  const appliedKeys: string[] = [];
  if (selected.relevantConstraints.length) appliedKeys.push('constraints');
  if (selected.travelerType) appliedKeys.push('travelerType');
  if (selected.pace) appliedKeys.push('pace');
  if (selected.interests.length) appliedKeys.push('interests');
  if (selected.favorites.length) appliedKeys.push('favorites');
  if (selected.visitedExperiences.length) appliedKeys.push('visitedExperiences');

  const ignoredKeys = Object.keys(memory).filter(key => !appliedKeys.includes(key));
  return { ...selected, appliedKeys, ignoredKeys };
}

/**
 * Durable memory is consulted AFTER current-turn semantic understanding.
 *
 * This planner cannot alter domain/intent/action/informationNeed. It only
 * selects a conservative subset of already-normalized customer memory for
 * downstream planning. Current-turn meaning therefore always owns the turn.
 */
export function planMemoryRelevance(
  turn: SemanticTurn,
  memory: DurableMemorySnapshot | null | undefined,
): MemoryRelevancePlan {
  if (!memory) return emptyPlan(memory);

  const constraints = safeList(memory.constraints);
  const interests = safeList(memory.interests);
  const favorites = safeList(memory.favorites);
  const visitedExperiences = safeList(memory.visitedExperiences);
  const travelerType = typeof memory.travelerType === 'string' && memory.travelerType.trim()
    ? memory.travelerType.trim()
    : null;
  const pace = typeof memory.pace === 'string' && memory.pace.trim()
    ? memory.pace.trim()
    : null;

  const none = (): MemoryRelevancePlan => emptyPlan(memory);
  const recommendationLike = turn.action === 'recommend'
    || turn.action === 'discover'
    || turn.informationNeed === 'recommendation'
    || turn.informationNeed === 'catalog';

  // Live/operational questions should be answered from current facts only.
  // Durable lifestyle/preferences must never change what the customer asked.
  if (
    turn.informationNeed === 'availability'
    || turn.informationNeed === 'schedule'
    || turn.informationNeed === 'transaction_status'
    || turn.action === 'status'
  ) return none();

  if (turn.domain === 'restaurant') {
    if (turn.informationNeed === 'ingredients' || recommendationLike) {
      return finalize(memory, {
        relevantConstraints: selectConstraints(constraints, FOOD_CONSTRAINTS),
        travelerType: null,
        pace: null,
        interests: [],
        favorites: [],
        visitedExperiences: [],
      });
    }
    return none();
  }

  if (turn.domain === 'activity') {
    if (!recommendationLike) return none();
    return finalize(memory, {
      relevantConstraints: selectConstraints(constraints, ACTIVITY_CARE_CONSTRAINTS),
      travelerType,
      pace,
      interests: interests.filter(item => ['adventure','nature','family','wellness'].includes(item)),
      favorites: [],
      visitedExperiences: [],
    });
  }

  if (turn.domain === 'stay') {
    if (!recommendationLike) return none();
    return finalize(memory, {
      relevantConstraints: selectConstraints(constraints, ECOSYSTEM_CONSTRAINTS),
      travelerType,
      pace,
      interests: interests.filter(item => ['rest','nature','family','wellness'].includes(item)),
      favorites: [],
      visitedExperiences: [],
    });
  }

  if (turn.domain === 'ecosystem' || turn.domain === 'journey') {
    if (!recommendationLike) return none();
    return finalize(memory, {
      relevantConstraints: selectConstraints(constraints, ECOSYSTEM_CONSTRAINTS),
      travelerType,
      pace,
      interests,
      favorites,
      visitedExperiences,
    });
  }

  // Promotion, membership, payment, support, location-like unknowns, and other
  // operational/administrative domains stay memory-neutral by default.
  return none();
}


/** Apply only the selected memory constraints to downstream planning.
 * The original semantic classification is preserved separately by the
 * orchestrator for observability/conversation state. */
export function semanticTurnForDialog(
  turn: SemanticTurn,
  plan: MemoryRelevancePlan,
): SemanticTurn {
  const constraints = [...new Set([
    ...turn.constraints,
    ...plan.relevantConstraints,
  ])];
  return { ...turn, constraints };
}
