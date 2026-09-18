// TEMPORARY Phase P diagnostic. Reproduces the exact production failure
// (runThongthaiBrain's model call for a real non-discovery message, using
// REAL live world-fact/catalog data via an anonymous/no-guestId runtime so
// no customer data is ever touched) and returns ONLY a safe, structured
// per-attempt trail: provider, model, outcome class, HTTP status if any,
// and latency. It never returns the prompt, the model's raw output, any
// customer data, or any credential.
//
// POST only, and requires a secret bearer token set in this site's Netlify
// environment as THONGTHAI_PHASE_P_DIAGNOSTIC_TOKEN, sent as the
// `x-diagnostic-token` request header. With no token configured (or a
// mismatched one), every request is rejected -- this endpoint is inert by
// default until that env var is deliberately set.
//
// Remove this file once the Phase P provider-failure investigation
// concludes; it must never be relied on by any real feature, and no
// production write/transaction is ever created here.
import type { Handler } from '@netlify/functions';
import { buildBrainPrompt, type BrainRequest } from './_thongthai-brain-v3';
import { loadVerifiedCommunityOfferings } from './_customer-db';
import { loadBrainRuntime } from './_thongthai-runtime-v3';
import { callPreferredModel, LLMRequestError, ProviderNotConfiguredError, type ProviderAttemptDiagnostic } from './_thongthai-model-provider';

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

export const handler: Handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const expected = process.env.THONGTHAI_PHASE_P_DIAGNOSTIC_TOKEN;
  const provided = event.headers?.['x-diagnostic-token'] ?? event.headers?.['X-Diagnostic-Token'];
  if (!expected || !provided || provided !== expected) return json(401, { error: 'unauthorized' });

  // Same synthetic, non-discovery, no-guestId, no-PII test turn every time --
  // deliberately one of the exact phrases that fails 100% in production, so
  // this reproduces the real failure rather than a different code path.
  const request: BrainRequest = {
    guestId: undefined,
    message: 'ม้าล่ะ',
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

  const startedAt = Date.now();
  try {
    await callPreferredModel(prompt, [{ role: 'user', content: request.message }], 'phase-p-diagnostic');
    return json(200, { result: 'success', totalElapsedMs: Date.now() - startedAt, attempts: [] as ProviderAttemptDiagnostic[] });
  } catch (error) {
    const attempts = error instanceof LLMRequestError || error instanceof ProviderNotConfiguredError
      ? error.attempts
      : (error as { attempts?: ProviderAttemptDiagnostic[] } | null)?.attempts ?? [];
    return json(200, {
      result: 'failure',
      totalElapsedMs: Date.now() - startedAt,
      errorClass: error instanceof Error ? error.name : 'unknown',
      attempts,
    });
  }
};
