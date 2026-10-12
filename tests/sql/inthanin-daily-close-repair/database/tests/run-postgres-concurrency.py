#!/usr/bin/env python3
"""Real PostgreSQL concurrency tests. Python stdlib + existing psql; no installers.

REFUSES nonlocal hosts, generic database names, and nonempty public schemas.
Requires explicit --allow-local-fixture-writes. Never use a production database.
The setup creates synthetic fixture relations and actual saved/proposed functions.
Two mutation sessions plus a read-only observer verify actual pg_blocking_pids.
"""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid

HERE = Path(__file__).resolve().parent
A, B, C = [f'00000000-0000-0000-0000-{n:012}' for n in [1, 2, 3]]
BRANCH = '00000000-0000-0000-0000-000000000100'
E, E2, L, L2, CLAIM = [f'00000000-0000-0000-0000-{n:012}' for n in [200, 201, 300, 301, 400]]
ACTOR = 'a' * 64


def fixture():
    saved = HERE / '../../deployment-preflight'
    files = [HERE/'fixture-schema.sql', HERE/'../guard-repair.sql',
             saved/'financial_daily_closes_touch_updated_at.sql',
             saved/'financial_daily_adjustment_guard.sql',
             saved/'financial_reconcile_daily_close_v1.sql',
             saved/'financial_confirm_inthanin_live_daily_close_v1.sql',
             saved/'remote-wrapper.sql', HERE/'fixture-triggers.sql']
    chunks, manifest = [], []
    for path in files:
        source = path.read_text()
        manifest.append({'path': os.path.relpath(path.resolve(), HERE),
                         'sha256': hashlib.sha256(source.encode()).hexdigest()})
        # Do not create/change roles. The behavior suite is owner-run, not an ACL test.
        sql = re.sub(r'^(?:revoke|grant)\s[^\n]*;\s*$', '', source, flags=re.M|re.I) if path.name == 'remote-wrapper.sql' else source
        chunks.append(sql.strip()+'\n;\n')
    return '\n'.join(chunks), manifest


