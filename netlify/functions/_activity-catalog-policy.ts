// Authoritative activity resourceCode/duration resolution -- reuses the SAME
// catalog facts the Knowledge Resolver already produces
// (_dialog-source-adapters.ts's activityCatalogAdapter, sourced from
// activity_offerings/activity_assets via _activity-sot.ts). Never hardcodes
// a resourceCode or duration per activity/asset ("ภาราดร = 30 min" etc.) --
// if the authoritative source hasn't verified something, these functions say
// so honestly (return null / 'unknown') rather than guess.
//
// Two real facts from the data model this resolves around (see
// _operations-db.ts's activityResourceFromText/service_resources and
// _activity-sot.ts's loadActivityWorldFacts):
// - service_resources (what create_booking/listBookingOptions key off) has
//   ONE row per ACTIVITY TYPE ("activity-horse"), not per named asset.
// - activity_assets (individual named horses etc.) is a separate, purely
//   informational listing. A customer selecting "ภาราดร" must resolve to
//   the activity's real resourceCode, never the asset's own id.
import type { KnowledgeBundle } from './_knowledge-resolver';

function factValue(bundles: readonly KnowledgeBundle[], key: string): unknown {
  for (const bundle of bundles) {
    for (const fact of bundle.facts) {
      if (fact.key === key) return fact.value;
    }
  }
  return undefined;
}

/** Resolves a customer's selection (a specific named asset id like
 *  "activity_asset:horse-01", or an activityCode directly) to the real,
 *  bookable resourceCode. Returns null -- never a guess -- when the
 *  authoritative link isn't (yet) known from the supplied bundles. */
export function resolveActivityResourceCode(
  bundles: readonly KnowledgeBundle[],
  selection: string,
): string | null {
  const activityCode = selection.startsWith('activity_asset:')
    ? factValue(bundles, `${selection}:activityCode`)
    : selection;
  if (typeof activityCode !== 'string' || !activityCode) return null;
  const resourceCode = factValue(bundles, `activity:${activityCode}:resourceCode`);
  return typeof resourceCode === 'string' && resourceCode ? resourceCode : null;
}

export type ActivityDurationPolicyResult =
  | { status: 'single'; durationMinutes: number }
  | { status: 'multiple'; options: number[] }
  | { status: 'unknown' };

const RESOURCE_CODE_FACT = /^activity:([^:]+):resourceCode$/;
const DURATION_PRICE_FACT = /^activity:([^:]+):(\d+)min:price$/;

/** Valid duration options for the activity behind an already-resolved
 *  resourceCode -- read directly off the authoritative activity_offerings
 *  price facts. A single verified duration auto-populates; more than one
 *  means the customer must be asked which; none verified means honestly
 *  saying so, never guessing a default. */
export function resolveActivityDurationOptions(
  bundles: readonly KnowledgeBundle[],
  resourceCode: string,
): ActivityDurationPolicyResult {
  let activityCode: string | null = null;
  outer: for (const bundle of bundles) {
    for (const fact of bundle.facts) {
      const match = fact.key.match(RESOURCE_CODE_FACT);
      if (match && fact.value === resourceCode) { activityCode = match[1]!; break outer; }
    }
  }
  if (!activityCode) return { status: 'unknown' };

  const options = new Set<number>();
  for (const bundle of bundles) {
    for (const fact of bundle.facts) {
      const match = fact.key.match(DURATION_PRICE_FACT);
      if (match && match[1] === activityCode) options.add(Number(match[2]));
    }
  }
  const sorted = [...options].sort((a, b) => a - b);
  if (sorted.length === 1) return { status: 'single', durationMinutes: sorted[0]! };
  if (sorted.length > 1) return { status: 'multiple', options: sorted };
  return { status: 'unknown' };
}
