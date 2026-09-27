// Human Core PR C -- CanonicalKnowledgeScope.
//
// SemanticMeaning (see _semantic-meaning.ts) says WHAT KIND of thing the
// customer's turn is focused on (focusKind/focusValue) using only the
// closed SemanticTurn shape -- no catalog access. CanonicalKnowledgeScope
// is the next step: turning that into real machine identities/relationships
// from the Activity and Stay SOTs (activity asset/type relationships, Stay
// resource/bedroom-type relationships), NEVER a customer-language keyword
// and NEVER a fabricated id.
//
// Two-stage resolution, because the canonical PARENT of a named entity
// (e.g. which activity type "ภาราดร" belongs to) is only knowable from the
// live catalog, and the catalog itself is only fetched once dialog planning
// decides to fetch it:
//   1. deriveCanonicalKnowledgeScope(meaning) -- PRE-FETCH. Works from
//      SemanticMeaning alone. A stated entity_type (already a real SOT code
//      via entities.activityCode) resolves immediately. A resolved
//      canonical entity reference (activity_asset:<code>) resolves
//      immediately. A bare customer-stated name with no canonical id yet
//      is 'ambiguous' pending catalog lookup. No focus signal is
//      'unresolved'.
//   2. resolveCanonicalScopeAgainstFacts(scope, facts) -- POST-FETCH.
//      Given the facts a knowledge request actually returned, canonicalizes
//      a pending bare name against the live activity_asset:<code>:name /
//      :activityCode facts (the SAME real relationship
//      _response-composer.ts's naturalActivityTopicSummary already joins
//      on) -- never a hardcoded name table.
//
// filterFactsByCanonicalScope is the response scope firewall (C5): the last
// gate before any GroundedFact reaches a renderer. It is intentionally
// SEPARATE from resolution -- a request can be pre-scoped, refined from
// facts, or (if a knowledge source ever over-fetches) still need filtering
// -- so the firewall is a pure function over (facts, scope) that never
// trusts the fetch to have already narrowed correctly.
import type { SemanticDomain } from './_semantic-interpreter';
import type { SemanticFocusKind, SemanticMeaning, SemanticScopeBreadth } from './_semantic-meaning';

// Deliberately NOT importing GroundedFact from _knowledge-resolver.ts here:
// that module will import this one's resolve/filter functions (to apply the
// firewall as facts are resolved), and a full GroundedFact import back
// would make the two modules mutually dependent. Every real GroundedFact
// already has {key, value}, so it satisfies this minimal shape structurally
// with no cast needed at any call site.
export type ScopableFact = { key: string; value: unknown };

export type CanonicalScopeStatus = 'resolved' | 'ambiguous' | 'unresolved';

export type CanonicalKnowledgeScope = {
  domain: SemanticDomain;
  breadth: SemanticScopeBreadth;
  focusKind: SemanticFocusKind;
  status: CanonicalScopeStatus;
  /** Canonical parent identities (e.g. activity_offerings.activity_code
   *  values like 'horse') the request/response must stay inside. Empty
   *  when breadth is domain_wide (nothing to constrain to) or status is
   *  not yet resolved. */
  canonicalParentIds: string[];
  /** Canonical specific-entity identities (e.g. 'activity_asset:horse-
   *  pharadon') the request/response must stay inside, when the focus is
   *  one particular resolved entity rather than a whole type. */
  canonicalEntityIds: string[];
  /** The entity-kind prefix(es) this scope governs (e.g. 'activity_asset')
   *  -- lets the firewall know which fact keys are even subject to this
   *  scope, so unrelated domains' facts are never touched. */
  allowedEntityKinds: string[];
  /** Where this scope's identities came from, for observability/debugging
   *  -- never used for routing. */
  provenance: string;
  /** A bare customer-stated name (e.g. a horseName) not yet canonicalized
   *  to a real entity id -- present only when status is 'ambiguous',
   *  pending resolveCanonicalScopeAgainstFacts. Never a fabricated id. */
  pendingFocusName?: string;
};

const ACTIVITY_ASSET_KIND = 'activity_asset';
const ACTIVITY_KIND = 'activity';
const STAY_KIND = 'stay';
const STAY_TYPE_KIND = 'stay_type';
const MENU_KIND = 'menu';
const MENU_CATEGORY_KIND = 'menu_category';

