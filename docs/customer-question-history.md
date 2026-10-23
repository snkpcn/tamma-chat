# Customer question history (30 days)

The owner requested readable customer questions in Backoffice, retained for
30 days. This feature records redacted customer text separately from cost
accounting. It adds no provider calls and leaves the 2 THB conversation cap
unchanged. Assistant replies, attachments, and model prompts are not archived.

## Activation

1. Apply `supabase/migrations/20261024090000_customer_question_history.sql`
   to the same Supabase project used by Backoffice and tamma-chat.
2. Deploy this branch's tamma-chat writer and `customer-question-prune`
   function, including its hourly schedule from `netlify.toml`.
3. Deploy the Backoffice question API and UI from `fix/ai-cost-summary`.
4. Send a new web or LINE question, then open Backoffice's **คำถามลูกค้า**.
   Verify the question appears with its channel and time, and that its
   conversation links to cost details.

Local Backoffice uses `.env.local` server-side. That enables reading the
database; it does not deploy or activate the customer-facing question writer.
Questions sent before activation are not backfilled.

## Storage and retention

`customer_question_history` is keyed by channel, event id, and environment.
Duplicate inserts are ignored, retaining the original creation and expiry
times. Questions link to accounting through the canonical conversation and
event ids. Test data is excluded by the Backoffice API.

The writer removes common phone, email, long-number, and credential patterns.
Redaction is pattern-based and cannot guarantee removal of every form of
personal information. Questions are limited to 4,000 Unicode characters;
the UI marks truncated text.

The owner API excludes expired rows immediately. The database prunes on
insert, and the scheduled function deletes expired rows hourly even when
no one chats. Physical deletion can therefore lag expiry by up to one hour
when the schedule is healthy. Monitor scheduled-function failures. No raw
question, contact, or key is written to console logs by this feature.

RLS denies public, anonymous, and signed-in client roles; only the backend's
service role has table access. Backoffice requires its existing owner session.
Only a GET endpoint is exposed for reading history.

## Verification

Run `node --import tsx --test tests/customer-question-history.test.ts`.
Additional shared-core regression coverage includes turn writes, duplicate
claims, mixed LINE batches, conversation context, web deadlines, and the
existing two-baht budget test.
