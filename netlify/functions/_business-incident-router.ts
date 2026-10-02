// Phase 5 — Business + Incident Router.
//
// This is the single routing contract between semantic understanding and
// operational ownership. It does NOT answer the customer, execute a
// transaction, or invent business truth. Its job is only to decide whether
// the current turn belongs to a normal business lane or an operational
// incident/customer-voice lane, and which real team owns that lane.
//
// Ordering is intentional:
// 1) deterministic authority guardrails;
// 2) deterministic service-feedback/incident matches;
// 3) structured semantic INCIDENT meaning;
// 4) ordinary structured business domain;
// 5) general.
//
// Phase 4's commercial boundary remains authoritative for transaction consent.
// An INCIDENT route can therefore never be used as transaction authorization.
import {
  classifyEscalationBoundary,
  type EscalationMatch,
} from './_boundary-classifier';
import {
  classifyServiceFeedback,
  type BusinessUnit,
  type IssueKeyword,
  type ServiceFeedbackMatch,
} from './_service-mind-feedback-intent';
import type { SemanticDomain, SemanticSpeechAct } from './_semantic-interpreter';
import type { SemanticMeaning } from './_semantic-meaning';

export type BusinessIncidentLane = 'BUSINESS' | 'INCIDENT' | 'CUSTOMER_VOICE' | 'GENERAL';

export type BusinessIncidentRoute =
  | {
      kind: 'authority_boundary';
      lane: 'INCIDENT';
      source: 'deterministic_guardrail';
      businessUnit: BusinessUnit;
      escalation: EscalationMatch;
      feedback: null;
    }
  | {
      kind: 'service_feedback';
      lane: 'INCIDENT' | 'CUSTOMER_VOICE';
      source: 'deterministic_feedback';
      businessUnit: BusinessUnit;
      escalation: null;
      feedback: ServiceFeedbackMatch;
    }
  | {
      kind: 'semantic_incident';
      lane: 'INCIDENT';
      source: 'semantic_meaning';
      businessUnit: BusinessUnit;
      semanticDomain: SemanticDomain;
      speechAct: SemanticSpeechAct;
    }
  | {
      kind: 'business';
      lane: 'BUSINESS';
      source: 'semantic_meaning';
      businessUnit: BusinessUnit;
      semanticDomain: SemanticDomain;
      speechAct: SemanticSpeechAct;
    }
  | {
      kind: 'general';
      lane: 'GENERAL';
      source: 'semantic_meaning';
      businessUnit: 'general';
      semanticDomain: SemanticDomain;
      speechAct: SemanticSpeechAct;
    };

const BUSINESS_DOMAINS: Readonly<Partial<Record<SemanticDomain, BusinessUnit>>> = {
  restaurant: 'restaurant',
  activity: 'activity',
  stay: 'stay',
  cafe: 'cafe',
  otop: 'otop',
  membership: 'membership',
  promotion: 'membership',
  payment: 'membership',
};

const VALID_EXPLICIT_UNITS: ReadonlySet<BusinessUnit> = new Set([
  'restaurant', 'activity', 'stay', 'cafe', 'otop', 'membership',
  'system', 'general', 'unknown',
]);

function explicitUnitFromEntities(meaning: SemanticMeaning): BusinessUnit | null {
  const raw = meaning.entities.businessUnit ?? meaning.entities.business_unit;
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase() as BusinessUnit;
  return VALID_EXPLICIT_UNITS.has(normalized) ? normalized : null;
}

/** Resolve the operational owner from CLOSED semantic structure only.
 *  Never inspect normalizedMeaning/free-form paraphrases. */
export function businessUnitForSemanticMeaning(meaning: SemanticMeaning): BusinessUnit {
  const direct = BUSINESS_DOMAINS[meaning.domain];
  if (direct) return direct;

  // An INCIDENT domain can still carry a validated, explicit business-unit
  // entity from the semantic schema. Accept only the closed enum above.
  const explicit = explicitUnitFromEntities(meaning);
  if (explicit && explicit !== 'unknown') return explicit;

  // Structural entity evidence can recover the owning business when the
  // supervisor intentionally chose domain='incident'.
  if (typeof meaning.entities.activityCode === 'string'
      || typeof meaning.entities.horseName === 'string') return 'activity';
  if (typeof meaning.entities.menuItemId === 'string'
      || typeof meaning.entities.menuCategory === 'string') return 'restaurant';
  const resourceCode = typeof meaning.entities.resourceCode === 'string'
    ? meaning.entities.resourceCode.toLowerCase() : '';
  if (resourceCode.startsWith('stay') || resourceCode.includes('hueun')) return 'stay';
  if (typeof meaning.entities.otopProductId === 'string'
      || typeof meaning.entities.productId === 'string') return 'otop';

  return meaning.domain === 'support' ? 'system' : 'general';
}