function emptyScope(
  meaning: Pick<SemanticMeaning, 'domain' | 'scopeBreadth' | 'focusKind'>,
  status: CanonicalScopeStatus,
  provenance: string,
): CanonicalKnowledgeScope {
  return {
    domain: meaning.domain,
    breadth: meaning.scopeBreadth,
    focusKind: meaning.focusKind,
    status,
    canonicalParentIds: [],
    canonicalEntityIds: [],
    allowedEntityKinds: [],
    provenance,
  };
}

/** Pure, pre-fetch scope derivation from SemanticMeaning alone. Activity and
 *  Stay have real canonical relationships wired today; other
 *  domains resolve to domain_wide/unresolved and the firewall is a no-op
 *  for them, exactly like today's unscoped behavior -- this never makes an
 *  un-migrated domain stricter than before. */
export function deriveCanonicalKnowledgeScope(meaning: SemanticMeaning): CanonicalKnowledgeScope {
  if (meaning.scopeBreadth === 'domain_wide') {
    return emptyScope(meaning, 'resolved', 'domain_wide_discovery');
  }
  if (meaning.scopeBreadth === 'unknown') {
    return emptyScope(meaning, 'unresolved', 'no_focus_signal');
  }

  // breadth === 'focused' from here.
  if (meaning.domain !== 'activity' && meaning.domain !== 'stay' && meaning.domain !== 'restaurant') {
    // Focused in a domain this contract doesn't canonicalize yet -- remain
    // unresolved rather than guessing, but this is intentionally inert
    // until that domain's own PR wires it (see filterFactsByCanonicalScope,
    // which only firewalls domains it understands).
    return emptyScope(meaning, 'unresolved', 'domain_not_yet_canonicalized');
  }

  if (meaning.domain === 'restaurant') {
    if ((meaning.focusKind === 'category' || meaning.focusKind === 'entity_type') && meaning.focusValue) {
      const category = meaning.focusValue.startsWith(`${MENU_CATEGORY_KIND}:`)
        ? meaning.focusValue
        : `${MENU_CATEGORY_KIND}:${meaning.focusValue}`;
      return {
        ...emptyScope(meaning, 'resolved', 'declared_menu_category'),
        canonicalParentIds: [category],
        allowedEntityKinds: [MENU_KIND, MENU_CATEGORY_KIND],
      };
    }
    if (meaning.focusKind === 'entity' && meaning.focusValue) {
      if (meaning.focusValue.startsWith(`${MENU_KIND}:`)) {
        return {
          ...emptyScope(meaning, 'resolved', 'resolved_menu_entity_reference'),
          canonicalEntityIds: [meaning.focusValue],
          allowedEntityKinds: [MENU_KIND, MENU_CATEGORY_KIND],
        };
      }
      return {
        ...emptyScope(meaning, 'ambiguous', 'named_menu_item_pending_sot_lookup'),
        allowedEntityKinds: [MENU_KIND, MENU_CATEGORY_KIND],
        pendingFocusName: meaning.focusValue,
      };
    }
    if (meaning.focusKind === 'prior_reference') {
      return meaning.focusValue
        ? { ...emptyScope(meaning, 'ambiguous', 'prior_menu_reference_pending_sot_lookup'), allowedEntityKinds: [MENU_KIND, MENU_CATEGORY_KIND], pendingFocusName: meaning.focusValue }
        : emptyScope(meaning, 'unresolved', 'prior_menu_reference_without_evidence');
    }
    return emptyScope(meaning, 'unresolved', 'no_restaurant_focus_signal');
  }

  if (meaning.domain === 'stay') {
    if (meaning.focusKind === 'entity_type' && meaning.focusValue) {
      return {
        ...emptyScope(meaning, 'resolved', 'declared_stay_type'),
        canonicalParentIds: [meaning.focusValue],
        allowedEntityKinds: [STAY_KIND, STAY_TYPE_KIND],
      };
    }
    if (meaning.focusKind === 'entity' && meaning.focusValue) {
      if (meaning.focusValue.startsWith(`${STAY_KIND}:`)) {
        return {
          ...emptyScope(meaning, 'resolved', 'resolved_stay_entity_reference'),
          canonicalEntityIds: [meaning.focusValue],
          allowedEntityKinds: [STAY_KIND, STAY_TYPE_KIND],
        };
      }
      return {
        ...emptyScope(meaning, 'ambiguous', 'named_stay_pending_sot_lookup'),
        allowedEntityKinds: [STAY_KIND, STAY_TYPE_KIND],
        pendingFocusName: meaning.focusValue,
      };
    }
    if (meaning.focusKind === 'prior_reference') {
      return meaning.focusValue
        ? { ...emptyScope(meaning, 'ambiguous', 'prior_stay_reference_pending_sot_lookup'), allowedEntityKinds: [STAY_KIND, STAY_TYPE_KIND], pendingFocusName: meaning.focusValue }
        : emptyScope(meaning, 'unresolved', 'prior_stay_reference_without_evidence');
    }
    return emptyScope(meaning, 'unresolved', 'no_stay_focus_signal');
  }

  if (meaning.focusKind === 'entity_type' && meaning.focusValue) {
    return {
      ...emptyScope(meaning, 'resolved', 'declared_activity_type'),
      canonicalParentIds: [meaning.focusValue],
      allowedEntityKinds: [ACTIVITY_ASSET_KIND, ACTIVITY_KIND],
    };
  }

  if (meaning.focusKind === 'entity' && meaning.focusValue) {
    if (meaning.focusValue.startsWith(`${ACTIVITY_ASSET_KIND}:`)) {
      return {
        ...emptyScope(meaning, 'resolved', 'resolved_entity_reference'),
        canonicalEntityIds: [meaning.focusValue],
        allowedEntityKinds: [ACTIVITY_ASSET_KIND, ACTIVITY_KIND],
      };
    }
    // A bare customer-stated name (e.g. horseName "ภาราดร") -- real, but
    // not yet canonicalized to an entity id or parent. Ambiguous, not
    // unresolved: there IS a concrete focus, it just needs a catalog lookup.
    return {
      ...emptyScope(meaning, 'ambiguous', 'named_entity_pending_sot_lookup'),
      allowedEntityKinds: [ACTIVITY_ASSET_KIND, ACTIVITY_KIND],
      pendingFocusName: meaning.focusValue,
    };
  }

  if (meaning.focusKind === 'prior_reference') {
    // Bounded prior-context evidence with no canonical id of its own yet.
    // If it names something recognizable, treat it exactly like a bare
    // name pending catalog lookup; otherwise stay unresolved (fail closed).
    return meaning.focusValue
      ? { ...emptyScope(meaning, 'ambiguous', 'prior_reference_pending_sot_lookup'), allowedEntityKinds: [ACTIVITY_ASSET_KIND, ACTIVITY_KIND], pendingFocusName: meaning.focusValue }
      : emptyScope(meaning, 'unresolved', 'prior_reference_without_evidence');
  }

  return emptyScope(meaning, 'unresolved', 'no_focus_signal');
}

