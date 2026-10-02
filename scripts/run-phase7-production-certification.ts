// Phase 7 final connected production certification.
//
// This is one sequential, read-only conversation through the real production
// HTTP gateway. It deliberately includes memory, correction, topic switching,
// resume, grounded food safety, source-unavailable availability, and explicit
// no-transaction turns. It never authorizes booking/order/payment/inventory
// writes. Unlike the earlier Phase 6 smoke, it records all 16 turns before
// returning a final pass/fail so later-turn regressions cannot be hidden by an
// overly narrow earlier assertion.

import {
  PHASE7_MESSAGES,
  evaluatePhase7Turn,
  phase7ContractIsComplete,
} from './phase7-production-certification-contract';

const PRODUCTION_URL = process.env.THONGTHAI_PRODUCTION_URL?.trim()
  || 'https://tamma-chat.netlify.app/.netlify/functions/thongthai-chat';

type ChatMessage = { role: 'user' | 'assistant'; content: string };
type Payload = Record<string, unknown> & { message?: unknown; intent?: unknown };

function productionGuestId(): string {
  const suffix = BigInt(Date.now()).toString(16).slice(-12).padStart(12, '0');
  return `f7f7f7f7-0251-4f7f-8f7f-${suffix}`;
}

async function main(): Promise<void> {
  if (!phase7ContractIsComplete()) {
    throw new Error('Phase 7 message/rule contract is incomplete');
  }

  const guestId = productionGuestId();
  const history: ChatMessage[] = [];
  const results: Array<Record<string, unknown> & { pass: boolean }> = [];

  for (let index = 0; index < PHASE7_MESSAGES.length; index += 1) {
    const userMessage = PHASE7_MESSAGES[index]!;
    try {
      const response = await fetch(PRODUCTION_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          guestId,
          eventId: `phase7-production-${guestId}-${index + 1}`,
          message: userMessage,
          language: 'th',
          chatHistory: history,
          guestContext: {
            tripDuration: null, travelerType: null,
            group: { adults: null, children: null, elderly: null },
            interests: [], pace: null, budget: null, constraints: [],
          },
          journeyContext: {
            currentPlan: null, savedPlan: null,
            visitedExperiences: [], favorites: [], journalEntries: [],
          },
          pageContext: { section: 'line' },
        }),
      });
      const payload = await response.json().catch(() => ({})) as Payload;
      const message = typeof payload.message === 'string' ? payload.message : '';
      const intent = typeof payload.intent === 'string' ? payload.intent : null;
      const evaluation = evaluatePhase7Turn({
        turnIndex: index,
        httpStatus: response.status,
        message,
        intent,
      });
      const result = {
        turn: index + 1,
        guestId,
        request: userMessage,
        httpStatus: response.status,
        intent,
        response: message,
        ...evaluation,
      };
      results.push(result);
      console.log(JSON.stringify(result));
      history.push({ role: 'user', content: userMessage });
      history.push({ role: 'assistant', content: message });
    } catch (error) {
      const result = {
        turn: index + 1,
        guestId,
        request: userMessage,
        httpStatus: 0,
        intent: null,
        response: '',
        missing: [],
        forbidden: [],
        error: error instanceof Error ? error.message : String(error),
        pass: false,
      };
      results.push(result);
      console.log(JSON.stringify(result));
    }
  }

  const failed = results.filter(result => !result.pass);
  console.log(JSON.stringify({
    kind: 'PHASE7_FINAL_PRODUCTION_CERTIFICATION',
    productionUrl: PRODUCTION_URL,
    guestId,
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    falseTransactionsDetected: results.filter(result =>
      Array.isArray(result.forbidden)
      && result.forbidden.some(value => String(value).includes('จองเรียบร้อย'))
    ).length,
    failedTurns: failed.map(result => result.turn),
  }, null, 2));

  if (failed.length > 0) process.exit(1);
}

main().catch(error => {
  console.error('PHASE7_FINAL_PRODUCTION_CERTIFICATION_CRASHED', error instanceof Error ? error.message : error);
  process.exit(1);
});