function feedbackIsOperationalIncident(match: ServiceFeedbackMatch): boolean {
  return match.feedbackType === 'complaint'
    || match.feedbackType === 'safety_issue'
    || match.feedbackType === 'incident'
    || match.feedbackType === 'system_feedback';
}

/** Pre-model router. It preserves the existing safety rule that authority
 *  boundaries and customer incidents are deterministic and must win before
 *  any LLM/business/transaction path. */
export function classifyRawBusinessIncidentRoute(message: string): BusinessIncidentRoute | null {
  const escalation = classifyEscalationBoundary(message);
  if (escalation) {
    return {
      kind: 'authority_boundary',
      lane: 'INCIDENT',
      source: 'deterministic_guardrail',
      businessUnit: escalation.domainUnit ?? 'general',
      escalation,
      feedback: null,
    };
  }

  const feedback = classifyServiceFeedback(message);
  if (!feedback) return null;
  return {
    kind: 'service_feedback',
    lane: feedbackIsOperationalIncident(feedback) ? 'INCIDENT' : 'CUSTOMER_VOICE',
    source: 'deterministic_feedback',
    businessUnit: feedback.businessUnit,
    escalation: null,
    feedback,
  };
}

function isSemanticIncident(meaning: SemanticMeaning): boolean {
  return meaning.domain === 'incident'
    || meaning.speechAct === 'incident_report'
    || meaning.speechAct === 'complaint'
    || meaning.speechAct === 'request_help';
}

/** Post-understanding router. INCIDENT precedence is deliberate: even if a
 *  model also classified the action as book/order, an incident/help/complaint
 *  speech act must be handled operationally and cannot fall into a commercial
 *  executor. */
export function classifySemanticBusinessIncidentRoute(meaning: SemanticMeaning): BusinessIncidentRoute {
  if (isSemanticIncident(meaning)) {
    return {
      kind: 'semantic_incident',
      lane: 'INCIDENT',
      source: 'semantic_meaning',
      businessUnit: businessUnitForSemanticMeaning(meaning),
      semanticDomain: meaning.domain,
      speechAct: meaning.speechAct,
    };
  }

  const businessUnit = BUSINESS_DOMAINS[meaning.domain];
  if (businessUnit) {
    return {
      kind: 'business',
      lane: 'BUSINESS',
      source: 'semantic_meaning',
      businessUnit,
      semanticDomain: meaning.domain,
      speechAct: meaning.speechAct,
    };
  }

  return {
    kind: 'general',
    lane: 'GENERAL',
    source: 'semantic_meaning',
    businessUnit: 'general',
    semanticDomain: meaning.domain,
    speechAct: meaning.speechAct,
  };
}

const INFORMATION_NEED_ISSUE: Readonly<Partial<Record<SemanticMeaning['informationNeed'], IssueKeyword>>> = {
  safety: 'safety',
  price: 'pricing',
  availability: 'booking',
  transaction_status: 'booking',
  equipment: 'activity_condition',
};

/** Build the minimum honest durable case from structured semantics when the
 *  raw language classifier did not recognize the wording. No person/name/
 *  asset is guessed from free text; those arrays intentionally remain empty.
 *  The original customer message is still stored (redacted) by
 *  createFeedbackEvent for human triage. */
export function semanticIncidentFeedbackMatch(meaning: SemanticMeaning): ServiceFeedbackMatch {
  const safety = meaning.informationNeed === 'safety';
  const feedbackType: ServiceFeedbackMatch['feedbackType'] = safety
    ? 'safety_issue'
    : meaning.speechAct === 'complaint'
      ? 'complaint'
      : 'incident';
  const issue = INFORMATION_NEED_ISSUE[meaning.informationNeed];

  return {
    feedbackType,
    businessUnit: businessUnitForSemanticMeaning(meaning),
    severity: feedbackType === 'complaint' ? 'normal' : 'high',
    staffName: null,
    personMentions: [],
    businessUnitMentions: [],
    sentimentKeywords: [],
    issueKeywords: issue ? [issue] : [],
    namedAssets: [],
    keywordSummary: { topPositive: [], topNegative: [] },
  };
}
