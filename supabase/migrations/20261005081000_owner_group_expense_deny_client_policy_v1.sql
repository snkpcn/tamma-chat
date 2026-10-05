-- Owner Expense is server-mediated only.  These explicit deny policies make
-- that boundary visible to RLS tooling as well as to future maintainers.
-- service_role continues to use the narrowly granted RPCs and bypasses RLS.

create policy "owner_expense_intakes_no_direct_client_access"
on public.financial_owner_expense_intakes
as restrictive
for all
to public
using (false)
with check (false);

create policy "owner_expense_audit_no_direct_client_access"
on public.financial_owner_expense_audit_events
as restrictive
for all
to public
using (false)
with check (false);
