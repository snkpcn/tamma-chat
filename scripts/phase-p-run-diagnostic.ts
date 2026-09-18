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

function write(result: Record<string, unknown>) {
  writeFileSync(OUTPUT_PATH, JSON.stringify({ ...result, generatedAt: new Date().toISOString() }, null, 2));
  console.log('PHASE_P_DIAGNOSTIC_WRITTEN', OUTPUT_PATH);
}

async function main() {
  const startedAt = Date.now();

  // Every stage before the actual model call (loading runtime/offerings,
  // building the prompt) is itself wrapped, so a failure THERE -- e.g. a
  // build-time Supabase/network difference from the Functions runtime --
  // is reported as real evidence (a safe stage name + error class) instead
  // of silently producing no output file at all.
  let prompt: string;
  try {
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
    prompt = buildBrainPrompt(request, communityOfferings, runtime);
  } catch (error) {
    write({
      result: 'setup_failure',
      stage: 'load_runtime_or_build_prompt',
      totalElapsedMs: Date.now() - startedAt,
      errorClass: error instanceof Error ? error.name : 'unknown',
      errorMessage: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
    });
    return;
  }

  try {
    await callPreferredModel(prompt, [{ role: 'user', content: 'ม้าล่ะ' }], 'phase-p-diagnostic');
    write({ result: 'success', totalElapsedMs: Date.now() - startedAt, attempts: [] as ProviderAttemptDiagnostic[] });
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
  // Absolute last resort: even an error in write() itself still gets a
  // minimal file, so the workflow always has something concrete to read.
  try {
    write({
      result: 'script_error',
      errorClass: error instanceof Error ? error.name : 'unknown',
      errorMessage: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
    });
  } catch { /* filesystem itself unavailable; nothing more we can do */ }
  process.exitCode = 0; // never fail the production build over a diagnostic
});
