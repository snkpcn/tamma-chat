// Phase J — safe structured observability for the One-Mind pipeline.
//
// This is NOT a transcript logger and never accepts raw customer text or raw
// model output. The envelope contains only bounded machine metadata needed to
// diagnose routing, grounding, degradation, state concurrency and composition.
// Phase K can persist a bounded/expiring form of this same envelope without
// changing the "no permanent raw chat storage" stance.
import type { OneMindTurnResult } from './_thongthai-one-mind-orchestrator';
import type { ComposedResponse, VerifiedOperationalOutcome } from './_response-composer';

export const ONE_MIND_TRACE_VERSION = 'one-mind-trace-v1';

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu;
const PHONE_RE = /(?:\+?66|0)[\d\s-]{8,13}/gu;

function safeToken(value: unknown, max = 160): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed
    .replace(EMAIL_RE,'[redacted]')
    .replace(PHONE_RE,'[redacted]')
    .slice(0,max);
}

function safeTokens(values: readonly unknown[], maxItems = 30, maxChars = 160): string[] {
  const out:string[]=[];
  for(const value of values){
    const token=safeToken(value,maxChars);
    if(!token || out.includes(token)) continue;
    out.push(token);
    if(out.length>=maxItems) break;
  }
  return out;
}

export type OneMindTraceEnvelope = {
  traceVersion: typeof ONE_MIND_TRACE_VERSION;
  traceId: string;
  at: string;
  channel: string;
  versions: {
    orchestrator: string;
    semantic: string;
    composer: string | null;
    bible: string | null;
  };
  semantic: {
    domain: string;
    intent: string;
    action: string;
    confidenceBucket: 'high' | 'medium' | 'low';
    referencesResolved: number;
    referencesUnresolved: number;
    needsClarification: boolean;
  };
  dialog: {
    mode: string;
    responseIntent: string;
    reasonCodes: string[];
    actionProposed: boolean;
  };
  knowledge: {
    sources: Array<{domain:string;sourceId:string;status:string}>;
    usedFactKeys: string[];
  };
  degradation: {
    condition: string;
    level: string;
    reasonCodes: string[];
    retryable: boolean;
  };
  state: {
    persisted: boolean;
    conflictRetries: number;
  };
  composer: {
    mode: string | null;
  };
  transaction: {
    executed: boolean;
    success: boolean;
    status: string | null;
    referenceCode: string | null;
    duplicate: boolean;
  } | null;
  timingsMs: {
    semantic: number;
    dialogAndKnowledge: number;
    stateRead: number;
    stateWrite: number;
    composer: number;
    total: number;
  };
};

export function buildOneMindTraceEnvelope(args:{
  turn:OneMindTurnResult;
  response?:ComposedResponse | null;
  operationalOutcome?:VerifiedOperationalOutcome | null;
  composerMs?:number;
  totalMs?:number;
  at?:Date;
}):OneMindTraceEnvelope {
  const {turn,response,operationalOutcome}=args;
  const timing=turn.trace.timingsMs;
  const transaction=operationalOutcome ? {
    executed:operationalOutcome.executed === true,
    success:operationalOutcome.success === true,
    status:safeToken(operationalOutcome.status,80),
    referenceCode:safeToken(operationalOutcome.referenceCode,80),
    duplicate:operationalOutcome.duplicate === true,
  } : null;

  return {
    traceVersion:ONE_MIND_TRACE_VERSION,
    traceId:safeToken(turn.trace.eventId,180) ?? 'unknown',
    at:(args.at ?? new Date()).toISOString(),
    channel:safeToken(turn.trace.channel,40) ?? 'unknown',
    versions:{
      orchestrator:safeToken(turn.trace.orchestratorVersion,80) ?? 'unknown',
      semantic:safeToken(turn.trace.semantic.semanticVersion,80) ?? 'unknown',
      composer:response ? safeToken(response.composerVersion,80) : null,
      bible:response ? safeToken(response.bibleVersion,80) : null,
    },
    semantic:{
      domain:safeToken(turn.trace.semantic.domain,60) ?? 'unknown',
      intent:safeToken(turn.trace.semantic.intent,100) ?? 'unknown',
      action:safeToken(turn.trace.semantic.action,60) ?? 'unknown',
      confidenceBucket:turn.trace.semantic.confidenceBucket,
      referencesResolved:Math.max(0,turn.trace.semantic.referencesResolved),
      referencesUnresolved:Math.max(0,turn.trace.semantic.referencesUnresolved),
      needsClarification:turn.trace.semantic.needsClarification === true,
    },
    dialog:{
      mode:safeToken(turn.trace.dialogMode,60) ?? 'unknown',
      responseIntent:safeToken(turn.trace.responseIntent,100) ?? 'unknown',
      reasonCodes:safeTokens(turn.trace.reasonCodes,20,100),
      actionProposed:turn.trace.actionProposed === true,
    },
    knowledge:{
      sources:turn.trace.knowledgeSources.slice(0,30).map(source=>({
        domain:safeToken(source.domain,60) ?? 'unknown',
        sourceId:safeToken(source.sourceId,120) ?? 'unknown',
        status:safeToken(source.status,40) ?? 'unknown',
      })),
      usedFactKeys:response ? safeTokens(response.usedFactKeys,40,180) : [],
    },
    degradation:{
      condition:safeToken(turn.knowledgeDegradation.condition,80) ?? 'unknown',
      level:safeToken(turn.knowledgeDegradation.level,80) ?? 'unknown',
      reasonCodes:safeTokens(turn.knowledgeDegradation.reasonCodes,20,120),
      retryable:turn.knowledgeDegradation.retryable === true,
    },
    state:{
      persisted:turn.trace.statePersisted === true,
      conflictRetries:Math.max(0,turn.trace.stateConflictRetries ?? 0),
    },
    composer:{mode:response ? (safeToken(response.mode,40) ?? 'unknown') : null},
    transaction,
    timingsMs:{
      semantic:Math.max(0,timing?.semantic ?? 0),
      dialogAndKnowledge:Math.max(0,timing?.dialogAndKnowledge ?? 0),
      stateRead:Math.max(0,timing?.stateRead ?? 0),
      stateWrite:Math.max(0,timing?.stateWrite ?? 0),
      composer:Math.max(0,args.composerMs ?? 0),
      total:Math.max(0,args.totalMs ?? timing?.total ?? 0),
    },
  };
}

/** Logging must never change customer behavior. */
export function emitOneMindTrace(trace:OneMindTraceEnvelope):void {
  try {
    console.log('THONGTHAI_ONE_MIND_TRACE',JSON.stringify(trace));
  } catch {
    // Deliberately swallowed. Observability is non-blocking.
  }
}
