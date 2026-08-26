#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PRODUCTION_CATALOG = Object.freeze({
  supabaseProjectRef: 'udtlppnrugmtzhigdsxo',
  vercelOrgId: 'team_LGag47eU8tKbsK6ixAmVa5Uq',
  vercelProjectId: 'prj_nze9Q0MdSzMjYSOV2ynchdwqm1PD',
  vercelProjectName: 'suiyuecare-finance',
  productionDomain: 'finance.suiyuecare.com'
});
const MIGRATION_V1 = '20260826070814';
const MIGRATION_V2 = '20260826155840';
const PRODUCTION_BASELINE_LEDGER = Object.freeze({
  count: 120,
  lastVersion: '20260825103034',
  sha256: '23680167bee6cfefcdbd7eb951907da61955019e24368d6e13e9ac1282422cd6'
});
// Live production uses two explicit phases. A rollback rehearsal on the live
// database is not a shadow database and cannot prove cross-version atomicity.
const SUPPORTED_GATE_PHASES = Object.freeze([
  Object.freeze([]),
  Object.freeze([MIGRATION_V1]),
  Object.freeze([MIGRATION_V2])
]);
const SUPPORTED_GATE_SUFFIXES = SUPPORTED_GATE_PHASES;

function fail(message) { throw new Error(message); }
function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0 || !process.argv[index + 1]) fail(`missing --${name}`);
  return process.argv[index + 1];
}
function optionalBooleanArg(name, fallback = false) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!['true', 'false'].includes(value)) fail(`--${name} must be true or false`);
  return value === 'true';
}
function canonicalVersion(value) {
  if (!/^\d{14}$/.test(String(value || ''))) fail('migration version must be 14 digits');
  return String(value);
}
function migrationVersions(value) {
  const raw = String(value || '');
  if (raw === 'none') return [];
  if (!raw || raw !== raw.trim() || /\s/.test(raw)) fail('migration_versions must be none or comma-separated 14-digit versions without whitespace');
  const versions = raw.split(',').map(canonicalVersion);
  if (new Set(versions).size !== versions.length || versions.some((v, i) => i && v <= versions[i - 1])) {
    fail('migration_versions must be unique and strictly ordered');
  }
  return versions;
}
function migrationPhase(value) {
  const versions = migrationVersions(value);
  if (!SUPPORTED_GATE_PHASES.some((phase) => phase.join(',') === versions.join(','))) {
    if (versions.join(',') === `${MIGRATION_V1},${MIGRATION_V2}`) {
      fail('v1 and v2 must be released in two phases; a live rollback rehearsal is not a shadow database or an atomic compatibility proof');
    }
    fail('database gate has no exact catalog contract for this migration phase');
  }
  return versions;
}
function canonicalSha(value) {
  if (!/^[0-9a-f]{40}$/.test(String(value || ''))) fail('candidate SHA must be 40 lowercase hex characters');
  return String(value);
}
function projectRef(value) {
  if (!/^[a-z0-9]{20}$/.test(String(value || ''))) fail('Supabase project ref must be 20 lowercase letters/digits');
  return String(value);
}
function readJson(file) {
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail(`${path.basename(file)} is not valid JSON: ${error.message}`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path.basename(file)} must contain a JSON object`);
  return value;
}
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function deploymentId(record) { return String(record.id || record.uid || '').trim(); }
function deploymentHost(record) { return String(record.url || '').replace(/^https?:\/\//, '').replace(/\/$/, ''); }

function validateTarget(env, candidate, versionsText, expectedRef) {
  canonicalSha(candidate);
  migrationPhase(versionsText);
  expectedRef = projectRef(expectedRef);
  if (expectedRef !== PRODUCTION_CATALOG.supabaseProjectRef) fail('Supabase project ref is not the immutable Finance production catalog target');
  for (const name of ['SUPABASE_ACCESS_TOKEN', 'FINANCE_SUPABASE_URL', 'FINANCE_SUPABASE_ANON_KEY', 'VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID']) {
    if (!String(env[name] || '').trim()) fail(`missing protected setting ${name}`);
  }
  if (env.VERCEL_ORG_ID !== PRODUCTION_CATALOG.vercelOrgId) fail('Vercel organization is not the immutable Finance production catalog target');
  if (env.VERCEL_PROJECT_ID !== PRODUCTION_CATALOG.vercelProjectId) fail('Vercel project is not the immutable Finance production catalog target');
  const web = new URL(env.FINANCE_SUPABASE_URL);
  if (web.protocol !== 'https:' || web.hostname !== `${expectedRef}.supabase.co` || web.pathname !== '/' || web.search || web.hash) {
    fail('production browser project does not match the approved Supabase project ref');
  }
  return true;
}

function verifySupabasePublicKey(apiKeysPath, suppliedKey) {
  let keys;
  try { keys = JSON.parse(fs.readFileSync(apiKeysPath, 'utf8')); }
  catch (error) { fail(`${path.basename(apiKeysPath)} is not valid JSON: ${error.message}`); }
  if (!Array.isArray(keys)) fail(`${path.basename(apiKeysPath)} must contain an API key array`);
  suppliedKey = String(suppliedKey || '').trim();
  if (!suppliedKey) fail('protected Finance browser key is empty');
  const candidates = keys.filter((record) => record && record.disabled !== true
    && (record.type === 'publishable' || (record.type === 'legacy' && record.name === 'anon')))
    .map((record) => String(record.api_key || ''))
    .filter(Boolean);
  const supplied = Buffer.from(suppliedKey);
  const matched = candidates.some((candidate) => {
    const expected = Buffer.from(candidate);
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  });
  if (!matched) fail('protected Finance browser key is not an active publishable/anon key of the immutable Supabase project');
  return true;
}

function migrationFiles(directory) {
  const files = fs.readdirSync(directory).filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/.test(name)).sort();
  const versions = files.map((name) => name.slice(0, 14));
  const duplicate = versions.find((version, index) => versions.indexOf(version) !== index);
  if (duplicate) fail(`local migration version is duplicated: ${duplicate}`);
  for (const version of [MIGRATION_V1, MIGRATION_V2]) {
    const file = files.find((name) => name.startsWith(`${version}_`));
    if (file) assertCliAtomicMigration(fs.readFileSync(path.join(directory, file), 'utf8'), file);
  }
  return files;
}
function ledgerSha256(versions) {
  return crypto.createHash('sha256').update(`${versions.join('\n')}\n`).digest('hex');
}
function readLedgerVersions(ledgerPath) {
  const remote = fs.readFileSync(ledgerPath, 'utf8').split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
  if (remote.some((v) => !/^\d{14}$/.test(v)) || new Set(remote).size !== remote.length) fail('remote ledger is malformed or duplicated');
  if (remote.some((version, index) => index && version <= remote[index - 1])) fail('remote ledger must be strictly ordered');
  return remote;
}
function assertProductionLedgerBaseline(remote, baseline = PRODUCTION_BASELINE_LEDGER) {
  if (!baseline || !Number.isInteger(baseline.count)
      || !/^\d{14}$/.test(String(baseline.lastVersion || ''))
      || !/^[0-9a-f]{64}$/.test(String(baseline.sha256 || ''))) {
    fail('production migration baseline contract is invalid');
  }
  const baselineVersions = remote.filter((version) => version < MIGRATION_V1);
  if (baselineVersions.length !== baseline.count
      || baselineVersions[baselineVersions.length - 1] !== baseline.lastVersion
      || ledgerSha256(baselineVersions) !== baseline.sha256) {
    fail('remote production migration baseline differs from the reviewed immutable ledger');
  }
  const unexpected = remote.filter((version) => version >= MIGRATION_V1 && ![MIGRATION_V1, MIGRATION_V2].includes(version));
  if (unexpected.length) fail(`remote ledger contains an unreviewed post-baseline migration: ${unexpected.join(',')}`);
  return true;
}
function classifyLedger(ledgerPath, directory, versionsText, baseline = PRODUCTION_BASELINE_LEDGER) {
  const requested = migrationPhase(versionsText);
  const local = migrationFiles(directory);
  if (!local.length) fail('local migration catalog is empty');
  const remote = readLedgerVersions(ledgerPath);
  assertProductionLedgerBaseline(remote, baseline);
  const missing = [MIGRATION_V1, MIGRATION_V2].filter((version) => !remote.includes(version));
  if (!requested.length) {
    if (missing.length) fail(`none phase requires zero local pending migrations, found: ${missing.join(',')}`);
    return 'noop';
  }
  const pending = requested[0] === MIGRATION_V1 ? [MIGRATION_V1, MIGRATION_V2] : [MIGRATION_V2];
  const applied = requested[0] === MIGRATION_V1 ? [MIGRATION_V2] : [];
  if (missing.join(',') === pending.join(',')) return 'pending';
  if (missing.join(',') === applied.join(',')) return 'applied';
  fail(`ledger is neither the exact pending nor applied state for this phase: ${missing.length ? missing.join(',') : 'none'}`);
}
function verifyLedger(mode, ledgerPath, directory, versionsText, baseline = PRODUCTION_BASELINE_LEDGER) {
  const requested = migrationPhase(versionsText);
  if (!['pre', 'post'].includes(mode)) fail('ledger mode must be pre or post');
  const state = classifyLedger(ledgerPath, directory, versionsText, baseline);
  const expectedState = requested.length ? (mode === 'pre' ? 'pending' : 'applied') : 'noop';
  if (state !== expectedState) fail(`${mode}-apply ledger state must be ${expectedState}, found ${state}`);
  return true;
}

function assertCliAtomicMigration(source, label = 'migration') {
  const transactionControl = /^\s*(?:begin(?:\s+(?:work|transaction))?|start\s+transaction(?:\s+[^;]+)?|commit(?:\s+(?:work|transaction))?|rollback(?:\s+(?:work|transaction))?(?:\s+to(?:\s+savepoint)?\s+\S+)?|savepoint\s+\S+|release\s+(?:savepoint\s+)?\S+)\s*;\s*$/gim;
  const pipelineIncompatible = /^\s*(?:(?:create(?:\s+unique)?\s+index|drop\s+index)\s+concurrently\b|reindex\b[^;]*\bconcurrently\b|vacuum\b|alter\s+system\b|cluster\b)/gim;
  if (transactionControl.test(source)) {
    fail(`${label} must not contain transaction control; the release guard must atomically commit migration statements with its ledger insert`);
  }
  if (pipelineIncompatible.test(source)) {
    fail(`${label} contains a statement the Supabase CLI may run outside its atomic migration batch`);
  }
  return true;
}

function extractMarkedSql(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  if (start < 0 || end <= start || source.indexOf(startMarker, start + startMarker.length) >= 0
      || source.indexOf(endMarker, end + endMarker.length) >= 0) {
    fail(`${label} must contain exactly one ordered ${startMarker}/${endMarker} section`);
  }
  const body = source.slice(start + startMarker.length, end).trim();
  if (!/^do\s+\$/i.test(body) || !/\$[a-z0-9_]*\$\s*;\s*$/i.test(body)) {
    fail(`${label} marked section must be one complete DO block`);
  }
  assertCliAtomicMigration(body, `${label} marked section`);
  return body;
}

function authenticatedCanarySections(canaryPath) {
  if (!canaryPath) fail('authenticated canary path is required for migration rehearsal');
  const source = fs.readFileSync(canaryPath, 'utf8');
  if (!/^--[^\n]*\n(?:--[^\n]*\n)*\s*begin isolation level repeatable read;/i.test(source)
      || !/^\s*rollback\s*;/im.test(source)
      || /^\s*commit\s*;/im.test(source)) {
    fail('authenticated canary must be a rollback-only repeatable-read transaction');
  }
  return {
    core: extractMarkedSql(
      source,
      '-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN',
      '-- FINANCE_AUTHENTICATED_CANARY_CORE_END',
      path.basename(canaryPath)
    ),
    rollbackCheck: extractMarkedSql(
      source,
      '-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_BEGIN',
      '-- FINANCE_AUTHENTICATED_CANARY_ROLLBACK_CHECK_END',
      path.basename(canaryPath)
    )
  };
}

function prepareRehearsal(sourcePath, outputPath, target, fingerprintPath, canaryPath) {
  target = canonicalVersion(target);
  if (path.basename(sourcePath).slice(0, 14) !== target) fail('migration path/version mismatch');
  const source = fs.readFileSync(sourcePath, 'utf8');
  assertCliAtomicMigration(source, path.basename(sourcePath));
  const canary = authenticatedCanarySections(canaryPath);
  let fingerprint = stripPsqlDirectives(fs.readFileSync(fingerprintPath, 'utf8'), path.basename(fingerprintPath)).trim();
  if (!/^with\b/i.test(fingerprint)
      || /\b(?:insert\s+into|update\s+\S+\s+set|delete\s+from|alter\s+table|create\s+(?:table|index|schema|function|policy)|drop\s+(?:table|index|schema|function|policy)|truncate\s+|vacuum\b|call\s+|copy\s+)\b/i.test(fingerprint)) {
    fail('rollback fingerprint must be one pure read-only CTE query');
  }
  const assertionTag = `$finance_rehearsal_assert_${target}$`;
  if (source.includes(assertionTag) || fingerprint.includes(assertionTag)
      || canary.core.includes(assertionTag) || canary.rollbackCheck.includes(assertionTag)) {
    fail('rehearsal source collides with its protected assertion tag');
  }
  const rehearsal = `begin isolation level repeatable read;\nset local lock_timeout = '5s';\nset local statement_timeout = '180s';\ncreate temporary table finance_release_fingerprint_before on commit drop as\n${fingerprint}\nsavepoint finance_release_migration;\n${source.trimEnd()}\n${canary.core}\nrollback to savepoint finance_release_migration;\n${canary.rollbackCheck}\ncreate temporary table finance_release_fingerprint_after on commit drop as\n${fingerprint}\ndo ${assertionTag}\nbegin\n  if (select fingerprint from finance_release_fingerprint_before)\n     is distinct from (select fingerprint from finance_release_fingerprint_after) then\n    raise exception 'rollback rehearsal changed the reviewed database fingerprint';\n  end if;\nend;\n${assertionTag};\nrollback;\n`;
  writeExclusive(outputPath, rehearsal);
  return true;
}

function sqlLiteral(value) { return `'${String(value).replace(/'/g, "''")}'`; }
function stripPsqlDirectives(source, label) {
  if (!/^\\set ON_ERROR_STOP on\r?\n/.test(source)) fail(`${label} must begin with the reviewed psql fail-closed directive`);
  return source.replace(/^\\set ON_ERROR_STOP on\r?\n/, '');
}
function writeExclusive(outputPath, source) {
  fs.writeFileSync(outputPath, source, { mode: 0o600, flag: 'wx' });
}
function prepareGateQuery(sourcePath, outputPath, versionsText) {
  migrationPhase(versionsText);
  let source = stripPsqlDirectives(fs.readFileSync(sourcePath, 'utf8'), path.basename(sourcePath));
  if (!/:'migration_versions'/.test(source)) fail(`${path.basename(sourcePath)} is missing its migration phase marker`);
  source = source.replace(/:'migration_versions'/g, sqlLiteral(versionsText));
  writeExclusive(outputPath, `begin read only;\nset local statement_timeout = '60s';\n${source.trimEnd()}\nrollback;\n`);
  return true;
}
function prepareReadOnlyQuery(sourcePath, outputPath) {
  const source = stripPsqlDirectives(fs.readFileSync(sourcePath, 'utf8'), path.basename(sourcePath));
  if (/:'migration_versions'/.test(source)) fail(`${path.basename(sourcePath)} requires prepare-gate-query`);
  writeExclusive(outputPath, `begin read only;\nset local statement_timeout = '60s';\n${source.trimEnd()}\nrollback;\n`);
  return true;
}
function prepareApply(sourcePath, outputPath, target, ledgerPath, baseline = PRODUCTION_BASELINE_LEDGER) {
  target = canonicalVersion(target);
  const filename = path.basename(sourcePath);
  if (filename.slice(0, 14) !== target) fail('migration path/version mismatch');
  const source = fs.readFileSync(sourcePath, 'utf8');
  assertCliAtomicMigration(source, filename);
  const remote = readLedgerVersions(ledgerPath);
  assertProductionLedgerBaseline(remote, baseline);
  const expectedSuffix = target === MIGRATION_V1 ? [] : [MIGRATION_V1];
  const actualSuffix = remote.filter((version) => version >= MIGRATION_V1);
  if (actualSuffix.join(',') !== expectedSuffix.join(',')) {
    fail(`captured ledger is not the exact pending state for ${target}`);
  }
  const name = filename.replace(/^\d{14}_/, '').replace(/\.sql$/, '');
  const tag = `$finance_migration_${target}$`;
  if (source.includes(tag)) fail('migration source collides with the protected ledger quote tag');
  const ledgerGuardTag = `$finance_ledger_guard_${target}$`;
  if (source.includes(ledgerGuardTag)) fail('migration source collides with the protected ledger guard tag');
  const expectedLedger = `array[${remote.map(sqlLiteral).join(',')}]::text[]`;
  const ledgerGuard = `select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('finance-production-release-v1', 0));\nlock table supabase_migrations.schema_migrations in share row exclusive mode;\ndo ${ledgerGuardTag}\ndeclare\n  actual_versions text[];\nbegin\n  select pg_catalog.array_agg(version order by version)\n    into actual_versions\n  from supabase_migrations.schema_migrations;\n  if actual_versions is distinct from ${expectedLedger} then\n    raise exception 'formal migration ledger changed after the reviewed release gate';\n  end if;\nend;\n${ledgerGuardTag};`;
  const ledger = `insert into supabase_migrations.schema_migrations(version, statements, name, created_by)\nvalues (${sqlLiteral(target)}, array[${tag}${source.trimEnd()}${tag}]::text[], ${sqlLiteral(name)}, 'github-actions')`;
  writeExclusive(outputPath, `begin;\n${ledgerGuard}\n${source.trimEnd()}\n${ledger};\ncommit;\n`);
  return true;
}
function normalizeQueryRows(inputPath, outputPath) {
  const payload = readJson(inputPath);
  if (!Array.isArray(payload.rows)) fail(`${path.basename(inputPath)} must contain a rows array`);
  writeExclusive(outputPath, `${JSON.stringify(payload.rows)}\n`);
  return true;
}