class Session:
    def __init__(self, command):
        self.proc = subprocess.Popen(command+['-v','ON_ERROR_STOP=0'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1)
        self.lines = queue.Queue()
        def read():
            for line in self.proc.stdout:
                self.lines.put(line.rstrip('\n'))
            self.lines.put(None)
        threading.Thread(target=read, daemon=True).start()
        self.lock = threading.Lock()
        self.pid = int(self.scalar('select pg_backend_pid()'))
        self.ok("set statement_timeout='15s'")
        self.ok("set lock_timeout='12s'")

    def execute(self, sql, timeout=20):
        with self.lock:
            marker='__GUARD_TEST_END_'+uuid.uuid4().hex+'__'
            self.proc.stdin.write(sql.rstrip().rstrip(';')+';\n\\echo '+marker+' :SQLSTATE\n')
            self.proc.stdin.flush()
            output=[]
            deadline=time.monotonic()+timeout
            while True:
                try:
                    line=self.lines.get(timeout=max(0.01,deadline-time.monotonic()))
                except queue.Empty:
                    raise RuntimeError(f'psql response timed out: {sql}')
                if line is None:
                    raise RuntimeError('psql exited before response: '+'\n'.join(output))
                if line.startswith(marker):
                    state=line[len(marker):].strip()
                    return {'sqlstate':state,'lines':output,'text':'\n'.join(output)}
                output.append(line)

    def ok(self, sql):
        result=self.execute(sql)
        if result['sqlstate']!='00000':
            raise AssertionError(f"SQL failed ({result['sqlstate']}): {sql}\n{result['text']}")
        return result

    def scalar(self, sql):
        lines=[line for line in self.ok(sql)['lines'] if line and not line.startswith('NOTICE:')]
        if len(lines)!=1:
            raise AssertionError(f'Expected one scalar row: {lines!r}; SQL: {sql}')
        return lines[0]

    def json(self, sql):
        return json.loads(self.scalar(sql))

    def close(self):
        if self.proc.poll() is None:
            try:
                self.proc.stdin.write('rollback;\n\\q\n'); self.proc.stdin.flush()
                self.proc.wait(timeout=2)
            except Exception:
                self.proc.terminate()
                self.proc.wait(timeout=2)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host',required=True,help='127.0.0.1, localhost, ::1, or local Unix socket directory')
    parser.add_argument('--port',type=int,default=5432)
    parser.add_argument('--database',required=True,help='Existing empty disposable database named guard_revision_test_*')
    parser.add_argument('--user')
    parser.add_argument('--psql',default='psql')
    parser.add_argument('--allow-local-fixture-writes',action='store_true')
    args=parser.parse_args()
    if not args.allow_local_fixture_writes:
        parser.error('Pass --allow-local-fixture-writes only for an authorized disposable local database.')
    if args.host not in ('127.0.0.1','localhost','::1') and not (os.path.isabs(args.host) and os.path.isdir(args.host)):
        parser.error('Only loopback hosts or an existing local Unix socket directory are accepted.')
    if not re.fullmatch(r'guard_revision_test_[A-Za-z0-9_]+',args.database):
        parser.error('Database must be named guard_revision_test_ followed by letters, numbers or underscores.')
    psql=shutil.which(args.psql)
    if not psql:
        parser.error('psql is unavailable. No install was attempted. Use an authorized computer with PostgreSQL installed.')
    command=[psql,'-X','-q','-A','-t','-w','-P','pager=off','-h',args.host,'-p',str(args.port),'-d',args.database]
    if args.user: command += ['-U',args.user]
    probe=subprocess.run(command+['-v','ON_ERROR_STOP=1','-c',
        "select (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public') + (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')"],
        capture_output=True,text=True,timeout=15)
    if probe.returncode or probe.stdout.strip()!='0':
        raise SystemExit('Refusing setup: database is unreachable or public schema is not empty. '+probe.stderr)
    sql,manifest=fixture()
    setup=subprocess.run(command+['-v','ON_ERROR_STOP=1'],input=sql,capture_output=True,text=True,timeout=30)
    if setup.returncode:
        raise SystemExit('Fixture setup failed in disposable database:\n'+setup.stderr)
    observer=Session(command)
    results=[]
    evidence=[]

    def rev(id=A):
        return int(observer.scalar(f"select revision from financial_daily_closes where id='{id}'"))

    def reset():
        observer.ok('truncate financial_daily_close_adjustments, financial_daily_close_evidence, financial_daily_ledger_entries, financial_expense_claims, financial_daily_closes, operations_business_branches cascade')
        observer.ok(f"insert into operations_business_branches(id,code) values('{BRANCH}','inthanin_tadtone')")
        observer.ok(f"insert into financial_daily_closes(id,branch_id,local_date) values('{A}','{BRANCH}','2026-10-10'),('{B}','{BRANCH}','2026-10-11'),('{C}','{BRANCH}','2026-10-12')")
        observer.ok(f"insert into financial_daily_close_evidence(id,daily_close_id) values('{E}','{A}'),('{E2}','{B}')")
        observer.ok(f"insert into financial_daily_ledger_entries(id,daily_close_id) values('{L}','{A}'),('{L2}','{B}')")
        observer.ok(f"insert into financial_expense_claims(id,origin_daily_close_id,approval_status,approved_amount) values('{CLAIM}','{A}','approved',10)")

    def card_sql(expected,id=A,date='2026-10-10'):
        return f"select financial_confirm_inthanin_daily_close_card_v1('{id}','{date}',{expected},'{ACTOR}')"

    def blocked(waiter,blocker):
        deadline=time.monotonic()+8
        while time.monotonic()<deadline:
            row=observer.json(f"select json_build_object('pid',pid,'wait_event_type',wait_event_type,'wait_event',wait_event,'blockers',pg_blocking_pids(pid)) from pg_stat_activity where pid={waiter.pid}")
            if row['wait_event_type']=='Lock' and blocker.pid in row['blockers']:
                evidence.append(row)
                return
            if waiter.proc.poll() is not None:
                raise AssertionError('Waiting session exited before a database lock wait was observed.')
            time.sleep(.025)
        raise AssertionError(f'No actual PostgreSQL lock wait observed for waiter {waiter.pid} blocked by {blocker.pid}')

    def race(name,fn):
        x=y=None
        start=len(evidence)
        try:
            reset(); x=Session(command); y=Session(command)
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                fn(x,y,pool)
            results.append({'name':name,'status':'passed','observedLocks':evidence[start:]})
            print('PASS '+name,flush=True)
        except Exception as error:
            results.append({'name':name,'status':'failed','error':str(error),'observedLocks':evidence[start:]})
            print('FAIL '+name+': '+str(error),flush=True)
        finally:
            if x: x.close()
            if y: y.close()

    mutations={
      'ledger':f"update financial_daily_ledger_entries set amount=11 where id='{L}'",
      'evidence':f"update financial_daily_close_evidence set metadata='{{\"changed\":true}}' where id='{E}'",
      'claim':f"update financial_expense_claims set claimed_amount=11 where id='{CLAIM}'",
      'parent':f"update financial_daily_closes set cup_count=11 where id='{A}'",
    }
    for kind,mutation in mutations.items():
        def edit_first(x,y,pool,mutation=mutation):
            shown=rev(); x.ok('begin'); x.ok(mutation)
            pending=pool.submit(y.json,card_sql(shown)); blocked(y,x)
            x.ok('commit'); result=pending.result(timeout=20)
            assert result.get('reason')=='stale_revision',result
            assert observer.scalar(f"select status from financial_daily_closes where id='{A}'")=='draft'
        race(kind+' first: confirmation waits then rejects stale revision',edit_first)

        def confirm_first(x,y,pool,mutation=mutation):
            shown=rev(); x.ok('begin'); assert x.json(card_sql(shown))['confirmed']
            pending=pool.submit(y.execute,mutation); blocked(y,x)
            x.ok('commit'); result=pending.result(timeout=20)
            assert result['sqlstate']=='P0001' and 'immutable' in result['text'],result
            assert rev()==shown+1
        race('confirmation first: '+kind+' edit waits then rejects confirmed mutation',confirm_first)

    def rollback_first(x,y,pool):
        shown=rev(); x.ok('begin'); x.ok(mutations['ledger'])
        pending=pool.submit(y.json,card_sql(shown)); blocked(y,x)
        x.ok('rollback'); result=pending.result(timeout=20)
        assert result['confirmed'],result
        assert rev()==shown+1
        assert observer.scalar(f"select amount::integer from financial_daily_ledger_entries where id='{L}'")=='10'
    race('rolled-back edit restores revision and lets original card confirm',rollback_first)

    def opposite_moves(x,y,pool):
        ar,br=rev(A),rev(B); x.ok('begin')
        x.ok(f"update financial_daily_ledger_entries set daily_close_id='{B}' where id='{L}'")
        pending=pool.submit(y.ok,f"update financial_daily_ledger_entries set daily_close_id='{A}' where id='{L2}'")
        blocked(y,x); x.ok('commit'); pending.result(timeout=20)
        assert rev(A)==ar+2 and rev(B)==br+2
    race('opposite child reparent moves serialize on ordered old/new parent locks',opposite_moves)

    settlement=f"insert into financial_daily_ledger_entries(id,daily_close_id,expense_claim_id,accounting_role,direction) values('00000000-0000-0000-0000-000000000302','{B}','{CLAIM}','cash_settlement','outflow')"
    cancel=f"update financial_expense_claims set approval_status='cancelled' where id='{CLAIM}'"

    def settle_first(x,y,pool):
        x.ok('begin'); x.ok(settlement)
        pending=pool.submit(y.ok,cancel); blocked(y,x); x.ok('commit'); pending.result(timeout=20)
        c=observer.json(f"select json_build_object('status',approval_status,'blocked',metadata->'cancel_blocked_due_cash_settlement') from financial_expense_claims where id='{CLAIM}'")
        assert c=={'status':'needs_review','blocked':True},c
    race('settlement first: same-claim cancellation waits then becomes needs_review',settle_first)

    def cancel_first(x,y,pool):
        x.ok('begin'); x.ok(cancel)
        pending=pool.submit(y.ok,settlement); blocked(y,x); x.ok('commit'); pending.result(timeout=20)
        assert observer.scalar(f"select approval_status from financial_expense_claims where id='{CLAIM}'")=='cancelled'
        # This is existing business behavior, not proof that a cancelled claim is unpayable.
    race('cancellation first: later settlement waits then retains existing allowed behavior',cancel_first)

    def indirect_edit_first(x,y,pool):
        shown=rev(); x.ok('begin'); x.ok(settlement)
        pending=pool.submit(y.json,card_sql(shown)); blocked(y,x); x.ok('commit')
        result=pending.result(timeout=20); assert result.get('reason')=='stale_revision',result
    race('cross-day settlement first invalidates draft origin and blocks old card',indirect_edit_first)

    def indirect_confirm_first(x,y,pool):
        shown=rev(); br=rev(B); x.ok('begin'); assert x.json(card_sql(shown))['confirmed']
        pending=pool.submit(y.ok,settlement); blocked(y,x); x.ok('commit'); pending.result(timeout=20)
        assert rev(A)==shown+1 and rev(B)==br+1
    race('origin confirmation first permits later settlement while preserving confirmed origin',indirect_confirm_first)

    def settlement_reparent(x,y,pool):
        ar,cr=rev(A),rev(C); x.ok('begin'); x.ok(settlement)
        pending=pool.submit(y.ok,f"update financial_expense_claims set origin_daily_close_id='{C}' where id='{CLAIM}'")
        blocked(y,x); x.ok('commit'); pending.result(timeout=20)
        assert rev(A)==ar+2 and rev(C)==cr+1
    race('settlement claim-share lock serializes concurrent claim reparenting',settlement_reparent)

    observer.close()
    report={'generatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
      'engine':'real local PostgreSQL via psql', 'database':args.database,
      'passed':sum(r['status']=='passed' for r in results),
      'failed':sum(r['status']=='failed' for r in results),
      'sourceManifest':manifest,'results':results,
      'limitations':[
        'Synthetic views/schema; actual production dependency coverage and ACL/RLS are not established.',
        'Observed lock-order cases do not prove all multi-row batch writers are deadlock-free.',
        'Cancellation before a later settlement remains allowed by existing business guards.',
        'Test fixtures remain in the disposable database for inspection; no automated deletion is performed.']}
    (HERE/'postgres-concurrency-results.json').write_text(json.dumps(report,indent=2)+'\n')
    print(f"{report['passed']}/{len(results)} passed. Fixture data remains in {args.database}.")
    return bool(report['failed'])


if __name__=='__main__':
    sys.exit(main())
