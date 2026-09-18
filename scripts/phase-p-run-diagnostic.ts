// Phase P — build-time-only provider diagnostic, log-only (no file, no HTTP
// endpoint of any kind, authenticated or not). Runs inside Netlify's own
// build process, gated on the mere PRESENCE of THONGTHAI_PHASE_P_DIAGNOSTIC_TOKEN
// (scripts/phase-p-diagnostic-build.mjs never reads its value). Prints ONLY
// the safe, structured per-attempt trail (provider/model/outcome/httpStatus/
// elapsedMs) to the build log -- never a prompt, never model output, never
// customer data, never a credential -- for the user to read directly from
// their own Netlify dashboard and relay back.
//
// Reproduction case: the exact first-turn message from the current UAT that
// fails fast (~1.7s, nowhere near any timeout) on production:
// "มากันสองคน งบ 500" with empty chatHistory, section 'web'.
import { buildBrainPrompt, type BrainRequest } from '../netlify/functions/_thongthai-brain-v3';
import { loadVerifiedCommunityOfferings } from '../netlify/functions/_customer-db';
import { loadBrainRuntime } from '../netlify/functions/_thongthai-runtime-v3';
import {
  callPreferredModel, LLMRequestError, ProviderNotConfiguredError,
  type ProviderAttemptDiagnostic,
} from '../netlify/functions/_thongthai-model-provider';

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
    console.log('PHASE_P_DIAGNOSTIC_RESULT', JSON.stringify({
      result: 'setup_failure',
      stage: 'load_runtime_or_build_prompt',
      totalElapsedMs: Date.now() - startedAt,
      errorClass: error instanceof Error ? error.name : 'unknown',
      errorMessage: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
    }));
    return;
  }

  try {
    await callPreferredModel(prompt, [{ role: 'user', content: message }], 'phase-p-diagnostic');
    console.log('PHASE_P_DIAGNOSTIC_RESULT', JSON.stringify({ result: 'success', totalElapsedMs: Date.now() - startedAt, attempts: [] as ProviderAttemptDiagnostic[] }));
  } catch (error) {
    const attempts = error instanceof LLMRequestError || error instanceof ProviderNotConfiguredError
      ? error.attempts
      : (error as { attempts?: ProviderAttemptDiagnostic[] } | null)?.attempts ?? [];
    console.log('PHASE_P_DIAGNOSTIC_RESULT', JSON.stringify({
      result: 'failure',
      totalElapsedMs: Date.now() - startedAt,
      errorClass: error instanceof Error ? error.name : 'unknown',
      errorMessagePreview: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
      attempts,
    }));
  }
}

main().catch(error => {
  console.log('PHASE_P_DIAGNOSTIC_RESULT', JSON.stringify({
    result: 'script_error',
    errorClass: error instanceof Error ? error.name : 'unknown',
    errorMessage: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
  }));
  process.exitCode = 0; // never fail the production build over a diagnostic
});
