import { createHash } from 'node:crypto';
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
  /** Stable pseudonymous grouping key. Never the raw guest/canonical/provider id. */
  conversationKey: string | null;
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
    informationNeed: string;
    confidenceBucket: 'high' | 'medium' | 'low';
    referencesResolved: number;
    referencesUnresolved: number;
    needsClarification: boolean;
  };
  memory: {
    appliedKeys: string[];
    ignoredKeys: string[];
    relevantConstraintCount: number;
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

export function conversationKeyFromGuestId(guestDbId: string | null | undefined): string | null {
  if (!guestDbId) return null;
  return createHash('sha256')
    .update('tamma-one-mind-conversation-v1:')
    .update(guestDbId)
    .digest('hex')
    .slice(0, 24);
}

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
    conversationKey:conversationKeyFromGuestId(turn.identity.guestDbId),
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
      informationNeed:safeToken(turn.trace.semantic.informationNeed,60) ?? 'none',
      confidenceBucket:turn.trace.semantic.confidenceBucket,
      referencesResolved:Math.max(0,turn.trace.semantic.referencesResolved),
      referencesUnresolved:Math.max(0,turn.trace.semantic.referencesUnresolved),
      needsClarification:turn.trace.semantic.needsClarification === true,
    },
    memory:{
      appliedKeys:safeTokens(turn.trace.memory.appliedKeys,20,60),
      ignoredKeys:safeTokens(turn.trace.memory.ignoredKeys,20,60),
      relevantConstraintCount:Math.max(0,turn.trace.memory.relevantConstraintCount),
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


export const ONE_MIND_TRACE_RETENTION_MS = 24 * 60 * 60 * 1000;

function traceStoreConfig(): { url:string; key:string } | null {
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? {url:url.replace(/\/$/,''),key} : null;
}

/** Best-effort bounded trace persistence for Phase K. The table is created by
 * one-mind-observability-v1.sql in the EXISTING tamma-customer-data project.
 * Failure is returned, never thrown into the customer response path. */
export async function persistOneMindTrace(trace:OneMindTraceEnvelope):Promise<boolean>{
  const config=traceStoreConfig();
  if(!config) return false;
  try{
    const observedAt=new Date(trace.at);
    const base=Number.isFinite(observedAt.getTime()) ? observedAt : new Date();
    const expiresAt=new Date(base.getTime()+ONE_MIND_TRACE_RETENTION_MS).toISOString();
    const response=await fetch(config.url+'/rest/v1/one_mind_traces?on_conflict=channel,trace_id',{
      method:'POST',
      headers:{
        apikey:config.key,
        Authorization:'Bearer '+config.key,
        'Content-Type':'application/json',
        Prefer:'resolution=ignore-duplicates,return=minimal',
      },
      body:JSON.stringify({
        trace_id:trace.traceId,
        conversation_key:trace.conversationKey,
        channel:trace.channel,
        domain:trace.semantic.domain,
        intent:trace.semantic.intent,
        action:trace.semantic.action,
        dialog_mode:trace.dialog.mode,
        degradation_condition:trace.degradation.condition,
        composer_mode:trace.composer.mode,
        state_conflict_retries:trace.state.conflictRetries,
        total_ms:trace.timingsMs.total,
        envelope:trace,
        observed_at:trace.at,
        expires_at:expiresAt,
      }),
    });
    if(!response.ok){
      const body=await response.text().catch(()=>'');
      console.error('THONGTHAI_ONE_MIND_TRACE_PERSIST_ERROR',response.status,body.slice(0,160));
      return false;
    }
    return true;
  }catch(error){
    console.error('THONGTHAI_ONE_MIND_TRACE_PERSIST_ERROR',error instanceof Error ? error.message.slice(0,180) : 'unknown');
    return false;
  }
}

/** Log + bounded DB persistence. Both are best-effort and neither may fail a
 * customer turn. Awaiting it only guarantees the serverless write has a chance
 * to finish; all errors are swallowed inside the observability boundary. */
export async function recordOneMindTrace(trace:OneMindTraceEnvelope):Promise<void>{
  emitOneMindTrace(trace);
  await persistOneMindTrace(trace).catch(()=>false);
}
