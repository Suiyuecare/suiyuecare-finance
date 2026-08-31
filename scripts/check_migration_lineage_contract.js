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
const EXPENSE_STATUS_HOTFIX = '20260831043051_expense_submit_derived_status.sql';
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
const staleAttemptBranch = releaseSql.match(/if v_attempt_id is null then([\s\S]*?)end if;/)?.[1] || '';
const futureRouteGuard = releaseSql.match(/create function private\.finance_expense_assert_applicant_revision_future_route_v3\([\s\S]*?\$function\$;/)?.[0] || '';
check('route authority and reviewed production hotfixes are the exact lineage suffix',
  releaseIndex === migrations.length - 4
    && adoptedRepairIndex === migrations.length - 3
    && routeHotfixIndex === migrations.length - 2
    && statusHotfixIndex === migrations.length - 1,
  migrations[migrations.length - 1] || '(none)');
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

check('release guide requires controlled remote rehearsal before promotion',
  releaseGuide.includes('transaction-control')
    && releaseGuide.includes('pipeline-incompatible')
    && releaseGuide.includes('remote schema gate')
    && releaseGuide.includes('不能宣稱 clean-slate replay'));
check('release guide records the future baseline engineering requirement',
  releaseGuide.includes('squash baseline'));

process.stdout.write(`\nAdopted migration lineage: ${passed}/${passed + failed} passed.\n`);
if (failed) process.exit(1);
