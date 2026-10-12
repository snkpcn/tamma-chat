#!/usr/bin/env bash
# Real independent PostgreSQL backend sessions. CI-only; never accepts a DSN.
# Uses standard psql from the postgres:17 job image, with no extra dependencies.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ ${GITHUB_ACTIONS:-} == true && ${PGHOST:-} == postgres && ${PGUSER:-} == postgres && ${PGDATABASE:-} == employee_advance_test ]] || {
 echo 'Refusing: this suite requires the isolated GitHub Actions postgres service and synthetic database.' >&2; exit 2;
}
[[ -z ${PGPASSWORD:-} && -z ${PGSERVICE:-} && -z ${DATABASE_URL:-} ]] || { echo 'Refusing credential-bearing or ambiguous database configuration.' >&2; exit 2; }
export PGCONNECT_TIMEOUT=5
mkdir -p evidence/concurrency
DB=(psql -XqAt --no-password -v ON_ERROR_STOP=1 -v VERBOSITY=verbose)
db(){ "${DB[@]}" "$@"; }
[[ $(db -c 'select current_database()') == employee_advance_test ]] || exit 2
# These are ephemeral NOLOGIN provider authorization roles, not new credentials.
# They exist only in the private service container, destroyed with this CI job.
db -c 'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;' > evidence/concurrency/provider-role-bootstrap.log 2>&1
# Bootstrap is exact source DDL plus separately documented schema-only prerequisites.
db -f tests/sql/employee-advance-actual-schema.sql > evidence/concurrency/bootstrap.log 2>&1
printf '%s  %s\n' '54daddec6e5cc0f9d4dcf15237671b8504448f2b469ab4075df745efbffc7026' 'supabase/proposals/owner_employee_advance_v1.sql' | sha256sum --check
# No Supabase migration history or production target exists in this job.
db -f supabase/proposals/owner_employee_advance_v1.sql >> evidence/concurrency/bootstrap.log 2>&1
db -f tests/sql/employee-advance-concurrency-cases.sql >> evidence/concurrency/bootstrap.log 2>&1
PASS=0
assert_sql(){ db -c "select employee_advance_test.assert(($1),'$2');" >/dev/null; }
act(){ db -c "BEGIN; SET LOCAL ROLE service_role; $1 COMMIT;"; }
prepare(){ db -c "select employee_advance_test.prepare('$1',ARRAY[$2]::numeric[],$3,$4);" >/dev/null; }
record(){ printf "insert into employee_advance_test.results(case_name,side,result) select '%s','%s',%s;" "$1" "$2" "$3"; }
# A performs a real write and holds the transaction. B must block on A's lock.
# A third short-lived connection proves the blocking edge and distinct PIDs.
race(){
 local name=$1 a=$2 b=$3 expected_error=${4:-} mode=${5:-blocked}
 local app_a="advance-ci-${name}-A" app_b="advance-ci-${name}-B" pid_a='' pid_b='' ready='' blocked='' status_a=0 status_b=0
 PGAPPNAME="$app_a" db >"evidence/concurrency/${name}-A.log" 2>&1 <<SQL &
BEGIN;
SET LOCAL ROLE service_role;
SET LOCAL statement_timeout='12s';
$a
SELECT pg_sleep(3);
COMMIT;
SQL
 local process_a=$!
 for _ in $(seq 1 100); do
  ready=$(db -c "select pid from pg_stat_activity where application_name='$app_a' and wait_event='PgSleep';")
  [[ -n $ready ]] && { pid_a=$ready; break; }; sleep 0.03
 done
 [[ -n $pid_a ]] || { cat "evidence/concurrency/${name}-A.log"; echo "A never reached held transaction: $name" >&2; wait "$process_a" || true; exit 1; }
 PGAPPNAME="$app_b" db >"evidence/concurrency/${name}-B.log" 2>&1 <<SQL &
BEGIN;
SET LOCAL ROLE service_role;
SET LOCAL statement_timeout='12s';
SELECT 'BACKEND_PID='||pg_backend_pid();
$b
COMMIT;
SQL
 local process_b=$!
 if [[ $mode == blocked ]]; then
  for _ in $(seq 1 100); do
   blocked=$(db -c "select b.pid from pg_stat_activity b where application_name='$app_b' and $pid_a=any(pg_blocking_pids(b.pid));")
   [[ -n $blocked ]] && { pid_b=$blocked; break; }; sleep 0.02
  done
  [[ -n $pid_b && $pid_b != "$pid_a" ]] || { echo "Independent blocked sessions not observed: $name" >&2; cat "evidence/concurrency/${name}-B.log"; wait "$process_a" || true; wait "$process_b" || true; exit 1; }
 elif [[ $mode == rejected ]]; then
  # A profile edit must fail promptly rather than deadlock behind a confirmer.
  wait "$process_b" || status_b=$?
  pid_b=$(sed -n 's/^BACKEND_PID=//p' "evidence/concurrency/${name}-B.log" | head -1)
  [[ $status_b != 0 && -n $pid_b && $pid_b != "$pid_a" ]] || { echo "Concurrent safe rejection missing: $name" >&2; exit 1; }
  [[ $(db -c "select count(*) from pg_stat_activity where pid=$pid_a and wait_event='PgSleep';") == 1 ]] || { echo 'Profile rejection was not concurrent' >&2; exit 1; }
 else
  # Different groups must complete while A is still sleeping, not serialize globally.
  for _ in $(seq 1 100); do
   pid_b=$(db -c "select pid from employee_advance_test.results where case_name='$name' and side='B';")
   [[ -n $pid_b ]] && break; sleep 0.02
  done
  [[ -n $pid_b && $pid_b != "$pid_a" ]] || { echo "Independent group did not complete: $name" >&2; exit 1; }
  [[ $(db -c "select count(*) from pg_stat_activity where pid=$pid_a and wait_event='PgSleep';") == 1 ]] || { echo 'Different-group result was not concurrent' >&2; exit 1; }
 fi
 wait "$process_a" || status_a=$?
 wait "$process_b" || status_b=$?
 [[ $status_a == 0 ]] || { cat "evidence/concurrency/${name}-A.log"; exit 1; }
 if [[ -n $expected_error ]]; then
  [[ $status_b != 0 ]] && grep -Eq "$expected_error" "evidence/concurrency/${name}-B.log" || { cat "evidence/concurrency/${name}-B.log"; echo "Expected safe rejection missing: $name" >&2; exit 1; }
 else
  [[ $status_b == 0 ]] || { cat "evidence/concurrency/${name}-B.log"; exit 1; }
 fi
 printf '%s\t%s\t%s\t%s\n' "$name" "$pid_a" "$pid_b" "$mode" >> evidence/concurrency/observed-backends.tsv
}
ok(){ PASS=$((PASS+1)); echo "ok $PASS - $1"; }