function factMapFrom(facts: readonly ScopableFact[]): Map<string, unknown> {
  return new Map(facts.map(fact => [fact.key, fact.value] as const));
}

/** Post-fetch refinement: canonicalize a pending bare name against the
 *  live catalog facts a knowledge request actually returned. Matches by
 *  the asset's own real `name` fact (never a hardcoded name table), then
 *  reads its real `activityCode` fact for the parent -- the SAME
 *  relationship _response-composer.ts's naturalActivityTopicSummary
 *  already joins on. If the name genuinely isn't in this bundle, the scope
 *  becomes 'unresolved' (fail closed), never silently widened. */
export function resolveCanonicalScopeAgainstFacts(
  scope: CanonicalKnowledgeScope,
  facts: readonly ScopableFact[],
): CanonicalKnowledgeScope {
  if (scope.domain !== 'activity' && scope.domain !== 'stay' && scope.domain !== 'restaurant') return scope;
  const map = factMapFrom(facts);

  if (scope.domain === 'restaurant') {
    if (scope.status === 'ambiguous' && scope.pendingFocusName) {
      const matches = [...map.keys()]
        .map(key => key.match(/^menu:([^:]+):name$/)?.[1])
        .filter((value): value is string => Boolean(value))
        .filter(id => map.get(`menu:${id}:name`) === scope.pendingFocusName);
      if (matches.length !== 1) {
        return {
          ...scope,
          status: matches.length > 1 ? 'ambiguous' : 'unresolved',
          canonicalEntityIds: [],
          canonicalParentIds: [],
          provenance: matches.length > 1 ? 'named_menu_item_not_unique_in_live_catalog' : 'named_menu_item_not_found_in_live_catalog',
        };
      }
      const id = matches[0]!;
      const category = map.get(`menu:${id}:category`);
      return {
        ...scope,
        status: 'resolved',
        canonicalEntityIds: [`menu:${id}`],
        canonicalParentIds: typeof category === 'string' && category ? [`${MENU_CATEGORY_KIND}:${category}`] : [],
        provenance: 'named_menu_item_resolved_against_live_catalog',
      };
    }
    if (scope.status === 'resolved' && scope.canonicalEntityIds.length && !scope.canonicalParentIds.length) {
      const parents = scope.canonicalEntityIds
        .map(entityId => map.get(`${entityId}:category`))
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .map(value => `${MENU_CATEGORY_KIND}:${value}`);
      if (parents.length) {
        return { ...scope, canonicalParentIds: [...new Set(parents)], provenance: `${scope.provenance}+menu_category_backfilled_from_live_catalog` };
      }
    }
    return scope;
  }

  if (scope.domain === 'stay') {
    if (scope.status === 'ambiguous' && scope.pendingFocusName) {
      const matches = [...map.keys()]
        .map(key => key.match(/^stay:([^:]+):name$/)?.[1])
        .filter((value): value is string => Boolean(value))
        .filter(code => map.get(`stay:${code}:name`) === scope.pendingFocusName);
      if (matches.length !== 1) {
        return { ...scope, status: matches.length > 1 ? 'ambiguous' : 'unresolved', canonicalEntityIds: [], canonicalParentIds: [], provenance: matches.length > 1 ? 'named_stay_not_unique_in_live_catalog' : 'named_stay_not_found_in_live_catalog' };
      }
      const code = matches[0]!;
      const bedrooms = map.get(`stay:${code}:bedrooms`);
      const roomType = map.get(`stay:${code}:roomType`);
      const parent = typeof bedrooms === 'number' ? `bedrooms:${bedrooms}`
        : typeof roomType === 'string' && roomType ? `room_type:${roomType}` : null;
      return {
        ...scope,
        status: 'resolved',
        canonicalEntityIds: [`stay:${code}`],
        canonicalParentIds: parent ? [parent] : [],
        provenance: 'named_stay_resolved_against_live_catalog',
      };
    }
    if (scope.status === 'resolved' && scope.canonicalEntityIds.length && !scope.canonicalParentIds.length) {
      const parents = scope.canonicalEntityIds.flatMap(entityId => {
        const bedrooms = map.get(`${entityId}:bedrooms`);
        const roomType = map.get(`${entityId}:roomType`);
        if (typeof bedrooms === 'number') return [`bedrooms:${bedrooms}`];
        if (typeof roomType === 'string' && roomType) return [`room_type:${roomType}`];
        return [];
      });
      if (parents.length) return { ...scope, canonicalParentIds: [...new Set(parents)], provenance: `${scope.provenance}+stay_parent_backfilled_from_live_catalog` };
    }
    return scope;
  }

  if (scope.status === 'ambiguous' && scope.pendingFocusName) {
    const matchingCode = [...map.keys()]
      .map(key => key.match(/^activity_asset:([^:]+):name$/)?.[1])
      .filter((value): value is string => Boolean(value))
      .find(code => map.get(`activity_asset:${code}:name`) === scope.pendingFocusName);
    if (!matchingCode) {
      return { ...scope, status: 'unresolved', canonicalEntityIds: [], canonicalParentIds: [], provenance: 'named_entity_not_found_in_live_catalog' };
    }
    const entityId = `${ACTIVITY_ASSET_KIND}:${matchingCode}`;
    const parentCode = map.get(`${entityId}:activityCode`);
    return {
      ...scope,
      status: 'resolved',
      canonicalEntityIds: [entityId],
      canonicalParentIds: typeof parentCode === 'string' ? [parentCode] : [],
      provenance: 'named_entity_resolved_against_live_catalog',
    };
  }

  // Already resolved to a specific canonical entity id (e.g. a reference
  // the semantic layer itself resolved), but its canonical PARENT is still
  // unknown -- that relationship only exists in the live catalog, never in
  // the turn itself. Backfill it the same way, so the parent's own facts
  // (activity:<code>:resourceCode, :name, ...) aren't wrongly firewalled
  // out alongside the specific asset's facts.
  if (scope.status === 'resolved' && scope.canonicalEntityIds.length && !scope.canonicalParentIds.length) {
    const parentCodes = scope.canonicalEntityIds
      .map(entityId => map.get(`${entityId}:activityCode`))
      .filter((value): value is string => typeof value === 'string');
    if (parentCodes.length) return { ...scope, canonicalParentIds: [...new Set(parentCodes)], provenance: `${scope.provenance}+parent_backfilled_from_live_catalog` };
  }

  return scope;
}

