#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const guard = require('./finance_production_release_guard');

assert.deepEqual(guard.PRODUCTION_CATALOG, {
  supabaseProjectRef: 'udtlppnrugmtzhigdsxo',
  vercelOrgId: 'team_LGag47eU8tKbsK6ixAmVa5Uq',
  vercelProjectId: 'prj_nze9Q0MdSzMjYSOV2ynchdwqm1PD',
  vercelProjectName: 'suiyuecare-finance',
  productionDomain: 'finance.suiyuecare.com'
});
assert.deepEqual(guard.SUPPORTED_GATE_PHASES, [[], ['20260826070814'], ['20260826155840']]);
assert.deepEqual(guard.migrationVersions('none'), []);
assert.throws(() => guard.migrationVersions('20260826070814,20260826070814'), /unique/);
assert.throws(() => guard.migrationVersions('20260826070814, 20260826155840'));
assert.throws(() => guard.migrationPhase('20260826070814,20260826155840'), /two phases/);

const catalog = guard.PRODUCTION_CATALOG;
const exactEnvironment = {
  SUPABASE_ACCESS_TOKEN: 'sbp_test-only',
  FINANCE_SUPABASE_URL: `https://${catalog.supabaseProjectRef}.supabase.co/`,
  FINANCE_SUPABASE_ANON_KEY: 'sb_publishable_test-only',
  VERCEL_TOKEN: 'test-only',
  VERCEL_ORG_ID: catalog.vercelOrgId,
  VERCEL_PROJECT_ID: catalog.vercelProjectId
};
guard.validateTarget(exactEnvironment, 'a'.repeat(40), '20260826070814', catalog.supabaseProjectRef);
guard.validateTarget(exactEnvironment, 'a'.repeat(40), '20260826155840', catalog.supabaseProjectRef);
guard.validateTarget(exactEnvironment, 'a'.repeat(40), 'none', catalog.supabaseProjectRef);
assert.throws(() => guard.validateTarget({ ...exactEnvironment, VERCEL_ORG_ID: 'team_other' }, 'a'.repeat(40), 'none', catalog.supabaseProjectRef), /organization/);
assert.throws(() => guard.validateTarget({ ...exactEnvironment, VERCEL_PROJECT_ID: 'prj_other' }, 'a'.repeat(40), 'none', catalog.supabaseProjectRef), /project/);
assert.throws(() => guard.validateTarget(exactEnvironment, 'a'.repeat(40), 'none', 'a'.repeat(20)), /immutable/);