prepare same_slip 100 false null
race same_slip "$(record same_slip A "employee_advance_test.confirm('same_slip',1,'synthetic-confirm-A')")" "$(record same_slip B "employee_advance_test.confirm('same_slip',1,'synthetic-confirm-B')")"
assert_sql "employee_advance_test.paid_count('same_slip')=1 and (select (result->>'duplicate')::boolean from employee_advance_test.results where case_name='same_slip' and side='B')" 'one payment and idempotent second click'
ok 'simultaneous same-slip clicks commit one payment'

prepare same_employee 100,100 false null
race same_employee "$(record same_employee A "employee_advance_test.confirm('same_employee',1,'synthetic-confirm-A2')")" "$(record same_employee B "employee_advance_test.confirm('same_employee',2,'synthetic-confirm-B2')")"
assert_sql "employee_advance_test.paid_count('same_employee')=1 and (select (result->>'changed')::boolean from employee_advance_test.results where case_name='same_employee' and side='B')" 'stale balance creates no second payment'
act "select employee_advance_test.refresh('same_employee',2);select employee_advance_test.confirm('same_employee',2,'synthetic-confirm-B3',2);" > evidence/concurrency/same_employee-refresh.log
assert_sql "employee_advance_test.paid_count('same_employee')=2 and employee_advance_test.paid_sum('same_employee')=200" 'both genuinely different equal payments survive after refreshed approval'
ok 'different slips serialize per employee and stale balance requires another approval'

prepare duplicate_ref 100,100 true null
race duplicate_ref "$(record duplicate_ref A "employee_advance_test.confirm('duplicate_ref',1,'synthetic-confirm-A4')")" "$(record duplicate_ref B "employee_advance_test.confirm('duplicate_ref',2,'synthetic-confirm-B4')")"
act "select employee_advance_test.refresh('duplicate_ref',2);insert into employee_advance_test.results values('duplicate_ref','retry',employee_advance_test.confirm('duplicate_ref',2,'synthetic-confirm-B5',2),pg_backend_pid());" >/dev/null
assert_sql "employee_advance_test.paid_count('duplicate_ref')=1 and (select (result->>'duplicate_transaction')::boolean from employee_advance_test.results where case_name='duplicate_ref' and side='retry')" 'reference duplicate remains excluded after refresh'
ok 'same bank reference cannot add a second payment'

