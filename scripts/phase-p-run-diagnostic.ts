// Phase P — build-time-only provider diagnostic. Runs inside Netlify's own
// build process, gated on the mere PRESENCE of THONGTHAI_PHASE_P_DIAGNOSTIC_TOKEN
// (scripts/phase-p-diagnostic-build.mjs never reads its value) -- no bearer
// token or auth header is ever typed, transmitted, or relayed by anyone to
// invoke it. Writes ONLY a strictly safe, structured result to a static file
// in the publish root (phase-p-diagnostic-result.json): result/stage/
// totalElapsedMs/errorClass/attempts (provider/model/outcome/httpStatus/
// elapsedMs per attempt). Never a prompt, never model output, never customer
// data, never a credential, never a raw error message or stack trace.
//
// Reproduction case: the exact first-turn message that fails fast (~2s,
// nowhere near any timeout) on production: "มากันสองคน งบ 500", empty
// chatHistory, section 'web'.
import { writeFileSync } from 'node:fs';
import { buildBrainPrompt, type BrainRequest } from '../netlify/functions/_thongthai-brain-v3';
import { loadVerifiedCommunityOfferings } from '../netlify/functions/_customer-db';
import { loadBrainRuntime } from '../netlify/functions/_thongthai-runtime-v3';
import {
  callPreferredModel, LLMRequestError, ProviderNotConfiguredError,
  type ProviderAttemptDiagnostic,
} from '../netlify/functions/_thongthai-model-provider';

const OUTPUT_PATH = 'phase-p-diagnostic-result.json';

type SafeResult = {
  result: string;
  stage?: string;
  totalElapsedMs: number;
  errorClass?: string;
  attempts?: ProviderAttemptDiagnostic[];
};

function write(result: SafeResult) {
  writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));
  console.log('PHASE_P_DIAGNOSTIC_WRITTEN', OUTPUT_PATH);
  console.log('PHASE_P_DIAGNOSTIC_RESULT', JSON.stringify(result));
}

async function main() {
  const startedAt = Date.now();
  const message = 'มากันสองคน งบ 500';

  let prompt: string;
  try {
    const request: BrainRequest = {
      guestId: undefined,
      message,
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
    prompt = buildBrainPrompt(request, communityOfferings, runtime);
  } catch (error) {
    write({
      result: 'setup_failure',
      stage: 'load_runtime_or_build_prompt',
      totalElapsedMs: Date.now() - startedAt,
      errorClass: error instanceof Error ? error.name : 'unknown',
    });
    return;
  }

  try {
    await callPreferredModel(prompt, [{ role: 'user', content: message }], 'phase-p-diagnostic');
    write({ result: 'success', totalElapsedMs: Date.now() - startedAt, attempts: [] });
  } catch (error) {
    const attempts = error instanceof LLMRequestError || error instanceof ProviderNotConfiguredError
      ? error.attempts
      : (error as { attempts?: ProviderAttemptDiagnostic[] } | null)?.attempts ?? [];
    write({
      result: 'failure',
      totalElapsedMs: Date.now() - startedAt,
      errorClass: error instanceof Error ? error.name : 'unknown',
      attempts,
    });
  }
}

main().catch(error => {
  // Absolute last resort: even an error here still gets a minimal, safe
  // result written, so the workflow always has something concrete to read.
  try {
    write({
      result: 'script_error',
      totalElapsedMs: 0,
      errorClass: error instanceof Error ? error.name : 'unknown',
    });
  } catch { /* filesystem itself unavailable; nothing more we can do */ }
  process.exitCode = 0; // never fail the production build over a diagnostic
});
