// Phase P — build-time-only provider diagnostic. Never an HTTP-reachable
// endpoint: it runs inside Netlify's own build process (same trust boundary
// as GEMINI_API_KEY/OPENAI_API_KEY already living there), so no bearer token
// or auth header is ever typed, transmitted, or relayed by anyone to invoke
// it. Gated by scripts/phase-p-diagnostic-build.mjs on the mere PRESENCE of
// THONGTHAI_PHASE_P_DIAGNOSTIC_TOKEN as an on/off flag -- this script never
// reads or uses that variable's value.
//
// Writes ONLY a safe, structured result to a static file in the publish
// root (phase-p-diagnostic-result.json, served as a public static asset
// after deploy): provider/model/outcome/httpStatus/elapsedMs per attempt.
// Never the prompt, never model output, never customer data, never a
// credential.
import { writeFileSync } from 'node:fs';
import { buildBrainPrompt, type BrainRequest } from '../netlify/functions/_thongthai-brain-v3';
import { loadVerifiedCommunityOfferings } from '../netlify/functions/_customer-db';
import { loadBrainRuntime } from '../netlify/functions/_thongthai-runtime-v3';
import {
  callPreferredModel, LLMRequestError, ProviderNotConfiguredError,
  type ProviderAttemptDiagnostic,
} from '../netlify/functions/_thongthai-model-provider';

const OUTPUT_PATH = 'phase-p-diagnostic-result.json';

async function main() {
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
  let result: Record<string, unknown>;
  try {
    await callPreferredModel(prompt, [{ role: 'user', content: request.message }], 'phase-p-diagnostic');
    result = { result: 'success', totalElapsedMs: Date.now() - startedAt, attempts: [] as ProviderAttemptDiagnostic[] };
  } catch (error) {
    const attempts = error instanceof LLMRequestError || error instanceof ProviderNotConfiguredError
      ? error.attempts
      : (error as { attempts?: ProviderAttemptDiagnostic[] } | null)?.attempts ?? [];
    result = {
      result: 'failure',
      totalElapsedMs: Date.now() - startedAt,
      errorClass: error instanceof Error ? error.name : 'unknown',
      attempts,
    };
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify({ ...result, generatedAt: new Date().toISOString() }, null, 2));
  console.log('PHASE_P_DIAGNOSTIC_WRITTEN', OUTPUT_PATH);
}

main().catch(error => {
  console.error('PHASE_P_DIAGNOSTIC_SCRIPT_ERROR', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
  process.exitCode = 0; // never fail the production build over a diagnostic
});
