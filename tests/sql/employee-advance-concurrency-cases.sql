-- Synthetic cases only. Run after the exact-source fixture and proposed SQL.
-- This schema is test instrumentation, not an application migration.
DO $$ BEGIN
 IF current_database()<>'employee_advance_test' THEN RAISE EXCEPTION 'disposable_test_database_required'; END IF;
 IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN RAISE EXCEPTION 'postgres_17_required'; END IF;
 IF EXISTS(SELECT 1 FROM public.financial_employee_payroll_events)
  OR EXISTS(SELECT 1 FROM public.financial_owner_expense_intakes)
  THEN RAISE EXCEPTION 'empty_synthetic_financial_database_required'; END IF;
END $$;
CREATE SCHEMA employee_advance_test;
CREATE TABLE employee_advance_test.cases(case_name text PRIMARY KEY,group_hash text UNIQUE NOT NULL);
CREATE TABLE employee_advance_test.slips(case_name text REFERENCES employee_advance_test.cases,slot int,intake_id uuid,legacy_event_id uuid,PRIMARY KEY(case_name,slot));
CREATE TABLE employee_advance_test.results(case_name text,side text,result jsonb,pid int NOT NULL DEFAULT pg_backend_pid(),PRIMARY KEY(case_name,side));
CREATE FUNCTION employee_advance_test.assert(p_ok boolean,p_message text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF p_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'assertion_failed: %',p_message; END IF; END$$;
CREATE FUNCTION employee_advance_test.prepare(p_case text,p_amounts numeric[],p_same_ref boolean DEFAULT false,p_generic_slot int DEFAULT null,p_stage boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE g text:='synthetic-ci-'||md5(p_case); actor text:=repeat('a',64); i int; msg text; ref text; sha text; ex jsonb; r jsonb; v_id uuid; d jsonb;
BEGIN
 INSERT INTO employee_advance_test.cases VALUES(p_case,g);
 IF p_stage THEN
 INSERT INTO public.financial_owner_employee_profiles(owner_group_hash,employee_id,employee_key,business_unit_code,role_label,salary_period,approval_ref)
 VALUES(g,'10000000-0000-4000-8000-000000000001','worker','shared_infrastructure','Synthetic groundskeeper','monthly','synthetic-profile-'||p_case);
 END IF;
 FOR i IN 1..array_length(p_amounts,1) LOOP
  msg:='synthetic-ci-'||p_case||'-'||i;sha:=md5(msg)||md5(msg||'-image');ref:='SYNTHETIC-BANK-'||p_case||'-'||CASE WHEN p_same_ref THEN 1 ELSE i END;
  ex:=jsonb_build_object('document_type','transfer_slip','document_kind','transfer_evidence','funds_direction','outgoing','payment_document_count',1,
   'amount_total',p_amounts[i],'document_date_local','2026-10-09','confidence',0.99,'reference_number',ref,'merchant','Synthetic employee');
  -- Historical capture is intentional for duplicate-reference scenarios. No
  -- real evidence is uploaded; fake paths and hashes are fixture inputs only.
  r:=public.financial_capture_owner_expense_slip_v1(g,msg,actor,'2026-10-09',sha,'owner-expense-evidence','synthetic/'||msg||'.jpg','image/jpeg',ex);
  v_id:=(r->>'intake_id')::uuid;
  UPDATE public.financial_owner_expense_intakes SET review_state='draft',amount=null WHERE financial_owner_expense_intakes.id=v_id;
  INSERT INTO employee_advance_test.slips(case_name,slot,intake_id) VALUES(p_case,i,v_id);
  IF NOT p_stage THEN CONTINUE; END IF;
  IF i=p_generic_slot THEN
   d:=jsonb_build_object('purpose','Synthetic supplies','expense_class','operating_expense','expense_category','consumables','expense_subcategory',null,
    'business_unit_code','shared_infrastructure','amount',p_amounts[i],'occurred_on','2026-10-09','questions','[]'::jsonb,'project_id',null,'task_id',null,'installment_id',null);
   r:=public.financial_stage_owner_slip_review_v1(v_id,g,actor,'synthetic-stage-'||msg,0,d);
  ELSE
   d:=jsonb_build_object('kind','employee_advance','event_type','salary_advance','employee_query','Worker',
    'employee_id','10000000-0000-4000-8000-000000000001','business_unit_code','shared_infrastructure','funding_source','unknown',
    'amount',p_amounts[i],'occurred_on','2026-10-09','purpose','Synthetic salary advance','questions','[]'::jsonb);
   r:=public.financial_stage_owner_employee_advance_v1(v_id,g,actor,'synthetic-stage-'||msg,0,d);
  END IF;
  PERFORM employee_advance_test.assert((r->>'ok')::boolean,'synthetic stage must succeed');
 END LOOP;
END $$;
CREATE FUNCTION employee_advance_test.confirm(p_case text,p_slot int,p_message text,p_revision int DEFAULT 1)
RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.financial_confirm_owner_employee_advance_v1(s.intake_id,c.group_hash,repeat('a',64),p_revision,p_message)
 FROM employee_advance_test.slips s JOIN employee_advance_test.cases c USING(case_name) WHERE s.case_name=p_case AND s.slot=p_slot;
$$;
CREATE FUNCTION employee_advance_test.refresh(p_case text,p_slot int)
RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.financial_stage_owner_employee_advance_v1(i.id,c.group_hash,repeat('a',64),'synthetic-refresh-'||p_case||'-'||p_slot,i.review_revision,i.review_data)
 FROM employee_advance_test.slips s JOIN employee_advance_test.cases c USING(case_name) JOIN public.financial_owner_expense_intakes i ON i.id=s.intake_id
 WHERE s.case_name=p_case AND s.slot=p_slot;
$$;
CREATE FUNCTION employee_advance_test.expense(p_case text,p_slot int)
RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.financial_confirm_owner_slip_review_v1(s.intake_id,c.group_hash,repeat('a',64),1,'synthetic-expense-confirm-'||p_case,false)
 FROM employee_advance_test.slips s JOIN employee_advance_test.cases c USING(case_name) WHERE s.case_name=p_case AND s.slot=p_slot;
$$;
CREATE FUNCTION employee_advance_test.investment(p_case text,p_slot int)
RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.financial_record_investment_v1('2026-10-09','shared_infrastructure','Synthetic equipment','equipment',100,'transfer',null,'Synthetic CI only',
  'backoffice',c.group_hash,i.evidence_message_id,repeat('a',64))
 FROM employee_advance_test.slips s JOIN employee_advance_test.cases c USING(case_name) JOIN public.financial_owner_expense_intakes i ON i.id=s.intake_id
 WHERE s.case_name=p_case AND s.slot=p_slot;
$$;
CREATE FUNCTION employee_advance_test.make_legacy(p_case text,p_slot int)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r jsonb; g text; amt numeric;
BEGIN
 SELECT c.group_hash,(i.extraction_data->>'amount_total')::numeric INTO g,amt
 FROM employee_advance_test.slips s JOIN employee_advance_test.cases c USING(case_name) JOIN public.financial_owner_expense_intakes i ON i.id=s.intake_id
 WHERE s.case_name=p_case AND s.slot=p_slot;
 r:=public.financial_create_owner_payroll_event_v1('salary_advance','Worker',amt,'2026-10-09',null,g,repeat('a',64),'synthetic-legacy-'||p_case);
 UPDATE employee_advance_test.slips SET legacy_event_id=(r->>'event_id')::uuid WHERE case_name=p_case AND slot=p_slot;
END$$;
CREATE FUNCTION employee_advance_test.attach_legacy(p_case text,p_slot int)
RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.financial_attach_owner_payroll_slip_v1(s.legacy_event_id,i.evidence_message_id,i.evidence_sha256,'owner-payroll-evidence',
  'synthetic/legacy-'||p_case||'.jpg','image/jpeg','transfer_slip',(i.extraction_data->>'amount_total')::numeric,0.99,i.extraction_data)
 FROM employee_advance_test.slips s JOIN public.financial_owner_expense_intakes i ON i.id=s.intake_id WHERE s.case_name=p_case AND s.slot=p_slot;
$$;
CREATE FUNCTION employee_advance_test.paid_count(p_case text) RETURNS bigint LANGUAGE sql AS $$
 SELECT count(*) FROM public.financial_employee_payroll_events p JOIN employee_advance_test.cases c ON p.owner_group_hash=c.group_hash
 WHERE c.case_name=p_case AND p.event_type='salary_advance' AND p.status='paid';
$$;
CREATE FUNCTION employee_advance_test.paid_sum(p_case text) RETURNS numeric LANGUAGE sql AS $$
 SELECT coalesce(sum(p.amount),0) FROM public.financial_employee_payroll_events p JOIN employee_advance_test.cases c ON p.owner_group_hash=c.group_hash
 WHERE c.case_name=p_case AND p.event_type='salary_advance' AND p.status='paid';
$$;
REVOKE ALL ON SCHEMA employee_advance_test FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA employee_advance_test TO service_role;
GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA employee_advance_test TO service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA employee_advance_test FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA employee_advance_test TO service_role;

CREATE TABLE employee_advance_test.import_requests(case_name text PRIMARY KEY,rows jsonb NOT NULL);
CREATE FUNCTION employee_advance_test.import_batch(p_case text,p_stale boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE g text; payload jsonb;
BEGIN
 SELECT group_hash INTO g FROM employee_advance_test.cases WHERE case_name=p_case;
 SELECT rows INTO payload FROM employee_advance_test.import_requests WHERE case_name=p_case;
 IF payload IS NULL THEN
  SELECT jsonb_agg(jsonb_build_object('intake_id',i.id,'employee_id',e.id,'employee_key','worker',
   'expected_restaurant_id',e.restaurant_id,'expected_employee_full_name',e.full_name,'expected_salary',e.wage_amount,
   'expected_employee_updated_at',e.updated_at,'business_unit_code','shared_infrastructure','role_label','Synthetic groundskeeper','salary_period','monthly',
   'expected_reference',i.reference_number,'expected_evidence_message_id',i.evidence_message_id,'expected_evidence_sha256',i.evidence_sha256,
   'expected_review_revision',i.review_revision,'expected_updated_at',CASE WHEN p_stale AND i.id=(SELECT max(intake_id::text)::uuid FROM employee_advance_test.slips WHERE case_name=p_case) THEN '2000-01-01'::timestamptz ELSE i.updated_at END,
   'amount',(i.extraction_data->>'amount_total')::numeric,'occurred_on','2026-10-09',
   'funding_source',CASE WHEN s.slot=3 THEN 'unknown' ELSE 'business_account' END)) INTO payload
  FROM employee_advance_test.slips s JOIN public.financial_owner_expense_intakes i ON i.id=s.intake_id
  CROSS JOIN tamma_chart_os.employees e WHERE s.case_name=p_case AND e.id='10000000-0000-4000-8000-000000000001';
  INSERT INTO employee_advance_test.import_requests VALUES(p_case,payload);
 END IF;
 RETURN public.financial_import_owner_employee_advances_v1(g,'synthetic-chat-approval-'||p_case,null,payload,
  (SELECT sum((x->>'amount')::numeric) FROM jsonb_array_elements(payload) x));
END$$;
CREATE FUNCTION employee_advance_test.revert_first_import(p_case text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE ev public.financial_employee_payroll_events%rowtype; rev int;
BEGIN
 SELECT p.* INTO ev FROM public.financial_employee_payroll_events p JOIN employee_advance_test.cases c ON c.group_hash=p.owner_group_hash
 WHERE c.case_name=p_case ORDER BY p.amount LIMIT 1;
 SELECT review_revision INTO rev FROM public.financial_owner_expense_intakes WHERE id=ev.source_intake_id;
 RETURN public.financial_revert_owner_employee_advance_v1(ev.id,ev.owner_group_hash,'synthetic-reversal-'||p_case,null,'Synthetic audited reversal',ev.updated_at,rev);
END$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA employee_advance_test FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA employee_advance_test TO service_role;
GRANT SELECT,INSERT,UPDATE ON employee_advance_test.import_requests TO service_role;

-- Additional synthetic existing employees for alias-uniqueness races. No
-- application path may create employees; the final count is the seeded baseline.
INSERT INTO tamma_chart_os.employees(id,restaurant_id,full_name,nickname,wage_amount,employment_type,status,created_at,updated_at)
VALUES('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000002','Synthetic Inactive','Idle',12000,'เงินเดือน','พ้นสภาพ','2026-09-01','2026-09-01'),
('10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000002','Synthetic Active','Second',12000,'เงินเดือน','ทำงานอยู่','2026-09-01','2026-09-01');
CREATE FUNCTION employee_advance_test.add_alias_profile(p_case text,p_employee uuid) RETURNS void LANGUAGE sql AS $$
 INSERT INTO public.financial_owner_employee_profiles(owner_group_hash,employee_id,employee_key,business_unit_code,role_label,approval_ref,salary_advance_aliases,salary_advance_alias_approval_ref)
 SELECT c.group_hash,e.id,lower(e.nickname),'shared_infrastructure','Synthetic alias role','synthetic-profile-'||p_case,ARRAY['Workerเบิก'],'synthetic-alias-'||p_case
 FROM employee_advance_test.cases c CROSS JOIN tamma_chart_os.employees e WHERE c.case_name=p_case AND e.id=p_employee;
$$;
CREATE FUNCTION employee_advance_test.prepare_alias(p_case text,p_inactive_match boolean DEFAULT false) RETURNS void LANGUAGE plpgsql AS $$
DECLARE g text; i public.financial_owner_expense_intakes%rowtype; c jsonb; r jsonb;
BEGIN
 PERFORM employee_advance_test.prepare(p_case,ARRAY[125]::numeric[],false,null,false);
 SELECT group_hash INTO g FROM employee_advance_test.cases WHERE case_name=p_case;
 PERFORM employee_advance_test.add_alias_profile(p_case,'10000000-0000-4000-8000-000000000001');
 IF p_inactive_match THEN PERFORM employee_advance_test.add_alias_profile(p_case,'10000000-0000-4000-8000-000000000004'); END IF;
 UPDATE public.financial_owner_expense_intakes SET review_data=jsonb_build_object('purpose','Workerเบิก'),
  extraction_data=extraction_data||jsonb_build_object('visible_payment_note','Workerเบิก')
 WHERE owner_group_hash=g;
 SELECT * INTO i FROM public.financial_owner_expense_intakes WHERE owner_group_hash=g;
 c:=public.owner_employee_advance_context_v1(g,'Workerเบิก',null,'2026-10-09');
 PERFORM employee_advance_test.assert(c->'alias_resolution' IS NOT NULL AND c->'alias_resolution'<>'null'::jsonb,'synthetic alias initially unique');
 r:=public.financial_stage_owner_employee_advance_v1(i.id,g,repeat('a',64),'synthetic-alias-stage-'||p_case,0,
  jsonb_build_object('kind','employee_advance','event_type','salary_advance','employee_query','Workerเบิก',
   'employee_id','10000000-0000-4000-8000-000000000001','business_unit_code','shared_infrastructure','funding_source','unknown',
   'amount',125,'occurred_on','2026-10-09','purpose','Synthetic salary advance','alias_inference',c->'alias_resolution'));
 PERFORM employee_advance_test.assert((r->>'ok')::boolean,'synthetic alias stage succeeds without money');
END$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA employee_advance_test FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA employee_advance_test TO service_role;
