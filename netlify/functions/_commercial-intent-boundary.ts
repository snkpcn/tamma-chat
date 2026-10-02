import type { SemanticTurn } from './_semantic-interpreter';
import { deriveSemanticMeaning } from './_semantic-meaning';
import {
  hasCancelMarker,
  hasExplicitNoTransactionMarker,
  hasStandaloneTransactionRequest,
} from './_slot-parsers';

export type CommercialBoundaryMode =
  | 'READ_ONLY'
  | 'CONSIDER'
  | 'WITHHOLD'
  | 'COMMIT'
  | 'MANAGE'
  | 'INCIDENT';

export type CommercialBoundaryDecision = {
  mode: CommercialBoundaryMode;
  /** True only for a current-turn explicit commercial commitment. */
  currentTurnCommit: boolean;
  /** True only for transaction families that the production Agent can PREPARE
   * without executing. A COMMIT may still be false here (e.g. promotion
   * redemption) and must then continue to its existing executor boundary. */
  prepareEligible: boolean;
  /** Boundary-sensitive non-commit language should reach the semantic/dialog
   * contract before the 100% read-only Saved Agent, so planning/withholding/
   * resume/cancel cannot be flattened into ordinary chat. */
  routeToOneMindBeforePrimary: boolean;
  reason: string;
};

const TRANSACTION_QUESTION_RE =
  /[?？]|ไหม|ไหน|มั้ย|หรือเปล่า|รึเปล่า|ยังไง|อย่างไร|เมื่อไหร่|เมื่อไร|กี่โมง|เท่าไหร่|เท่าไร/u;

const COMMERCIAL_LANGUAGE_RE =
  /(?:จอง|สั่ง|ยืนยัน|สมัครสมาชิก|ใช้โปร|เอาโปร|รับโปร|เอาชุด|เอาเซ็ต|ทำรายการ|ส่งคำถาม|ส่งเรื่อง|ส่งคำขอ)/iu;

const RESUME_COMMERCIAL_RE =
  /(?:กลับ.*(?:จอง|สั่ง|รายการ)|(?:จอง|สั่ง|รายการ)(?:\s|เรื่อง)*ต่อ(?:$|\s|ครับ|ค่ะ|นะ))/u;

const PLANNING_SELECTION_RE =
  /(?:^|\s)(?:ยืนยัน)(?:$|\s|ครับ|ค่ะ|คะ|คับ)|เอา(?:ชุด|เซ็ต)นี้|เอาชุดเมื่อกี้|ชุดเมื่อกี้|เอาตามนี้|โอเค(?:ชุด|เซ็ต)นี้|ตกลง(?:ชุด|เซ็ต)นี้|จัด(?:ชุด|เซ็ต)นี้|ชุดนี้เลย/u;

const PROMOTION_COMMIT_RE =
  /(?:เอาโปรนี้|ใช้โปรนี้|รับโปรนี้|เอาสิทธิ์นี้)/u;

const CAFE_HANDOFF_DIRECTIVE_RE =
  /(?:ช่วย\s*)?(?:ส่ง|ฝาก)(?:เรื่อง|คำถาม|คำขอ).{0,80}(?:ทีม|ร้าน|คาเฟ่|อินทนิล|Inthanin)/iu;

function noTransactionConstraint(constraints: readonly string[]): boolean {
  return constraints.some(value =>
    /^(?:consider_only|not_yet_booking|no_transaction|not_booking)$/iu.test(value));
}

