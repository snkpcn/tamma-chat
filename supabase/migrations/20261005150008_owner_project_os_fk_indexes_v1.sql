-- Cover the new foreign keys for task, installment, and draft links.
-- These indexes are additive and retain all existing rows.

create index if not exists owner_project_installments_project_due_idx
  on public.owner_project_installments(project_id,due_on);

create index if not exists owner_project_drafts_confirmed_project_idx
  on public.owner_project_conversation_drafts(confirmed_project_id)
  where confirmed_project_id is not null;

create index if not exists owner_project_drafts_confirmed_task_idx
  on public.owner_project_conversation_drafts(confirmed_task_id)
  where confirmed_task_id is not null;

create index if not exists owner_project_messages_draft_idx
  on public.owner_project_conversation_messages(draft_id)
  where draft_id is not null;

create index if not exists financial_investment_entries_owner_project_task_idx
  on public.financial_investment_entries(owner_project_task_id,occurred_on)
  where status='recorded' and owner_project_task_id is not null;

create index if not exists financial_investment_entries_owner_project_installment_idx
  on public.financial_investment_entries(owner_project_installment_id,occurred_on)
  where status='recorded' and owner_project_installment_id is not null;

create index if not exists financial_owner_expense_owner_project_task_idx
  on public.financial_owner_expense_intakes(owner_project_task_id,occurred_on)
  where status<>'cancelled' and owner_project_task_id is not null;

create index if not exists financial_owner_expense_owner_project_installment_idx
  on public.financial_owner_expense_intakes(owner_project_installment_id,occurred_on)
  where status<>'cancelled' and owner_project_installment_id is not null;