function verifyCandidate(localPath, remotePath, candidate, deploymentUrl) {
  candidate = canonicalSha(candidate);
  const deployment = new URL(deploymentUrl);
  if (deployment.protocol !== 'https:' || !deployment.hostname.endsWith('.vercel.app') || deployment.pathname !== '/' || deployment.search || deployment.hash) {
    fail('invalid immutable Vercel deployment URL');
  }
  const local = readJson(localPath);
  const remote = readJson(remotePath);
  if (local.schema_version !== 2 || local.contract !== 'finance-release-artifact-v2' || local.build_target !== 'production' || local.runtime_mode !== 'production-supabase') {
    fail('local production manifest contract is invalid');
  }
  if (local.source_commit !== candidate || !/^[0-9a-f]{64}$/.test(local.source_manifest_sha256) || !/^[0-9a-f]{64}$/.test(local.artifact_manifest_sha256)) {
    fail('manifest is not bound to the candidate SHA and hashes');
  }
  assert.deepStrictEqual(remote, local, 'deployed manifest differs from the locally verified manifest');
  return true;
}

function verifyVercelTarget(deploymentPath, projectPath, domainsPath, candidate, deploymentUrl, allowProductionAlias = false) {
  if (typeof allowProductionAlias !== 'boolean') fail('allowProductionAlias must be boolean');
  candidate = canonicalSha(candidate);
  const deploymentUrlObject = new URL(deploymentUrl);
  const deployment = readJson(deploymentPath);
  const project = readJson(projectPath);
  const domainsRecord = readJson(domainsPath);
  if (deployment.projectId !== PRODUCTION_CATALOG.vercelProjectId) fail('deployment belongs to a different Vercel project');
  if (deployment.name !== PRODUCTION_CATALOG.vercelProjectName) fail('deployment project name drifted from the immutable catalog');
  if (deployment.target !== 'production' || deployment.readyState !== 'READY') fail('candidate is not a READY production-target deployment');
  if (deploymentHost(deployment) !== deploymentUrlObject.hostname) fail('Vercel deployment record URL differs from the candidate URL');
  if (!/^dpl_[A-Za-z0-9]+$/.test(deploymentId(deployment))) fail('candidate has no immutable Vercel deployment ID');
  if (!deployment.meta || deployment.meta.financeCandidateSha !== candidate) fail('candidate deployment metadata is not bound to the reviewed SHA');
  const aliases = Array.isArray(deployment.alias) ? deployment.alias.map((item) => typeof item === 'string' ? item : item && item.alias).filter(Boolean) : [];
  if (!allowProductionAlias && aliases.includes(PRODUCTION_CATALOG.productionDomain)) {
    fail('candidate received the production domain before the database gate');
  }
  if (project.id !== PRODUCTION_CATALOG.vercelProjectId || project.name !== PRODUCTION_CATALOG.vercelProjectName) fail('Vercel project catalog does not match the immutable target');
  if (project.accountId !== PRODUCTION_CATALOG.vercelOrgId) fail('Vercel project organization does not match the immutable target');
  const domains = Array.isArray(domainsRecord.domains) ? domainsRecord.domains : [];
  const productionDomain = domains.find((item) => (typeof item === 'string' ? item : item && item.name) === PRODUCTION_CATALOG.productionDomain);
  if (!productionDomain) fail('Finance production domain is not attached to the immutable project');
  if (typeof productionDomain === 'object' && productionDomain.verified === false) fail('Finance production domain is not verified');
  return true;
}

