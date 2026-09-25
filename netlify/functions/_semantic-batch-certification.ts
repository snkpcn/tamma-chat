import {
  buildSemanticInterpreterPrompt,
  emptySemanticContext,
  parseSemanticTurnResponse,
} from './_semantic-interpreter';
import {
  getSemanticCertificationCases,
  semanticCertificationFailureForTurn,
  type SemanticCertificationFailure,
  type SemanticCertificationProfile,
} from './_semantic-live-certification';

export const SEMANTIC_BATCH_MODEL = 'gemini-3.6-flash';

export type SemanticBatchCaseError = {
  id: string;
  kind: 'provider_error' | 'parse_error' | 'missing_response';
  code?: number | string | null;
  message?: string | null;
};

export type SemanticBatchEvaluation = {
  kind: 'LIVE_MODEL_SEMANTIC_CERTIFICATION';
  transport: 'gemini_batch';
  model: typeof SEMANTIC_BATCH_MODEL;
  totalCorpusCases: number;
  evaluated: number;
  pass: number;
  semanticMismatches: number;
  transportErrors: number;
  failed: number;
  passPct: number;
  failures: SemanticCertificationFailure[];
  errors: SemanticBatchCaseError[];
};

export function buildGeminiSemanticBatchRequest(
  profile: SemanticCertificationProfile = 'full',
  displayName = 'thongthai-semantic-certification',
) {
  const cases = getSemanticCertificationCases(profile);
  const requests = cases.map(item => {
    const context = item.context ?? emptySemanticContext();
    return {
      request: {
        systemInstruction: {
          parts: [{ text: buildSemanticInterpreterPrompt(context) }],
        },
        contents: [{
          role: 'user',
          parts: [{ text: item.message }],
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingLevel: 'low' },
          maxOutputTokens: 4096,
        },
      },
      metadata: { key: item.id },
    };
  });

  return {
    cases,
    body: {
      batch: {
        displayName,
        inputConfig: {
          requests: { requests },
        },
      },
    },
  };
}

function inlineResponsesFromOperation(operation: any): any[] {
  const candidates = [
    operation?.response?.inlinedResponses?.inlinedResponses,
    operation?.response?.inlinedResponses,
    operation?.response?.output?.inlinedResponses?.inlinedResponses,
    operation?.response?.output?.inlinedResponses,
    operation?.dest?.inlinedResponses?.inlinedResponses,
    operation?.dest?.inlinedResponses,
    operation?.output?.inlinedResponses?.inlinedResponses,
    operation?.output?.inlinedResponses,
    operation?.inlinedResponses?.inlinedResponses,
    operation?.inlinedResponses,
  ];
  return candidates.find(Array.isArray) ?? [];
}

function responseText(entry: any): string {
  const parts = entry?.response?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part: any) => typeof part?.text === 'string' ? part.text : '')
    .join('')
    .trim();
}

function safeErrorMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.replace(/\s+/g, ' ').trim().slice(0, 220) || null;
}

export function evaluateGeminiSemanticBatchOperation(
  operation: unknown,
  profile: SemanticCertificationProfile = 'full',
): SemanticBatchEvaluation {
  const cases = getSemanticCertificationCases(profile);
  const byId = new Map(cases.map(item => [item.id, item]));
  const responses = inlineResponsesFromOperation(operation);
  const failures: SemanticCertificationFailure[] = [];
  const errors: SemanticBatchCaseError[] = [];
  const seen = new Set<string>();
  let pass = 0;

  responses.forEach((entry, index) => {
    const metadataKey = typeof entry?.metadata?.key === 'string' ? entry.metadata.key : null;
    const fallbackCase = cases[index];
    const id = metadataKey && byId.has(metadataKey) ? metadataKey : fallbackCase?.id;
    if (!id) return;

    const item = byId.get(id);
    if (!item || seen.has(id)) return;
    seen.add(id);

    if (entry?.error) {
      errors.push({
        id,
        kind:'provider_error',
        code:entry.error.code ?? entry.error.status ?? null,
        message:safeErrorMessage(entry.error.message),
      });
      return;
    }

    const text = responseText(entry);
    if (!text) {
      errors.push({ id, kind:'missing_response' });
      return;
    }

    try {
      const turn = parseSemanticTurnResponse(text, item.context ?? emptySemanticContext());
      const failure = semanticCertificationFailureForTurn(item, turn);
      if (failure) failures.push(failure);
      else pass += 1;
    } catch (error) {
      errors.push({
        id,
        kind:'parse_error',
        message:error instanceof Error ? safeErrorMessage(error.message) : 'unknown',
      });
    }
  });

  for (const item of cases) {
    if (!seen.has(item.id)) errors.push({ id:item.id, kind:'missing_response' });
  }

  const evaluated = pass + failures.length;
  const failed = cases.length - pass;
  return {
    kind:'LIVE_MODEL_SEMANTIC_CERTIFICATION',
    transport:'gemini_batch',
    model:SEMANTIC_BATCH_MODEL,
    totalCorpusCases:cases.length,
    evaluated,
    pass,
    semanticMismatches:failures.length,
    transportErrors:errors.length,
    failed,
    passPct:cases.length ? Number((pass / cases.length * 100).toFixed(2)) : 0,
    failures,
    errors,
  };
}

export function semanticBatchState(operation: any): string {
  const raw = operation?.metadata?.state ?? operation?.state ?? operation?.response?.state;
  return typeof raw === 'string' ? raw : 'UNKNOWN';
}

export function semanticBatchName(operation: any): string | null {
  const raw = operation?.name
    ?? operation?.metadata?.name
    ?? operation?.response?.name;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

export function semanticBatchSucceeded(operation: any): boolean {
  return ['JOB_STATE_SUCCEEDED', 'BATCH_STATE_SUCCEEDED'].includes(semanticBatchState(operation));
}

export function semanticBatchTerminalFailure(operation: any): boolean {
  return [
    'JOB_STATE_FAILED',
    'JOB_STATE_CANCELLED',
    'JOB_STATE_EXPIRED',
    'BATCH_STATE_FAILED',
    'BATCH_STATE_CANCELLED',
    'BATCH_STATE_EXPIRED',
  ].includes(semanticBatchState(operation));
}
