import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('high-confidence financial evidence attaches by document date while preserving received date',()=>{
  const sql=readFileSync(
    'supabase/migrations/20261002114354_financial_evidence_attach_document_date_v1.sql',
    'utf8'
  );
  assert.match(sql,/v_attach_date/);
  assert.match(sql,/v_confidence>=0\.80/);
  assert.match(sql,/v_effective_date/);
  assert.match(sql,/values\(v_branch_id,v_received_date,''test'',''draft'',''line''\)/);
  assert.match(sql,/values\(v_branch_id,v_attach_date,''test'',''draft'',''line''\)/);
  assert.match(sql,/and c\.local_date=v_received_date/);
  assert.match(sql,/and c\.local_date=v_attach_date/);
  assert.match(sql,/received_local_date/);
  assert.match(sql,/attached_local_date/);
});
