// Human Core final certification: a minimal, auditable, read-only smoke
// test against the REAL deployed production customer endpoint (not a
// local build, not a deploy preview). Runs from a GitHub Actions runner
// because this repository's own sandbox/dev environments may have no
// direct network path to production.
//
// Safety contract (do not weaken):
// - Every message is read-only/discovery/status/correction -- never an
//   explicit commit marker ("จองเลย"/"ยืนยันจอง"/etc). No real booking,
//   order, payment, or redemption is ever created by this script.
// - Each conversation uses a synthetic UUID accepted by the real customer
//   memory layer. The fixed c1c1c1c1 / 4c1c / 8c1c marker pattern makes CI
//   guests recognizable in production while still satisfying UUID_RE. This
//   matters: arbitrary strings such as "ci-smoke-..." are intentionally
//   rejected by loadCustomerMemory and therefore CANNOT certify multi-turn
//   persisted context.
// - Every request + the safe (non-secret) parts of the response are
//   logged to stdout for audit. No secret/token is ever read or printed.
// - The workflow calling this script fails (non-zero exit) on the first
//   assertion failure.
//
// Final conversation-perfection pass: HTTP 200 + "a message came back" is
// not conversational correctness. Every case now also carries semantic
// assertions -- required meaning markers, forbidden wrong-domain/fallback
// markers, and a transaction expectation -- so a fluent but semantically
// wrong reply fails the smoke, not just a broken one. See
// tests/final-perfection-pass-conversational-fixes.test.ts for the offline,
// root-caused regression tests behind restaurant-01, activity-03-
// conditional, and promotion-02-followup below.
const PRODUCTION_URL = process.env.THONGTHAI_PRODUCTION_URL ?? 'https://tamma-chat.netlify.app/.netlify/functions/thongthai-chat';

// A customer-visible claim of a COMPLETED transaction. None of this
// script's messages authorize a transaction, so none of these markers may
// ever appear in a response -- if one does, something claimed success
// without the operational tool result to back it (the exact failure mode
// Human Core's transaction-safety contract exists to prevent).
const FALSE_TRANSACTION_MARKERS = [
  'จองสำเร็จ', 'จองให้เรียบร้อย', 'ยืนยันการจองแล้ว', 'สั่งซื้อสำเร็จ',
  'ชำระเงินสำเร็จ', 'ใช้สิทธิ์โปรโมชั่นแล้ว', 'ยกเลิกให้เรียบร้อย', 'เลขที่จอง',
];

// Perfection rule #5: for every covered, understandable customer intent
// below, these generic system/LLM-outage apologies must never appear
// unless the turn is genuinely unrecoverable -- and none of the cases here
// are. A real, non-transient provider outage would legitimately produce
// one of these; that is an acceptable, honest degradation this smoke does
// NOT try to distinguish from a real regression, so a hit here should be
// investigated, not reflexively re-run as a flake.
const GENERIC_FALLBACK_MARKERS = [
  'คิดช้ากว่าปกติ', 'ตอบช้ากว่าปกติ', 'ระบบตอบช้า',
];

type SmokeCase = {
  id: string;
  domain: string;
  message: string;
  chatHistory?: { role: 'user' | 'assistant'; content: string }[];
  /** Reuse an EARLIER case's real guestId/conversation instead of a fresh
   *  one. Required whenever the assertion depends on real persisted task
   *  state (not just plausible-looking prose) -- fabricated chatHistory
   *  text alone never creates a real activeTask row for a synthetic guest
   *  that never actually processed the earlier turn. */
  chainFrom?: string;
  /** Every pattern must match the reply -- the real meaning was understood. */
  requiredMarkers?: RegExp[];
  /** No pattern may match -- catches a fluent but semantically wrong reply
   *  (wrong domain, a guessed fact, a lost referent). */
  forbiddenMarkers?: RegExp[];
};