prepare new_then_legacy 100 false null
act "select employee_advance_test.make_legacy('new_then_legacy',1);" >/dev/null
race new_then_legacy "$(record new_then_legacy A "employee_advance_test.confirm('new_then_legacy',1,'synthetic-confirm-A6')")" "$(record new_then_legacy B "employee_advance_test.attach_legacy('new_then_legacy',1)")" '23505:.*duplicate key.*(financial_employee_payroll_slip_message_unique|financial_employee_payroll_slip_sha_unique|financial_payroll_slip_message_unique_v2|financial_payroll_slip_sha_unique_v2|financial_payroll_bank_reference_unique_v2)|payroll_slip_already_used'
assert_sql "employee_advance_test.paid_count('new_then_legacy')=1" 'legacy same-evidence attach cannot duplicate new payroll'
ok 'new confirmation versus legacy attach keeps one payment'

prepare legacy_then_new 100 false null
act "select employee_advance_test.make_legacy('legacy_then_new',1);" >/dev/null
race legacy_then_new "$(record legacy_then_new A "employee_advance_test.attach_legacy('legacy_then_new',1)")" "$(record legacy_then_new B "employee_advance_test.confirm('legacy_then_new',1,'synthetic-confirm-B7')")"
assert_sql "employee_advance_test.paid_count('legacy_then_new')=1 and (select (result->>'changed')::boolean from employee_advance_test.results where case_name='legacy_then_new' and side='B')" 'legacy writer forces balance refresh'
act "select employee_advance_test.refresh('legacy_then_new',1);insert into employee_advance_test.results values('legacy_then_new','retry',employee_advance_test.confirm('legacy_then_new',1,'synthetic-confirm-B8',2),pg_backend_pid());" >/dev/null
assert_sql "(select (result->>'duplicate_transaction')::boolean from employee_advance_test.results where case_name='legacy_then_new' and side='retry')" 'legacy evidence recognized after fresh review'
ok 'legacy attach versus new confirmation also keeps one payment'

prepare payroll_then_expense 100,100 true 2
race payroll_then_expense "$(record payroll_then_expense A "employee_advance_test.confirm('payroll_then_expense',1,'synthetic-confirm-A9')")" "$(record payroll_then_expense B "employee_advance_test.expense('payroll_then_expense',2)")" 'evidence_already_counted_as_payroll'
assert_sql "employee_advance_test.paid_count('payroll_then_expense')=1 and not exists(select 1 from public.financial_owner_expense_intakes i join employee_advance_test.cases c on i.owner_group_hash=c.group_hash where c.case_name='payroll_then_expense' and i.status in ('categorized','needs_review'))" 'no payroll plus expense double count'
ok 'payroll-first blocks concurrent generic expense allocation'

prepare expense_then_payroll 100,100 true 2
race expense_then_payroll "$(record expense_then_payroll A "employee_advance_test.expense('expense_then_payroll',2)")" "$(record expense_then_payroll B "employee_advance_test.confirm('expense_then_payroll',1,'synthetic-confirm-B10')")" 'evidence_already_counted_as_expense'
assert_sql "employee_advance_test.paid_count('expense_then_payroll')=0" 'preexisting expense blocks payroll'
ok 'expense-first blocks concurrent payroll allocation'

prepare payroll_then_investment 100 false null
race payroll_then_investment "$(record payroll_then_investment A "employee_advance_test.confirm('payroll_then_investment',1,'synthetic-confirm-A11')")" "$(record payroll_then_investment B "employee_advance_test.investment('payroll_then_investment',1)")" 'evidence_already_counted_as_payroll'
assert_sql "employee_advance_test.paid_count('payroll_then_investment')=1 and not exists(select 1 from public.financial_investment_entries i join employee_advance_test.cases c on i.owner_group_hash=c.group_hash where c.case_name='payroll_then_investment' and i.status='recorded')" 'investment and its audit transaction roll back'
ok 'payroll-first blocks concurrent investment from another representation channel'