const root = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/finance-production-release.yml'), 'utf8');
const required = [
  'actions: read',
  'environment:\n      name: finance-production',
  'ref: main',
  'test "$GITHUB_SHA" = "$CANDIDATE_SHA"',
  'test "$(git rev-parse main)" = "$CANDIDATE_SHA"',
  'pnpm release:preflight',
  'vercel@59.3.0 build --prod --standalone',
  'deploy --prebuilt --prod --skip-domain',
  '--meta "financeCandidateSha=$CANDIDATE_SHA"',
  '/v13/deployments/${DEPLOYMENT_HOST}?teamId=${VERCEL_ORG_ID}',
  '/v9/projects/${VERCEL_PROJECT_ID}/domains?teamId=${VERCEL_ORG_ID}',
  'verify-vercel-target',
  'verify-production-baseline',
  'SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}',
  'supabase link --project-ref "$FINANCE_PRODUCTION_SUPABASE_PROJECT_REF"',
  'verify-supabase-public-key',
  '/auth/v1/settings',
  'external?.google!==true',
  '/rest/v1/finance_users?select=id&limit=1',
  'finance_production_authenticated_canary.sql',
  'authenticated-canary-before.json',
  'authenticated-canary-after.json',
  'promotion-authenticated-canary.json',
  'finance_production_db_preflight.sql',
  'supabase db query --linked --output csv',
  'prepare-rehearsal',
  '--authenticated-canary "$TOOLS/scripts/finance_production_authenticated_canary.sql"',
  'prepare-apply',
  'finance_production_db_fingerprint.sql',
  '--fingerprint "$TOOLS/scripts/finance_production_db_fingerprint.sql"',
  '--ledger "$LEDGER"',
  'production-immediately-before-v2.json',
  'finance_production_db_postflight.sql',
  'create-receipt',
  'verify-receipt',
  'finance-verified-candidate-${{ inputs.candidate_sha }}',
  'artifact_digest: ${{ steps.upload_candidate.outputs.artifact-digest }}',
  'EXPECTED_DEPLOYMENT_ID: ${{ needs.candidate.outputs.deployment_id }}',
  'EXPECTED_MANIFEST_SHA256: ${{ needs.candidate.outputs.manifest_sha256 }}',
  'EXPECTED_ARTIFACT_DIGEST: ${{ needs.candidate.outputs.artifact_digest }}',
  'PHASE_STATE="$(node "$GUARD" classify-ledger',
  'if test "$PHASE_STATE" = "pending"; then',
  'elif test "$PHASE_STATE" = "applied"; then',
  'elif test "$PHASE_STATE" = "noop" && test "$MIGRATION_VERSIONS" = "none"; then',
  '--allow-production-alias true',
  'for ATTEMPT in 1 2 3',
  'promote "$DEPLOYMENT_URL" --yes',
  'verify-promotion'
];
for (const marker of required) assert.ok(workflow.includes(marker), `workflow missing ${marker}`);
assert.ok(!workflow.includes('git fetch'), 'private-repository release must not fetch after checkout');
assert.ok(!workflow.includes('ref: ${{ inputs.candidate_sha }}'), 'private-repository checkout must resolve protected main itself');
assert.ok(!workflow.includes('continue-on-error'));
assert.equal((workflow.match(/deploy --prebuilt --prod --skip-domain/g) || []).length, 1);
assert.equal((workflow.match(/vercel@59\.3\.0 build --prod --standalone/g) || []).length, 1);
assert.equal((workflow.match(/promote "\$DEPLOYMENT_URL" --yes/g) || []).length, 1);
const candidateAt = workflow.indexOf('\n  candidate:\n');
const databaseAt = workflow.indexOf('\n  database:\n');
const promoteAt = workflow.indexOf('\n  promote:\n');
assert.ok(candidateAt >= 0 && databaseAt > candidateAt && promoteAt > databaseAt, 'workflow must have ordered candidate, database and promote jobs');
const candidateJob = workflow.slice(candidateAt, databaseAt);
const databaseJob = workflow.slice(databaseAt, promoteAt);
const promoteJob = workflow.slice(promoteAt);
assert.match(candidateJob, /pnpm release:preflight[\s\S]+vercel@59\.3\.0 build --prod --standalone[\s\S]+pnpm release:verify-artifact[\s\S]+deploy --prebuilt --prod --skip-domain[\s\S]+verify-vercel-target[\s\S]+create-receipt[\s\S]+upload-artifact/);
assert.doesNotMatch(candidateJob, /supabase db push|vercel@59\.3\.0 promote/);
assert.match(databaseJob, /needs: candidate/);
assert.match(databaseJob, /download-artifact[\s\S]+validate-target[\s\S]+supabase link[\s\S]+verify-receipt[\s\S]+verify-candidate[\s\S]+verify-vercel-target[\s\S]+classify-ledger/);
assert.doesNotMatch(databaseJob, /vercel@59\.3\.0 (?:build|deploy|promote)/, 'database job must consume the sealed candidate without rebuilding or promoting it');
assert.match(promoteJob, /needs: \[candidate, database\]/);
assert.match(promoteJob, /download-artifact[\s\S]+validate-target[\s\S]+supabase link[\s\S]+verify-receipt[\s\S]+finance_production_db_postflight\.sql[\s\S]+promote "\$DEPLOYMENT_URL" --yes[\s\S]+verify-promotion/);
assert.doesNotMatch(promoteJob, /vercel@59\.3\.0 (?:build|deploy)|prepare-apply/, 'retryable promote job must not rebuild, redeploy or reapply DB migrations');
const pendingAt = databaseJob.indexOf('if test "$PHASE_STATE" = "pending"; then');
const appliedAt = databaseJob.indexOf('elif test "$PHASE_STATE" = "applied"; then');
const noopAt = databaseJob.indexOf('elif test "$PHASE_STATE" = "noop" && test "$MIGRATION_VERSIONS" = "none"; then');
const applies = [...databaseJob.matchAll(/prepare-apply/g)];
assert.equal(applies.length, 1, 'database job must generate exactly one atomic apply payload');
assert.ok(pendingAt >= 0 && applies[0].index > pendingAt && applies[0].index < appliedAt && appliedAt < noopAt, 'DB mutation must exist only in the pending branch; applied/noop are recovery/read-only paths');
assert.ok((databaseJob.match(/supabase db query --linked/g) || []).length >= 4, 'database job must use pinned linked queries for ledger, gates, rehearsal and apply');
assert.match(databaseJob, /verify-supabase-public-key[\s\S]+auth\/v1\/settings[\s\S]+rest\/v1\/finance_users[\s\S]+finance_submit_expense_request[\s\S]+finance_resubmit_expense_request[\s\S]+classify-ledger/);
assert.match(databaseJob, /prepare-rehearsal[\s\S]+--fingerprint[\s\S]+production-immediately-before-v2\.json[\s\S]+prepare-apply[\s\S]+--ledger "\$LEDGER"/);
const canaryBeforeAt = databaseJob.indexOf('authenticated-canary-before.json');
const classifyAt = databaseJob.indexOf('PHASE_STATE="$(node "$GUARD" classify-ledger');
const canaryAfterAt = databaseJob.indexOf('authenticated-canary-after.json');
const receiptRevalidatedAt = databaseJob.indexOf('node "$GUARD" verify-receipt');
const targetRevalidatedAt = databaseJob.indexOf('node "$GUARD" verify-vercel-target');
assert.ok(
  receiptRevalidatedAt >= 0 && targetRevalidatedAt > receiptRevalidatedAt
    && canaryBeforeAt > targetRevalidatedAt && canaryBeforeAt < classifyAt,
  'authenticated canary must run after sealed target revalidation and before DB mutation is classified'
);
assert.ok(canaryAfterAt > classifyAt, 'authenticated canary must pass again after the exact DB phase postflight');
assert.match(promoteJob, /finance_production_db_postflight\.sql[\s\S]+promotion-authenticated-canary\.json[\s\S]+promote "\$DEPLOYMENT_URL" --yes/);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-release-contract-'));
try {
  const apiKeys = path.join(temp, 'api-keys.json');
  fs.writeFileSync(apiKeys, JSON.stringify([
    { name: 'anon', type: 'legacy', api_key: 'legacy-anon-test' },
    { name: 'default', type: 'publishable', api_key: 'sb_publishable_test-only' },
    { name: 'default', type: 'secret', api_key: 'sb_secret_must-not-match' }
  ]));
  guard.verifySupabasePublicKey(apiKeys, 'sb_publishable_test-only');
  guard.verifySupabasePublicKey(apiKeys, 'legacy-anon-test');
  assert.throws(() => guard.verifySupabasePublicKey(apiKeys, 'sb_secret_must-not-match'), /not an active publishable\/anon key/);
  assert.throws(() => guard.verifySupabasePublicKey(apiKeys, 'wrong-project-key'), /not an active publishable\/anon key/);
  const migrations = path.join(temp, 'migrations'); fs.mkdirSync(migrations);
  fs.writeFileSync(path.join(migrations, '20260825000000_old.sql'), 'begin;\ncommit;\n');
  const notification = path.join(migrations, '20260826070814_notification.sql');
  const target = path.join(migrations, '20260826155840_route.sql');
  fs.writeFileSync(notification, '-- comment\nselect 1;\n');
  fs.writeFileSync(target, '-- comment\nselect 2;\n');
  const ledger = path.join(temp, 'ledger');
  fs.writeFileSync(ledger, '20260825000000\n');
  const syntheticVersions = ['20260825000000'];
  const syntheticBaseline = { count: 1, lastVersion: syntheticVersions[0], sha256: guard.ledgerSha256(syntheticVersions) };
  assert.equal(guard.classifyLedger(ledger, migrations, '20260826070814', syntheticBaseline), 'pending');
  assert.throws(() => guard.classifyLedger(ledger, migrations, 'none', syntheticBaseline), /zero local pending/);
  guard.verifyLedger('pre', ledger, migrations, '20260826070814', syntheticBaseline);
  fs.appendFileSync(ledger, '20260826070814\n');
  assert.equal(guard.classifyLedger(ledger, migrations, '20260826070814', syntheticBaseline), 'applied');
  assert.equal(guard.classifyLedger(ledger, migrations, '20260826155840', syntheticBaseline), 'pending');
  guard.verifyLedger('post', ledger, migrations, '20260826070814', syntheticBaseline);
  guard.verifyLedger('pre', ledger, migrations, '20260826155840', syntheticBaseline);
  fs.appendFileSync(ledger, '20260826155840\n');
  assert.equal(guard.classifyLedger(ledger, migrations, '20260826155840', syntheticBaseline), 'applied');
  assert.equal(guard.classifyLedger(ledger, migrations, 'none', syntheticBaseline), 'noop');
  guard.verifyLedger('post', ledger, migrations, '20260826155840', syntheticBaseline);
  guard.verifyLedger('pre', ledger, migrations, 'none', syntheticBaseline);
  guard.verifyLedger('post', ledger, migrations, 'none', syntheticBaseline);
  const duplicateDir = path.join(temp, 'duplicate'); fs.mkdirSync(duplicateDir);
  fs.writeFileSync(path.join(duplicateDir, '20260826070814_a.sql'), 'begin;\ncommit;\n');
  fs.writeFileSync(path.join(duplicateDir, '20260826070814_b.sql'), 'begin;\ncommit;\n');
  assert.throws(() => guard.migrationFiles(duplicateDir), /duplicated/);
  const rehearsalFingerprint = path.join(temp, 'fingerprint.sql');
  fs.writeFileSync(rehearsalFingerprint, "\\set ON_ERROR_STOP on\nwith value as (select 'stable'::text fingerprint) select md5(fingerprint) fingerprint from value;\n");
  const rehearsalCanary = path.join(temp, 'authenticated-canary.sql');
  fs.writeFileSync(rehearsalCanary, [
    '-- rollback-only authenticated test',
    'begin isolation level repeatable read;',
    '-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN',
    'do $canary$ begin perform 101; end; $canary$;',
    '-- FINANCE_AUTHENTICATED_CANARY_CORE_END',
    'rollback;',
    '-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN',
    'do $rollback_check$ begin perform 202; end; $rollback_check$;',
    '-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END'
  ].join('\n'));
  const rehearsal = path.join(temp, 'rollback.sql');
  guard.prepareRehearsal(target, rehearsal, '20260826155840', rehearsalFingerprint, rehearsalCanary);
  assert.match(fs.readFileSync(rehearsal, 'utf8'), /^begin isolation level repeatable read;\s*/i);
  assert.match(fs.readFileSync(rehearsal, 'utf8'), /rollback;\s*$/i);
  assert.doesNotMatch(fs.readFileSync(rehearsal, 'utf8'), /^\s*commit;\s*$/im);
  assert.match(fs.readFileSync(rehearsal, 'utf8'), /select 2;/i);
  assert.match(fs.readFileSync(rehearsal, 'utf8'), /savepoint finance_release_migration;[\s\S]+rollback to savepoint finance_release_migration;/);
  assert.match(fs.readFileSync(rehearsal, 'utf8'), /select 2;[\s\S]+perform 101;[\s\S]+rollback to savepoint finance_release_migration;[\s\S]+perform 202;/);
  assert.equal((fs.readFileSync(rehearsal, 'utf8').match(/with value as/g) || []).length, 2, 'rehearsal must compare the same fingerprint in one snapshot');
  const gateSource = path.join(temp, 'gate.sql');
  const gateOutput = path.join(temp, 'gate-rendered.sql');
  fs.writeFileSync(gateSource, "\\set ON_ERROR_STOP on\nselect set_config('finance.release_migration_versions', :'migration_versions', false);\nselect 1;\n");
  guard.prepareGateQuery(gateSource, gateOutput, '20260826070814');
  assert.match(fs.readFileSync(gateOutput, 'utf8'), /^begin read only;\nset local statement_timeout/);
  assert.match(fs.readFileSync(gateOutput, 'utf8'), /'20260826070814'/);
  assert.doesNotMatch(fs.readFileSync(gateOutput, 'utf8'), /\\set|:'migration_versions'/);
  const readOnlySource = path.join(temp, 'read-only.sql');
  const readOnlyOutput = path.join(temp, 'read-only-rendered.sql');
  fs.writeFileSync(readOnlySource, '\\set ON_ERROR_STOP on\nselect 1;\n');
  guard.prepareReadOnlyQuery(readOnlySource, readOnlyOutput);
  assert.match(fs.readFileSync(readOnlyOutput, 'utf8'), /^begin read only;/);
  const apply = path.join(temp, 'apply.sql');
  const applyLedger = path.join(temp, 'apply-ledger');
  fs.writeFileSync(applyLedger, '20260825000000\n20260826070814\n');
  guard.prepareApply(target, apply, '20260826155840', applyLedger, syntheticBaseline);
  const applySql = fs.readFileSync(apply, 'utf8');
  assert.match(applySql, /^begin;\n/);
  assert.match(applySql, /pg_advisory_xact_lock/);
  assert.match(applySql, /lock table supabase_migrations\.schema_migrations in share row exclusive mode/);
  assert.match(applySql, /actual_versions is distinct from array\['20260825000000','20260826070814'\]::text\[\]/);
  assert.match(applySql, /insert into supabase_migrations\.schema_migrations/);
  assert.match(applySql, /20260826155840/);
  assert.match(applySql, /expense_route_authority_v2|route/);
  assert.match(applySql, /commit;\n$/);
  fs.appendFileSync(applyLedger, '20260826155840\n');
  assert.throws(
    () => guard.prepareApply(target, path.join(temp, 'concurrent-ledger-apply.sql'), '20260826155840', applyLedger, syntheticBaseline),
    /exact pending state/,
    'a ledger change captured before apply must fail closed'
  );
  const queryResult = path.join(temp, 'query-result.json');
  const normalizedRows = path.join(temp, 'query-rows.json');
  fs.writeFileSync(queryResult, JSON.stringify({ boundary: 'random-per-call', rows: [{ fingerprint: 'stable' }], warning: 'ignored transport warning' }));
  guard.normalizeQueryRows(queryResult, normalizedRows);
  assert.equal(fs.readFileSync(normalizedRows, 'utf8'), '[{"fingerprint":"stable"}]\n');
  const badTransaction = path.join(temp, '20260826155840_bad_transaction.sql');
  fs.writeFileSync(badTransaction, 'begin;\nselect 3;\ncommit;\n');
  assert.throws(() => guard.prepareRehearsal(badTransaction, path.join(temp, 'bad-transaction-rehearsal.sql'), '20260826155840', rehearsalFingerprint, rehearsalCanary), /must not contain transaction control/);
  const badPipeline = path.join(temp, '20260826155840_bad_pipeline.sql');
  fs.writeFileSync(badPipeline, 'create index concurrently bad_idx on bad_table(id);\n');
  assert.throws(() => guard.prepareRehearsal(badPipeline, path.join(temp, 'bad-pipeline-rehearsal.sql'), '20260826155840', rehearsalFingerprint, rehearsalCanary), /outside its atomic migration batch/);

  const manifest = {
    schema_version: 2, contract: 'finance-release-artifact-v2', build_target: 'production', runtime_mode: 'production-supabase',
    source_commit: 'a'.repeat(40), source_manifest_sha256: 'b'.repeat(64), artifact_manifest_sha256: 'c'.repeat(64)
  };
  const localManifest = path.join(temp, 'local.json');
  const remoteManifest = path.join(temp, 'remote.json');
  fs.writeFileSync(localManifest, JSON.stringify(manifest)); fs.writeFileSync(remoteManifest, JSON.stringify(manifest));
  guard.verifyCandidate(localManifest, remoteManifest, 'a'.repeat(40), 'https://candidate.vercel.app/');
  guard.verifyProductionBaseline(remoteManifest, localManifest, 'a'.repeat(40), '20260826155840');
  assert.throws(() => guard.verifyProductionBaseline(remoteManifest, localManifest, 'a'.repeat(40), 'none'));

  const deployment = {
    id: 'dpl_Abc123', name: catalog.vercelProjectName, projectId: catalog.vercelProjectId,
    target: 'production', readyState: 'READY', url: 'candidate.vercel.app', alias: [],
    meta: { financeCandidateSha: 'a'.repeat(40) }
  };
  const project = { id: catalog.vercelProjectId, name: catalog.vercelProjectName, accountId: catalog.vercelOrgId };
  const domains = { domains: [{ name: catalog.productionDomain, verified: true }] };
  const deploymentPath = path.join(temp, 'deployment.json');
  const projectPath = path.join(temp, 'project.json');
  const domainsPath = path.join(temp, 'domains.json');
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment));
  fs.writeFileSync(projectPath, JSON.stringify(project));
  fs.writeFileSync(domainsPath, JSON.stringify(domains));
  guard.verifyVercelTarget(deploymentPath, projectPath, domainsPath, 'a'.repeat(40), 'https://candidate.vercel.app/');
  fs.writeFileSync(deploymentPath, JSON.stringify({ ...deployment, alias: [catalog.productionDomain] }));
  assert.throws(() => guard.verifyVercelTarget(deploymentPath, projectPath, domainsPath, 'a'.repeat(40), 'https://candidate.vercel.app/'), /before the database gate/);
  guard.verifyVercelTarget(deploymentPath, projectPath, domainsPath, 'a'.repeat(40), 'https://candidate.vercel.app/', true);
  fs.writeFileSync(deploymentPath, JSON.stringify({ ...deployment, projectId: 'prj_other' }));
  assert.throws(() => guard.verifyVercelTarget(deploymentPath, projectPath, domainsPath, 'a'.repeat(40), 'https://candidate.vercel.app/'), /different Vercel project/);
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment));
  const receiptPath = path.join(temp, 'verified-candidate-receipt.json');
  guard.createReceipt(receiptPath, deploymentPath, localManifest, 'a'.repeat(40), '20260826070814', 'https://candidate.vercel.app/', 'owner/repository', '12345');
  guard.verifyReceipt(receiptPath, deploymentPath, localManifest, 'a'.repeat(40), '20260826070814', 'https://candidate.vercel.app/', 'owner/repository', '12345');
  assert.throws(() => guard.verifyReceipt(receiptPath, deploymentPath, localManifest, 'a'.repeat(40), '20260826155840', 'https://candidate.vercel.app/', 'owner/repository', '12345'), /differs/);
  assert.throws(() => guard.verifyReceipt(receiptPath, deploymentPath, localManifest, 'a'.repeat(40), '20260826070814', 'https://candidate.vercel.app/', 'owner/repository', '99999'), /differs/);
  const promotedPath = path.join(temp, 'promoted.json');
  fs.writeFileSync(promotedPath, JSON.stringify({ ...deployment, alias: [catalog.productionDomain] }));
  guard.verifyPromotion(deploymentPath, promotedPath, remoteManifest, localManifest);
} finally { fs.rmSync(temp, { recursive: true, force: true }); }

