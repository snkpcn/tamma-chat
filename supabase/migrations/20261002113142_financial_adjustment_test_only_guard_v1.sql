do $$
declare
  ddl text;
begin
  select pg_get_functiondef(
    'public.financial_add_daily_close_adjustment_batch_v1(uuid,jsonb,text,text,text)'::regprocedure
  ) into ddl;

  ddl:=replace(ddl,'v_status text;','v_status text;'||chr(10)||'  v_environment text;');
  ddl:=replace(
    ddl,
    'select status into v_status',
    'select status,environment into v_status,v_environment'
  );
  ddl:=replace(
    ddl,
    'if v_status is null then raise exception ''daily_close_not_found''; end if;',
    'if v_status is null then raise exception ''daily_close_not_found''; end if;'||chr(10)||
    '  if v_environment<>''test'' then raise exception ''adjustment_test_only''; end if;'
  );

  execute ddl;
end;
$$;