const CASES: SmokeCase[] = [
  { id: 'general-01', domain: 'general', message: 'วันนี้อยากมาเที่ยวแบบชิล ๆ มีอะไรแนะนำบ้าง' },
  {
    id: 'activity-01', domain: 'activity',
    message: 'อยากขี่ม้าพรุ่งนี้ช่วงเย็น แต่ไม่เอาทองไทยนะ เอาตัวที่นิสัยนิ่งกว่า',
    requiredMarkers: [/ภาราดร/u],
  },
  {
    id: 'activity-02-reference', domain: 'activity',
    message: 'ตัวไหนนะที่เมื่อกี้บอกว่านิ่งกว่า เอาตัวนั้นแหละ',
    chatHistory: [
      { role: 'user', content: 'อยากขี่ม้าพรุ่งนี้ช่วงเย็น แต่ไม่เอาทองไทยนะ เอาตัวที่นิสัยนิ่งกว่า' },
      { role: 'assistant', content: 'ถ้าเอาตามเงื่อนไขที่บอก ตอนนี้ ภาราดร ตรงกว่าครับ ข้อมูลระบุว่านิสัยนิ่งกว่า' },
    ],
    requiredMarkers: [/ภาราดร/u],
  },
  {
    id: 'activity-03-conditional', domain: 'activity',
    message: 'ถ้าตัวนั้นไม่ว่าง เอาอีกตัวแทนได้ แต่ถ้าทั้งคู่ไม่ว่างไม่ต้องจองอะไร',
    // Was previously a genuine cold start with no antecedent at all for
    // "ตัวนั้น"/"อีกตัว". Chains onto activity-01's REAL guestId/conversation
    // (not fabricated chatHistory text) -- the fix this case certifies reads
    // the real persisted task's assetSelection slot when the model is
    // unavailable, which only exists if activity-01's turn was actually
    // processed against this same guest, not merely quoted as prior prose.
    // Real production incident traced in THONGTHAI_HANDOFF.md's
    // final-perfection-pass entry.
    chainFrom: 'activity-01',
    requiredMarkers: [/ภาราดร/u, /ยังไม่ได้ทำรายการ|ยังไม่ได้จอง/u],
    forbiddenMarkers: [...GENERIC_FALLBACK_MARKERS.map(text => new RegExp(text, 'u'))],
  },
  { id: 'stay-01', domain: 'stay', message: 'พรุ่งนี้มีห้องสำหรับ 3 คนไหม' },
  {
    id: 'stay-02-followup', domain: 'stay', message: 'ถ้ามี เอาแบบสองห้องนอน',
    chatHistory: [
      { role: 'user', content: 'พรุ่งนี้มีห้องสำหรับ 3 คนไหม' },
      { role: 'assistant', content: 'ทองไทยเช็กช่วงที่ขอแล้ว ตอนนี้ยังไม่พบที่พักว่างครับ และยังไม่ได้จอง' },
    ],
  },
  {
    id: 'restaurant-01', domain: 'restaurant', message: 'พรุ่งนี้หกโมงโต๊ะเต็มยัง',
    requiredMarkers: [/โต๊ะ/u],
    forbiddenMarkers: [
      ...GENERIC_FALLBACK_MARKERS.map(text => new RegExp(text, 'u')),
      /เต็มครับ|ว่างครับ|มีโต๊ะว่าง/u,
    ],
  },
  {
    id: 'restaurant-02-constraint', domain: 'restaurant',
    message: 'ถ้ามากัน 4 คน มีเด็ก 1 คน แล้วมีคนแพ้กุ้ง ควรกินอะไรดี',
    // The real answer states the exclusion as a short summary line
    // ("ไม่มีกุ้ง / เลี่ยงกุ้ง") BEFORE the menu list, so "กุ้ง" legitimately
    // appears earlier in the string than the word that excludes it -- a
    // lookahead requiring the exclusion word to follow every "กุ้ง"
    // occurrence is backwards and false-positives on this exact correct
    // reply. The real, narrower safety property (no shrimp DISH actually
    // recommended) already has its own dedicated offline coverage; this
    // smoke case only needs to confirm the reply engages with the allergy
    // constraint at all, not re-derive that property via regex.
    requiredMarkers: [/กุ้ง/u],
  },
  { id: 'promotion-01', domain: 'promotion', message: 'ตอนนี้มีโปรอะไรใช้ได้บ้าง' },
  {
    id: 'promotion-02-followup', domain: 'promotion', message: 'อันเมื่อกี้ใช้กับกิจกรรมได้ไหม',
    // This is a REAL continuation: reuse promotion-01's persisted guest state.
    // Fabricated chatHistory does not prove server-side context continuity.
    chainFrom: 'promotion-01',
    requiredMarkers: [/โปร/u],
    // The real, reported defect: this exact follow-up used to reset to the
    // broad ecosystem catalog or collapse to a generic provider apology.
    forbiddenMarkers: [
      /🍽️ กิน|🌿 กิจกรรม|🏡 พัก|☕ แวะพัก/u,
      ...GENERIC_FALLBACK_MARKERS.map(text => new RegExp(text, 'u')),
    ],
  },
  { id: 'cafe-01', domain: 'cafe', message: 'คาเฟ่ที่นี่เปิดกี่โมงถึงกี่โมง' },
  { id: 'correction-01', domain: 'activity', message: 'ไม่ใช่ เมื่อกี้หมายถึงภาราดร' },
  { id: 'unknown-source-01', domain: 'stay', message: 'คืนนี้ห้องแบบวิวทะเลว่างกี่ห้อง' },
  {
    id: 'transaction-boundary-01', domain: 'activity',
    message: 'ม้าที่ว่างพรุ่งนี้เย็นมีตัวไหนบ้าง เดี๋ยวขอดูก่อนว่าจะเอาไหม',
  },
  // Kernel V2 Phase 3 increment 1 (semantic concept memory, PR #218):
  // this script has no Supabase access (by design -- it only ever talks to
  // the public customer HTTP endpoint, never a service-role key), so it
  // cannot itself assert a row was written or rejected. What it CAN and
  // does assert against the real deployed endpoint: a short standalone
  // companion statement is handled coherently (no crash, no false
  // transaction claim) whether or not it happens to be a fresh concept-
  // memory MISS or a HIT, and a companion statement carrying a personal
  // name is handled exactly the same way from the customer's point of
  // view -- the privacy boundary lives entirely in the write path
  // (recordSemanticConceptEvidence silently declines to persist it), never
  // in the customer-facing response. See
  // tests/kernel-v2-phase3-semantic-concept-memory.test.ts for the
  // Supabase-backed assertions this script cannot make (MISS->write,
  // exact-replay zero-call, privacy rejection).
  {
    id: 'phase3-companion-01', domain: 'activity',
    message: 'มากับภรรยาครับ ไม่อยากทำอะไรเหนื่อยมาก',
    chainFrom: 'activity-01',
  },
  {
    id: 'phase3-companion-privacy-01', domain: 'activity',
    message: 'มากับแฟนชื่อหนิงครับ',
    chainFrom: 'activity-01',
  },
];