prepare investment_then_payroll 100 false null
race investment_then_payroll "$(record investment_then_payroll A "employee_advance_test.investment('investment_then_payroll',1)")" "$(record investment_then_payroll B "employee_advance_test.confirm('investment_then_payroll',1,'synthetic-confirm-B12')")" 'evidence_already_counted_as_investment'
assert_sql "employee_advance_test.paid_count('investment_then_payroll')=0" 'investment-first prevents payroll copy'
ok 'investment-first also blocks concurrent payroll'

prepare independent_A 100 false null
prepare independent_B 100 false null
race independent_groups "$(record independent_groups A "employee_advance_test.confirm('independent_A',1,'synthetic-confirm-A13')")" "$(record independent_groups B "employee_advance_test.confirm('independent_B',1,'synthetic-confirm-B13')")" '' independent
assert_sql "employee_advance_test.paid_count('independent_A')=1 and employee_advance_test.paid_count('independent_B')=1" 'independent groups can both commit'
ok 'separate owner groups do not share a global transaction lock'

prepare stale_profile 100 false null
race stale_profile "update public.financial_owner_employee_profiles set business_unit_code='tamma_restaurant',revision=revision+1,updated_at=now() where owner_group_hash=(select group_hash from employee_advance_test.cases where case_name='stale_profile');insert into employee_advance_test.results(case_name,side,result) values('stale_profile','A','{\"profile_updated\":true}'::jsonb);" "$(record stale_profile B "employee_advance_test.confirm('stale_profile',1,'synthetic-stale-profile-confirm')")"
assert_sql "employee_advance_test.paid_count('stale_profile')=0 and (select (result->>'changed')::boolean from employee_advance_test.results where case_name='stale_profile' and side='B') and not exists(select 1 from public.financial_employee_advance_audit_events a join employee_advance_test.cases c on c.group_hash=a.owner_group_hash where c.case_name='stale_profile' and a.action='confirmed')" 'concurrent affiliation change refreshes card with zero payroll/audit writes'
ok 'concurrent profile change blocks stale employee approval'

prepare stale_revision 100 false null
race stale_revision "$(record stale_revision A "employee_advance_test.refresh('stale_revision',1)")" "$(record stale_revision B "employee_advance_test.confirm('stale_revision',1,'synthetic-stale-revision-confirm')")"
assert_sql "employee_advance_test.paid_count('stale_revision')=0 and (select (result->>'conflict')::boolean from employee_advance_test.results where case_name='stale_revision' and side='B') and (select i.review_revision from public.financial_owner_expense_intakes i join employee_advance_test.slips s on s.intake_id=i.id where s.case_name='stale_revision')=2" 'concurrent review revision supersedes old confirmation without financial write'
ok 'concurrent draft revision invalidates the old card'

# Exact approved-note inference is also a concurrent decision. The two extra
# employees are pre-existing synthetic fixture rows, never created by a handler.
db -c "select employee_advance_test.prepare_alias('alias_removed');" >/dev/null
race alias_removed "update public.financial_owner_employee_profiles set salary_advance_aliases='{}' where owner_group_hash=(select group_hash from employee_advance_test.cases where case_name='alias_removed');" "$(record alias_removed B "employee_advance_test.confirm('alias_removed',1,'synthetic-alias-confirm-1')")"
assert_sql "employee_advance_test.paid_count('alias_removed')=0 and (select (result->>'alias_invalid')::boolean from employee_advance_test.results where case_name='alias_removed' and side='B')" 'removed alias invalidates salary inference'
ok 'concurrent alias removal produces no payment'

db -c "select employee_advance_test.prepare_alias('alias_inserted');" >/dev/null
race alias_inserted "select employee_advance_test.add_alias_profile('alias_inserted','10000000-0000-4000-8000-000000000005');" "$(record alias_inserted B "employee_advance_test.confirm('alias_inserted',1,'synthetic-alias-confirm-2')")"
assert_sql "employee_advance_test.paid_count('alias_inserted')=0 and (select (result->>'alias_invalid')::boolean from employee_advance_test.results where case_name='alias_inserted' and side='B')" 'new matching profile makes inference ambiguous'
ok 'concurrent duplicate alias insertion invalidates inference'

db -c "select employee_advance_test.prepare_alias('alias_confirm_then_edit');" >/dev/null
race alias_confirm_then_edit "$(record alias_confirm_then_edit A "employee_advance_test.confirm('alias_confirm_then_edit',1,'synthetic-alias-confirm-3')")" "update public.financial_owner_employee_profiles set salary_advance_aliases='{}' where owner_group_hash=(select group_hash from employee_advance_test.cases where case_name='alias_confirm_then_edit');"
assert_sql "employee_advance_test.paid_count('alias_confirm_then_edit')=1 and (select salary_advance_aliases='{}'::text[] from public.financial_owner_employee_profiles p join employee_advance_test.cases c on p.owner_group_hash=c.group_hash where c.case_name='alias_confirm_then_edit')" 'profile edit waits until the unique approval commits'
ok 'confirmation-first serializes a profile edit without deadlock'

