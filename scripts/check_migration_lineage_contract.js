#!/usr/bin/env node
'use strict';

/**
 * Finance adopted-database migration lineage contract.
 *
 * This repository currently contains forward migrations for an existing
 * Finance production lineage. It does not contain a clean-slate baseline or
 * seed. This check makes that limitation explicit and prevents CI from
 * presenting an empty local reset as evidence of deployability.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase/migrations');
const FIRST_ADOPTED_MIGRATION = '20260820052216_repair_account_and_new_taipei_runtime.sql';
const ROUTE_AUTHORITY_MIGRATION = '20260827052447_expense_route_authority_v3.sql';
const LATEST_ADOPTED_MIGRATION = '20260828015718_repair_admin_ntpc_portal_employee_link_20260828.sql';
const TOP_LEVEL_ROUTE_HOTFIX = '20260831042040_top_level_ceo_self_route.sql';
const EXPENSE_STATUS_HOTFIX = '20260831043517_expense_submit_derived_status.sql';
const FINAL_ACCOUNTANT_SELF_POST_HOTFIX = '20260901024020_final_accountant_self_post.sql';
const FORMAL_CASHIER_REPAIR = '20260901073241_assign_ceo_cashier_and_reassign_pending_cashier.sql';
const FORMAL_CASHIER_SELF_DISBURSEMENT = '20260901081807_allow_formal_cashier_self_disbursement.sql';
const {AUDIT_MIGRATIONS,CASE_MIGRATIONS,UTILITY_MIGRATIONS,REPORT_MIGRATIONS,AMOUNT_SEARCH_MIGRATIONS,REPORTING_INTEGRITY_MIGRATIONS,AUDIT_READINESS_MIGRATIONS,EMPLOYEE_RELIABILITY_MIGRATIONS,HISTORY_PERFORMANCE_MIGRATIONS,READ_LATENCY_MIGRATIONS,AR_MAPPING_MIGRATIONS,AUDIT_REMEDIATION_MIGRATIONS}=require('./finance_production_release_guard');
const HUMAN_ACCOUNTING_AUTHORITY = '20260902054834_preserve_human_accounting_authority_v1.sql';
const SCHEMA_QUALIFIED_CONDITIONAL_EXPRESSION =
  /"?pg_catalog"?\s*\.\s*"?(?:coalesce|nullif|greatest|least)"?\s*\(/i;

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    process.stdout.write(`PASS ${label}\n`);
  } else {
    failed += 1;
    process.stderr.write(`FAIL ${label}${detail ? `: ${detail}` : ''}\n`);
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

const config = read('supabase/config.toml');
const workflow = read('.github/workflows/stability-gate.yml');
const releaseGuide = read('docs/RELEASE_GATES.md');
const migrations = fs.readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort();

check('migration lineage is present', migrations.length > 0);
check('migration versions are canonical and strictly ordered',
  migrations.every((name, index) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name)
    && (index === 0 || name.slice(0, 14) > migrations[index - 1].slice(0, 14))));
check('every migration in the adopted lineage is non-empty',
  migrations.every((name) => fs.statSync(path.join(MIGRATIONS_DIR, name)).size > 0),
  migrations.filter((name) => fs.statSync(path.join(MIGRATIONS_DIR, name)).size === 0).join(', '));

const first = migrations[0] || '';
const firstSql = first ? read(`supabase/migrations/${first}`) : '';
check('lineage begins with the declared production adoption migration', first === FIRST_ADOPTED_MIGRATION, first);
check('first migration proves it requires existing production master data',
  /Account\/org repair preflight expected 9 active users/.test(firstSql)
    && /from public\.finance_users/.test(firstSql)
    && !/create\s+table[\s\S]*?finance_users/i.test(firstSql));

check('Supabase config declares no clean-slate schema baseline',
  /\[db\.migrations\][\s\S]*?schema_paths\s*=\s*\[\s*\]/.test(config));
check('configured seed is absent and therefore cannot simulate production data',
  /\[db\.seed\][\s\S]*?sql_paths\s*=\s*\[\s*["']\.\/seed\.sql["']\s*\]/.test(config)
    && !fs.existsSync(path.join(ROOT, 'supabase/seed.sql')));
check('CI does not run a misleading empty-database reset',
  !/(?:supabase\s+(?:start|stop)|supabase\s+db\s+reset)/i.test(workflow));

const releaseIndex = migrations.indexOf(ROUTE_AUTHORITY_MIGRATION);
const releaseSql = releaseIndex >= 0 ? read(`supabase/migrations/${ROUTE_AUTHORITY_MIGRATION}`) : '';
const adoptedRepairIndex = migrations.indexOf(LATEST_ADOPTED_MIGRATION);
const adoptedRepairSql = adoptedRepairIndex >= 0 ? read(`supabase/migrations/${LATEST_ADOPTED_MIGRATION}`) : '';
const routeHotfixIndex = migrations.indexOf(TOP_LEVEL_ROUTE_HOTFIX);
const routeHotfixSql = routeHotfixIndex >= 0 ? read(`supabase/migrations/${TOP_LEVEL_ROUTE_HOTFIX}`) : '';
const statusHotfixIndex = migrations.indexOf(EXPENSE_STATUS_HOTFIX);
const statusHotfixSql = statusHotfixIndex >= 0 ? read(`supabase/migrations/${EXPENSE_STATUS_HOTFIX}`) : '';
const finalAccountantHotfixIndex = migrations.indexOf(FINAL_ACCOUNTANT_SELF_POST_HOTFIX);
const finalAccountantHotfixSql = finalAccountantHotfixIndex >= 0
  ? read(`supabase/migrations/${FINAL_ACCOUNTANT_SELF_POST_HOTFIX}`)
  : '';
const cashierRepairIndex = migrations.indexOf(FORMAL_CASHIER_REPAIR);
const cashierRepairSql = cashierRepairIndex >= 0 ? read(`supabase/migrations/${FORMAL_CASHIER_REPAIR}`) : '';
const cashierSelfDisbursementIndex = migrations.indexOf(FORMAL_CASHIER_SELF_DISBURSEMENT);
const cashierSelfDisbursementSql = cashierSelfDisbursementIndex >= 0
  ? read(`supabase/migrations/${FORMAL_CASHIER_SELF_DISBURSEMENT}`)
  : '';
const humanAccountingIndex = migrations.indexOf(HUMAN_ACCOUNTING_AUTHORITY);
const humanAccountingSql = humanAccountingIndex >= 0 ? read(`supabase/migrations/${HUMAN_ACCOUNTING_AUTHORITY}`) : '';
const staleAttemptBranch = releaseSql.match(/if v_attempt_id is null then([\s\S]*?)end if;/)?.[1] || '';
const futureRouteGuard = releaseSql.match(/create function private\.finance_expense_assert_applicant_revision_future_route_v3\([\s\S]*?\$function\$;/)?.[0] || '';
check('route authority and all reviewed production hotfixes are the exact lineage suffix',
  releaseIndex === migrations.length - HISTORY_PERFORMANCE_MIGRATIONS.length-READ_LATENCY_MIGRATIONS.length-AR_MAPPING_MIGRATIONS.length-AUDIT_REMEDIATION_MIGRATIONS.length - EMPLOYEE_RELIABILITY_MIGRATIONS.length - AUDIT_READINESS_MIGRATIONS.length - REPORTING_INTEGRITY_MIGRATIONS.length - AMOUNT_SEARCH_MIGRATIONS.length - REPORT_MIGRATIONS.length - UTILITY_MIGRATIONS.length - CASE_MIGRATIONS.length - AUDIT_MIGRATIONS.length - 8
    && adoptedRepairIndex === migrations.length - HISTORY_PERFORMANCE_MIGRATIONS.length-READ_LATENCY_MIGRATIONS.length-AR_MAPPING_MIGRATIONS.length-AUDIT_REMEDIATION_MIGRATIONS.length - EMPLOYEE_RELIABILITY_MIGRATIONS.length - AUDIT_READINESS_MIGRATIONS.length - REPORTING_INTEGRITY_MIGRATIONS.length - AMOUNT_SEARCH_MIGRATIONS.length - REPORT_MIGRATIONS.length - UTILITY_MIGRATIONS.length - CASE_MIGRATIONS.length - AUDIT_MIGRATIONS.length - 7
    && routeHotfixIndex === migrations.length - HISTORY_PERFORMANCE_MIGRATIONS.length-READ_LATENCY_MIGRATIONS.length-AR_MAPPING_MIGRATIONS.length-AUDIT_REMEDIATION_MIGRATIONS.length - EMPLOYEE_RELIABILITY_MIGRATIONS.length - AUDIT_READINESS_MIGRATIONS.length - REPORTING_INTEGRITY_MIGRATIONS.length - AMOUNT_SEARCH_MIGRATIONS.length - REPORT_MIGRATIONS.length - UTILITY_MIGRATIONS.length - CASE_MIGRATIONS.length - AUDIT_MIGRATIONS.length - 6
    && statusHotfixIndex === migrations.length - HISTORY_PERFORMANCE_MIGRATIONS.length-READ_LATENCY_MIGRATIONS.length-AR_MAPPING_MIGRATIONS.length-AUDIT_REMEDIATION_MIGRATIONS.length - EMPLOYEE_RELIABILITY_MIGRATIONS.length - AUDIT_READINESS_MIGRATIONS.length - REPORTING_INTEGRITY_MIGRATIONS.length - AMOUNT_SEARCH_MIGRATIONS.length - REPORT_MIGRATIONS.length - UTILITY_MIGRATIONS.length - CASE_MIGRATIONS.length - AUDIT_MIGRATIONS.length - 5
    && finalAccountantHotfixIndex === migrations.length - HISTORY_PERFORMANCE_MIGRATIONS.length-READ_LATENCY_MIGRATIONS.length-AR_MAPPING_MIGRATIONS.length-AUDIT_REMEDIATION_MIGRATIONS.length - EMPLOYEE_RELIABILITY_MIGRATIONS.length - AUDIT_READINESS_MIGRATIONS.length - REPORTING_INTEGRITY_MIGRATIONS.length - AMOUNT_SEARCH_MIGRATIONS.length - REPORT_MIGRATIONS.length - UTILITY_MIGRATIONS.length - CASE_MIGRATIONS.length - AUDIT_MIGRATIONS.length - 4
    && cashierRepairIndex === migrations.length - HISTORY_PERFORMANCE_MIGRATIONS.length-READ_LATENCY_MIGRATIONS.length-AR_MAPPING_MIGRATIONS.length-AUDIT_REMEDIATION_MIGRATIONS.length - EMPLOYEE_RELIABILITY_MIGRATIONS.length - AUDIT_READINESS_MIGRATIONS.length - REPORTING_INTEGRITY_MIGRATIONS.length - AMOUNT_SEARCH_MIGRATIONS.length - REPORT_MIGRATIONS.length - UTILITY_MIGRATIONS.length - CASE_MIGRATIONS.length - AUDIT_MIGRATIONS.length - 3
    && cashierSelfDisbursementIndex === migrations.length - HISTORY_PERFORMANCE_MIGRATIONS.length-READ_LATENCY_MIGRATIONS.length-AR_MAPPING_MIGRATIONS.length-AUDIT_REMEDIATION_MIGRATIONS.length - EMPLOYEE_RELIABILITY_MIGRATIONS.length - AUDIT_READINESS_MIGRATIONS.length - REPORTING_INTEGRITY_MIGRATIONS.length - AMOUNT_SEARCH_MIGRATIONS.length - REPORT_MIGRATIONS.length - UTILITY_MIGRATIONS.length - CASE_MIGRATIONS.length - AUDIT_MIGRATIONS.length - 2
    && humanAccountingIndex === migrations.length - HISTORY_PERFORMANCE_MIGRATIONS.length-READ_LATENCY_MIGRATIONS.length-AR_MAPPING_MIGRATIONS.length-AUDIT_REMEDIATION_MIGRATIONS.length - EMPLOYEE_RELIABILITY_MIGRATIONS.length - AUDIT_READINESS_MIGRATIONS.length - REPORTING_INTEGRITY_MIGRATIONS.length - AMOUNT_SEARCH_MIGRATIONS.length - REPORT_MIGRATIONS.length - UTILITY_MIGRATIONS.length - CASE_MIGRATIONS.length - AUDIT_MIGRATIONS.length - 1,
  migrations[migrations.length - 1] || '(none)');
check('audited batch is the exact ordered predecessor of cases and utility',migrations.slice(-AUDIT_MIGRATIONS.length-CASE_MIGRATIONS.length-UTILITY_MIGRATIONS.length-REPORT_MIGRATIONS.length-AMOUNT_SEARCH_MIGRATIONS.length-REPORTING_INTEGRITY_MIGRATIONS.length-AUDIT_READINESS_MIGRATIONS.length-HISTORY_PERFORMANCE_MIGRATIONS.length-READ_LATENCY_MIGRATIONS.length-AR_MAPPING_MIGRATIONS.length-AUDIT_REMEDIATION_MIGRATIONS.length-EMPLOYEE_RELIABILITY_MIGRATIONS.length,-CASE_MIGRATIONS.length-UTILITY_MIGRATIONS.length-REPORT_MIGRATIONS.length-AMOUNT_SEARCH_MIGRATIONS.length-REPORTING_INTEGRITY_MIGRATIONS.length-AUDIT_READINESS_MIGRATIONS.length-HISTORY_PERFORMANCE_MIGRATIONS.length-READ_LATENCY_MIGRATIONS.length-AR_MAPPING_MIGRATIONS.length-AUDIT_REMEDIATION_MIGRATIONS.length-EMPLOYEE_RELIABILITY_MIGRATIONS.length).map(name=>name.slice(0,14)).join(',')===AUDIT_MIGRATIONS.join(','));
check('database cases are the exact ordered predecessor of utility',migrations.slice(-CASE_MIGRATIONS.length-UTILITY_MIGRATIONS.length-REPORT_MIGRATIONS.length-AMOUNT_SEARCH_MIGRATIONS.length-REPORTING_INTEGRITY_MIGRATIONS.length-AUDIT_READINESS_MIGRATIONS.length-HISTORY_PERFORMANCE_MIGRATIONS.length-READ_LATENCY_MIGRATIONS.length-AR_MAPPING_MIGRATIONS.length-AUDIT_REMEDIATION_MIGRATIONS.length-EMPLOYEE_RELIABILITY_MIGRATIONS.length,-UTILITY_MIGRATIONS.length-REPORT_MIGRATIONS.length-AMOUNT_SEARCH_MIGRATIONS.length-REPORTING_INTEGRITY_MIGRATIONS.length-AUDIT_READINESS_MIGRATIONS.length-HISTORY_PERFORMANCE_MIGRATIONS.length-READ_LATENCY_MIGRATIONS.length-AR_MAPPING_MIGRATIONS.length-AUDIT_REMEDIATION_MIGRATIONS.length-EMPLOYEE_RELIABILITY_MIGRATIONS.length).map(name=>name.slice(0,14)).join(',')===CASE_MIGRATIONS.join(','));
check('utility tax is the exact ordered predecessor of reports',migrations.slice(-UTILITY_MIGRATIONS.length-REPORT_MIGRATIONS.length-AMOUNT_SEARCH_MIGRATIONS.length-REPORTING_INTEGRITY_MIGRATIONS.length-AUDIT_READINESS_MIGRATIONS.length-HISTORY_PERFORMANCE_MIGRATIONS.length-READ_LATENCY_MIGRATIONS.length-AR_MAPPING_MIGRATIONS.length-AUDIT_REMEDIATION_MIGRATIONS.length-EMPLOYEE_RELIABILITY_MIGRATIONS.length,-REPORT_MIGRATIONS.length-AMOUNT_SEARCH_MIGRATIONS.length-REPORTING_INTEGRITY_MIGRATIONS.length-AUDIT_READINESS_MIGRATIONS.length-HISTORY_PERFORMANCE_MIGRATIONS.length-READ_LATENCY_MIGRATIONS.length-AR_MAPPING_MIGRATIONS.length-AUDIT_REMEDIATION_MIGRATIONS.length-EMPLOYEE_RELIABILITY_MIGRATIONS.length).map(name=>name.slice(0,14)).join(',')===UTILITY_MIGRATIONS.join(','));
check('financial reports are the exact predecessor of amount search',migrations.slice(-REPORT_MIGRATIONS.length-AMOUNT_SEARCH_MIGRATIONS.length-REPORTING_INTEGRITY_MIGRATIONS.length-AUDIT_READINESS_MIGRATIONS.length-HISTORY_PERFORMANCE_MIGRATIONS.length-READ_LATENCY_MIGRATIONS.length-AR_MAPPING_MIGRATIONS.length-AUDIT_REMEDIATION_MIGRATIONS.length-EMPLOYEE_RELIABILITY_MIGRATIONS.length,-AMOUNT_SEARCH_MIGRATIONS.length-REPORTING_INTEGRITY_MIGRATIONS.length-AUDIT_READINESS_MIGRATIONS.length-HISTORY_PERFORMANCE_MIGRATIONS.length-READ_LATENCY_MIGRATIONS.length-AR_MAPPING_MIGRATIONS.length-AUDIT_REMEDIATION_MIGRATIONS.length-EMPLOYEE_RELIABILITY_MIGRATIONS.length).map(name=>name.slice(0,14)).join(',')===REPORT_MIGRATIONS.join(','));
check('amount search is the exact predecessor of reporting integrity',migrations.slice(-AMOUNT_SEARCH_MIGRATIONS.length-REPORTING_INTEGRITY_MIGRATIONS.length-AUDIT_READINESS_MIGRATIONS.length-HISTORY_PERFORMANCE_MIGRATIONS.length-READ_LATENCY_MIGRATIONS.length-AR_MAPPING_MIGRATIONS.length-AUDIT_REMEDIATION_MIGRATIONS.length-EMPLOYEE_RELIABILITY_MIGRATIONS.length,-REPORTING_INTEGRITY_MIGRATIONS.length-AUDIT_READINESS_MIGRATIONS.length-HISTORY_PERFORMANCE_MIGRATIONS.length-READ_LATENCY_MIGRATIONS.length-AR_MAPPING_MIGRATIONS.length-AUDIT_REMEDIATION_MIGRATIONS.length-EMPLOYEE_RELIABILITY_MIGRATIONS.length).map(name=>name.slice(0,14)).join(',')===AMOUNT_SEARCH_MIGRATIONS.join(','));
check('reporting integrity is the exact ordered predecessor of audit readiness',migrations.slice(-REPORTING_INTEGRITY_MIGRATIONS.length-AUDIT_READINESS_MIGRATIONS.length-HISTORY_PERFORMANCE_MIGRATIONS.length-READ_LATENCY_MIGRATIONS.length-AR_MAPPING_MIGRATIONS.length-AUDIT_REMEDIATION_MIGRATIONS.length-EMPLOYEE_RELIABILITY_MIGRATIONS.length,-AUDIT_READINESS_MIGRATIONS.length-HISTORY_PERFORMANCE_MIGRATIONS.length-READ_LATENCY_MIGRATIONS.length-AR_MAPPING_MIGRATIONS.length-AUDIT_REMEDIATION_MIGRATIONS.length-EMPLOYEE_RELIABILITY_MIGRATIONS.length).map(name=>name.slice(0,14)).join(',')===REPORTING_INTEGRITY_MIGRATIONS.join(','));
check('audit readiness is the exact fixed predecessor of employee reliability',AUDIT_READINESS_MIGRATIONS.join(',')==='20260911151054' && migrations.slice(-AUDIT_READINESS_MIGRATIONS.length-HISTORY_PERFORMANCE_MIGRATIONS.length-READ_LATENCY_MIGRATIONS.length-AR_MAPPING_MIGRATIONS.length-AUDIT_REMEDIATION_MIGRATIONS.length-EMPLOYEE_RELIABILITY_MIGRATIONS.length,-HISTORY_PERFORMANCE_MIGRATIONS.length-READ_LATENCY_MIGRATIONS.length-AR_MAPPING_MIGRATIONS.length-AUDIT_REMEDIATION_MIGRATIONS.length-EMPLOYEE_RELIABILITY_MIGRATIONS.length).join(',')==='20260911151054_finance_audit_readiness_v1.sql');
check('employee reliability is the exact fixed predecessor of history performance',EMPLOYEE_RELIABILITY_MIGRATIONS.join(',')==='20260912145849' && migrations.slice(-HISTORY_PERFORMANCE_MIGRATIONS.length-READ_LATENCY_MIGRATIONS.length-AR_MAPPING_MIGRATIONS.length-AUDIT_REMEDIATION_MIGRATIONS.length-EMPLOYEE_RELIABILITY_MIGRATIONS.length,-HISTORY_PERFORMANCE_MIGRATIONS.length-READ_LATENCY_MIGRATIONS.length-AR_MAPPING_MIGRATIONS.length-AUDIT_REMEDIATION_MIGRATIONS.length).join(',')==='20260912145849_finance_employee_payment_concerns_v1.sql');
check('history performance is the exact fixed predecessor of source paging',HISTORY_PERFORMANCE_MIGRATIONS.join(',')==='20260912164807' && migrations.slice(-HISTORY_PERFORMANCE_MIGRATIONS.length-READ_LATENCY_MIGRATIONS.length-AR_MAPPING_MIGRATIONS.length-AUDIT_REMEDIATION_MIGRATIONS.length,-READ_LATENCY_MIGRATIONS.length-AR_MAPPING_MIGRATIONS.length-AUDIT_REMEDIATION_MIGRATIONS.length).join(',')==='20260912164807_finance_approval_history_page_first_v1.sql');
check('statement source paging is the exact fixed predecessor of AR mapping',
  READ_LATENCY_MIGRATIONS.join(',') === '20260913042629'
    && migrations.slice(-READ_LATENCY_MIGRATIONS.length-AR_MAPPING_MIGRATIONS.length-AUDIT_REMEDIATION_MIGRATIONS.length,-AR_MAPPING_MIGRATIONS.length-AUDIT_REMEDIATION_MIGRATIONS.length).join(',')
      === '20260913042629_finance_statement_source_page_v1.sql');
check('AR mapping is the exact fixed predecessor of audit remediation',AR_MAPPING_MIGRATIONS.join(',')==='20260913061745' && migrations.slice(-AR_MAPPING_MIGRATIONS.length-AUDIT_REMEDIATION_MIGRATIONS.length,-AUDIT_REMEDIATION_MIGRATIONS.length).join(',')==='20260913061745_finance_ar_mapping_set_based_v1.sql');
check('audit remediation is the exact ordered final suffix',AUDIT_REMEDIATION_MIGRATIONS.join(',')==='20260914001246,20260914001252' && migrations.slice(-AUDIT_REMEDIATION_MIGRATIONS.length).join(',')==='20260914001246_finance_dashboard_scope_integrity_v1.sql,20260914001252_finance_google_projection_identity_v3.sql');
const statementSourceSql = read('supabase/migrations/20260913042629_finance_statement_source_page_v1.sql');
const statementSourceBody = statementSourceSql.match(/as \$function\$([\s\S]*?)\$function\$;/i)?.[1] || '';
check('source paging remains a stable SECURITY INVOKER browser read with a fixed search path',
  /language plpgsql stable security invoker\s+set search_path = ''/i.test(statementSourceSql)
    && !/security\s+definer/i.test(statementSourceSql)
    && /alter function public\.finance_statement_source_page_v1\(text,text,integer,integer\) owner to postgres/i.test(statementSourceSql)
    && /revoke all on function public\.finance_statement_source_page_v1\(text,text,integer,integer\) from public, anon, service_role/i.test(statementSourceSql)
    && /grant execute on function public\.finance_statement_source_page_v1\(text,text,integer,integer\) to authenticated/i.test(statementSourceSql));
check('source paging shares one RLS-visible count and page for exactly three static sources',
  (statementSourceBody.match(/with visible as materialized/g) || []).length === 3
    && ['expense_requests','bills','invoices'].every(table => statementSourceBody.includes('from public.' + table + ' source_row'))
    && (statementSourceBody.match(/source_row\.tenant_id = v_tenant_id/g) || []).length === 3
    && (statementSourceBody.match(/source_row\.data_environment = p_data_environment/g) || []).length === 3
    && (statementSourceBody.match(/select count\(\*\) from visible/g) || []).length === 3
    && (statementSourceBody.match(/order by id asc limit p_limit offset p_offset/g) || []).length === 3
    && !/^\s*execute\b/im.test(statementSourceBody));
check('source paging derives verified tenant identity and never mutates old data or RLS policies',
  statementSourceBody.includes('if auth.uid() is null then')
    && statementSourceBody.includes('v_tenant_id := public.current_tenant_id()')
    && statementSourceBody.includes('v_actor_id := public.current_finance_user_id()')
    && statementSourceBody.includes("p_data_environment not in ('production', 'test')")
    && statementSourceBody.includes('p_limit > 1000')
    && statementSourceBody.includes('p_offset < 0')
    && !/\b(?:insert\s+into|update\s+public\.|delete\s+from|alter\s+table|(?:create|alter|drop)\s+policy)\b/i.test(statementSourceSql)
    && /do \$postflight\$/.test(statementSourceSql)
    && /notify pgrst, 'reload schema'/.test(statementSourceSql));
for(const version of [...AUDIT_MIGRATIONS,...CASE_MIGRATIONS,...UTILITY_MIGRATIONS,...REPORT_MIGRATIONS,...AMOUNT_SEARCH_MIGRATIONS,...REPORTING_INTEGRITY_MIGRATIONS,...AUDIT_READINESS_MIGRATIONS,...EMPLOYEE_RELIABILITY_MIGRATIONS,...HISTORY_PERFORMANCE_MIGRATIONS,...READ_LATENCY_MIGRATIONS,...AR_MAPPING_MIGRATIONS,...AUDIT_REMEDIATION_MIGRATIONS]){
  const file=migrations.find(name=>name.startsWith(version+'_'));
  if(file)require('./finance_production_release_guard').assertCliAtomicMigration(read('supabase/migrations/'+file),file);
}
check('current release migration leaves transaction and ledger atomicity to the pinned CLI',
  !/^\s*(?:begin|commit|rollback)(?:\s+(?:work|transaction))?\s*;\s*$/im.test(releaseSql)
    && !/^\s*(?:(?:create(?:\s+unique)?\s+index|drop\s+index)\s+concurrently\b|reindex\b[^;]*\bconcurrently\b|vacuum\b|alter\s+system\b|cluster\b)/im.test(releaseSql)
    && /set local lock_timeout/.test(releaseSql)
    && /set local statement_timeout/.test(releaseSql));
check('conditional-expression lint covers spacing, line breaks, and quoted identifiers',
  [
    'pg_catalog.greatest(1, 2)',
    'pg_catalog . least(1, 2)',
    'pg_catalog.\n coalesce(1, 2)',
    '"pg_catalog"."nullif"(1, 2)',
  ].every((source) => SCHEMA_QUALIFIED_CONDITIONAL_EXPRESSION.test(source))
    && [
      'greatest(1, 2)',
      'pg_catalog.btrim(value)',
    ].every((source) => !SCHEMA_QUALIFIED_CONDITIONAL_EXPRESSION.test(source)));
check('current release does not schema-qualify PostgreSQL conditional expressions',
  !SCHEMA_QUALIFIED_CONDITIONAL_EXPRESSION.test(releaseSql));
check('current release migration contains fail-closed preflight and postflight',
  /do \$preflight\$/.test(releaseSql)
    && /do \$postflight\$/.test(releaseSql)
    && /notify pgrst, 'reload schema'/.test(releaseSql));
check('current v3 release independently guards manager auto-skip and rejects stale pre-v3 tabs',
  /finance_expense_assert_dept_manager_autoskip_v3/.test(releaseSql)
    && /finance_org_resolve_actor\(\s*'direct_supervisor'/.test(releaseSql)
    && /finance_org_resolve_actor\(\s*'dept_manager'/.test(releaseSql)
    && staleAttemptBranch.includes('頁面版本已過期，請重新整理後再送出')
    && staleAttemptBranch.includes("errcode = '55000'")
    && !staleAttemptBranch.includes('finance_submit_expense_request_v1_unsafe')
    && !staleAttemptBranch.includes('return')
    && /finance_expense_assert_applicant_revision_future_route_v3/.test(releaseSql)
    && /finance_expense_resubmit_applicant_revision_v1_unsafe/.test(releaseSql));
check('current v3 release preserves completed applicant-revision history and validates only the current future suffix',
  futureRouteGuard.includes('into v_historical_key_count, v_historical_anchor_index')
    && futureRouteGuard.includes('v_expected_index := greatest(')
    && !futureRouteGuard.includes('pg_catalog.greatest(')
    && futureRouteGuard.includes('v_historical_anchor_index + 1')
    && futureRouteGuard.indexOf('if v_actual_index < p_active_index then')
      < futureRouteGuard.indexOf('if v_expected_index >= pg_catalog.jsonb_array_length(v_expected_steps)'));
check('latest adopted repair is atomic-safe and tied to the exact verified admin.ntpc identities',
  !/^\s*(?:begin|commit|rollback)(?:\s+(?:work|transaction))?\s*;\s*$/im.test(adoptedRepairSql)
    && !/^\s*(?:(?:create(?:\s+unique)?\s+index|drop\s+index)\s+concurrently\b|reindex\b[^;]*\bconcurrently\b|vacuum\b|alter\s+system\b|cluster\b)/im.test(adoptedRepairSql)
    && adoptedRepairSql.includes("v_auth_user_id uuid := 'c50e9e4f-0b63-44e9-b445-9dd5fe7d9f2e'::uuid")
    && adoptedRepairSql.includes("v_portal_user_id uuid := 'b1f0c6bd-3e22-45c0-b6f4-81d7ebd3d369'::uuid")
    && adoptedRepairSql.includes("v_retired_employee_id uuid := '6c101aa3-b91d-4590-ae7a-5df070af2793'::uuid")
    && adoptedRepairSql.includes("v_active_employee_id uuid := '73c0ce88-c0f7-4276-ba0e-938cea9d53ce'::uuid")
    && adoptedRepairSql.includes("v_active_company_id uuid := 'd114b583-824e-42c9-9d4e-5ab3cf17ac65'::uuid")
    && adoptedRepairSql.includes("employee_no = 'u_1785138353548'")
    && adoptedRepairSql.includes('Portal user did not converge to active employee projection'));
check('top-level route hotfix is atomic-safe, hash-pinned, and cannot alter organization assignments',
  !/^\s*(?:begin|commit|rollback)(?:\s+(?:work|transaction))?\s*;\s*$/im.test(routeHotfixSql)
    && !/^\s*(?:(?:create(?:\s+unique)?\s+index|drop\s+index)\s+concurrently\b|reindex\b[^;]*\bconcurrently\b|vacuum\b|alter\s+system\b|cluster\b)/im.test(routeHotfixSql)
    && routeHotfixSql.includes('c5b8ac8042c4df045589a5f25ec05ee3c5d660b9692efe0182c17f07c0cf25eb')
    && routeHotfixSql.includes('direct_supervisor_finance_user_id')
    && routeHotfixSql.includes('department_manager_finance_user_id')
    && routeHotfixSql.includes('department_director_finance_user_id')
    && !/insert\s+into\s+public\.employee_department_roles/i.test(routeHotfixSql)
    && !/update\s+public\.employee_department_roles/i.test(routeHotfixSql));
check('expense status hotfix derives projections server-side without changing workflow authority',
  !/^\s*(?:begin|commit|rollback)(?:\s+(?:work|transaction))?\s*;\s*$/im.test(statusHotfixSql)
    && statusHotfixSql.includes('4c309af8e1cd1384fe6121a452d2a378d1f3ed07cf3a32c0618b97913b1f6927')
    && statusHotfixSql.includes('private.finance_income_status_from_steps')
    && statusHotfixSql.includes("''status'', v_derived ->> ''approval_status''")
    && statusHotfixSql.includes("''step'', (v_derived ->> ''approval_step'')::integer")
    && !/insert\s+into\s+public\.expense_requests/i.test(statusHotfixSql)
    && !/update\s+public\.expense_requests/i.test(statusHotfixSql)
    && !/employee_department_roles/i.test(statusHotfixSql));
check('final-accountant hotfix permits only the explicitly frozen final posting actor',
  !/^\s*(?:begin|commit|rollback)(?:\s+(?:work|transaction))?\s*;\s*$/im.test(finalAccountantHotfixSql)
    && finalAccountantHotfixSql.includes('5ec7df359d84b46c7824f57b8d96dd1d1b0300c197f4d68e31ee22157450c0dd')
    && finalAccountantHotfixSql.includes("p_expense.status = 'pending_voucher'")
    && finalAccountantHotfixSql.includes("v_role_key in ('accountant_final', 'accounting')")
    && finalAccountantHotfixSql.includes('p_step_index =')
    && finalAccountantHotfixSql.includes('v_explicit_user_id = p_actor_finance_user_id')
    && !/(?:insert\s+into|update|delete\s+from)\s+public\.(?:expense_requests|employee_department_roles|finance_users)/i.test(finalAccountantHotfixSql));
check('formal cashier repair is atomic-safe, hash-pinned, removes the GA fallback, and audits all three transfers',
  !/^\s*(?:begin|commit|rollback)(?:\s+(?:work|transaction))?\s*;\s*$/im.test(cashierRepairSql)
    && !/^\s*(?:(?:create(?:\s+unique)?\s+index|drop\s+index)\s+concurrently\b|reindex\b[^;]*\bconcurrently\b|vacuum\b|alter\s+system\b|cluster\b)/im.test(cashierRepairSql)
    && cashierRepairSql.includes('52e4fe984d2ee7bbadb72a6d96dfe443caf9de91b08eba689e21249a78a33213')
    && cashierRepairSql.includes('1fff070fc78f2d0182647f496b51119ecfa072a7b189bc25fb767567d99c874a')
    && cashierRepairSql.includes(`v_old_cashier_normalization constant text := 'when ''cashier'' then ''general_affairs'''`)
    && cashierRepairSql.includes("v_old_general_affairs_fallback constant text := 'or (p_role_key = ''cashier'' and fu.role = ''general_affairs'')'")
    && cashierRepairSql.includes("v_cashier_user_id constant text := 'u_entrepreneur'")
    && cashierRepairSql.includes("v_target_nos constant text[] := array['20260827012','20260831007','20260831008']")
    && cashierRepairSql.includes("'cashier_reassigned'")
    && cashierRepairSql.includes("'reassignmentHistory'")
    && cashierRepairSql.includes('if v_request_count <> 3 then')
    && cashierRepairSql.includes('if v_audit_count <> 3 then'));
check('human accounting authority is atomic-safe, fail-closed, audited, and synchronizes normalized lines',
  !/^\s*(?:begin|commit|rollback)(?:\s+(?:work|transaction))?\s*;\s*$/im.test(humanAccountingSql)
    && !/^\s*(?:(?:create(?:\s+unique)?\s+index|drop\s+index)\s+concurrently\b|reindex\b[^;]*\bconcurrently\b|vacuum\b|alter\s+system\b|cluster\b)/im.test(humanAccountingSql)
    && /set local lock_timeout/.test(humanAccountingSql)
    && /set local statement_timeout/.test(humanAccountingSql)
    && /do \$preflight\$/.test(humanAccountingSql)
    && /do \$postflight\$/.test(humanAccountingSql)
    && /notify pgrst, 'reload schema'/.test(humanAccountingSql)
    && humanAccountingSql.includes('trg_zz_finance_preserve_human_accounting_authority')
    && humanAccountingSql.includes('trg_zz_finance_sync_request_accounting_lines')
    && humanAccountingSql.includes("'HUMAN_ACCOUNTING_SYNC'")
    && humanAccountingSql.includes('on conflict (request_id, line_index) do update'));

check('formal cashier self-disbursement hotfix is narrow, hash-pinned, and data preserving',
  !/^\s*(?:begin|commit|rollback)(?:\s+(?:work|transaction))?\s*;\s*$/im.test(cashierSelfDisbursementSql)
    && cashierSelfDisbursementSql.includes('36c621ce91d061a58b56453321980a19e75d4bc0f521ad1340641e70c2c59938')
    && cashierSelfDisbursementSql.includes("p_expense.status = 'pending_cashier'")
    && cashierSelfDisbursementSql.includes('p_expense.cash_posted_at is null')
    && cashierSelfDisbursementSql.includes("v_role_key = 'cashier'")
    && cashierSelfDisbursementSql.includes('v_explicit_user_id = p_actor_finance_user_id')
    && cashierSelfDisbursementSql.includes("cashier_role.role_key = 'cashier'")
    && cashierSelfDisbursementSql.includes('cashier_role.active is true')
    && cashierSelfDisbursementSql.includes('cashier_role.can_approve is true')
    && !/(?:insert\s+into|update|delete\s+from)\s+public\.(?:expense_requests|employee_department_roles|finance_users)/i.test(cashierSelfDisbursementSql));

check('release guide requires controlled remote rehearsal before promotion',
  releaseGuide.includes('transaction-control')
    && releaseGuide.includes('pipeline-incompatible')
    && releaseGuide.includes('remote schema gate')
    && releaseGuide.includes('不能宣稱 clean-slate replay'));
check('release guide records the future baseline engineering requirement',
  releaseGuide.includes('squash baseline'));

process.stdout.write(`\nAdopted migration lineage: ${passed}/${passed + failed} passed.\n`);
if (failed) process.exit(1);
