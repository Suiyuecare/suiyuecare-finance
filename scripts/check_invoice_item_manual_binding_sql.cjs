#!/usr/bin/env node
'use strict';

// Isolated PostgreSQL fixture for the production RPC and both final-posting
// allowlists. No linked database, credentials, or real invoice data are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.FINANCE_PGLITE_MODULE || '@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const tenant = '00000000-0000-0000-0000-000000000001';
const otherTenant = '00000000-0000-0000-0000-000000000002';
const accountantAuth = '00000000-0000-0000-0000-000000000011';
const ceoAuth = '00000000-0000-0000-0000-000000000012';
const employeeAuth = '00000000-0000-0000-0000-000000000013';
const migration = read('supabase/migrations/20261008031845_finance_bind_expense_invoice_item_v1.sql');
const db = new PGlite();
let checks = 0;
function pass(message, condition) { assert(condition, message); checks++; process.stdout.write(`PASS ${message}\n`); }
async function admin(sql, values) {
  await db.exec('set session authorization postgres');
  return values ? db.query(sql, values) : db.exec(sql);
}
async function as(id, authId, scope = tenant) {
  await admin('select 1');
  await db.query("select set_config('test.auth',$1,false),set_config('test.tenant',$2,false)", [authId || '', scope]);
  await db.exec('set session authorization authenticated');
}
async function denied(message, action, expected) {
  let error;
  try { await action(); } catch (caught) { error = caught; }
  pass(message, !!error && (!expected || error.code === expected));
}
async function bind(requestId, ver, sourceIndex, lineId, key, environment = 'test') {
  const result = await db.query(
    'select public.finance_bind_expense_invoice_item_v1($1,$2,$3,$4,$5,$6) result',
    [requestId, ver, sourceIndex, lineId, key, environment]
  );
  return result.rows[0].result;
}
async function saved(requestId) {
  return (await admin('select to_jsonb(r) result from public.expense_requests r where id=$1', [requestId])).rows[0].result;
}
async function auditCount(requestId) {
  return (await admin("select count(*)::integer n from public.module_audit_logs where row_id=$1 and action='INVOICE_ITEM_MANUAL_BIND'", [requestId])).rows[0].n;
}
const source = (no, date) => ({
  no, date, item: '油資', qty: 1, unitPrice: 90, netAmount: 86,
  taxAmount: 4, grossAmount: 90, total: 90, file: `${no}.pdf`
});
const line = id => ({
  id, source: 'expense_detail', description: '油資', netAmount: 86,
  taxAmount: 4, grossAmount: 90, debitAccount: '6219',
  creditAccount: '1112', manualOverride: true, manualFields: ['debitAccount'],
  manualOverrideBy: { id: 'accountant' }, manualOverrideHistory: [{ at: '2026-10-01' }],
  aiReason: '原始建議保留', systemFee: false, locked: false
});
const payload = {
  lazyRows: [source('EV93641169', '2026-09-25'), source('EV93642222', '2026-09-26'), source('EV93643333', '2026-09-27')],
  accountingLines: [line('line_1'), line('line_2'), line('line_3')],
  unrelatedField: { keep: 'unchanged' }
};
const schema = `
create schema private; create schema auth;
create role anon; create role authenticated; create role service_role;
set check_function_bodies=off;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.auth',true),'')::uuid$$;
create function public.current_tenant_id() returns uuid language sql stable as $$select nullif(current_setting('test.tenant',true),'')::uuid$$;
create table public.finance_users(id text primary key, tenant_id uuid, auth_user_id uuid, role text, email text, active boolean);
create table public.expense_requests(
  id text primary key, no text, tenant_id uuid, data_environment text, applicant_id text,
  entity_id text, department_code text, type text, petty_mode text,
  form_payload jsonb, steps jsonb, status text, ver integer, updated_at timestamptz,
  posting_locked_at timestamptz, ledger_posted_at timestamptz, voided_at timestamptz,
  voucher_id text, bank_fee_amount numeric default 0
);
create table public.application_accounting_lines(
  request_id text, line_index integer, data_environment text, payload jsonb,
  primary key(request_id,line_index)
);
create table public.module_audit_logs(
  table_name text,row_id text,action text,actor_email text,before_data jsonb,after_data jsonb
);
create table private.finance_income_document_operations(
  tenant_id uuid,data_environment text,operation_type text,idempotency_key text,
  request_digest text,actor_finance_user_id text,operation_status text default 'in_progress',
  result jsonb,primary key(tenant_id,data_environment,operation_type,idempotency_key)
);
create function private.finance_income_request_digest(jsonb) returns text language sql immutable as $$select md5($1::text)$$;
create function private.finance_income_begin_operation(uuid,text,text,text,text,text) returns jsonb
language plpgsql set search_path='' as $f$
declare op private.finance_income_document_operations%rowtype;
begin
  if coalesce($4,'') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$' then
    raise exception 'Invalid idempotency key' using errcode='22023';
  end if;
  insert into private.finance_income_document_operations
    (tenant_id,data_environment,operation_type,idempotency_key,request_digest,actor_finance_user_id)
  values ($1,$2,$3,$4,$5,$6) on conflict do nothing;
  select * into op from private.finance_income_document_operations
  where tenant_id=$1 and data_environment=$2 and operation_type=$3 and idempotency_key=$4 for update;
  if op.actor_finance_user_id is distinct from $6 then raise exception 'Wrong replay actor' using errcode='42501'; end if;
  if op.request_digest is distinct from $5 then raise exception 'Changed replay request' using errcode='23505'; end if;
  if op.operation_status='completed' then return op.result; end if;
  return null;
end;$f$;
create function private.finance_income_finish_operation(uuid,text,text,text,jsonb) returns void
language sql set search_path='' as $f$
  update private.finance_income_document_operations set operation_status='completed',result=$5
  where tenant_id=$1 and data_environment=$2 and operation_type=$3 and idempotency_key=$4
$f$;
create function private.finance_income_active_step_index(jsonb) returns integer language sql stable as $f$
  select (ordinality-1)::integer from jsonb_array_elements($1) with ordinality step(value,ordinality)
  where coalesce(value->>'a','')='' order by ordinality limit 1
$f$;
create function private.finance_income_step_role(jsonb) returns text language sql stable as $f$
  select coalesce($1->>'rk','')
$f$;
create function private.finance_expense_actor_can_act(uuid,public.expense_requests,integer,jsonb,text,text,text)
returns boolean language sql stable as $f$ select $4->>'uid'=$5 $f$;
create function private.finance_expense_optional_permission_allows(uuid,text,text,jsonb)
returns boolean language sql stable as $f$
  select $3='finance.accounting.subject.edit'
    and exists(select 1 from public.finance_users where tenant_id=$1 and id=$2
      and role in ('accountant','ceo','admin_director') and active)
$f$;
create function private.fixture_expense_write_guard() returns trigger language plpgsql as $f$
begin
  if coalesce(current_setting('app.finance_expense_write_context',true),'')<>'active_step' then
    raise exception 'Direct expense update denied' using errcode='42501';
  end if;
  return new;
end;$f$;
create trigger trg_finance_expense_controlled_write before update on public.expense_requests
for each row execute function private.fixture_expense_write_guard();
create function private.fixture_accounting_sync() returns trigger language plpgsql as $f$
begin
  delete from public.application_accounting_lines where request_id=new.id;
  insert into public.application_accounting_lines(request_id,line_index,data_environment,payload)
  select new.id,ordinality::integer,new.data_environment,value
  from jsonb_array_elements(new.form_payload->'accountingLines') with ordinality item(value,ordinality);
  return new;
end;$f$;
create trigger trg_zz_finance_sync_request_accounting_lines after update of form_payload
on public.expense_requests for each row execute function private.fixture_accounting_sync();
grant usage on schema public to authenticated;
`;
function extractFinalHelper(sql, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = sql.match(new RegExp(`create function private\\.${escaped}\\([\\s\\S]*?\\$function\\$;`, 'i'));
  assert(match, `${name} source missing`);
  return match[0];
}