db -c "select employee_advance_test.prepare_alias('alias_confirm_then_insert');" >/dev/null
race alias_confirm_then_insert "$(record alias_confirm_then_insert A "employee_advance_test.confirm('alias_confirm_then_insert',1,'synthetic-alias-confirm-4')")" "select employee_advance_test.add_alias_profile('alias_confirm_then_insert','10000000-0000-4000-8000-000000000005');" 'P0001: employee_profile_busy' rejected
assert_sql "employee_advance_test.paid_count('alias_confirm_then_insert')=1 and (select count(*) from public.financial_owner_employee_profiles p join employee_advance_test.cases c on p.owner_group_hash=c.group_hash where c.case_name='alias_confirm_then_insert')=1" 'new matching profile cannot appear during inference commit'
ok 'confirmation-first refuses a phantom matching profile'

db -c "select employee_advance_test.prepare_alias('alias_reactivated',true);" >/dev/null
race alias_reactivated "update tamma_chart_os.employees set status='ทำงานอยู่' where id='10000000-0000-4000-8000-000000000004';" "$(record alias_reactivated B "employee_advance_test.confirm('alias_reactivated',1,'synthetic-alias-confirm-5')")"
assert_sql "employee_advance_test.paid_count('alias_reactivated')=0 and (select (result->>'alias_invalid')::boolean from employee_advance_test.results where case_name='alias_reactivated' and side='B')" 'reactivated matching employee invalidates uniqueness'
ok 'concurrent employee reactivation invalidates an ambiguous alias'

# Reset only the synthetic fixture employee between two independent race cases.
db -c "update tamma_chart_os.employees set status='พ้นสภาพ' where id='10000000-0000-4000-8000-000000000004';select employee_advance_test.prepare_alias('alias_confirm_then_reactivate',true);" >/dev/null
race alias_confirm_then_reactivate "$(record alias_confirm_then_reactivate A "employee_advance_test.confirm('alias_confirm_then_reactivate',1,'synthetic-alias-confirm-6')")" "update tamma_chart_os.employees set status='ทำงานอยู่' where id='10000000-0000-4000-8000-000000000004';$(record alias_confirm_then_reactivate B "jsonb_build_object('employee_reactivated',true)")"
assert_sql "employee_advance_test.paid_count('alias_confirm_then_reactivate')=1 and (select public.owner_employee_advance_context_v1(group_hash,'Workerเบิก',null,'2026-10-09')->'alias_resolution'='null'::jsonb from employee_advance_test.cases where case_name='alias_confirm_then_reactivate')" 'reactivation waits until the unique approval commits; future alias resolution is ambiguous'
ok 'confirmation-first locks inactive matching employee until commit'

# Actual-source backoffice import, exact cached retry, complete failure rollback,
# and audited compensation are checked on the same PostgreSQL 17 schema.
db -c "select employee_advance_test.prepare('actual_import',ARRAY[120,130,140]::numeric[],false,null,false);" >/dev/null
act "insert into employee_advance_test.results(case_name,side,result) select 'actual_import','first',employee_advance_test.import_batch('actual_import');insert into employee_advance_test.results(case_name,side,result) select 'actual_import','retry',employee_advance_test.import_batch('actual_import');" >/dev/null
assert_sql "employee_advance_test.paid_count('actual_import')=3 and employee_advance_test.paid_sum('actual_import')=390 and not exists(select 1 from employee_advance_test.results r,jsonb_array_elements(r.result->'results') x where r.case_name='actual_import' and r.side='retry' and (x->>'duplicate')::boolean is distinct from true)" 'three-slip actual-schema import retries without an extra event'
assert_sql "(select count(*) from public.financial_employee_payroll_events p join employee_advance_test.cases c on c.group_hash=p.owner_group_hash where c.case_name='actual_import' and p.funding_source='business_account')=2 and (select count(*) from public.financial_employee_payroll_events p join employee_advance_test.cases c on c.group_hash=p.owner_group_hash where c.case_name='actual_import' and p.funding_source='unknown')=1" 'two business funding rows and one unknown stay truthful'
ok 'actual-schema backoffice three-slip import and identical request retry'

