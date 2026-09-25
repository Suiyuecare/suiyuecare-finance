#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

const migration = read('supabase/migrations/20260925170000_finance_retire_demo_password_v1.sql');
const schema = read('supabase/module_finance_production_schema.sql');
const legacyStorageSeed = read('supabase/reactivate_legacy_test_accounts_for_storage_20260522.sql');
const canary = read('scripts/finance_demo_password_retirement_canary.sql');
const postflight = read('scripts/finance_demo_password_retirement_postflight.sql');
const releaseWorkflow = read('.github/workflows/finance-production-release.yml');
const guard = require('./finance_production_release_guard');
const packageJson = JSON.parse(read('package.json'));

assert.match(migration, /where demo_password is not null[\s\S]+contains data; migration refused/i);
assert.match(migration, /drop trigger if exists trg_finance_strip_demo_password/i);
assert.match(migration, /drop function if exists public\.finance_strip_demo_password\(\)/i);
assert.match(migration, /alter table public\.finance_users drop column demo_password/i);
assert.doesNotMatch(migration, /\bcascade\b/i, 'unknown schema dependencies must stop the retirement');
assert.doesNotMatch(migration, /\b(?:insert\s+into|update\s+\w+\s+set|delete\s+from|truncate\s+)\b/i,
  'the migration may only retire the empty legacy schema field');
assert.doesNotMatch(schema, /demo_password/i, 'fresh installs must not recreate a plaintext credential field');
assert.doesNotMatch(legacyStorageSeed, /demo_password|["']password["']\s*=/i,
  'legacy Storage setup must not seed a password into Finance user rows');
for (const source of [canary, postflight]) {
  assert.match(source, /finance_users/i);
  assert.match(source, /relrowsecurity and relforcerowsecurity/i);
  assert.match(source, /has_table_privilege\('authenticated'.*'SELECT'\)/i);
  assert.match(source, /finance_strip_demo_password/i);
  assert.match(source, /finance_password_retirement|finance_demo_password_retirement/i);
}
assert.match(canary, /begin isolation level repeatable read read only;[\s\S]+rollback;/i);
assert.doesNotMatch(canary, /\b(?:insert\s+into|update\s+\S+\s+set|delete\s+from|set_config\s*\()/i);
assert.equal(guard.DEMO_PASSWORD_RETIREMENT_MIGRATIONS.join(','), '20260925170000');
assert.equal(guard.RELEASE_PHASE_DATABASE_DEMO_PASSWORD_RETIREMENT,
  'database_demo_password_retirement_20260925');
assert.equal(guard.RELEASE_PHASES[guard.RELEASE_PHASE_DATABASE_DEMO_PASSWORD_RETIREMENT], '20260925170000');
assert.ok(guard.SUPPORTED_GATE_PHASES.some((phase) => phase.join(',') === '20260925170000'));
assert.doesNotThrow(() => guard.validateTarget({
  SUPABASE_ACCESS_TOKEN: 'sbp_test-only',
  FINANCE_SUPABASE_URL: `https://${guard.PRODUCTION_CATALOG.supabaseProjectRef}.supabase.co/`,
  FINANCE_SUPABASE_ANON_KEY: 'sb_publishable_test-only',
  VERCEL_TOKEN: 'test-only',
  VERCEL_ORG_ID: guard.PRODUCTION_CATALOG.vercelOrgId,
  VERCEL_PROJECT_ID: guard.PRODUCTION_CATALOG.vercelProjectId
}, 'a'.repeat(40), 'database_demo_password_retirement_20260925', '20260925170000', guard.PRODUCTION_CATALOG.supabaseProjectRef));
assert.match(releaseWorkflow, /database_demo_password_retirement_20260925/);
assert.match(releaseWorkflow, /finance_demo_password_retirement_canary\.sql/);
assert.match(releaseWorkflow, /finance_demo_password_retirement_postflight\.sql/);
assert.ok(packageJson.scripts['release:preflight'].includes('test:demo-password-retirement'));
assert.equal(packageJson.scripts['test:demo-password-retirement'],
  'node scripts/check_finance_demo_password_retirement.cjs');
process.stdout.write('PASS retired credential field, safe directory access and protected release coverage\n');