(async () => {
  try {
    await db.exec(schema);
    await db.exec(extractFinalHelper(read('supabase/migrations/20260908065050_finance_finalize_accounting_lines_atomic_v1.sql'), 'finance_finalize_accounting_patch_v1'));
    await db.exec(extractFinalHelper(read('supabase/migrations/20260909083825_finance_utility_gross_expense_guard_v1.sql'), 'finance_finalize_utility_advance_patch_v1'));
    await db.query('insert into public.finance_users values($1,$2,$3,$4,$5,true),($6,$2,$7,$8,$9,true),($10,$2,$11,$12,$13,true)',
      ['accountant',tenant,accountantAuth,'accountant','accountant@example.invalid',
        'ceo',ceoAuth,'ceo','ceo@example.invalid','employee',employeeAuth,'employee','employee@example.invalid']);
    const insert = async (id, actor = 'accountant', extra = {}) => {
      const data = { id, no: id, tenant_id: tenant, data_environment: 'test', applicant_id: 'applicant',
        entity_id: 'E1', department_code: 'D1', type: 'expense_request', form_payload: structuredClone(payload),
        steps: [{ rk: actor, uid: actor, a: '' }], status: 'pending', ver: 7, ...extra };
      await admin('insert into public.expense_requests select * from jsonb_populate_record(null::public.expense_requests,$1)', [JSON.stringify(data)]);
      return data;
    };
    await insert('expense-duplicate');
    await db.exec(`begin;${migration}\ncommit;`);
    const helperSources = await admin("select proname,prosrc from pg_proc where proname in ('finance_finalize_accounting_patch_v1','finance_finalize_utility_advance_patch_v1') order by proname", []);
    pass('Both final posting helpers retain the source identity', helperSources.rows.length === 2 && helperSources.rows.every(row => row.prosrc.includes("array['id','sourceItemId','source','description'")));
    await as('accountant', accountantAuth);
    const original = await saved('expense-duplicate');
    const key = 'invoice-item-bind:expense-duplicate:7:2:line_3';
    const bound = await bind('expense-duplicate', 7, 2, 'line_3', key);
    pass('Accountant binds an ambiguous historical item with stable UUID and incremented version', bound.ok && bound.ver === 8 && /^[0-9a-f-]{36}$/.test(bound.sourceItemId));
    const after = await saved('expense-duplicate');
    pass('Only selected row and line gain matching source identity',
      after.form_payload.lazyRows[1].id === bound.sourceItemId && after.form_payload.accountingLines[2].sourceItemId === bound.sourceItemId
      && !after.form_payload.lazyRows[0].id && !after.form_payload.accountingLines[0].sourceItemId);
    pass('Money, accounts, manual authority, evidence, workflow and other fields are preserved',
      after.form_payload.accountingLines[2].debitAccount === '6219'
      && JSON.stringify(after.form_payload.accountingLines[2].manualOverrideHistory) === JSON.stringify(original.form_payload.accountingLines[2].manualOverrideHistory)
      && after.form_payload.lazyRows[1].no === 'EV93642222'
      && JSON.stringify(after.steps) === JSON.stringify(original.steps)
      && after.form_payload.unrelatedField.keep === 'unchanged');
    pass('Normalized accounting payload has the same durable source link',
      (await admin("select payload->>'sourceItemId' link from public.application_accounting_lines where request_id='expense-duplicate' and line_index=3", [])).rows[0].link === bound.sourceItemId);
    pass('A single actor audit records the binding', await auditCount('expense-duplicate') === 1);
    await as('accountant', accountantAuth);
    const replay = await bind('expense-duplicate', 7, 2, 'line_3', key);
    pass('Retry returns the original stable result without a second version or audit',
      replay.idempotentReplay === true && replay.sourceItemId === bound.sourceItemId
      && (await saved('expense-duplicate')).ver === 8 && await auditCount('expense-duplicate') === 1);
    await denied('Stale version cannot overwrite a later action', () => bind('expense-duplicate', 7, 1, 'line_1', 'invoice-item-bind:stale-version'), '40001');
    await denied('A source cannot be rebound to another line', () => bind('expense-duplicate', 8, 2, 'line_1', 'invoice-item-bind:source-rebind'), '23505');
    await denied('A bound line cannot be assigned to another source', () => bind('expense-duplicate', 8, 1, 'line_3', 'invoice-item-bind:line-rebind'), '23505');
    await denied('Different request under the same idempotency key is rejected', () => bind('expense-duplicate', 8, 1, 'line_1', key), '23505');
    await as('ceo', ceoAuth);
    await insert('expense-ceo', 'ceo');
    const ceoBound = await bind('expense-ceo', 7, 3, 'line_2', 'invoice-item-bind:expense-ceo:7:3:line_2');
    pass('CEO can bind a current assigned item', ceoBound.ok && ceoBound.ver === 8);
    await denied('CEO cannot edit a step assigned to accountant', () => bind('expense-duplicate', 8, 1, 'line_1', 'invoice-item-bind:wrong-assignee'), '42501');
    await as('employee', employeeAuth);
    await denied('Unprivileged employee cannot bind', () => bind('expense-duplicate', 8, 1, 'line_1', 'invoice-item-bind:employee'), '42501');
    await as('accountant', accountantAuth, otherTenant);
    await denied('Tenant boundary denies cross-tenant binding', () => bind('expense-duplicate', 8, 1, 'line_1', 'invoice-item-bind:other-tenant'), '42501');
    await as('accountant', accountantAuth);
    await denied('Environment boundary denies cross-environment binding', () => bind('expense-duplicate', 8, 1, 'line_1', 'invoice-item-bind:other-env', 'production'), 'P0002');
    const mismatched = structuredClone(payload); mismatched.lazyRows[0].taxAmount = 5;
    await insert('expense-mismatch', 'accountant', { form_payload: mismatched });
    await denied('Mismatched source tax is rejected', () => bind('expense-mismatch', 7, 1, 'line_1', 'invoice-item-bind:mismatch'), '23514');
    const grossOnly = structuredClone(payload);
    delete grossOnly.lazyRows[0].netAmount;
    delete grossOnly.lazyRows[0].taxAmount;
    await insert('expense-gross-only', 'accountant', { form_payload: grossOnly });
    const grossBound = await bind('expense-gross-only', 7, 1, 'line_1', 'invoice-item-bind:gross-only');
    pass('Gross-only historical source derives the displayed 86 + 4 = 90 signature', grossBound.ok && grossBound.ver === 8);
    const exempt = structuredClone(payload);
    exempt.lazyRows[0] = { ...exempt.lazyRows[0], taxMode: 'exempt', grossAmount: 90 };
    delete exempt.lazyRows[0].netAmount;
    delete exempt.lazyRows[0].taxAmount;
    await insert('expense-exempt-mismatch', 'accountant', { form_payload: exempt });
    await denied('Exempt gross-only source cannot bind a taxed accounting line', () => bind('expense-exempt-mismatch', 7, 1, 'line_1', 'invoice-item-bind:exempt-mismatch'), '23514');
    await insert('expense-locked', 'accountant', { posting_locked_at: '2026-10-01T00:00:00Z' });
    await denied('Posted or locked request cannot bind', () => bind('expense-locked', 7, 1, 'line_1', 'invoice-item-bind:locked'), '55000');
    await insert('expense-duplicate-id', 'accountant', { form_payload: { ...structuredClone(payload), accountingLines: [line('line_1'), line('line_1'), line('line_3')] } });
    await denied('Duplicate accounting line IDs fail closed', () => bind('expense-duplicate-id', 7, 1, 'line_1', 'invoice-item-bind:duplicate-id'), '22023');
    const snapshot = await saved('expense-duplicate');
    pass('Rejected mutations leave request and audit unchanged', snapshot.ver === 8 && await auditCount('expense-duplicate') === 1);
    await denied('Direct client update remains guarded', () => db.query("update public.expense_requests set ver=99 where id='expense-duplicate'"), '42501');
    process.stdout.write(`PASS ${checks} isolated SQL binding checks\n`);
  } finally { await db.close(); }
})().catch(error => { console.error({ message: error.message, code: error.code, detail: error.detail, stack: error.stack }); process.exitCode = 1; });
