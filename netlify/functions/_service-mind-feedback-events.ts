// Service Mind -- creates a feedback event row (compliment/complaint/
// suggestion/safety_issue/system_feedback) and dispatches the staff
// notification. Same "never let infra failure break the customer's turn"
// discipline as every other real adapter in this codebase
// (_weather-provider.ts, _dialog-source-adapters.ts): every failure mode
// degrades to a structured, honest outcome, never a thrown error, never a
// crash, never a silently-dropped event that the customer is told
// succeeded.
//
// Storage: the Supabase-CLI migration documenting the full intended
// schema lives at supabase/migrations/<timestamp>_ops_feedback_events_v1.sql
// -- NOT APPLIED, prepared for owner review only (see
// THONGTHAI_HANDOFF.md's Service Mind section). Until it's applied,
// every write here fails
// gracefully (caught below) and the customer still gets a sincere reply;
// nothing is silently dropped -- the failure is logged and the customer-
// facing response is composed with notificationQueued:false, which
// produces the honest "ทองไทยจะส่งต่อให้..." (future tense) wording rather
// than falsely claiming it already happened.
import { notifyFeedbackEventTargets, type FeedbackTargetResult } from './_ops-notifications';
import type { BrainChannel } from './_thongthai-brain-v3';
import type { ServiceFeedbackMatch } from './_service-mind-feedback-intent';
import { redactDirectIdentifiers } from './_direct-identifier-redaction';

export type FeedbackEventResult = {
  eventId: string | null;
  /** True only when the DB write succeeded AND the staff notification was
   *  actually sent or durably queued (not 'not_bound'/'ignored'/an
   *  error) -- see routingLine's own doc comment in
   *  _service-mind-feedback-response.ts for why this distinction matters
   *  for the customer-facing wording. */
  notificationQueued: boolean;
  /** Per-target delivery outcome (domain team, and owner_general for a
   *  safety issue or urgent severity) -- lets the customer-facing reply
   *  say precisely what happened instead of one collapsed boolean. Empty
   *  when the DB write itself failed (eventId is null). */
  targets: FeedbackTargetResult[];
};

function dbConfig(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ''), key };
}

async function dbFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const config = dbConfig();
  if (!config) throw new Error('Operations database is not configured');
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`ops_feedback_events request failed ${response.status}: ${body.slice(0, 260)}`);
  }
  return response;
}

function channelForEvent(channel: BrainChannel): 'web' | 'line' | 'other' {
  if (channel === 'web' || channel === 'line') return channel;
  return 'other';
}

function summarize(message: string): string {
  const trimmed = message.trim().replace(/\s+/g, ' ');
  return trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed;
}

const ROUTE_TARGET: Record<ServiceFeedbackMatch['businessUnit'], string> = {
  restaurant: 'restaurant_group',
  activity: 'activity_group',
  stay: 'stay_group',
  cafe: 'cafe_group',
  membership: 'admin_group',
  system: 'admin_group',
  general: 'owner_general',
  unknown: 'owner_general',
};

/**
 * Creates the feedback event row and dispatches the staff notification.
 * NEVER throws -- every failure (DB not configured, table doesn't exist
 * yet because the migration hasn't been applied, notification dispatch
 * error) degrades to `{eventId: null, notificationQueued: false}`, logged
 * via console.error, never surfaced to the customer as anything other
 * than the honest "will route" (rather than "routed") wording.
 */
export async function createFeedbackEvent(input: {
  match: ServiceFeedbackMatch;
  message: string;
  channel: BrainChannel;
  guestDbId: string | null;
}): Promise<FeedbackEventResult> {
  try {
    // Customer Voice needs the operational meaning of the report, not
    // copied contact details or external URLs. Redact direct identifiers
    // BEFORE persistence so the same safe text is what backoffice and LINE
    // staff notifications read later.
    const safeCustomerMessage = redactDirectIdentifiers(input.message, 2000);
    const body = {
      guest_id: input.guestDbId,
      feedback_type: input.match.feedbackType,
      business_unit: input.match.businessUnit,
      severity: input.match.severity,
      customer_message: safeCustomerMessage,
      summary: summarize(safeCustomerMessage),
      channel: channelForEvent(input.channel),
      staff_name: input.match.staffName,
      route_target: ROUTE_TARGET[input.match.businessUnit],
      status: 'new',
      notification_status: 'pending',
      // Structured extraction for the backoffice "เสียงลูกค้า" dashboard --
      // only written once the v2 migration is applied; until then these
      // columns simply don't exist and Postgres/PostgREST would reject the
      // insert, so this whole write stays inside the try/catch above and
      // degrades gracefully like every other feedback write in this file.
      person_mentions: input.match.personMentions,
      business_unit_mentions: input.match.businessUnitMentions,
      sentiment_keywords: input.match.sentimentKeywords,
      issue_keywords: input.match.issueKeywords,
      named_assets: input.match.namedAssets,
      keyword_summary: input.match.keywordSummary,
    };
    const response = await dbFetch('ops_feedback_events', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(body),
    });
    const row = (await response.json() as Array<{ id: string }>)[0];
    if (!row?.id) return { eventId: null, notificationQueued: false, targets: [] };

    try {
      const { overallStatus, targets } = await notifyFeedbackEventTargets(row.id);
      // Reflect the real PRIMARY-team dispatch outcome on the single
      // notification_status column. Per-target delivery outcomes already
      // live in ops_notification_deliveries; internal_notes is reserved
      // exclusively for the backoffice staff-note array contract.
      await dbFetch(`ops_feedback_events?id=eq.${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          notification_status: overallStatus === 'ignored' ? 'not_configured' : overallStatus,
        }),
      }).catch(() => undefined);
      return {
        eventId: row.id,
        notificationQueued: overallStatus === 'sent' || overallStatus === 'duplicate',
        targets,
      };
    } catch (notifyError) {
      console.error('THONGTHAI_SERVICE_MIND_NOTIFY_ERROR', notifyError instanceof Error ? notifyError.message.slice(0, 220) : 'unknown');
      await dbFetch(`ops_feedback_events?id=eq.${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          notification_status: 'failed',
          notification_error: notifyError instanceof Error ? notifyError.message.slice(0, 220) : 'unknown',
        }),
      }).catch(() => undefined);
      return { eventId: row.id, notificationQueued: false, targets: [] };
    }
  } catch (error) {
    console.error('THONGTHAI_SERVICE_MIND_EVENT_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
    return { eventId: null, notificationQueued: false, targets: [] };
  }
}
