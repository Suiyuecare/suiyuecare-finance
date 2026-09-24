#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

const migration = read('supabase/migrations/20260924155142_finance_operational_stability_v1.sql');
const postflight = read('scripts/finance_operational_stability_postflight.sql');
const canary = read('scripts/finance_operational_stability_canary.sql');
const workflow = read('.github/workflows/finance-production-release.yml');
const guard = read('scripts/finance_production_release_guard.js');
const packageJson = JSON.parse(read('package.json'));

for (const table of ['expense_requests', 'bills', 'invoices']) {
  assert.match(migration, new RegExp(`create index if not exists ${table}_tenant_environment_id_stability_idx\\s+on public\\.${table} \\(tenant_id, data_environment, id\\)`, 'i'));
  assert.match(postflight, new RegExp(`'${table}_tenant_environment_id_stability_idx','${table}'`));
}
assert.match(migration, /create or replace function public\.finance_approval_actor_health\(p_data_environment text default 'production'\)[\s\S]+language plpgsql stable security invoker\s+set search_path = ''/i);
const actorHealthBody = migration.match(/create or replace function public\.finance_approval_actor_health\(p_data_environment text default 'production'\)[\s\S]+?as \$function\$([\s\S]*?)\$function\$;/i)?.[1];
assert.ok(actorHealthBody, 'reviewed approval health function body is extractable');
const actorHealthBodyMd5 = crypto.createHash('md5').update(actorHealthBody).digest('hex');
assert.equal(actorHealthBodyMd5, '96acac6e2745bc4786bcc5b7fd58fd5a', 'PostgreSQL stores the exact dollar-quoted source, including surrounding newlines');
assert.ok(migration.includes(`pg_catalog.md5(p.prosrc)<>'${actorHealthBodyMd5}'`), 'migration postflight pins the exact pg_proc source');
assert.ok(postflight.includes(`pg_catalog.md5(p.prosrc)<>'${actorHealthBodyMd5}'`), 'release postflight pins the exact pg_proc source');
assert.equal((migration.match(/jsonb_array_elements\(/g) || []).length, 2, 'one JSON-step expansion per tenant-scoped form source');
assert.match(migration, /revoke all on function public\.current_hr_user_company_id\(\) from public, anon;[\s\S]+grant execute on function public\.current_hr_user_company_id\(\) to authenticated, service_role/i);
assert.match(migration, /alter function public\.current_hr_user_company_id\(\) set search_path = ''/i);
for (const signature of [
  'public.touch_application_accounting_lines_updated_at()',
  'public.touch_payee_bank_accounts_updated_at()',
  'public.hr_department_type_from_code(text,text)',
  'public.hr_role_scope(text)',
  'private.finance_approval_steps_array(jsonb)',
  'private.finance_approval_step_role_key(jsonb)',
  'private.finance_approval_step_is_approved(jsonb)',
  'private.finance_steps_role_approved(jsonb,text[])',
  'private.finance_unapproved_step_count(jsonb)'
]) assert.ok(migration.includes(`alter function ${signature} set search_path = ''`), `missing fixed search_path: ${signature}`);
assert.doesNotMatch(migration, /\b(?:insert\s+into|update\s+\w+\s+set|delete\s+from|truncate\s+)\b/i, 'migration changes schema and routine configuration only');
assert.doesNotMatch(migration, /create or replace function public\.finance_statement_source_page_v1/i, 'keeps the measured single-scan statement source RPC intact');
assert.match(postflight, /finance_statement_source_page_v1[\s\S]+fe39d7ec0b151e30cc36e9e2cb7538dc/);
assert.match(canary, /begin isolation level repeatable read read only;[\s\S]+rollback;[\s\S]+operational_stability_canary_result/);
assert.doesNotMatch(canary, /\b(?:insert\s+into|update\s+\S+\s+set|delete\s+from|set_config\s*\()/i);
assert.match(guard, /database_operational_stability_20260924/);
assert.match(workflow, /prepare-operational-stability-rehearsal[\s\S]+finance_operational_stability_canary\.sql[\s\S]+prepare-operational-stability-apply/);
assert.equal((workflow.match(/verify-reports-canary --domain operational_stability /g) || []).length, 2, 'canary runs after DB postflight and again before promotion');
assert.ok(packageJson.scripts['release:preflight'].includes('pnpm test:operational-stability-release'));
process.stdout.write('PASS operational stability migration scope, access and release coverage\n');
