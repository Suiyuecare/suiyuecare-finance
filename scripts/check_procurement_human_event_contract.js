#!/usr/bin/env node
'use strict';

// In-memory PostgreSQL tests, never a connection to Supabase. The procurement
// trigger is the reviewed real source. Identity/ownership helper interfaces use
// minimal anonymous fixtures; this is not a complete production schema replay.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const baseSql = fs.readFileSync(path.join(root, 'supabase/migrations/20260902054834_preserve_human_accounting_authority_v1.sql'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260907154739_procurement_and_human_accounting_contract_v2.sql'), 'utf8');
const guardSql = fs.readFileSync(path.join(__dirname, 'fixtures/finance_procurement_guard_20260907.sql'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
let passed = 0;
function check(name, predicate) { assert(predicate, name); passed++; }
function functionSource(name) {
  const start = index.indexOf('function ' + name + '(');
  assert(start >= 0, name);
  let depth = 0;
  for (let i = index.indexOf('{', start); i < index.length; i++) {
    if (index[i] === '{') depth++;
    else if (index[i] === '}' && --depth === 0) return index.slice(start, i + 1);
  }
  throw new Error('Unclosed function: ' + name);
}
const names = ['accountingManualActorSnapshot','accountingManualFieldNames','accountingLineManualFields',
  'accountingComparableValue','accountingChangedFields','preserveAccountingManualAuthority',
  'markAccountingManualAuthority','invalidateAccountingLines'];
const runtime = new Function('num', 'cloneSettingValue', 'S', names.map(functionSource).join('\n')
  + '\nreturn {mark:markAccountingManualAuthority,invalidate:invalidateAccountingLines};')(
  value => Number(value || 0), clone, { user: { id: 'audit', name: 'Audit', n: 'Audit', role: 'accountant' } });

const tenant = '00000000-0000-0000-0000-000000000001';
const authId = '00000000-0000-0000-0000-000000000002';
const fields = ['netAmount','taxAmount','grossAmount','debitAccount','creditAccount'];
const schemaSql = `
create schema private; create schema auth; create schema extensions;
create role anon; create role authenticated; create role service_role;
create function extensions.digest(bytea,text) returns bytea language sql immutable as
  $$ select case when $2='sha256' then pg_catalog.sha256($1) else null end $$;
create table public.finance_users(id text,tenant_id uuid,auth_user_id uuid,name text,email text,role text,active boolean,created_at timestamptz);
insert into public.finance_users values('audit','${tenant}','${authId}','Audit','audit.invalid','general_affairs',true,now());
create table public.expense_requests(
 id text primary key,tenant_id uuid,data_environment text,applicant_id text,entity_id text,department_code text,type text,
 amount numeric,estimated_amount numeric,actual_amount numeric,actual_files jsonb,files jsonb,steps jsonb,form_payload jsonb,
 status text,step integer,ver integer,updated_at timestamptz,payee text,bank_type text,bank_name text,bank_branch text,
 bank_no text,expected_pay_date date,bank_account text,fee_bearer text,bank_fee_amount numeric);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('audit.uid',true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{"role":"authenticated"}'::jsonb $$;
create function public.current_tenant_id() returns uuid language sql stable as $$ select '${tenant}'::uuid $$;
create function private.finance_income_active_step_index(jsonb) returns integer language sql immutable as
 $$ select (ordinality-1)::integer from jsonb_array_elements($1) with ordinality s(value,ordinality) where coalesce(value->>'a','')='' order by ordinality limit 1 $$;
create function private.finance_income_step_role(jsonb) returns text language sql immutable as $$ select $1->>'rk' $$;
create function private.finance_expense_actor_can_act(uuid,public.expense_requests,integer,jsonb,text,text,text) returns boolean language sql as
 $$ select $4->>'uid'=$5 and $7='general_affairs' and coalesce($4->>'a','')='' $$;
create function private.finance_expense_is_exact_step_transition(jsonb,jsonb,integer,text,text,text) returns boolean language sql as
 $$ select jsonb_array_length($1)=jsonb_array_length($2) and $2->$3->>'a'=$4 and $2->$3->>'uid'=$5 and $2->$3->>'n'=$6
 and not exists(select 1 from jsonb_array_elements($1) with ordinality a(v,i) where i-1<>$3 and v is distinct from $2->(i::integer-1)) $$;
create function private.finance_expense_new_files_are_owned(uuid,public.expense_requests,jsonb,jsonb,text) returns boolean language sql as
 $$ select not exists(select 1 from jsonb_array_elements(coalesce($4,'[]')) f where f->>'owner' is distinct from $5) $$;
create function private.finance_income_status_from_steps(jsonb) returns jsonb language sql as
 $$ select jsonb_build_object('approval_status',coalesce($1->private.finance_income_active_step_index($1)->>'status','completed'),
 'approval_step',coalesce(private.finance_income_active_step_index($1)+1,jsonb_array_length($1))) $$;
create function private.finance_expense_optional_permission_allows(uuid,text,text,jsonb) returns boolean language sql as
 $$ select coalesce(current_setting('audit.permission',true),'true')<>'false' $$;
grant usage on schema public,auth to authenticated;
grant select,insert,update,delete on public.expense_requests to authenticated;
alter table public.expense_requests enable row level security;
create policy fixture_tenant on public.expense_requests to authenticated
 using(tenant_id=public.current_tenant_id()) with check(tenant_id=public.current_tenant_id());
`;

function procurementRecords(role, oldFlag, newFlag = false) {
  const evidence = { path: 'audit/receipt.pdf', owner: 'audit' };
  const old = { id: 'fixture', tenant_id: tenant, data_environment: 'test', applicant_id: 'another-applicant',
    entity_id: 'fixture-entity', department_code: 'fixture-department', type: 'purchase_request', amount: 100,
    estimated_amount: 100, actual_amount: null, actual_files: [], files: [], status: 'pending_procurement', step: 1,
    ver: 1, updated_at: '2026-09-07T00:00:00Z', payee: '', bank_type: '', bank_name: '', bank_branch: '', bank_no: '',
    expected_pay_date: null, bank_account: '', fee_bearer: '', bank_fee_amount: 0,
    steps: [{ rk: role, uid: 'audit', n: '', a: '', files: [], status: 'pending_procurement' },
      { rk: 'accountant_final', uid: 'accountant', a: '', status: 'pending_voucher' }],
    form_payload: { accountingLines: [{ id: 'line_1', netAmount: 100, taxAmount: 0, grossAmount: 100 }] } };
  if (oldFlag !== undefined) old.form_payload.accountingLinesPreservedForReview = oldFlag;
  const next = clone(old), request = { formPayload: next.form_payload };
  runtime.invalidate(request, '採購新憑據需要重新覆核', true);
  next.form_payload = request.formPayload;
  if (newFlag === undefined) delete next.form_payload.accountingLinesPreservedForReview;
  else next.form_payload.accountingLinesPreservedForReview = newFlag;
  next.steps[0] = { ...next.steps[0], a: 'approved', n: 'Audit', files: [evidence] };
  next.status = 'pending_voucher'; next.step = 2;
  if (role === 'procurement_payment') {
    next.form_payload.purchaseEstimate = { stage: 'procurement_estimate' };
    next.form_payload.procurementPaymentInfo = { amount: 100, payee: '', bankType: '', bankName: '', bankBranch: '',
      bankNo: '', expectedPayDate: '', feeBearer: '', summary: '', filledBy: 'Audit' };
  } else {
    next.actual_amount = 120; next.actual_files = [evidence]; next.files = [evidence];
    next.form_payload.purchaseActual = { actualAmount: 120, submittedBy: 'Audit', stage: 'procurement_actual_receipt', files: [evidence] };
    next.form_payload.procurementReceiptInfo = { actualAmount: 120, submittedBy: 'Audit', fileCount: 1 };
  }
  return { old, next };
}

async function updateFixture(db, records, shouldPass, label, permission = true) {
  // PGlite RESET SESSION AUTHORIZATION keeps its last session identity; restore
  // the original superuser explicitly only for fixture setup, never for UPDATE.
  await db.exec('set session authorization postgres; delete from public.expense_requests');
  await db.query('insert into public.expense_requests select * from jsonb_populate_record(null::public.expense_requests,$1::jsonb)', [JSON.stringify(records.old)]);
  await db.exec(`set session authorization authenticated; set audit.uid='${authId}'; set audit.permission='${permission}';`);
  const identity = (await db.query('select session_user,current_user')).rows[0];
  assert.strictEqual(identity.session_user, 'authenticated', 'Never bypass the guard with postgres + SET ROLE');
  const columns = Object.keys(records.old).filter(key => key !== 'id');
  let error;
  try {
    await db.query(`update public.expense_requests set (${columns.join(',')})=(select ${columns.join(',')} from jsonb_populate_record(null::public.expense_requests,$1::jsonb)) where id='fixture'`, [JSON.stringify(records.next)]);
  } catch (err) { error = err; }
  await db.exec('set session authorization postgres');
  if (shouldPass) { if (error) throw new Error(label + ': ' + error.message); }
  else assert(error && ['42501','23514','55000'].includes(error.code), label + ' must be denied');
  const saved = (await db.query("select * from public.expense_requests where id='fixture'")).rows[0];
  check(label, shouldPass ? saved.ver === 2 && saved.step === 2 : saved.ver === 1 && saved.step === 1);
}

function line(historyCount = 0) {
  return { id: 'line_1', netAmount: 1000, taxAmount: 50, grossAmount: 1050, debitAccount: '6205', creditAccount: '1112',
    manualOverride: true, valueAuthority: 'human', manualFields: fields.slice(),
    manualOverrideHistory: Array.from({ length: historyCount }, (_, i) => ({ operationId: 'saved-' + i, at: 'saved-' + i })),
    manualOverrideBy: { id: 'audit' }, manualOverrideAt: 'old', manualOverrideSource: 'saved' };
}
function edited(old, changes, legacy = false) {
  const next = runtime.mark(clone(old), { ...clone(old), ...changes }, 'audit-review');
  if (legacy) {
    next.manualOverrideHistory = next.manualOverrideHistory.slice(-50);
    const event = next.manualOverrideHistory[next.manualOverrideHistory.length - 1];
    delete event.operationId; delete event.beforeValues; delete event.afterValues;
  }
  return next;
}
async function merge(db, old, next) {
  return (await db.query('select private.finance_merge_human_accounting_line($1::jsonb,$2::jsonb) as value',
    [JSON.stringify(old), JSON.stringify(next)])).rows[0].value;
}
async function conflict(db, old, next, label) {
  let error; try { await merge(db, old, next); } catch (err) { error = err; }
  check(label, error && error.code === '40001' && error.detail === 'HUMAN_ACCOUNTING_REVISION_CONFLICT');
}

(async () => {
  const db = new PGlite();
  try {
    await db.exec(schemaSql);
    const baselineFunctions = [...baseSql.matchAll(/create or replace function private\.(finance_accounting_manual_fields|finance_accounting_line_is_human|finance_merge_human_accounting_line)\([\s\S]*?\$function\$;/g)].map(match => match[0]);
    assert.strictEqual(baselineFunctions.length, 3);
    await db.exec(baselineFunctions.join('\n') + '\n' + guardSql);
    await db.exec('create trigger audit_guard before update on public.expense_requests for each row execute function private.finance_expense_guard_direct_update()');
    await updateFixture(db, procurementRecords('procurement_payment'), false, 'Baseline rejects the actual frontend false marker');
    await db.exec(migration);
    for (const role of ['procurement_payment','procurement_receipt','procurement_review']) {
      for (const oldFlag of [undefined, false, true]) await updateFixture(db, procurementRecords(role, oldFlag), true, role + ' accepts exact false from ' + oldFlag);
      for (const invalid of [true, null, 'false', 'true', 0, 1, [], {}, [false]]) await updateFixture(db, procurementRecords(role, undefined, invalid), false, role + ' rejects invalid marker ' + JSON.stringify(invalid));
    }
    const legacy = procurementRecords('procurement_payment'); delete legacy.next.form_payload.accountingLinesPreservedForReview;
    await updateFixture(db, legacy, true, 'Both absent remains compatible with legacy clients');
    const removed = procurementRecords('procurement_payment', false); delete removed.next.form_payload.accountingLinesPreservedForReview;
    await updateFixture(db, removed, false, 'Existing marker cannot be deleted');
    for (const mutate of [
      x => { x.next.form_payload.accountingLinePolicy = 'forged-human'; },
      x => { x.next.form_payload.manualOverrideHistory = [{ forged: true }]; },
      x => { x.next.form_payload.accountingLines = []; },
      x => { x.next.form_payload.accountingLinesNeedReview = false; },
      x => { x.next.form_payload.accountingLinesInvalidatedReason = ''; },
      x => { x.next.steps[1].uid = 'forged-next-person'; },
      x => { x.next.steps[0].files[0].owner = 'other'; },
      x => { x.next.applicant_id = 'another'; },
      x => { x.next.status = 'completed'; },
      x => { x.next.actual_amount = 999; },
      x => { x.next.form_payload.procurementReceiptInfo.fileCount = 9; },
    ]) {
      const records = procurementRecords('procurement_receipt'); mutate(records);
      await updateFixture(db, records, false, 'Retains existing procurement security/field guard');
    }
    await updateFixture(db, procurementRecords('procurement_payment'), false, 'Membership permission still enforced', false);

    for (const count of [0, 49, 50, 51, 80]) {
      const before = line(count), next = edited(before, { netAmount: 900, taxAmount: 40, grossAmount: 940, debitAccount: '6221', creditAccount: '2110' });
      const saved = await merge(db, before, next);
      check('All five human fields survive event ' + (count + 1), fields.every(field => saved[field] === next[field]));
      check('Full immutable history retained at ' + count, saved.manualOverrideHistory.length === count + 1);
      if (count >= 50) {
        const oldClient = edited(before, { taxAmount: 20, netAmount: 1030 }, true), oldSaved = await merge(db, before, oldClient);
        check('Legacy rolling 50-event client continues at ' + count, oldSaved.taxAmount === 20 && oldSaved.manualOverrideHistory.length === count + 1);
        const newClient = edited(oldSaved, { taxAmount: 30, netAmount: 1020 });
        check('New client continues after old client ' + count, (await merge(db, oldSaved, newClient)).manualOverrideHistory.length === count + 2);
      }
    }
    for (const field of fields) {
      const before = line(50), value = /Account$/.test(field) ? '9999' : before[field] + 1;
      check('Independent field binding: ' + field, (await merge(db, before, edited(before, { [field]: value })))[field] === value);
    }
    const before = line(50), a = edited(before, { netAmount: 900, taxAmount: 150 }), b = edited(before, { netAmount: 950, taxAmount: 100 });
    const committed = await merge(db, before, a);
    await conflict(db, committed, b, 'Two tabs cannot overwrite the first committed human event');
    await conflict(db, committed, edited(before, { creditAccount: '2110' }, true), 'Stale rolling client cannot overwrite an unrelated new event');
    const forgedAfter = clone(a); forgedAfter.taxAmount = 200;
    await conflict(db, before, forgedAfter, 'Same last event cannot authorize a different payload');
    const forgedBefore = clone(a); forgedBefore.manualOverrideHistory.at(-1).changes.netAmount.before = 123;
    await conflict(db, before, forgedBefore, 'Event must bind to the exact previous field value');
    for (const mutate of [
      value => { delete value.manualOverrideHistory.at(-1).actor; },
      value => { delete value.manualOverrideHistory.at(-1).changes; },
      value => { value.manualOverrideHistory.at(-1).changes = null; },
      value => { value.manualOverrideHistory.at(-1).changes = []; },
      value => { value.manualOverrideHistory.at(-1).beforeValues = null; },
      value => { value.manualOverrideHistory.at(-1).afterValues.netAmount = 1; },
      value => { value.manualOverrideHistory.at(-1).actor.id = 'forged'; },
      value => { value.manualOverrideHistory.at(-1).operationId = 'saved-0'; },
      value => { value.manualOverrideHistory[0].at = 'replaced-history'; },
      value => { value.manualOverrideHistory = [{ forged: true }]; },
      value => { value.manualOverrideHistory.at(-1).changes.newField = { before: 1, after: 2 }; },
    ]) {
      const forged = clone(a); mutate(forged);
      await conflict(db, before, forged, 'Malformed/tampered/replayed human event is a visible conflict');
    }
    const partialBefore = line(50); partialBefore.manualFields = ['debitAccount'];
    const forgedNewField = clone(partialBefore); forgedNewField.manualFields.push('creditAccount'); forgedNewField.creditAccount = '2110';
    await conflict(db, partialBefore, forgedNewField, 'A newly human field still requires a value-bound audit event');
    const sameValue = runtime.mark(clone(before), clone(before), 'explicit-confirm', ['debitAccount']);
    check('Explicit same-value human confirmation retains its audit', (await merge(db, before, sameValue)).manualOverrideHistory.length === 51);
    const metadataOnly = clone(before); metadataOnly.comment = 'ordinary workflow note';
    check('Workflow metadata is not a fresh human revision', (await merge(db, before, metadataOnly)).manualOverrideHistory.length === 50);
    const staleAi = { ...line(0), manualOverride: false, valueAuthority: 'ai', netAmount: 1, taxAmount: 0, grossAmount: 1, debitAccount: '9999', creditAccount: '9998' };
    const aiSaved = await merge(db, before, staleAi);
    check('AI cannot replace any of the five human fields', fields.every(field => aiSaved[field] === before[field]));
    await db.exec('grant usage on schema private to authenticated');
    await db.exec('set session authorization authenticated');
    let denied; try { await db.query("select private.finance_accounting_human_event_is_fresh_v2('{}','{}')"); } catch (err) { denied = err; }
    check('Private audit helper cannot grant client write authority', denied && denied.code === '42501');
    await db.exec('set session authorization postgres');
    const fixtureAcl = (await db.query("select prosecdef,proconfig,proacl::text as acl from pg_proc where oid='private.finance_expense_guard_direct_update()'::regprocedure")).rows[0];
    check('Procurement remains security definer with fixed empty search path', fixtureAcl.prosecdef === true && JSON.stringify(fixtureAcl.proconfig) === JSON.stringify(['search_path=""']));
    // Reapply is deliberately refused: only an exact reviewed baseline may be
    // migrated. The Supabase migration ledger controls one-time application.
    let drift;
    try { await db.exec(migration); } catch (err) { drift = err; }
    check('Reviewed-source fingerprint prevents reapply or unexpected drift', drift && /differs from the reviewed production baseline/.test(drift.message));
    check('Failed migration leaves the installed guard unchanged', (await db.query("select proacl::text as acl from pg_proc where oid='private.finance_expense_guard_direct_update()'::regprocedure")).rows[0].acl === fixtureAcl.acl);
    console.log('PASS: ' + passed + ' F01/F06 actual PostgreSQL + production-JS checks (isolated fixtures; no live DB)');
  } finally { await db.close(); }
})().catch(error => { console.error({ message: error.message, code: error.code, detail: error.detail, where: error.where }); process.exitCode = 1; });
