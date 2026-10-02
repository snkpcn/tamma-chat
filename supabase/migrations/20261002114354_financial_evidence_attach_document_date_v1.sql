do $$
declare
  ddl text;
begin
  select pg_get_functiondef(
    'public.financial_attach_cafe_test_evidence_v1(text,text,date,text,text,text,text,jsonb)'::regprocedure
  ) into ddl;

  ddl:=replace(
    ddl,
    'v_received_date date;'||chr(10)||'  v_settlement_id uuid := null;',
    'v_received_date date;'||chr(10)||'  v_attach_date date;'||chr(10)||'  v_settlement_id uuid := null;'
  );

  ddl:=replace(
    ddl,
    'else v_received_date' || chr(10) || '  end;' || chr(10) || chr(10) ||
    '  insert into public.financial_daily_closes(',
    'else v_received_date' || chr(10) || '  end;' || chr(10) || chr(10) ||
    '  v_attach_date := case when v_confidence>=0.80 then v_effective_date else v_received_date end;' ||
    chr(10) || chr(10) ||
    '  insert into public.financial_daily_closes('
  );

  ddl:=replace(ddl,'values(v_branch_id,v_received_date,''test'',''draft'',''line'')',
                    'values(v_branch_id,v_attach_date,''test'',''draft'',''line'')');

  ddl:=replace(ddl,'and c.local_date=v_received_date',
                    'and c.local_date=v_attach_date');

  ddl:=replace(
    ddl,
    '''received_local_date'',v_received_date' || chr(10) || '  );',
    '''received_local_date'',v_received_date,' || chr(10) ||
    '    ''attached_local_date'',v_attach_date' || chr(10) || '  );'
  );

  execute ddl;
end;
$$;