for (const sql of ['preflight', 'postflight', 'fingerprint']) {
  const body = fs.readFileSync(path.join(root, `scripts/finance_production_db_${sql}.sql`), 'utf8');
  assert.ok(body.includes('\\set ON_ERROR_STOP on'));
  assert.ok(!/^\s*(insert|update|delete|alter|create|drop|truncate)\b/im.test(body));
}
const dbPreflight = fs.readFileSync(path.join(root, 'scripts/finance_production_db_preflight.sql'), 'utf8');
const dbPostflight = fs.readFileSync(path.join(root, 'scripts/finance_production_db_postflight.sql'), 'utf8');
const dbFingerprint = fs.readFileSync(path.join(root, 'scripts/finance_production_db_fingerprint.sql'), 'utf8');
const authenticatedCanary = fs.readFileSync(path.join(root, 'scripts/finance_production_authenticated_canary.sql'), 'utf8');
for (const marker of [
  "v_phase = 'none'", 'relrowsecurity and relforcerowsecurity',
  'notifications_tenant_production_isolation_v1', 'finance_portal_roles_active_finance_entry_check_v1',
  'the exact generated read-only storage_path compatibility alias must remain installed',
  'private.finance_expense_assert_authoritative_route_v2', 'none phase requires v2 to be recorded'
]) assert.ok(dbPreflight.includes(marker), `DB preflight missing ${marker}`);
for (const marker of [
  "v_phase = 'none'", 'relrowsecurity and relforcerowsecurity',
  'v1 compatibility alias is not an exact generated storage_path alias',
  'v2 must retain the exact generated read-only storage_path compatibility alias',
  'finance_expense_assert_authoritative_route_v2', 'pg_get_functiondef', 'has_function_privilege',
  'the six audited Portal roles did not converge to one Finance entry each'
]) assert.ok(dbPostflight.includes(marker), `DB postflight missing ${marker}`);
for (const marker of ['pg_get_functiondef', 'proacl', 'finance_expense_assert_authoritative_route_v2', 'finance_portal_roles', 'relrowsecurity', 'relforcerowsecurity']) {
  assert.ok(dbFingerprint.includes(marker), `DB fingerprint missing ${marker}`);
}
for (const marker of [
  'begin isolation level repeatable read', "'data_environment', 'test'",
  "set local role authenticated", 'finance_submit_expense_request',
  'finance_expense_act_active_step', 'finance_resubmit_expense_request',
  'notification_delivery_events', 'cash_movement_evidence_links',
  'approval_step_actor_snapshots', 'finance_income_document_operations',
  'rollback;', 'rolled_back', 'notifications_enqueued'
]) assert.ok(authenticatedCanary.includes(marker), `authenticated canary missing ${marker}`);
assert.doesNotMatch(authenticatedCanary, /^\s*commit\s*;/im, 'authenticated canary must never commit its test request');
console.log('PASS protected production release workflow contract');