db -c "select employee_advance_test.prepare('actual_import_rollback',ARRAY[120,130,140]::numeric[],false,null,false);" >/dev/null
if act "select employee_advance_test.import_batch('actual_import_rollback',true);" > evidence/concurrency/actual-import-rollback.log 2>&1; then echo 'Stale import unexpectedly succeeded' >&2; exit 1; fi
grep -q 'source_intake_changed' evidence/concurrency/actual-import-rollback.log
assert_sql "employee_advance_test.paid_count('actual_import_rollback')=0 and not exists(select 1 from public.financial_owner_employee_profiles p join employee_advance_test.cases c on c.group_hash=p.owner_group_hash where c.case_name='actual_import_rollback') and not exists(select 1 from public.financial_employee_advance_audit_events a join employee_advance_test.cases c on c.group_hash=a.owner_group_hash where c.case_name='actual_import_rollback') and not exists(select 1 from public.financial_owner_expense_intakes i join employee_advance_test.cases c on c.group_hash=i.owner_group_hash where c.case_name='actual_import_rollback' and (i.payroll_event_id is not null or i.review_revision<>0 or i.review_state<>'draft' or i.amount is not null))" 'stale last import row rolls back both earlier payments, profile, audits and source updates'
ok 'actual-schema stale batch rolls back every earlier row'

act "insert into employee_advance_test.results(case_name,side,result) select 'actual_import','reversal',employee_advance_test.revert_first_import('actual_import');" >/dev/null
assert_sql "employee_advance_test.paid_count('actual_import')=2 and employee_advance_test.paid_sum('actual_import')=270 and (select count(*) from public.financial_employee_payroll_events p join employee_advance_test.cases c on c.group_hash=p.owner_group_hash where c.case_name='actual_import')=3 and (select count(*) from public.financial_employee_advance_audit_events a join employee_advance_test.cases c on c.group_hash=a.owner_group_hash where c.case_name='actual_import' and a.action='reverted')=1 and (select result->>'payment_cancelled'='false' from employee_advance_test.results where case_name='actual_import' and side='reversal')" 'compensation retains history and does not claim bank payment cancellation'
ok 'actual-schema compensation is audited and evidence-preserving'

# Check the complete persisted representation, not just RPC return values.
assert_sql "not exists(select 1 from public.financial_employee_payroll_events p left join public.financial_owner_expense_intakes i on i.id=p.source_intake_id where p.employee_id is not null and p.status='paid' and (i.payroll_event_id is distinct from p.id or i.status<>'cancelled' or i.review_state<>'confirmed' or i.amount is not null or i.storage_bucket<>'owner-expense-evidence' or i.review_data->>'payment_cancelled'<>'false'))" 'all successful new payroll keeps original evidence and excludes the expense representation'
assert_sql "(select count(*) from public.financial_employee_advance_audit_events where action in ('confirmed','imported'))=(select count(*) from public.financial_employee_payroll_events where employee_id is not null)" 'exactly one confirmation audit per new paid event and none from failed transactions'
assert_sql "not exists(select 1 from public.financial_employee_payroll_events p where employee_id is not null and not exists(select 1 from public.financial_employee_advance_audit_events a where a.event_id=p.id and a.action in ('confirmed','imported') and a.before_data->'intake'->>'id'=p.source_intake_id::text and a.after_data->'event'->>'id'=p.id::text))" 'every new paid event has source-before and event-after audit provenance'
assert_sql "not exists(select 1 from public.financial_employee_payroll_events where employee_id is not null and source_channel='line' and funding_source<>'unknown')" 'unknown funding is never converted to personal funding'
assert_sql "not exists(select 1 from public.financial_investment_entry_audit_events a join public.financial_investment_entries i on i.id=a.entry_id join employee_advance_test.cases c on c.group_hash=i.owner_group_hash where c.case_name='payroll_then_investment')" 'failed investment has no leftover ledger audit'
assert_sql "(select count(*) from tamma_chart_os.employees)=3" 'no race creates another employee'
db -c "select jsonb_build_object('server_version',current_setting('server_version'),'race_cases',18,'all_cases',$PASS,'distinct_observed_sessions',(select count(distinct pid) from employee_advance_test.results),'paid_event_count',(select count(*) from public.financial_employee_payroll_events where status='paid'),'synthetic_only',true);" > evidence/concurrency/summary.json
printf '1..%s\n' "$PASS"
echo 'No production connection, data, secrets, or external notification services were used.'