export function classifyCommercialBoundaryText(
  message: string,
  topLevelSemanticIntent = 'OTHER',
): CommercialBoundaryDecision {
  const text=String(message??'').trim();

  if (hasExplicitNoTransactionMarker(text)) {
    return {
      mode:'WITHHOLD',
      currentTurnCommit:false,
      prepareEligible:false,
      routeToOneMindBeforePrimary:true,
      reason:'explicit_no_transaction',
    };
  }

  if (hasCancelMarker(text)) {
    return {
      mode:'MANAGE',
      currentTurnCommit:false,
      prepareEligible:false,
      routeToOneMindBeforePrimary:true,
      reason:'cancel_or_abandon_working_state',
    };
  }

  // Cafe staff handoff is an explicit operational request in its own right.
  // It is special-cased before the generic question veto because polite Thai
  // often phrases a request as "...ได้ไหม". It still only authorizes PREPARE,
  // never same-turn commit.
  if (CAFE_HANDOFF_DIRECTIVE_RE.test(text)) {
    return {
      mode:'COMMIT',
      currentTurnCommit:true,
      prepareEligible:true,
      routeToOneMindBeforePrimary:false,
      reason:'explicit_cafe_staff_handoff',
    };
  }

  // A commercial WORD inside a genuine question is not current-turn consent:
  // "จองได้ไหม", "ยืนยันการจองต้องทำยังไง", "สั่งได้หรือเปล่า".
  // This check deliberately runs before hasStandaloneTransactionRequest,
  // whose legacy hasCommitMarker compatibility path historically treated
  // "ยืนยันจองไหม" as affirmative.
  if (COMMERCIAL_LANGUAGE_RE.test(text) && TRANSACTION_QUESTION_RE.test(text)) {
    return {
      mode:'READ_ONLY',
      currentTurnCommit:false,
      prepareEligible:false,
      routeToOneMindBeforePrimary:true,
      reason:'commercial_question_not_consent',
    };
  }

  if (hasStandaloneTransactionRequest(text)) {
    return {
      mode:'COMMIT',
      currentTurnCommit:true,
      prepareEligible:true,
      routeToOneMindBeforePrimary:false,
      reason:'explicit_booking_or_order_request',
    };
  }

  if (PROMOTION_COMMIT_RE.test(text)) {
    return {
      mode:'COMMIT',
      currentTurnCommit:true,
      prepareEligible:false,
      routeToOneMindBeforePrimary:false,
      reason:'explicit_promotion_redemption_request',
    };
  }

  if (RESUME_COMMERCIAL_RE.test(text)) {
    return {
      mode:'CONSIDER',
      currentTurnCommit:false,
      prepareEligible:false,
      routeToOneMindBeforePrimary:true,
      reason:'resume_existing_commercial_context',
    };
  }

  if (PLANNING_SELECTION_RE.test(text)) {
    return {
      mode:'CONSIDER',
      currentTurnCommit:false,
      prepareEligible:false,
      routeToOneMindBeforePrimary:true,
      reason:'selection_or_bare_confirmation_without_fresh_consent',
    };
  }

  // A top-level lexical business marker is never enough, by itself, to
  // authorize a transaction. Send it to semantic/dialog reasoning when the
  // stronger explicit-current-turn tests above did not establish COMMIT.
  if (topLevelSemanticIntent === 'BUSINESS_TRANSACTION') {
    return {
      mode:'CONSIDER',
      currentTurnCommit:false,
      prepareEligible:false,
      routeToOneMindBeforePrimary:true,
      reason:'business_topic_without_explicit_current_turn_commit',
    };
  }

  return {
    mode:'READ_ONLY',
    currentTurnCommit:false,
    prepareEligible:false,
    routeToOneMindBeforePrimary:false,
    reason:'no_commercial_commit_signal',
  };
}

export function classifyCommercialBoundarySemantic(
  turn: SemanticTurn,
): CommercialBoundaryDecision {
  const meaning=deriveSemanticMeaning(turn);

  if (meaning.conversationalMode === 'INCIDENT') {
    return {
      mode:'INCIDENT',
      currentTurnCommit:false,
      prepareEligible:false,
      routeToOneMindBeforePrimary:true,
      reason:'incident_or_help_boundary',
    };
  }

  if (turn.action === 'cancel' || meaning.userGoal === 'manage_existing') {
    return {
      mode:'MANAGE',
      currentTurnCommit:false,
      prepareEligible:false,
      routeToOneMindBeforePrimary:true,
      reason:'manage_existing_not_fresh_consent',
    };
  }

  // Defense in depth: an explicit no-transaction constraint always defeats
  // a contradictory model action label. The semantic parser should normally
  // reconcile this earlier; the commercial boundary refuses to depend on that.
  if (noTransactionConstraint(meaning.constraints)) {
    return {
      mode:'WITHHOLD',
      currentTurnCommit:false,
      prepareEligible:false,
      routeToOneMindBeforePrimary:true,
      reason:'semantic_no_transaction_constraint',
    };
  }

  if (
    meaning.conversationalMode === 'COMMIT'
    && meaning.commitmentLevel === 'explicit_transaction'
    && meaning.userGoal === 'commit'
  ) {
    return {
      mode:'COMMIT',
      currentTurnCommit:true,
      prepareEligible:['activity','stay','restaurant','otop','cafe'].includes(meaning.domain),
      routeToOneMindBeforePrimary:false,
      reason:'semantic_explicit_transaction',
    };
  }

  if (meaning.conversationalMode === 'CONSIDER') {
    return {
      mode:'CONSIDER',
      currentTurnCommit:false,
      prepareEligible:false,
      routeToOneMindBeforePrimary:true,
      reason:'semantic_planning_or_preference',
    };
  }

  return {
    mode:'READ_ONLY',
    currentTurnCommit:false,
    prepareEligible:false,
    routeToOneMindBeforePrimary:false,
    reason:'semantic_read_only',
  };
}

export function semanticMayAuthorizeCommercialCommit(turn: SemanticTurn): boolean {
  return classifyCommercialBoundarySemantic(turn).mode === 'COMMIT';
}