/** The response scope firewall (C5). Filters facts to only those inside
 *  the resolved canonical scope. Structural invariants:
 *  - domain_wide: no filtering (the whole catalog is exactly what was
 *    asked for).
 *  - focused + resolved: keep only facts belonging to an allowed parent or
 *    entity id -- this is what replaces PR #185's ACTIVITY_TYPE_MARKERS
 *    regex.
 *  - focused + NOT resolved (ambiguous/unresolved): return NO facts. This
 *    is the fail-closed invariant C4 requires -- a focused request whose
 *    focus never canonicalized must never silently widen to the whole
 *    catalog.
 *  - unknown breadth: no filtering -- callers only reach here when a
 *    knowledge request was already issued despite an unclear focus (rare;
 *    _dialog-manager.ts's own recommendation-criteria gates usually avoid
 *    this), and this contract does not yet have an opinion for that case
 *    beyond preserving today's behavior. */
export function filterFactsByCanonicalScope(
  facts: readonly ScopableFact[],
  scope: CanonicalKnowledgeScope,
): readonly ScopableFact[] {
  if (scope.domain !== 'activity' && scope.domain !== 'stay' && scope.domain !== 'restaurant') return facts;
  if (scope.breadth === 'domain_wide' || scope.breadth === 'unknown') return facts;
  // breadth === 'focused'
  if (scope.status !== 'resolved') return [];
  const allowedParents = new Set(scope.canonicalParentIds);
  const allowedEntities = new Set(scope.canonicalEntityIds);
  if (!allowedParents.size && !allowedEntities.size) return facts;
  const map = factMapFrom(facts);
  if (scope.domain === 'restaurant') {
    return facts.filter(fact => {
      const menuMatch = fact.key.match(/^menu:([^:]+):/);
      if (menuMatch) {
        const id = menuMatch[1]!;
        if (allowedEntities.has(`menu:${id}`)) return true;
        const category = map.get(`menu:${id}:category`);
        return typeof category === 'string' && allowedParents.has(`${MENU_CATEGORY_KIND}:${category}`);
      }
      const categoryMatch = fact.key.match(/^menu_category:([^:]+):/);
      if (categoryMatch) return allowedParents.has(`${MENU_CATEGORY_KIND}:${categoryMatch[1]!}`);
      return true;
    });
  }
  if (scope.domain === 'stay') {
    return facts.filter(fact => {
      // Organization-wide policy remains valid inside every RESOLVED stay
      // scope, but focused unresolved scopes returned above are already [].
      if (/^stay:policy:/.test(fact.key)) return true;
      const stayMatch = fact.key.match(/^stay:([^:]+):/);
      if (stayMatch) {
        const code = stayMatch[1]!;
        if (allowedEntities.has(`stay:${code}`)) return true;
        const bedrooms = map.get(`stay:${code}:bedrooms`);
        const roomType = map.get(`stay:${code}:roomType`);
        return (typeof bedrooms === 'number' && allowedParents.has(`bedrooms:${bedrooms}`))
          || (typeof roomType === 'string' && allowedParents.has(`room_type:${roomType}`));
      }
      const typeMatch = fact.key.match(/^stay_type:([^:]+):/);
      if (typeMatch) {
        const typeCode = typeMatch[1]!;
        const bedroomMatch = typeCode.match(/^bedrooms-(\d+)$/u);
        const parent = bedroomMatch ? `bedrooms:${bedroomMatch[1]}` : `room_type:${typeCode}`;
        return allowedParents.has(parent);
      }
      const availabilityMatch = fact.key.match(/^availability:([^:]+):/);
      if (availabilityMatch) {
        const code = availabilityMatch[1]!;
        if (allowedEntities.has(`stay:${code}`)) return true;
        const bedrooms = map.get(`stay:${code}:bedrooms`);
        const roomType = map.get(`stay:${code}:roomType`);
        return (typeof bedrooms === 'number' && allowedParents.has(`bedrooms:${bedrooms}`))
          || (typeof roomType === 'string' && allowedParents.has(`room_type:${roomType}`));
      }
      return true;
    });
  }
  return facts.filter(fact => {
    const assetMatch = fact.key.match(/^activity_asset:([^:]+):/);
    if (assetMatch) {
      const code = assetMatch[1]!;
      if (allowedEntities.has(`${ACTIVITY_ASSET_KIND}:${code}`)) return true;
      const parent = map.get(`${ACTIVITY_ASSET_KIND}:${code}:activityCode`);
      return typeof parent === 'string' && allowedParents.has(parent);
    }
    const activityMatch = fact.key.match(/^activity:([^:]+):/);
    if (activityMatch) return allowedParents.has(activityMatch[1]!);
    return true;
  });
}
