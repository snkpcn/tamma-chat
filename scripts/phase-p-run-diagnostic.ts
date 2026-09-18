// Phase P — build-time-only provider diagnostic. Runs inside Netlify's own
// build process, gated on the mere PRESENCE of THONGTHAI_PHASE_P_DIAGNOSTIC_TOKEN
// (scripts/phase-p-diagnostic-build.mjs never reads its value) -- no bearer
// token or auth header is ever typed, transmitted, or relayed by anyone to
// invoke it. Writes ONLY a strictly safe, structured result to a static file
// in the publish root (phase-p-diagnostic-result.json): result/stage/
// totalElapsedMs/errorClass/attempts/calls. Never a prompt, never model
// output, never customer data, never a credential, never a raw error message.
//
// A single isolated callPreferredModel call for the reproduction message
// already proved healthy (succeeded in ~4s). But the REAL request path makes
// TWO sequential model calls for a non-discovery turn: One-Mind's
// interpretSemanticTurn() runs first on every turn (thongthai-chat.ts calls
// processOneMindCustomerTurn unconditionally; its failure is caught and
// logged, then falls through to the legacy brain -- see the try/catch around
// processOneMindCustomerTurn in thongthai-chat.ts), and only THEN does
// runThongthaiBrain() make its own call. A discovery turn that composes
// directly in One-Mind makes only ONE call. This reproduces that exact
// two-call sequence to see whether the SECOND call is what actually fails.
import { writeFileSync } from 'node:fs';
import { buildBrainPrompt, type BrainRequest } from '../netlify/functions/_thongthai-brain-v3';
import { loadVerifiedCommunityOfferings } from '../netlify/functions/_customer-db';
import { loadBrainRuntime } from '../netlify/functions/_thongthai-runtime-v3';
import { interpretSemanticTurn, emptySemanticContext } from '../netlify/functions/_semantic-interpreter';
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

type SafeOverallResult = SafeResult & { calls?: SafeResult[] };

function write(result: SafeOverallResult) {
  writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));
  console.log('PHASE_P_DIAGNOSTIC_WRITTEN', OUTPUT_PATH);
  console.log('PHASE_P_DIAGNOSTIC_RESULT', JSON.stringify(result));
}

function attemptsFrom(error: unknown): ProviderAttemptDiagnostic[] {
  return error instanceof LLMRequestError || error instanceof ProviderNotConfiguredError
    ? error.attempts
    : (error as { attempts?: ProviderAttemptDiagnostic[] } | null)?.attempts ?? [];
}

async function main() {
  const startedAt = Date.now();
  const message = 'มากันสองคน งบ 500';
  const calls: SafeResult[] = [];

  // Call 1: the same semantic-interpretation call One-Mind makes on every
  // turn, regardless of whether it ultimately handles the turn itself.
  const call1StartedAt = Date.now();
  try {
    await interpretSemanticTurn(message, emptySemanticContext());
    calls.push({ result: 'success', stage: 'semantic_interpret', totalElapsedMs: Date.now() - call1StartedAt, attempts: [] });
  } catch (error) {
    calls.push({
      result: 'failure', stage: 'semantic_interpret',
      totalElapsedMs: Date.now() - call1StartedAt,
      errorClass: error instanceof Error ? error.name : 'unknown',
      attempts: attemptsFrom(error),
    });
  }

  // Call 2: the legacy brain's own call, exactly as runThongthaiBrain makes it.
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
    calls.push({
      result: 'setup_failure', stage: 'legacy_brain_load_runtime_or_build_prompt',
      totalElapsedMs: Date.now() - startedAt,
      errorClass: error instanceof Error ? error.name : 'unknown',
    });
    write({ result: 'failure', totalElapsedMs: Date.now() - startedAt, calls });
    return;
  }

  const call2StartedAt = Date.now();
  try {
    await callPreferredModel(prompt, [{ role: 'user', content: message }], 'phase-p-diagnostic-legacy-brain');
    calls.push({ result: 'success', stage: 'legacy_brain', totalElapsedMs: Date.now() - call2StartedAt, attempts: [] });
  } catch (error) {
    calls.push({
      result: 'failure', stage: 'legacy_brain',
      totalElapsedMs: Date.now() - call2StartedAt,
      errorClass: error instanceof Error ? error.name : 'unknown',
      attempts: attemptsFrom(error),
    });
  }

  const overallResult = calls.every(call => call.result === 'success') ? 'success' : 'failure';
  write({ result: overallResult, totalElapsedMs: Date.now() - startedAt, calls });
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