type CaseResult = {
  id: string;
  domain: string;
  httpStatus: number;
  hasMessage: boolean;
  falseTransactionMarker: string | null;
  missingRequiredMarker: string | null;
  hitForbiddenMarker: string | null;
  pass: boolean;
  error?: string;
};

async function runCase(runId: string, index: number, testCase: SmokeCase, guestId: string): Promise<CaseResult> {
  try {
    const res = await fetch(PRODUCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: testCase.message,
        guestId,
        language: 'th',
        chatHistory: testCase.chatHistory ?? [],
      }),
    });
    const body = await res.json().catch(() => null) as { message?: unknown } | null;
    const messageText = typeof body?.message === 'string' ? body.message : '';
    const falseTransactionMarker = FALSE_TRANSACTION_MARKERS.find(marker => messageText.includes(marker)) ?? null;
    const missingRequired = (testCase.requiredMarkers ?? []).find(pattern => !pattern.test(messageText));
    const hitForbidden = (testCase.forbiddenMarkers ?? []).find(pattern => pattern.test(messageText));
    const hasMessage = messageText.trim().length > 0;
    const pass = res.status === 200 && hasMessage && !falseTransactionMarker && !missingRequired && !hitForbidden;
    console.log(JSON.stringify({
      id: testCase.id, domain: testCase.domain, guestId,
      request: testCase.message, httpStatus: res.status,
      response: messageText.slice(0, 300),
      falseTransactionMarker,
      missingRequiredMarker: missingRequired?.source ?? null,
      hitForbiddenMarker: hitForbidden?.source ?? null,
      pass,
    }));
    return {
      id: testCase.id, domain: testCase.domain, httpStatus: res.status, hasMessage, falseTransactionMarker,
      missingRequiredMarker: missingRequired?.source ?? null,
      hitForbiddenMarker: hitForbidden?.source ?? null,
      pass,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.log(JSON.stringify({ id: testCase.id, domain: testCase.domain, guestId, error: message, pass: false }));
    return {
      id: testCase.id, domain: testCase.domain, httpStatus: 0, hasMessage: false, falseTransactionMarker: null,
      missingRequiredMarker: null, hitForbiddenMarker: null, pass: false, error: message,
    };
  }
}

function ciGuestUuid(runId: string, index: number): string {
  // UUID v4-shaped and variant-correct so _customer-db.ts accepts it.
  // "c1c1c1c1" / "4c1c" / "8c1c" are deliberate CI markers, while the
  // final 12 hex chars retain the run timestamp for uniqueness/auditability.
  const runHex = BigInt(runId).toString(16).slice(-12).padStart(12, '0');
  const indexHex = index.toString(16).padStart(4, '0').slice(-4);
  return `c1c1c1c1-${indexHex}-4c1c-8c1c-${runHex}`;
}

async function main() {
  const runId = `${Date.now()}`;
  const results: CaseResult[] = [];
  const guestIdByCaseId = new Map<string, string>();
  for (let i = 0; i < CASES.length; i += 1) {
    const testCase = CASES[i]!;
    const guestId = testCase.chainFrom
      ? guestIdByCaseId.get(testCase.chainFrom) ?? ciGuestUuid(runId, i)
      : ciGuestUuid(runId, i);
    guestIdByCaseId.set(testCase.id, guestId);
    // Sequential, not parallel: this hits the real production endpoint and
    // must behave like one careful human tester, not a burst load test.
    // eslint-disable-next-line no-await-in-loop
    results.push(await runCase(runId, i, testCase, guestId));
  }
  const failed = results.filter(result => !result.pass);
  const summary = {
    kind: 'PRODUCTION_SMOKE_ACCEPTANCE',
    productionUrl: PRODUCTION_URL,
    total: results.length,
    pass: results.length - failed.length,
    failed: failed.length,
    falseTransactionsDetected: results.filter(result => result.falseTransactionMarker).length,
    failures: failed.map(result => ({
      id: result.id, domain: result.domain, httpStatus: result.httpStatus,
      missingRequiredMarker: result.missingRequiredMarker, hitForbiddenMarker: result.hitForbiddenMarker,
      error: result.error ?? null,
    })),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (failed.length > 0) {
    console.error(`PRODUCTION_SMOKE_FAILED: ${failed.length}/${results.length} cases failed`);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('PRODUCTION_SMOKE_CRASHED', error instanceof Error ? error.message : error);
  process.exit(1);
});
