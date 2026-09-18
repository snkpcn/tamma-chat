// TEMPORARY Phase P diagnostic. GET only, no PII, no business content in the
// response -- only aggregate character counts of the legacy brain's system
// prompt for an empty/fresh guest, so we can see whether the recent UAT
// finding (near-universal LLMAvailabilityError on any turn that reaches
// runThongthaiBrain) is explained by prompt size. Remove this file once the
// investigation is complete; it must never be relied on by any real feature.
import type { Handler } from '@netlify/functions';
import { buildBrainPrompt, type BrainRequest } from './_thongthai-brain-v3';
import { loadVerifiedCommunityOfferings } from './_customer-db';
import { loadBrainRuntime } from './_thongthai-runtime-v3';

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

export const handler: Handler = async event => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const request: BrainRequest = {
    guestId: undefined,
    message: 'diagnostic',
    language: 'th',
    chatHistory: [],
    guestContext: { tripDuration:null, travelerType:null, group:{adults:null,children:null,elderly:null}, interests:[], pace:null, budget:null, constraints:[] },
    journeyContext: { currentPlan:null, savedPlan:null, visitedExperiences:[], favorites:[], journalEntries:[] },
    pageContext: { section: 'web' },
  };

  const [communityOfferings, runtime] = await Promise.all([
    loadVerifiedCommunityOfferings(),
    loadBrainRuntime(null, 'web'),
  ]);

  const prompt = buildBrainPrompt(request, communityOfferings, runtime);
  const byFact = runtime.worldFacts
    .map(fact => ({ key: fact.fact_key, chars: JSON.stringify(fact.fact_value).length }))
    .sort((a, b) => b.chars - a.chars);

  return json(200, {
    totalPromptChars: prompt.length,
    worldFactsCount: runtime.worldFacts.length,
    worldFactsTotalChars: JSON.stringify(runtime.worldFacts).length,
    communityOfferingsCount: communityOfferings.length,
    communityOfferingsChars: JSON.stringify(communityOfferings).length,
    largestFacts: byFact.slice(0, 8),
  });
};