function verifyProductionBaseline(productionPath, candidatePath, candidate, versionsText) {
  const requested = migrationPhase(versionsText);
  if (requested.join(',') !== MIGRATION_V2) fail('production candidate baseline is only valid for the v2 phase');
  candidate = canonicalSha(candidate);
  const production = readJson(productionPath);
  const candidateManifest = readJson(candidatePath);
  if (production.source_commit !== candidate) fail('v2 requires the exact candidate SHA to already be live from the v1 compatibility phase');
  assert.deepStrictEqual(production, candidateManifest, 'v2 requires the exact deterministic candidate artifact to already be live');
  return true;
}

function verifyPromotion(candidateDeploymentPath, promotedDeploymentPath, productionManifestPath, candidateManifestPath) {
  const candidate = readJson(candidateDeploymentPath);
  const promoted = readJson(promotedDeploymentPath);
  if (!deploymentId(candidate) || deploymentId(promoted) !== deploymentId(candidate)) fail('production domain does not resolve to the verified candidate deployment ID');
  if (promoted.projectId !== PRODUCTION_CATALOG.vercelProjectId || promoted.target !== 'production' || promoted.readyState !== 'READY') {
    fail('promoted deployment target/project/state is invalid');
  }
  const aliases = Array.isArray(promoted.alias) ? promoted.alias.map((item) => typeof item === 'string' ? item : item && item.alias).filter(Boolean) : [];
  if (!aliases.includes(PRODUCTION_CATALOG.productionDomain)) fail('promoted deployment does not own the immutable Finance production domain');
  assert.deepStrictEqual(readJson(productionManifestPath), readJson(candidateManifestPath), 'production domain manifest differs after promotion');
  return true;
}

