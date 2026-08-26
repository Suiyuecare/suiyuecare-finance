#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const migrationPath = path.join(
  root,
  'supabase/migrations/20260826070814_reconcile_notification_tenant_and_staff_finance_access_v1.sql'
);
const sql = fs.readFileSync(migrationPath, 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${name}`);
  }
}

function occurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function dollarQuotesAreBalanced(source) {
  const counts = new Map();
  for (const tag of source.match(/\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$/g) || []) {
    counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return [...counts.values()].every((count) => count % 2 === 0);
}

const portalUpdate = sql.match(
  /update\s+public\.finance_portal_roles\s+portal_role\s+set\s+([\s\S]*?)\s+where\s+portal_role\.id\s*=\s*expected_role\.id[\s\S]*?;/i
);
const portalSetClause = portalUpdate ? portalUpdate[1] : '';
const expectedFinanceEntryRoles = [
  ['business-director', 'dept_manager'],
  ['ga-chief', 'general_affairs'],
  ['hr-chief', 'hr'],
  ['section-chief', 'section_chief'],
  ['staff', 'employee'],
  ['team-lead', 'section_chief']
];

check('migration leaves atomic migration plus ledger commit to the pinned CLI',
  !/^\s*(?:begin|commit|rollback)(?:\s+(?:work|transaction))?\s*;\s*$/im.test(sql)
  && !/^\s*(?:(?:create(?:\s+unique)?\s+index|drop\s+index)\s+concurrently\b|reindex\b[^;]*\bconcurrently\b|vacuum\b|alter\s+system\b|cluster\b)/im.test(sql)
  && /set local lock_timeout = '5s';/.test(sql)
  && /set local statement_timeout = '60s';/.test(sql)
  && dollarQuotesAreBalanced(sql));

check('notification columns are additive, typed, defaulted, and made non-null',
  /add column if not exists data_environment text;/i.test(sql)
  && /add column if not exists tenant_id uuid;/i.test(sql)
  && /alter column data_environment set default 'production'::text/i.test(sql)
  && /alter column data_environment set not null/i.test(sql)
  && /alter column tenant_id set default public\.default_tenant_id\(\)/i.test(sql)
  && /alter column tenant_id set not null/i.test(sql));

check('backfill changes only missing ownership values and never rewrites valid lanes',
  /set data_environment = 'production'\s+where notification_row\.data_environment is null;/i.test(sql)
  && /set tenant_id = public\.default_tenant_id\(\)\s+where notification_row\.tenant_id is null;/i.test(sql)
  && /invalid pre-existing values fail closed/i.test(sql));

check('environment and tenant constraints are installed and validated',
  /constraint notifications_data_environment_check_v1[\s\S]*?data_environment in \('production', 'test'\)[\s\S]*?not valid;/i.test(sql)
  && /constraint notifications_tenant_id_fkey_v1[\s\S]*?foreign key \(tenant_id\)[\s\S]*?references public\.tenants\(id\)[\s\S]*?on delete restrict[\s\S]*?not valid;/i.test(sql)
  && /validate constraint notifications_data_environment_check_v1;/i.test(sql)
  && /validate constraint notifications_tenant_id_fkey_v1;/i.test(sql));

check('tenant/environment lookup index is deterministic and postflight verified',
  /create index if not exists notifications_tenant_environment_created_idx_v1\s+on public\.notifications \(tenant_id, data_environment, created_at desc\);/i.test(sql)
  && /index_row\.indexdef ilike '%\(tenant_id, data_environment, created_at desc\)%'/i.test(sql));

check('v1 adds only the exact read-only path rollout alias over canonical storage_path',
  occurrences(sql, "attribute_row.attname = 'storage_path'") >= 2
  && occurrences(sql, "attribute_row.attname = 'path'") >= 2
  && /add column if not exists path text generated always as \(storage_path\) stored;/i.test(sql)
  && /attribute_row\.attgenerated = 's'/i.test(sql)
  && /pg_catalog\.pg_get_expr\(default_row\.adbin, default_row\.adrelid\) = 'storage_path'/i.test(sql)
  && !/\b(?:insert|update)\b[\s\S]{0,80}\bfile_attachments\b[\s\S]{0,80}\bpath\b/i.test(sql));

check('the exact six audited Portal roles receive one Finance entry idempotently',
  portalUpdate !== null
  && /modules\s*=\s*pg_catalog\.array_append\(portal_role\.modules, '會計系統'\)/i.test(portalSetClause)
  && expectedFinanceEntryRoles.every(([id, role]) =>
    new RegExp(`\\('${id}'::text, '${role}'::text\\)`, 'i').test(sql)
  )
  && /portal_role\.id = expected_role\.id/i.test(sql)
  && /portal_role\.finance_role = expected_role\.finance_role/i.test(sql)
  && /portal_role\.active/i.test(sql)
  && /array_positions\(portal_role\.modules, '會計系統'\)/i.test(sql)
  && /array_positions\(portal_role\.modules, '全部模組'\)/i.test(sql)
  && /An unaudited active Portal role is missing its Finance entry/i.test(sql));

check('database invariant prevents any future active Portal role from losing Finance entry visibility',
  /constraint finance_portal_roles_active_finance_entry_check_v1/i.test(sql)
  && /check \([\s\S]*?not active[\s\S]*?btrim\(finance_role\)[\s\S]*?array_positions\(modules, '會計系統'\)[\s\S]*?array_positions\(modules, '全部模組'\)[\s\S]*?not valid;/i.test(sql)
  && /validate constraint finance_portal_roles_active_finance_entry_check_v1;/i.test(sql)
  && /constraint_row\.convalidated/i.test(sql)
  && /Every active Portal role must have one Finance entry and a non-empty Finance role/i.test(sql));

check('retired duplicate employee repair is pinned to the audited immutable identity',
  /update public\.employees employee_row[\s\S]*?set employment_status = 'terminated'/i.test(sql)
  && /employee_row\.metadata ->> 'retired_at'/i.test(sql)
  && /termination_date = coalesce/i.test(sql)
  && /deleted_at = coalesce/i.test(sql)
  && /6c101aa3-b91d-4590-ae7a-5df070af2793/i.test(sql)
  && /u_1785138353548/i.test(sql)
  && /admin\.ntpc@suiyuecare\.com/i.test(sql)
  && /audited retired duplicate employee projection is still active/i.test(sql)
  && /refusing a broad retirement update/i.test(sql));

check('notifications add a restrictive tenant and production-lane policy without rewriting existing policies',
  /create policy notifications_tenant_production_isolation_v1/i.test(sql)
  && /as restrictive\s+for all\s+to authenticated/i.test(sql)
  && /tenant_id = public\.current_tenant_id\(\)/i.test(sql)
  && /data_environment = 'production'/i.test(sql)
  && /notification_staff_reconciliation_policies_before/i.test(sql)
  && /An existing notification policy drifted during reconciliation/i.test(sql));

check('frontend notification reads, inserts, and bulk updates carry tenant/environment scope',
  /tenantStampedRemoteTable[\s\S]*?'notifications'/.test(index)
  && /from\('notifications'\)\.select\('\*'\)\.eq\('tenant_id',currentTenantId\(\)\)\.eq\('data_environment',activeDataEnvironment\(\)\)/.test(index)
  && /table==='notifications'\)updateQuery=updateQuery\.eq\('tenant_id',currentTenantId\(\)\)\.eq\('data_environment',activeDataEnvironment\(\)\)/.test(index)
  && /from\('notifications'\)\.update\(\{read:true\}\)\.eq\('tenant_id',currentTenantId\(\)\)\.eq\('data_environment',activeDataEnvironment\(\)\)/.test(index));

check('Portal update cannot broaden Finance role, scope, actions, limits, or any non-module field',
  portalUpdate !== null
  && !/\b(?:finance_role|default_scope|actions|limits)\s*=/i.test(portalSetClause)
  && /notification_finance_entry_reconciliation_role_before/i.test(sql)
  && /to_jsonb\(portal_role\) - array\['modules', 'updated_at'\]::text\[\]/i.test(sql)
  && /full join public\.finance_portal_roles after_row/i.test(sql)
  && /to_jsonb\(after_row\) - array\['modules', 'updated_at'\]::text\[\]/i.test(sql)
  && /after_row\.modules is distinct from before_row\.modules_expected/i.test(sql)
  && /after_row\.updated_at is distinct from before_row\.updated_at_before/i.test(sql)
  && /changed a non-module permission or an unexpected module row/i.test(sql));

check('RLS remains enabled and forced on all three reconciled relations',
  ['notifications', 'finance_portal_roles', 'file_attachments'].every((table) =>
    new RegExp(`alter table public\\.${table} enable row level security;`, 'i').test(sql)
    && new RegExp(`alter table public\\.${table} force row level security;`, 'i').test(sql)
  )
  && /if not v_relation\.relrowsecurity or not v_relation\.relforcerowsecurity/i.test(sql));

check('ACLs are unchanged and the only new policy is restrictive',
  /notification_staff_reconciliation_acl_before/i.test(sql)
  && /before_acl\.relacl is not distinct from v_relation\.relacl/i.test(sql)
  && !/\bgrant\b/i.test(sql)
  && !/\brevoke\b/i.test(sql)
  && !/\bdrop\s+policy\b/i.test(sql));

check('migration is rerunnable and fail-closed on ambiguous prerequisites',
  occurrences(sql.toLowerCase(), 'if not exists') >= 4
  && /refusing to guess notification ownership/i.test(sql)
  && /Expected six audited active Portal roles mapped to their Finance roles/i.test(sql)
  && /Every active Portal role must map to a non-empty Finance role/i.test(sql)
  && /incompatible type/i.test(sql));

check('migration never writes to Auth or creates privileged functions',
  !/\b(?:insert\s+into|update|delete\s+from|alter\s+table)\s+auth\./i.test(sql)
  && !/security\s+definer/i.test(sql)
  && !/create\s+(?:or\s+replace\s+)?function/i.test(sql));

check('PostgREST schema cache is reloaded only after postflight',
  sql.indexOf('do $postflight$') > -1
  && sql.indexOf("notify pgrst, 'reload schema';") > sql.indexOf('do $postflight$'));

console.log(`\n${passed}/${passed + failed} checks passed`);
if (failed) process.exit(1);
