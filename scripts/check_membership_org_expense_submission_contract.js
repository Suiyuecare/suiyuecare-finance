#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const migrationPath = path.join(root, 'supabase/migrations/20260821170000_membership_org_expense_submission_v1.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');
let passed = 0;
const checks = [];

function check(name, predicate) {
  const ok = Boolean(predicate);
  checks.push({ name, ok });
  if (ok) passed += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${name}\n`);
}

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

check('frontend calls the guarded expense submit endpoint',
  /finance_submit_expense_request/.test(index) && /p_org_unit_id:unit\.id/.test(index));
check('frontend calls the guarded expense resubmit endpoint',
  /finance_resubmit_expense_request/.test(index) && /p_form_state:state/.test(index));
check('migration is explicitly non-rerunnable and transaction wrapped',
  /NON-RERUNNABLE/.test(sql) && /begin;[\s\S]*commit;\s*$/.test(sql));
check('preflight rejects endpoint drift instead of overwriting it',
  /finance_submit_expense_request\(jsonb,uuid,text,jsonb\)'\) is not null/.test(sql)
    && /finance_resubmit_expense_request\(text,jsonb,uuid,text,jsonb\)'\) is not null/.test(sql));
check('submit endpoint has the exact PostgREST signature',
  /create function public\.finance_submit_expense_request\(\s*p_form jsonb,\s*p_org_unit_id uuid,\s*p_legal_entity_code text,\s*p_actor_requests jsonb default '\[\]'::jsonb\s*\)/s.test(sql));
check('resubmit endpoint has the exact PostgREST signature',
  /create function public\.finance_resubmit_expense_request\(\s*p_form_id text,\s*p_form_state jsonb,\s*p_org_unit_id uuid,\s*p_legal_entity_code text,\s*p_actor_requests jsonb default '\[\]'::jsonb\s*\)/s.test(sql));
check('both endpoints are SECURITY DEFINER with an empty search_path',
  count(sql, 'security definer\nset search_path = \'\'') === 2);
check('submit derives identity from the verified current finance user',
  /v_actor := public\.current_finance_user\(\)/.test(sql)
    && /finance_user_is_approval_identity_ready\(v_tenant_id, v_actor\.id\)/.test(sql));
check('submit ignores client tenant and posting state',
  /'tenant_id', v_tenant_id/.test(sql)
    && /'voucher_id', null/.test(sql)
    && /'ledger_posted_at', null/.test(sql)
    && /'posting_locked_at', null/.test(sql));
check('submit validates a published posting unit and legal entity scope',
  /status = 'published'/.test(sql)
    && /'is_posting_unit'/.test(sql)
    && /entity_codes/.test(sql));
check('submit requires exact applicant identity and a resolved pending assignee',
  /v_request\.applicant_id is distinct from v_actor\.id/.test(sql)
    && /簽核流程仍有未綁定或無效的正式簽核人/.test(sql));
check('submit derives status from steps before inserting exactly once',
  /finance_income_status_from_steps\(v_request\.steps\)/.test(sql)
    && count(sql, 'insert into public.expense_requests') === 1);
check('resubmit locks the source row and allows only applicant revision',
  /for update;/.test(sql)
    && /finance_income_step_role\(v_active_step\) <> 'applicant_revision'/.test(sql)
    && /v_expense\.applicant_id is distinct from v_actor\.id/.test(sql));
check('resubmit requires an exact single-step transition and preserves accounting fields',
  /finance_expense_is_exact_step_transition/.test(sql)
    && /debit_account.*is distinct from/s.test(sql)
    && /credit_account.*is distinct from/s.test(sql));
check('resubmit writes only behind the guarded transaction context',
  /set_config\('app\.finance_expense_write_context', 'org_resubmit', true\)/.test(sql));
check('both endpoints return an explicit successful approval runtime',
  count(sql, "'runtime', 'embedded_expense_steps_v1'") === 2);
check('PUBLIC and anon are denied while authenticated and service role are allowed',
  count(sql, 'revoke all on function public.finance_') >= 2
    && count(sql, 'to authenticated, service_role;') === 2);
check('postflight pins endpoint count, owner, ACL, security, and search_path',
  /expected exactly two membership organization expense endpoints/.test(sql)
    && /pg_get_userbyid\(proc_row\.proowner\) <> 'postgres'/.test(sql)
    && /has_function_privilege\('anon'/.test(sql)
    && /proc_row\.prosecdef is not true/.test(sql));
check('PostgREST schema reload is issued after postflight',
  /notify pgrst, 'reload schema';\s*commit;/.test(sql));

if (passed !== checks.length) {
  process.stderr.write(`\n${passed}/${checks.length} checks passed\n`);
  process.exit(1);
}
process.stdout.write(`\n${passed}/${checks.length} checks passed\n`);