function createReceipt(outputPath, deploymentPath, manifestPath, candidate, versionsText, deploymentUrl, repository, runId) {
  candidate = canonicalSha(candidate);
  migrationPhase(versionsText);
  const deployment = readJson(deploymentPath);
  const parsedUrl = new URL(deploymentUrl);
  if (!deploymentId(deployment) || deploymentHost(deployment) !== parsedUrl.hostname) fail('cannot bind receipt to a different candidate deployment');
  if (!/^\d+$/.test(String(runId || ''))) fail('GitHub run ID must be numeric');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(repository || ''))) fail('GitHub repository is malformed');
  const receipt = {
    schema_version: 1,
    contract: 'finance-verified-candidate-v1',
    candidate_sha: candidate,
    migration_versions: versionsText,
    deployment_id: deploymentId(deployment),
    deployment_url: `${parsedUrl.origin}/`,
    manifest_sha256: sha256File(manifestPath),
    github_repository: repository,
    github_run_id: String(runId)
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return receipt;
}

function verifyReceipt(receiptPath, deploymentPath, manifestPath, candidate, versionsText, deploymentUrl, repository, runId) {
  candidate = canonicalSha(candidate);
  migrationPhase(versionsText);
  const receipt = readJson(receiptPath);
  const deployment = readJson(deploymentPath);
  const parsedUrl = new URL(deploymentUrl);
  const expected = {
    schema_version: 1,
    contract: 'finance-verified-candidate-v1',
    candidate_sha: candidate,
    migration_versions: versionsText,
    deployment_id: deploymentId(deployment),
    deployment_url: `${parsedUrl.origin}/`,
    manifest_sha256: sha256File(manifestPath),
    github_repository: repository,
    github_run_id: String(runId)
  };
  assert.deepStrictEqual(receipt, expected, 'verified candidate receipt differs from this workflow run and immutable artifact');
  if (deploymentHost(deployment) !== parsedUrl.hostname) fail('receipt candidate URL differs from its deployment record');
  return true;
}

function manifestSha(file) { return sha256File(file); }

const api = {
  PRODUCTION_CATALOG, PRODUCTION_BASELINE_LEDGER, MIGRATION_V1, MIGRATION_V2, SUPPORTED_GATE_PHASES, SUPPORTED_GATE_SUFFIXES,
  migrationVersions, migrationPhase, validateTarget, verifySupabasePublicKey, migrationFiles, classifyLedger, verifyLedger,
  ledgerSha256, readLedgerVersions, assertProductionLedgerBaseline, assertCliAtomicMigration,
  prepareRehearsal, prepareGateQuery, prepareReadOnlyQuery, prepareApply, normalizeQueryRows,
  verifyCandidate, verifyVercelTarget, verifyProductionBaseline, verifyPromotion,
  createReceipt, verifyReceipt, manifestSha
};
module.exports = api;
if (require.main === module) {
  try {
    const command = process.argv[2];
    if (command === 'validate-target') validateTarget(process.env, arg('candidate-sha'), arg('migration-versions'), arg('project-ref'));
    else if (command === 'classify-ledger') process.stdout.write(`${classifyLedger(arg('ledger'), arg('migration-dir'), arg('migration-versions'))}\n`);
    else if (command === 'verify-ledger') verifyLedger(arg('mode'), arg('ledger'), arg('migration-dir'), arg('migration-versions'));
    else if (command === 'prepare-rehearsal') prepareRehearsal(arg('migration'), arg('output'), arg('migration-version'), arg('fingerprint'), arg('authenticated-canary'));
    else if (command === 'prepare-gate-query') prepareGateQuery(arg('input'), arg('output'), arg('migration-versions'));
    else if (command === 'prepare-read-only-query') prepareReadOnlyQuery(arg('input'), arg('output'));
    else if (command === 'prepare-apply') prepareApply(arg('migration'), arg('output'), arg('migration-version'), arg('ledger'));
    else if (command === 'normalize-query-rows') normalizeQueryRows(arg('input'), arg('output'));
    else if (command === 'verify-supabase-public-key') verifySupabasePublicKey(arg('api-keys-json'), process.env.FINANCE_SUPABASE_ANON_KEY);
    else if (command === 'verify-candidate') verifyCandidate(arg('local-manifest'), arg('remote-manifest'), arg('candidate-sha'), arg('deployment-url'));
    else if (command === 'verify-vercel-target') verifyVercelTarget(arg('deployment-json'), arg('project-json'), arg('domains-json'), arg('candidate-sha'), arg('deployment-url'), optionalBooleanArg('allow-production-alias'));
    else if (command === 'verify-production-baseline') verifyProductionBaseline(arg('production-manifest'), arg('candidate-manifest'), arg('candidate-sha'), arg('migration-versions'));
    else if (command === 'verify-promotion') verifyPromotion(arg('candidate-deployment-json'), arg('promoted-deployment-json'), arg('production-manifest'), arg('candidate-manifest'));
    else if (command === 'create-receipt') createReceipt(arg('output'), arg('deployment-json'), arg('manifest'), arg('candidate-sha'), arg('migration-versions'), arg('deployment-url'), arg('repository'), arg('run-id'));
    else if (command === 'verify-receipt') verifyReceipt(arg('receipt'), arg('deployment-json'), arg('manifest'), arg('candidate-sha'), arg('migration-versions'), arg('deployment-url'), arg('repository'), arg('run-id'));
    else if (command === 'manifest-sha') process.stdout.write(`${manifestSha(arg('manifest'))}\n`);
    else fail('unknown command');
    if (!['manifest-sha','classify-ledger'].includes(command)) process.stdout.write(`PASS finance production release guard: ${command}\n`);
  } catch (error) { process.stderr.write(`FAIL ${error.message}\n`); process.exit(1); }
}
