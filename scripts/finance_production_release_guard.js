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
const MIGRATION_V3 = '20260827052447';
const MIGRATION_CHAIN = Object.freeze([MIGRATION_V1, MIGRATION_V2, MIGRATION_V3]);
const MIGRATION_PORTAL_LINK_REPAIR = '20260828015718';
const MIGRATION_TOP_LEVEL_CEO_ROUTE = '20260831042040';
const MIGRATION_EXPENSE_DERIVED_STATUS = '20260831043517';
const MIGRATION_FINAL_ACCOUNTANT_SELF_POST = '20260901024020';
const MIGRATION_FORMAL_CASHIER_REPAIR = '20260901073241';
const MIGRATION_FORMAL_CASHIER_SELF_DISBURSEMENT = '20260901081807';
const MIGRATION_HUMAN_ACCOUNTING_AUTHORITY = '20260902054834';
const REVIEWED_POST_BASELINE_MIGRATIONS = Object.freeze([
  MIGRATION_PORTAL_LINK_REPAIR,
  MIGRATION_TOP_LEVEL_CEO_ROUTE,
  MIGRATION_EXPENSE_DERIVED_STATUS,
  MIGRATION_FINAL_ACCOUNTANT_SELF_POST,
  MIGRATION_FORMAL_CASHIER_REPAIR,
  MIGRATION_FORMAL_CASHIER_SELF_DISBURSEMENT
]);
const AUDIT_MIGRATIONS = Object.freeze(['20260907154404','20260907154739','20260907154742','20260907154743','20260907154758','20260907154759']);
const RELEASE_PHASE_DATABASE_AUDIT = 'database_audit_20260907';
const CASE_MIGRATIONS = Object.freeze(['20260908065050']);
const RELEASE_PHASE_DATABASE_CASES = 'database_cases_20260908';
const UTILITY_MIGRATIONS = Object.freeze(['20260909083825']);
const RELEASE_PHASE_DATABASE_UTILITY = 'database_utility_tax_20260909';
const REPORT_MIGRATIONS = Object.freeze(['20260910064324','20260910064325']);
const RELEASE_PHASE_DATABASE_REPORTS = 'database_reports_20260910';
const AMOUNT_SEARCH_MIGRATIONS = Object.freeze(['20260910083000']);
const RELEASE_PHASE_DATABASE_AMOUNT_SEARCH = 'database_amount_search_20260910';
const REPORTING_INTEGRITY_MIGRATIONS = Object.freeze(['20260911135457','20260911135514']);
const RELEASE_PHASE_DATABASE_REPORTING_INTEGRITY = 'database_reporting_integrity_20260911';
const AUDIT_READINESS_MIGRATIONS = Object.freeze(['20260911151054']);
const RELEASE_PHASE_DATABASE_AUDIT_READINESS = 'database_audit_readiness_20260911';
const EMPLOYEE_RELIABILITY_MIGRATIONS = Object.freeze(['20260912145849']);
const RELEASE_PHASE_DATABASE_EMPLOYEE_RELIABILITY = 'database_employee_reliability_20260912';
const HISTORY_PERFORMANCE_MIGRATIONS = Object.freeze(['20260912164807']);
const RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE = 'database_history_performance_20260913';
const HISTORY_PERFORMANCE_POSTFLIGHT_FILES = Object.freeze(['finance_approval_history_postflight.sql']);
const EMPLOYEE_RELIABILITY_POSTFLIGHT_FILES = Object.freeze(['finance_employee_reliability_postflight.sql']);
const AUDIT_READINESS_POSTFLIGHT_FILES = Object.freeze(['finance_audit_readiness_postflight.sql']);
const REPORTING_INTEGRITY_POSTFLIGHT_FILES = Object.freeze(['finance_ar_reconciliation_postflight.sql','finance_tax_source_integrity_postflight.sql']);
const REPORT_POSTFLIGHT_FILES = Object.freeze([
  'finance_production_db_postflight.sql',
  'finance_audit_20260907_postflight.sql',
  'finance_finalize_accounting_lines_postflight.sql',
  'finance_utility_tax_postflight.sql',
  'finance_production_human_accounting_canary.sql',
  'finance_canonical_receivables_postflight.sql',
  'finance_reporting_profiles_postflight.sql'
]);
const REVIEWED_MIGRATION_CATALOG = Object.freeze([
  ...MIGRATION_CHAIN,
  ...REVIEWED_POST_BASELINE_MIGRATIONS,
  MIGRATION_HUMAN_ACCOUNTING_AUTHORITY,
  ...AUDIT_MIGRATIONS,
  ...CASE_MIGRATIONS,
  ...UTILITY_MIGRATIONS,
  ...REPORT_MIGRATIONS,
  ...AMOUNT_SEARCH_MIGRATIONS,
  ...REPORTING_INTEGRITY_MIGRATIONS,
  ...AUDIT_READINESS_MIGRATIONS,
  ...EMPLOYEE_RELIABILITY_MIGRATIONS,
  ...HISTORY_PERFORMANCE_MIGRATIONS
]);
const RELEASE_PHASE_FRONTEND_COMPAT = 'frontend_compat';
const RELEASE_PHASE_DATABASE_V3 = 'database_v3';
const RELEASE_PHASE_DATABASE_HUMAN_ACCOUNTING = 'database_human_accounting';
const RELEASE_PHASES = Object.freeze({
  [RELEASE_PHASE_FRONTEND_COMPAT]: 'none',
  [RELEASE_PHASE_DATABASE_V3]: MIGRATION_V3,
  [RELEASE_PHASE_DATABASE_AUDIT]: AUDIT_MIGRATIONS.join(','),
  [RELEASE_PHASE_DATABASE_CASES]: CASE_MIGRATIONS.join(','),
  [RELEASE_PHASE_DATABASE_UTILITY]: UTILITY_MIGRATIONS.join(','),
  [RELEASE_PHASE_DATABASE_REPORTS]: REPORT_MIGRATIONS.join(','),
  [RELEASE_PHASE_DATABASE_AMOUNT_SEARCH]: AMOUNT_SEARCH_MIGRATIONS.join(','),
  [RELEASE_PHASE_DATABASE_REPORTING_INTEGRITY]: REPORTING_INTEGRITY_MIGRATIONS.join(','),
  [RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE]: HISTORY_PERFORMANCE_MIGRATIONS.join(','),
  [RELEASE_PHASE_DATABASE_EMPLOYEE_RELIABILITY]: EMPLOYEE_RELIABILITY_MIGRATIONS.join(','),
  [RELEASE_PHASE_DATABASE_AUDIT_READINESS]: AUDIT_READINESS_MIGRATIONS.join(','),
  [RELEASE_PHASE_DATABASE_HUMAN_ACCOUNTING]: MIGRATION_HUMAN_ACCOUNTING_AUTHORITY
});
const FRONTEND_RELEASE_CONTRACT = 'expense-submit-resilience-v3-20260827';
const PRODUCTION_BASELINE_LEDGER = Object.freeze({
  count: 120,
  lastVersion: '20260825103034',
  sha256: '23680167bee6cfefcdbd7eb951907da61955019e24368d6e13e9ac1282422cd6'
});
// The SQL gate catalog retains historical v1/v2 contracts for exact-state
// verification. The protected workflow itself only accepts validateTarget's two
// explicit frontend_compat/database_history_performance_20260913 pairs.
const SUPPORTED_GATE_PHASES = Object.freeze([
  Object.freeze([]),
  Object.freeze([MIGRATION_V1]),
  Object.freeze([MIGRATION_V2]),
  Object.freeze([MIGRATION_V3]),
  Object.freeze([MIGRATION_HUMAN_ACCOUNTING_AUTHORITY]),
  AUDIT_MIGRATIONS,
  CASE_MIGRATIONS,
  UTILITY_MIGRATIONS,
  REPORT_MIGRATIONS,
  AMOUNT_SEARCH_MIGRATIONS,
  REPORTING_INTEGRITY_MIGRATIONS,
  AUDIT_READINESS_MIGRATIONS,
  EMPLOYEE_RELIABILITY_MIGRATIONS,
  HISTORY_PERFORMANCE_MIGRATIONS
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
    if (versions.length > 1 && versions.every((version) => MIGRATION_CHAIN.includes(version))) {
      fail('v1, v2, and v3 must be released as separate phases; a live rollback rehearsal is not a shadow database or an atomic compatibility proof');
    }
    fail('database gate has no exact catalog contract for this migration phase');
  }
  return versions;
}
function releasePlan(releasePhase, versionsText) {
  releasePhase = String(releasePhase || '');
  if (!Object.hasOwn(RELEASE_PHASES, releasePhase)) {
    fail(`release_phase must be one of: ${Object.keys(RELEASE_PHASES).join(', ')}`);
  }
  migrationPhase(versionsText);
  if (versionsText !== RELEASE_PHASES[releasePhase]) {
    fail(`${releasePhase} must use migration_versions=${RELEASE_PHASES[releasePhase]}`);
  }
  return Object.freeze({ releasePhase, migrationVersions: versionsText });
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

function validateTarget(env, candidate, releasePhase, versionsText, expectedRef) {
  canonicalSha(candidate);
  releasePlan(releasePhase, versionsText);
  if (![RELEASE_PHASE_FRONTEND_COMPAT,RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE].includes(releasePhase)) fail('legacy database phases are archived for this candidate; use the fixed history performance phase');
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
  for (const version of REVIEWED_MIGRATION_CATALOG) {
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
  const unexpected = remote.filter((version) => version >= MIGRATION_V1 && !REVIEWED_MIGRATION_CATALOG.includes(version));
  if (unexpected.length) fail(`remote ledger contains an unreviewed post-baseline migration: ${unexpected.join(',')}`);
  return true;
}
function assertReviewedAdoptedMigrations(remote) {
  const missing = REVIEWED_POST_BASELINE_MIGRATIONS.filter((version) => !remote.includes(version));
  if (missing.length) {
    fail(`remote ledger is missing a reviewed adopted migration: ${missing.join(',')}`);
  }
  return true;
}
function classifyLedger(ledgerPath, directory, releasePhase, versionsText, baseline = PRODUCTION_BASELINE_LEDGER) {
  const plan = releasePlan(releasePhase, versionsText);
  const requested = migrationPhase(versionsText);
  const local = migrationFiles(directory);
  if (!local.length) fail('local migration catalog is empty');
  const remote = readLedgerVersions(ledgerPath);
  assertProductionLedgerBaseline(remote, baseline);
  const missing = MIGRATION_CHAIN.filter((version) => !remote.includes(version));
  if(plan.releasePhase===RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE){
    const prerequisites=REVIEWED_MIGRATION_CATALOG.filter(v=>v<HISTORY_PERFORMANCE_MIGRATIONS[0]);
    if(prerequisites.some(v=>!remote.includes(v)))fail('history performance phase requires every reviewed prerequisite migration');
    if(HISTORY_PERFORMANCE_MIGRATIONS.some(v=>!local.some(name=>name.startsWith(v+'_'))))fail('history performance migration file is missing');
    return remote.includes(HISTORY_PERFORMANCE_MIGRATIONS[0])?'applied':'pending';
  }
  if(plan.releasePhase===RELEASE_PHASE_DATABASE_EMPLOYEE_RELIABILITY){
    const prerequisites=REVIEWED_MIGRATION_CATALOG.filter(v=>v<EMPLOYEE_RELIABILITY_MIGRATIONS[0]);
    if(prerequisites.some(v=>!remote.includes(v)))fail('employee reliability phase requires every reviewed prerequisite migration');
    if(EMPLOYEE_RELIABILITY_MIGRATIONS.some(v=>!local.some(name=>name.startsWith(v+'_'))))fail('employee reliability migration file is missing');
    return remote.includes(EMPLOYEE_RELIABILITY_MIGRATIONS[0])?'applied':'pending';
  }
  if(plan.releasePhase===RELEASE_PHASE_DATABASE_AUDIT_READINESS){
    const prerequisites=REVIEWED_MIGRATION_CATALOG.filter(v=>v<AUDIT_READINESS_MIGRATIONS[0]);
    if(prerequisites.some(v=>!remote.includes(v)))fail('audit readiness phase requires every reviewed prerequisite migration');
    if(AUDIT_READINESS_MIGRATIONS.some(v=>!local.some(name=>name.startsWith(v+'_'))))fail('audit readiness migration file is missing');
    return remote.includes(AUDIT_READINESS_MIGRATIONS[0])?'applied':'pending';
  }
  if(plan.releasePhase===RELEASE_PHASE_DATABASE_REPORTING_INTEGRITY){
    const prerequisites=REVIEWED_MIGRATION_CATALOG.filter(v=>v<REPORTING_INTEGRITY_MIGRATIONS[0]);
    if(prerequisites.some(v=>!remote.includes(v)))fail('reporting integrity phase requires every reviewed prerequisite migration');
    if(REPORTING_INTEGRITY_MIGRATIONS.some(v=>!local.some(name=>name.startsWith(v+'_'))))fail('reporting integrity migration file is missing');
    const installed=REPORTING_INTEGRITY_MIGRATIONS.filter(v=>remote.includes(v));
    if(installed.length!==0&&installed.length!==REPORTING_INTEGRITY_MIGRATIONS.length)fail('reporting integrity phase is partially installed; no mutation is permitted');
    return installed.length?'applied':'pending';
  }
  if(plan.releasePhase===RELEASE_PHASE_DATABASE_AMOUNT_SEARCH){
    const prerequisites=[...MIGRATION_CHAIN,...REVIEWED_POST_BASELINE_MIGRATIONS,MIGRATION_HUMAN_ACCOUNTING_AUTHORITY,...AUDIT_MIGRATIONS,...CASE_MIGRATIONS,...UTILITY_MIGRATIONS,...REPORT_MIGRATIONS];
    if(prerequisites.some(v=>!remote.includes(v)))fail('amount search phase requires the complete reviewed authority, audit, cases, utility and reports batches');
    if(AMOUNT_SEARCH_MIGRATIONS.some(v=>!local.some(name=>name.startsWith(v+'_'))))fail('amount search migration file is missing');
    return remote.includes(AMOUNT_SEARCH_MIGRATIONS[0])?'applied':'pending';
  }
  if (plan.releasePhase === RELEASE_PHASE_DATABASE_REPORTS) {
    const prerequisites=[...MIGRATION_CHAIN,...REVIEWED_POST_BASELINE_MIGRATIONS,MIGRATION_HUMAN_ACCOUNTING_AUTHORITY,...AUDIT_MIGRATIONS,...CASE_MIGRATIONS,...UTILITY_MIGRATIONS];
    if(prerequisites.some(v=>!remote.includes(v))) fail('reports phase requires the complete reviewed authority chain, audit, cases and utility batches');
    if(REPORT_MIGRATIONS.some(v=>!local.some(name=>name.startsWith(v+'_')))) fail('reports migration file is missing');
    const installed=REPORT_MIGRATIONS.filter(v=>remote.includes(v));
    if(installed.length!==0&&installed.length!==REPORT_MIGRATIONS.length)fail('reports phase is partially installed; no mutation is permitted');
    return installed.length?'applied':'pending';
  }
  if (plan.releasePhase === RELEASE_PHASE_DATABASE_UTILITY) {
    const prerequisites=[...MIGRATION_CHAIN,...REVIEWED_POST_BASELINE_MIGRATIONS,MIGRATION_HUMAN_ACCOUNTING_AUTHORITY,...AUDIT_MIGRATIONS,...CASE_MIGRATIONS];
    if(prerequisites.some(v=>!remote.includes(v))) fail('utility tax phase requires the complete reviewed authority chain, audit batch and database cases batch');
    if(UTILITY_MIGRATIONS.some(v=>!local.some(name=>name.startsWith(v+'_')))) fail('utility tax migration file is missing');
    return remote.includes(UTILITY_MIGRATIONS[0])?'applied':'pending';
  }
  if (plan.releasePhase === RELEASE_PHASE_DATABASE_CASES) {
    const prerequisites=[...MIGRATION_CHAIN,...REVIEWED_POST_BASELINE_MIGRATIONS,MIGRATION_HUMAN_ACCOUNTING_AUTHORITY,...AUDIT_MIGRATIONS];
    if(prerequisites.some(v=>!remote.includes(v))) fail('database cases phase requires the complete reviewed authority chain and audit migration batch');
    if(CASE_MIGRATIONS.some(v=>!local.some(name=>name.startsWith(v+'_')))) fail('database cases migration file is missing');
    return remote.includes(CASE_MIGRATIONS[0])?'applied':'pending';
  }
  if (plan.releasePhase === RELEASE_PHASE_DATABASE_AUDIT) {
    const legacy=[...MIGRATION_CHAIN,...REVIEWED_POST_BASELINE_MIGRATIONS,MIGRATION_HUMAN_ACCOUNTING_AUTHORITY];
    if(legacy.some(v=>!remote.includes(v))) fail('audit phase requires the complete reviewed legacy authority chain');
    if(AUDIT_MIGRATIONS.some(v=>!local.some(name=>name.startsWith(v+'_')))) fail('audit migration file is missing');
    const installed=AUDIT_MIGRATIONS.filter(v=>remote.includes(v));
    if(installed.length!==0&&installed.length!==AUDIT_MIGRATIONS.length) fail('audit phase is partially installed; no mutation is permitted');
    return installed.length?'applied':'pending';
  }
  if (plan.releasePhase === RELEASE_PHASE_FRONTEND_COMPAT) {
    if (missing.length) {
      fail(`frontend_compat requires the complete v1/v2/v3 authority chain, found pending: ${missing.join(',')}`);
    }
    assertReviewedAdoptedMigrations(remote);
    if (!remote.includes(MIGRATION_HUMAN_ACCOUNTING_AUTHORITY)) {
      fail(`frontend_compat requires applied migration ${MIGRATION_HUMAN_ACCOUNTING_AUTHORITY}`);
    }
    if(AUDIT_MIGRATIONS.some(version=>!remote.includes(version))) fail('frontend_compat requires the complete audit migration batch');
    if(CASE_MIGRATIONS.some(version=>!remote.includes(version))) fail('frontend_compat requires the complete database cases migration batch');
    if(UTILITY_MIGRATIONS.some(version=>!remote.includes(version))) fail('frontend_compat requires the complete utility tax migration batch');
    if(REPORT_MIGRATIONS.some(version=>!remote.includes(version))) fail('frontend_compat requires the complete financial reports migration batch');
    if(AMOUNT_SEARCH_MIGRATIONS.some(version=>!remote.includes(version)))fail('frontend_compat requires the complete amount search migration batch');
    if(REPORTING_INTEGRITY_MIGRATIONS.some(version=>!remote.includes(version)))fail('frontend_compat requires the complete reporting integrity migration batch');
    if(AUDIT_READINESS_MIGRATIONS.some(version=>!remote.includes(version)))fail('frontend_compat requires the complete audit readiness migration batch');
    if(EMPLOYEE_RELIABILITY_MIGRATIONS.some(version=>!remote.includes(version)))fail('frontend_compat requires the complete employee reliability migration batch');
    if(HISTORY_PERFORMANCE_MIGRATIONS.some(version=>!remote.includes(version)))fail('frontend_compat requires the complete history performance migration batch');
    return 'compat';
  }
  if (plan.releasePhase === RELEASE_PHASE_DATABASE_HUMAN_ACCOUNTING) {
    if (missing.length) {
      fail(`database_human_accounting requires the complete v1/v2/v3 authority chain, found pending: ${missing.join(',')}`);
    }
    assertReviewedAdoptedMigrations(remote);
    return remote.includes(MIGRATION_HUMAN_ACCOUNTING_AUTHORITY) ? 'applied' : 'pending';
  }
  if (!requested.length) {
    if (missing.length) fail(`none phase requires zero local pending migrations, found: ${missing.join(',')}`);
    return 'noop';
  }
  const targetIndex = MIGRATION_CHAIN.indexOf(requested[0]);
  const pending = MIGRATION_CHAIN.slice(targetIndex);
  const applied = MIGRATION_CHAIN.slice(targetIndex + 1);
  if (missing.join(',') === pending.join(',')) return 'pending';
  if (missing.join(',') === applied.join(',')) {
    assertReviewedAdoptedMigrations(remote);
    return 'applied';
  }
  fail(`ledger is neither the exact pending nor applied state for this phase: ${missing.length ? missing.join(',') : 'none'}`);
}
function verifyLedger(mode, ledgerPath, directory, releasePhase, versionsText, baseline = PRODUCTION_BASELINE_LEDGER) {
  const plan = releasePlan(releasePhase, versionsText);
  const requested = migrationPhase(versionsText);
  if (!['pre', 'post'].includes(mode)) fail('ledger mode must be pre or post');
  const state = classifyLedger(ledgerPath, directory, releasePhase, versionsText, baseline);
  const expectedState = plan.releasePhase === RELEASE_PHASE_FRONTEND_COMPAT
    ? 'compat'
    : (requested.length ? (mode === 'pre' ? 'pending' : 'applied') : 'noop');
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
  const raw = fs.readFileSync(canaryPath, 'utf8');
  const source = raw.startsWith('\\set') ? stripPsqlDirectives(raw, path.basename(canaryPath)) : raw;
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
function readAuditBatch(directory, versionsText, releasePhase=RELEASE_PHASE_DATABASE_AUDIT) {
  if(![RELEASE_PHASE_DATABASE_AUDIT,RELEASE_PHASE_DATABASE_CASES,RELEASE_PHASE_DATABASE_UTILITY,RELEASE_PHASE_DATABASE_REPORTS,RELEASE_PHASE_DATABASE_AMOUNT_SEARCH,RELEASE_PHASE_DATABASE_REPORTING_INTEGRITY,RELEASE_PHASE_DATABASE_AUDIT_READINESS,RELEASE_PHASE_DATABASE_EMPLOYEE_RELIABILITY,RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE].includes(releasePhase))fail('unsupported fixed database batch');
  releasePlan(releasePhase,versionsText);
  const files=migrationFiles(directory);
  return migrationPhase(versionsText).map(version=>{
    const filename=files.find(name=>name.startsWith(version+'_'));
    if(!filename)fail(`audit migration is missing: ${version}`);
    const source=fs.readFileSync(path.join(directory,filename),'utf8');
    assertCliAtomicMigration(source,filename);
    if(!source.trim())fail(`audit migration is empty: ${version}`);
    return {version,filename,source};
  });
}
function reportsRehearsalRollbackCheck(source) {
  // These seven relations are created by the fixed reports batch. After rolling
  // back that batch on first installation they do not exist. Keep every original
  // predicate, but plan its SELECT only when the relation exists. Existing-table
  // checks and the complete before/after schema/data fingerprint remain intact.
  const optionalChecks = [
    ['private.finance_ar_terms_v1', "invoice_id='__finance_ar_canary_20260910__'"],
    ['private.finance_ar_receipts_v1', "invoice_id='__finance_ar_canary_20260910__'"],
    ['private.finance_ar_refunds_v1', "invoice_id='__finance_ar_canary_20260910__'"],
    ['private.finance_ar_audit_v1', "invoice_id='__finance_ar_canary_20260910__'"],
    ['private.finance_ar_operations_v1', "invoice_id='__finance_ar_canary_20260910__' or operation_key like 'canary-ar-%20260910'"],
    ['private.finance_reporting_profile_revisions_v1', "reason='__finance_reporting_profiles_canary_20260910__'"],
    ['public.finance_reporting_profiles', "profile#>>array['tax','periods','2099-11-01/2099-12-31','priorCarryforwardTax']='123456.78'"]
  ];
  const declarations=[],reads=[];
  for(const [relation,predicate] of optionalChecks){
    if(!source.includes(relation))continue;
    const expression=`exists(select 1 from ${relation} where ${predicate})`;
    if(source.split(expression).length!==2)fail(`reports rollback check changed its reviewed predicate for ${relation}`);
    const variable=`finance_optional_report_check_${declarations.length}`;
    source=source.replace(expression,variable);
    if(source.includes(relation))fail(`reports rollback check has an unguarded reference to ${relation}`);
    declarations.push(`  ${variable} boolean := false;`);
    reads.push(`  if to_regclass(${sqlLiteral(relation)}) is not null then\n    execute ${sqlLiteral('select '+expression)} into ${variable};\n  end if;`);
  }
  if(!declarations.length)return source;
  const opening=/^(do\s+\$[a-z0-9_]*\$\s*)begin\b/i;
  if(!opening.test(source))fail('reports rollback check must preserve its reviewed declaration-free DO block');
  return source.replace(opening,(_,prefix)=>`${prefix}declare\n${declarations.join('\n')}\nbegin\n${reads.join('\n')}\n`);
}
function reportsPostflightChain(postflightPath,profilePostflightPath,includeAmountSearch=false,includeIntegrity=false,includeAuditReadiness=false,includeEmployeeReliability=false,includeHistoryPerformance=false) {
  const directory=path.dirname(postflightPath);
  if(path.resolve(path.dirname(profilePostflightPath))!==path.resolve(directory))fail('reports postflights must use the same sealed source directory');
  return REPORT_POSTFLIGHT_FILES.concat(includeAmountSearch?['finance_amount_search_postflight.sql']:[],includeIntegrity?REPORTING_INTEGRITY_POSTFLIGHT_FILES:[],includeAuditReadiness?AUDIT_READINESS_POSTFLIGHT_FILES:[],includeEmployeeReliability?EMPLOYEE_RELIABILITY_POSTFLIGHT_FILES:[],includeHistoryPerformance?HISTORY_PERFORMANCE_POSTFLIGHT_FILES:[]).map(name=>{
    const sourcePath=name==='finance_canonical_receivables_postflight.sql'?postflightPath:name==='finance_reporting_profiles_postflight.sql'?profilePostflightPath:path.join(directory,name);
    let source=stripPsqlDirectives(fs.readFileSync(sourcePath,'utf8'),name);
    if(name==='finance_production_db_postflight.sql'){
      if(!/:'migration_versions'/.test(source))fail('reports chain requires the reviewed v3 migration phase marker');
      source=source.replace(/:'migration_versions'/g,sqlLiteral(MIGRATION_V3));
    }
    assertCliAtomicMigration(source,`reports postflight ${name}`);
    return `-- Reviewed reports postflight: ${name}\n${source.trimEnd()}`;
  }).join('\n');
}
function prepareAuditBatchRehearsal(directory,outputPath,versionsText,fingerprintPath,canaryPath,postflightPath,releasePhase=RELEASE_PHASE_DATABASE_AUDIT,caseCanaryPath=null,utilityCanaryPath=null,reportCanaryPaths=[],profilePostflightPath=null,amountCanaryPath=null,integrityCanaryPaths=[],auditReadinessCanaryPath=null,employeeReliabilityCanaryPath=null,historyPerformanceCanaryPath=null) {
  const batch=readAuditBatch(directory,versionsText,releasePhase);
  const canary=authenticatedCanarySections(canaryPath);
  const fingerprint=stripPsqlDirectives(fs.readFileSync(fingerprintPath,'utf8'),path.basename(fingerprintPath)).trim();
  if(!/^with\b/i.test(fingerprint)||/\b(?:insert\s+into|update\s+\S+\s+set|delete\s+from|alter\s+table|create\s+(?:table|index|schema|function|policy)|drop\s+(?:table|index|schema|function|policy)|truncate\s+|vacuum\b|call\s+|copy\s+)\b/i.test(fingerprint))fail('audit fingerprint must be a pure read-only CTE query');
  const reports=[RELEASE_PHASE_DATABASE_REPORTS,RELEASE_PHASE_DATABASE_AMOUNT_SEARCH,RELEASE_PHASE_DATABASE_REPORTING_INTEGRITY,RELEASE_PHASE_DATABASE_AUDIT_READINESS,RELEASE_PHASE_DATABASE_EMPLOYEE_RELIABILITY,RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE].includes(releasePhase);
  const postflight=reports?reportsPostflightChain(postflightPath,profilePostflightPath,[RELEASE_PHASE_DATABASE_AMOUNT_SEARCH,RELEASE_PHASE_DATABASE_REPORTING_INTEGRITY,RELEASE_PHASE_DATABASE_AUDIT_READINESS,RELEASE_PHASE_DATABASE_EMPLOYEE_RELIABILITY,RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE].includes(releasePhase),[RELEASE_PHASE_DATABASE_REPORTING_INTEGRITY,RELEASE_PHASE_DATABASE_AUDIT_READINESS,RELEASE_PHASE_DATABASE_EMPLOYEE_RELIABILITY,RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE].includes(releasePhase),[RELEASE_PHASE_DATABASE_AUDIT_READINESS,RELEASE_PHASE_DATABASE_EMPLOYEE_RELIABILITY,RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE].includes(releasePhase),[RELEASE_PHASE_DATABASE_EMPLOYEE_RELIABILITY,RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE].includes(releasePhase),releasePhase===RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE):stripPsqlDirectives(fs.readFileSync(postflightPath,'utf8'),path.basename(postflightPath));
  assertCliAtomicMigration(postflight,'audit postflight');
  const extraCanary=[RELEASE_PHASE_DATABASE_CASES,RELEASE_PHASE_DATABASE_UTILITY,RELEASE_PHASE_DATABASE_REPORTS,RELEASE_PHASE_DATABASE_AMOUNT_SEARCH,RELEASE_PHASE_DATABASE_REPORTING_INTEGRITY,RELEASE_PHASE_DATABASE_AUDIT_READINESS,RELEASE_PHASE_DATABASE_EMPLOYEE_RELIABILITY,RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE].includes(releasePhase)?authenticatedCanarySections(caseCanaryPath):{core:'',rollbackCheck:''};
  const utilityCanary=[RELEASE_PHASE_DATABASE_UTILITY,RELEASE_PHASE_DATABASE_REPORTS,RELEASE_PHASE_DATABASE_AMOUNT_SEARCH,RELEASE_PHASE_DATABASE_REPORTING_INTEGRITY,RELEASE_PHASE_DATABASE_AUDIT_READINESS,RELEASE_PHASE_DATABASE_EMPLOYEE_RELIABILITY,RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE].includes(releasePhase)?authenticatedCanarySections(utilityCanaryPath):{core:'',rollbackCheck:''};
  if(reports&&reportCanaryPaths.length!==2)fail('reports rehearsal requires both authenticated domain canaries');
  const reportCanaries=reports?reportCanaryPaths.map(authenticatedCanarySections):[];
  const amountCanary=[RELEASE_PHASE_DATABASE_AMOUNT_SEARCH,RELEASE_PHASE_DATABASE_REPORTING_INTEGRITY,RELEASE_PHASE_DATABASE_AUDIT_READINESS,RELEASE_PHASE_DATABASE_EMPLOYEE_RELIABILITY,RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE].includes(releasePhase)?authenticatedCanarySections(amountCanaryPath):{core:'',rollbackCheck:''};
  if([RELEASE_PHASE_DATABASE_REPORTING_INTEGRITY,RELEASE_PHASE_DATABASE_AUDIT_READINESS,RELEASE_PHASE_DATABASE_EMPLOYEE_RELIABILITY,RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE].includes(releasePhase)&&integrityCanaryPaths.length!==2)fail('reporting integrity requires both domain canaries');
  const integrityCanaries=[RELEASE_PHASE_DATABASE_REPORTING_INTEGRITY,RELEASE_PHASE_DATABASE_AUDIT_READINESS,RELEASE_PHASE_DATABASE_EMPLOYEE_RELIABILITY,RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE].includes(releasePhase)?integrityCanaryPaths.map(authenticatedCanarySections):[];
  const readinessCanary=[RELEASE_PHASE_DATABASE_AUDIT_READINESS,RELEASE_PHASE_DATABASE_EMPLOYEE_RELIABILITY,RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE].includes(releasePhase)?authenticatedCanarySections(auditReadinessCanaryPath):{core:'',rollbackCheck:''};
  const employeeCanary=[RELEASE_PHASE_DATABASE_EMPLOYEE_RELIABILITY,RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE].includes(releasePhase)?authenticatedCanarySections(employeeReliabilityCanaryPath):{core:'',rollbackCheck:''};
  const historyCanary=releasePhase===RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE?authenticatedCanarySections(historyPerformanceCanaryPath):{core:'',rollbackCheck:''};
  const sources=batch.map(item=>item.source.trimEnd()).join('\n');
  const tag='$finance_audit_rollback_assert$';
  if([sources,fingerprint,postflight,historyCanary.core,historyCanary.rollbackCheck,employeeCanary.core,employeeCanary.rollbackCheck,readinessCanary.core,readinessCanary.rollbackCheck,canary.core,canary.rollbackCheck,extraCanary.core,extraCanary.rollbackCheck,utilityCanary.core,utilityCanary.rollbackCheck,amountCanary.core,amountCanary.rollbackCheck,...reportCanaries.flatMap(item=>[item.core,item.rollbackCheck]),...integrityCanaries.flatMap(item=>[item.core,item.rollbackCheck])].some(value=>value.includes(tag)))fail('audit rehearsal assertion tag collision');
  writeExclusive(outputPath,`begin isolation level repeatable read;
set local lock_timeout = '5s';
set local statement_timeout = '180s';
create temporary table finance_release_fingerprint_before on commit drop as
${fingerprint}
savepoint finance_release_migration;
${sources}
${postflight}
${canary.core}
${extraCanary.core}
${utilityCanary.core}
${reportCanaries.map(item=>item.core).join('\n')}
${amountCanary.core}
${integrityCanaries.map(item=>item.core).join('\n')}
${readinessCanary.core}
${employeeCanary.core}
${historyCanary.core}
rollback to savepoint finance_release_migration;
${canary.rollbackCheck}
${extraCanary.rollbackCheck}
${utilityCanary.rollbackCheck}
${reportCanaries.map(item=>reportsRehearsalRollbackCheck(item.rollbackCheck)).join('\n')}
${amountCanary.rollbackCheck}
${integrityCanaries.map(item=>item.rollbackCheck).join('\n')}
${readinessCanary.rollbackCheck}
${employeeCanary.rollbackCheck}
${historyCanary.rollbackCheck}
create temporary table finance_release_fingerprint_after on commit drop as
${fingerprint}
do ${tag}
begin
  if (select fingerprint from finance_release_fingerprint_before) is distinct from
     (select fingerprint from finance_release_fingerprint_after) then
    raise exception 'audit rollback rehearsal changed the reviewed database fingerprint';
  end if;
end;
${tag};
rollback;
`);
  return true;
}
function prepareAuditBatchApply(directory,outputPath,versionsText,ledgerPath,postflightPath,baseline=PRODUCTION_BASELINE_LEDGER,releasePhase=RELEASE_PHASE_DATABASE_AUDIT,profilePostflightPath=null) {
  const postflight=[RELEASE_PHASE_DATABASE_REPORTS,RELEASE_PHASE_DATABASE_AMOUNT_SEARCH,RELEASE_PHASE_DATABASE_REPORTING_INTEGRITY,RELEASE_PHASE_DATABASE_AUDIT_READINESS,RELEASE_PHASE_DATABASE_EMPLOYEE_RELIABILITY,RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE].includes(releasePhase)?reportsPostflightChain(postflightPath,profilePostflightPath,[RELEASE_PHASE_DATABASE_AMOUNT_SEARCH,RELEASE_PHASE_DATABASE_REPORTING_INTEGRITY,RELEASE_PHASE_DATABASE_AUDIT_READINESS,RELEASE_PHASE_DATABASE_EMPLOYEE_RELIABILITY,RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE].includes(releasePhase),[RELEASE_PHASE_DATABASE_REPORTING_INTEGRITY,RELEASE_PHASE_DATABASE_AUDIT_READINESS,RELEASE_PHASE_DATABASE_EMPLOYEE_RELIABILITY,RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE].includes(releasePhase),[RELEASE_PHASE_DATABASE_AUDIT_READINESS,RELEASE_PHASE_DATABASE_EMPLOYEE_RELIABILITY,RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE].includes(releasePhase),[RELEASE_PHASE_DATABASE_EMPLOYEE_RELIABILITY,RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE].includes(releasePhase),releasePhase===RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE):stripPsqlDirectives(fs.readFileSync(postflightPath,'utf8'),path.basename(postflightPath));
  assertCliAtomicMigration(postflight,'audit postflight');
  const batch=readAuditBatch(directory,versionsText,releasePhase);
  verifyLedger('pre',ledgerPath,directory,releasePhase,versionsText,baseline);
  const remote=readLedgerVersions(ledgerPath);
  const tag='$finance_audit_ledger_guard$';
  const parts=batch.map(item=>{
    const quote=`$finance_audit_migration_${item.version}$`;
    if(item.source.includes(quote)||item.source.includes(tag))fail('audit source collides with protected ledger tag');
    const name=item.filename.replace(/^\d{14}_/,'').replace(/\.sql$/,'');
    return `${item.source.trimEnd()}\ninsert into supabase_migrations.schema_migrations(version,statements,name,created_by) values (${sqlLiteral(item.version)},array[${quote}${item.source.trimEnd()}${quote}]::text[],${sqlLiteral(name)},'github-actions');`;
  });
  writeExclusive(outputPath,`begin;
set local lock_timeout = '5s';
set local statement_timeout = '180s';
select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('finance-production-release-v1',0));
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do ${tag}
declare actual_versions text[];
begin
  select pg_catalog.array_agg(version order by version) into actual_versions from supabase_migrations.schema_migrations;
  if actual_versions is distinct from array[${remote.map(sqlLiteral).join(',')}]::text[] then
    raise exception 'formal migration ledger changed after the reviewed release gate';
  end if;
end;
${tag};
${parts.join('\n')}
${postflight}
commit;
`);
  return true;
}
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
function preparePhaseQuery(sourcePath, outputPath, releasePhase, versionsText) {
  const plan = releasePlan(releasePhase, versionsText);
  const sourceName = path.basename(sourcePath);
  if([RELEASE_PHASE_DATABASE_REPORTS,RELEASE_PHASE_DATABASE_AMOUNT_SEARCH,RELEASE_PHASE_DATABASE_REPORTING_INTEGRITY,RELEASE_PHASE_DATABASE_AUDIT_READINESS,RELEASE_PHASE_DATABASE_EMPLOYEE_RELIABILITY,RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE,RELEASE_PHASE_FRONTEND_COMPAT].includes(plan.releasePhase)){
    if(sourceName!=='finance_production_db_postflight.sql')fail('reports compatibility requires the reviewed existing-v3 postflight');
    const directory=path.dirname(sourcePath),postflight=reportsPostflightChain(path.join(directory,'finance_canonical_receivables_postflight.sql'),path.join(directory,'finance_reporting_profiles_postflight.sql'),plan.releasePhase!==RELEASE_PHASE_DATABASE_REPORTS,[RELEASE_PHASE_DATABASE_REPORTING_INTEGRITY,RELEASE_PHASE_DATABASE_AUDIT_READINESS,RELEASE_PHASE_DATABASE_EMPLOYEE_RELIABILITY,RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE,RELEASE_PHASE_FRONTEND_COMPAT].includes(plan.releasePhase),[RELEASE_PHASE_DATABASE_AUDIT_READINESS,RELEASE_PHASE_DATABASE_EMPLOYEE_RELIABILITY,RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE,RELEASE_PHASE_FRONTEND_COMPAT].includes(plan.releasePhase),[RELEASE_PHASE_DATABASE_EMPLOYEE_RELIABILITY,RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE,RELEASE_PHASE_FRONTEND_COMPAT].includes(plan.releasePhase),[RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE,RELEASE_PHASE_FRONTEND_COMPAT].includes(plan.releasePhase));
    writeExclusive(outputPath,`begin read only;\nset local statement_timeout = '60s';\n${postflight}\nrollback;\n`);
    return true;
  }
  if ([RELEASE_PHASE_DATABASE_AUDIT,RELEASE_PHASE_DATABASE_CASES,RELEASE_PHASE_DATABASE_UTILITY,RELEASE_PHASE_DATABASE_REPORTS,RELEASE_PHASE_FRONTEND_COMPAT].includes(plan.releasePhase)) {
    if(sourceName!=='finance_production_db_postflight.sql') fail('audit phase requires the reviewed existing-v3 postflight');
    const base=stripPsqlDirectives(fs.readFileSync(sourcePath,'utf8'),sourceName).replace(/:'migration_versions'/g,sqlLiteral(MIGRATION_V3));
    const auditPath=path.join(path.dirname(sourcePath),'finance_audit_20260907_postflight.sql');
    const audit=stripPsqlDirectives(fs.readFileSync(auditPath,'utf8'),path.basename(auditPath));
    const cases=[RELEASE_PHASE_DATABASE_CASES,RELEASE_PHASE_DATABASE_UTILITY,RELEASE_PHASE_DATABASE_REPORTS,RELEASE_PHASE_FRONTEND_COMPAT].includes(plan.releasePhase)
      ?stripPsqlDirectives(fs.readFileSync(path.join(path.dirname(sourcePath),'finance_finalize_accounting_lines_postflight.sql'),'utf8'),'finance_finalize_accounting_lines_postflight.sql'):'';
    const utility=[RELEASE_PHASE_DATABASE_UTILITY,RELEASE_PHASE_DATABASE_REPORTS,RELEASE_PHASE_FRONTEND_COMPAT].includes(plan.releasePhase)
      ?stripPsqlDirectives(fs.readFileSync(path.join(path.dirname(sourcePath),'finance_utility_tax_postflight.sql'),'utf8'),'finance_utility_tax_postflight.sql'):'';
    const reports=[RELEASE_PHASE_DATABASE_REPORTS,RELEASE_PHASE_FRONTEND_COMPAT].includes(plan.releasePhase)
      ?['finance_canonical_receivables_postflight.sql','finance_reporting_profiles_postflight.sql'].map(name=>stripPsqlDirectives(fs.readFileSync(path.join(path.dirname(sourcePath),name),'utf8'),name)).join('\n'):'';
    writeExclusive(outputPath,`begin read only;\nset local statement_timeout = '60s';\n${base.trimEnd()}\n${audit.trimEnd()}\n${cases.trimEnd()}\n${utility.trimEnd()}\n${reports.trimEnd()}\nrollback;\n`);
    return true;
  }
  if (plan.releasePhase === RELEASE_PHASE_FRONTEND_COMPAT) {
    if (sourceName !== 'finance_production_db_postflight.sql') {
      fail('frontend_compat may only render the reviewed v3 read-only compatibility postflight');
    }
    return prepareGateQuery(sourcePath, outputPath, MIGRATION_V3);
  }
  if (plan.releasePhase === RELEASE_PHASE_DATABASE_HUMAN_ACCOUNTING) {
    if (sourceName !== 'finance_production_db_postflight.sql') {
      fail('database_human_accounting may only render the reviewed existing-v3 compatibility postflight');
    }
    return prepareGateQuery(sourcePath, outputPath, MIGRATION_V3);
  }
  if (!['finance_production_db_preflight.sql', 'finance_production_db_postflight.sql'].includes(sourceName)) {
    fail('database_v3 may only render the reviewed v3 preflight or postflight');
  }
  return prepareGateQuery(sourcePath, outputPath, MIGRATION_V3);
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
  const targetIndex = MIGRATION_CHAIN.indexOf(target);
  let expectedSuffix;
  if (target === MIGRATION_HUMAN_ACCOUNTING_AUTHORITY) {
    expectedSuffix = [...MIGRATION_CHAIN, ...REVIEWED_POST_BASELINE_MIGRATIONS];
  } else {
    if (targetIndex < 0) fail('migration target is not in the reviewed Finance chain');
    expectedSuffix = MIGRATION_CHAIN.slice(0, targetIndex);
  }
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

function verifyAuthenticatedCanary(inputPath) {
  let payload;
  try { payload = JSON.parse(fs.readFileSync(inputPath, 'utf8')); }
  catch (error) { fail(`${path.basename(inputPath)} is not valid JSON: ${error.message}`); }

  const matches = [];
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value)
        && Object.prototype.hasOwnProperty.call(value, 'authenticated_canary_result')) {
      matches.push(value.authenticated_canary_result);
    }
    if (Array.isArray(value)) value.forEach(visit);
    else Object.values(value).forEach(visit);
  };
  visit(payload);

  if (matches.length !== 1) {
    fail(`authenticated canary output must contain exactly one result, found ${matches.length}`);
  }
  let result = matches[0];
  if (typeof result === 'string') {
    try { result = JSON.parse(result); }
    catch (error) { fail(`authenticated canary result is not valid JSON: ${error.message}`); }
  }
  const expected = {
    canary: 'authenticated_submit_return_resubmit',
    notification_worker_contract_verified: true,
    notifications_enqueued: false,
    ok: true,
    rolled_back: true
  };
  try { assert.deepStrictEqual(result, expected); }
  catch {
    const safeResult = result && typeof result === 'object'
      ? Object.fromEntries(Object.entries(result).filter(([key]) => Object.hasOwn(expected, key)))
      : { type: typeof result };
    fail(`authenticated rollback canary did not complete safely: ${JSON.stringify(safeResult)}`);
  }
  return true;
}

function verifyFinalizeCanary(inputPath) {
  // db query --output json returns a top-level row array. Unlike deployment
  // manifests, canary transports may also wrap those rows in result objects.
  // Match the existing authenticated canary reader without weakening readJson.
  let payload;
  try { payload = JSON.parse(fs.readFileSync(inputPath, 'utf8')); }
  catch (error) { fail(`${path.basename(inputPath)} is not valid JSON: ${error.message}`); }
  const matches=[];
  const visit=value=>{
    if(!value||typeof value!=='object')return;
    if(Object.hasOwn(value,'finalize_accounting_canary_result'))matches.push(value.finalize_accounting_canary_result);
    Object.values(value).forEach(visit);
  };
  visit(payload);
  if(matches.length!==1)fail('finalize canary output must contain exactly one result');
  const result=typeof matches[0]==='string'?JSON.parse(matches[0]):matches[0];
  assert.deepStrictEqual(result,{canary:'authenticated_finalize_accounting_lines',ok:true,rolled_back:true,accounting_lines_consistent:true},'authenticated finalize rollback canary did not complete safely');
  return true;
}

function verifyUtilityCanary(inputPath) {
  // Accept the pinned CLI's row arrays and boundary/rows wrappers; retain the
  // object-only manifest reader and require exactly one complete SQL result.
  let payload;
  try { payload=JSON.parse(fs.readFileSync(inputPath,'utf8')); }
  catch(error) { fail(`${path.basename(inputPath)} is not valid JSON: ${error.message}`); }
  const matches=[];
  const visit=value=>{
    if(!value||typeof value!=='object')return;
    if(Object.hasOwn(value,'utility_tax_canary_result'))matches.push(value.utility_tax_canary_result);
    Object.values(value).forEach(visit);
  };
  visit(payload);
  if(matches.length!==1)fail('utility canary output must contain exactly one result');
  const result=typeof matches[0]==='string'?JSON.parse(matches[0]):matches[0];
  assert.deepStrictEqual(result,{canary:'authenticated_utility_tax_v1',ok:true,rolled_back:true,utility_input_tax_absent:true},'authenticated utility rollback canary did not complete safely');
  return true;
}

function verifyReportsCanary(inputPath,domain) {
  const contracts={
    approval_history:{marker:'approval_history_canary_result',result:{canary:'authenticated_approval_history_v1',ok:true,rolled_back:true,history_scope_preserved:true}},
    employee_reliability:{marker:'employee_reliability_canary_result',result:{canary:'authenticated_employee_reliability_v1',ok:true,rolled_back:true,payment_authority_preserved:true}},
    audit_readiness:{marker:'audit_readiness_canary_result',result:{canary:'authenticated_audit_readiness_v1',ok:true,rolled_back:true,audit_scope_preserved:true}},
    receivables:{marker:'canonical_receivables_canary_result',result:{canary:'authenticated_canonical_receivables_v1',ok:true,rolled_back:true,receivables_consistent:true}},
    profiles:{marker:'reporting_profiles_canary_result',result:{canary:'authenticated_reporting_profiles_v1',ok:true,rolled_back:true,profile_authority_preserved:true}},
    ar_reconciliation:{marker:'ar_reconciliation_canary_result',result:{canary:'authenticated_ar_reconciliation_v1',ok:true,rolled_back:true,scope_preserved:true}},
    tax_source_integrity:{marker:'tax_source_integrity_canary_result',result:{canary:'authenticated_tax_source_integrity_v1',ok:true,rolled_back:true,source_binding_preserved:true}},
    amount_search:{marker:'amount_search_canary_result',result:{canary:'authenticated_amount_search_v1',ok:true,rolled_back:true,participant_scope_preserved:true}}
  };
  const contract=contracts[domain];if(!contract)fail('unsupported reports canary domain');
  let payload;
  try{payload=JSON.parse(fs.readFileSync(inputPath,'utf8'));}catch(error){fail(`${path.basename(inputPath)} is not valid JSON: ${error.message}`);}
  const matches=[];
  const visit=value=>{if(!value||typeof value!=='object')return;if(Object.hasOwn(value,contract.marker))matches.push(value[contract.marker]);Object.values(value).forEach(visit);};
  visit(payload);
  if(matches.length!==1)fail('reports canary output must contain exactly one result');
  const result=typeof matches[0]==='string'?JSON.parse(matches[0]):matches[0];
  assert.deepStrictEqual(result,contract.result,'authenticated reports rollback canary did not complete safely');
  return true;
}
function verifyAmountSearchCanary(inputPath){return verifyReportsCanary(inputPath,'amount_search');}

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

function htmlAttribute(tag, name) {
  const match = String(tag).match(new RegExp(`\\b${name}\\s*=\\s*(["'])((?:(?!\\1).)*)\\1`, 'i'));
  return match ? match[2] : null;
}
function verifyFrontendContract(indexPath, manifestPath, candidate) {
  candidate = canonicalSha(candidate);
  const manifest = readJson(manifestPath);
  if (manifest.schema_version !== 2
      || manifest.contract !== 'finance-release-artifact-v2'
      || manifest.build_target !== 'production'
      || manifest.runtime_mode !== 'production-supabase'
      || manifest.source_commit !== candidate) {
    fail('frontend release manifest contract or candidate SHA is invalid');
  }
  const source = fs.readFileSync(indexPath, 'utf8');
  const values = (source.match(/<meta\b[^>]*>/gi) || [])
    .filter((tag) => htmlAttribute(tag, 'name') === 'finance-release-contract')
    .map((tag) => htmlAttribute(tag, 'content'));
  if (values.length !== 1 || values[0] !== FRONTEND_RELEASE_CONTRACT) {
    fail(`frontend must contain exactly one finance-release-contract=${FRONTEND_RELEASE_CONTRACT} meta`);
  }
  if (!/\bsubmissionAttemptId\b/.test(source)) {
    fail('frontend does not contain the required submissionAttemptId contract');
  }
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

function verifyProductionBaseline(productionPath, candidatePath, productionIndexPath, candidateIndexPath, candidate, releasePhase, versionsText) {
  const plan = releasePlan(releasePhase, versionsText);
  if (plan.releasePhase !== RELEASE_PHASE_DATABASE_V3) {
    fail('production frontend baseline is only valid before database_v3 mutation');
  }
  candidate = canonicalSha(candidate);
  const production = readJson(productionPath);
  const candidateManifest = readJson(candidatePath);
  if (production.source_commit !== candidate) fail('database_v3 requires the exact candidate SHA to already be live from frontend_compat');
  assert.deepStrictEqual(production, candidateManifest, 'database_v3 requires the exact deterministic candidate manifest to already be live');
  verifyFrontendContract(candidateIndexPath, candidatePath, candidate);
  verifyFrontendContract(productionIndexPath, productionPath, candidate);
  if (sha256File(productionIndexPath) !== sha256File(candidateIndexPath)) {
    fail('database_v3 requires production index.html bytes to match the exact frontend_compat candidate');
  }
  return true;
}

function verifyPromotion(candidateDeploymentPath, promotedDeploymentPath, productionAliasPath, productionManifestPath, candidateManifestPath) {
  const candidate = readJson(candidateDeploymentPath);
  const promoted = readJson(promotedDeploymentPath);
  const productionAlias = readJson(productionAliasPath);
  if (!deploymentId(candidate) || deploymentId(promoted) !== deploymentId(candidate)) fail('production domain does not resolve to the verified candidate deployment ID');
  if (promoted.projectId !== PRODUCTION_CATALOG.vercelProjectId || promoted.target !== 'production' || promoted.readyState !== 'READY') {
    fail('promoted deployment target/project/state is invalid');
  }
  if (productionAlias.alias !== PRODUCTION_CATALOG.productionDomain
      || productionAlias.projectId !== PRODUCTION_CATALOG.vercelProjectId
      || productionAlias.deploymentId !== deploymentId(candidate)) {
    fail('immutable Finance production alias does not point to the verified candidate deployment');
  }
  assert.deepStrictEqual(readJson(productionManifestPath), readJson(candidateManifestPath), 'production domain manifest differs after promotion');
  return true;
}

function createReceipt(outputPath, deploymentPath, manifestPath, indexPath, candidate, releasePhase, versionsText, deploymentUrl, repository, runId) {
  candidate = canonicalSha(candidate);
  releasePlan(releasePhase, versionsText);
  const deployment = readJson(deploymentPath);
  const parsedUrl = new URL(deploymentUrl);
  if (!deploymentId(deployment) || deploymentHost(deployment) !== parsedUrl.hostname) fail('cannot bind receipt to a different candidate deployment');
  if (!/^\d+$/.test(String(runId || ''))) fail('GitHub run ID must be numeric');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(repository || ''))) fail('GitHub repository is malformed');
  const receipt = {
    schema_version: 2,
    contract: 'finance-verified-candidate-v2',
    candidate_sha: candidate,
    release_phase: releasePhase,
    migration_versions: versionsText,
    deployment_id: deploymentId(deployment),
    deployment_url: `${parsedUrl.origin}/`,
    manifest_sha256: sha256File(manifestPath),
    index_sha256: sha256File(indexPath),
    github_repository: repository,
    github_run_id: String(runId)
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return receipt;
}

function verifyReceipt(receiptPath, deploymentPath, manifestPath, indexPath, candidate, releasePhase, versionsText, deploymentUrl, repository, runId) {
  candidate = canonicalSha(candidate);
  releasePlan(releasePhase, versionsText);
  const receipt = readJson(receiptPath);
  const deployment = readJson(deploymentPath);
  const parsedUrl = new URL(deploymentUrl);
  const expected = {
    schema_version: 2,
    contract: 'finance-verified-candidate-v2',
    candidate_sha: candidate,
    release_phase: releasePhase,
    migration_versions: versionsText,
    deployment_id: deploymentId(deployment),
    deployment_url: `${parsedUrl.origin}/`,
    manifest_sha256: sha256File(manifestPath),
    index_sha256: sha256File(indexPath),
    github_repository: repository,
    github_run_id: String(runId)
  };
  assert.deepStrictEqual(receipt, expected, 'verified candidate receipt differs from this workflow run and immutable artifact');
  if (deploymentHost(deployment) !== parsedUrl.hostname) fail('receipt candidate URL differs from its deployment record');
  return true;
}

function manifestSha(file) { return sha256File(file); }

const api = {
  HISTORY_PERFORMANCE_MIGRATIONS, RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE, HISTORY_PERFORMANCE_POSTFLIGHT_FILES,
  EMPLOYEE_RELIABILITY_MIGRATIONS, RELEASE_PHASE_DATABASE_EMPLOYEE_RELIABILITY, EMPLOYEE_RELIABILITY_POSTFLIGHT_FILES,
  AUDIT_READINESS_MIGRATIONS, RELEASE_PHASE_DATABASE_AUDIT_READINESS, AUDIT_READINESS_POSTFLIGHT_FILES,
  REPORTING_INTEGRITY_MIGRATIONS, RELEASE_PHASE_DATABASE_REPORTING_INTEGRITY, REPORTING_INTEGRITY_POSTFLIGHT_FILES,
  AMOUNT_SEARCH_MIGRATIONS, RELEASE_PHASE_DATABASE_AMOUNT_SEARCH, verifyAmountSearchCanary,
  REPORT_MIGRATIONS, REPORT_POSTFLIGHT_FILES, RELEASE_PHASE_DATABASE_REPORTS, verifyReportsCanary,
  UTILITY_MIGRATIONS, RELEASE_PHASE_DATABASE_UTILITY, verifyUtilityCanary,
  CASE_MIGRATIONS, RELEASE_PHASE_DATABASE_CASES, verifyFinalizeCanary,
  AUDIT_MIGRATIONS, RELEASE_PHASE_DATABASE_AUDIT, prepareAuditBatchRehearsal, prepareAuditBatchApply, readAuditBatch,
  PRODUCTION_CATALOG, PRODUCTION_BASELINE_LEDGER, MIGRATION_V1, MIGRATION_V2, MIGRATION_V3, MIGRATION_CHAIN,
  MIGRATION_PORTAL_LINK_REPAIR, MIGRATION_TOP_LEVEL_CEO_ROUTE, MIGRATION_EXPENSE_DERIVED_STATUS,
  MIGRATION_FINAL_ACCOUNTANT_SELF_POST, MIGRATION_FORMAL_CASHIER_REPAIR,
  MIGRATION_FORMAL_CASHIER_SELF_DISBURSEMENT,
  MIGRATION_HUMAN_ACCOUNTING_AUTHORITY,
  REVIEWED_POST_BASELINE_MIGRATIONS, REVIEWED_MIGRATION_CATALOG,
  RELEASE_PHASE_FRONTEND_COMPAT, RELEASE_PHASE_DATABASE_V3, RELEASE_PHASE_DATABASE_HUMAN_ACCOUNTING,
  RELEASE_PHASES, FRONTEND_RELEASE_CONTRACT,
  SUPPORTED_GATE_PHASES, SUPPORTED_GATE_SUFFIXES,
  migrationVersions, migrationPhase, releasePlan, validateTarget, verifySupabasePublicKey, migrationFiles, classifyLedger, verifyLedger,
  ledgerSha256, readLedgerVersions, assertProductionLedgerBaseline, assertReviewedAdoptedMigrations, assertCliAtomicMigration,
  prepareRehearsal, prepareGateQuery, preparePhaseQuery, prepareReadOnlyQuery, prepareApply, normalizeQueryRows,
  verifyAuthenticatedCanary,
  verifyCandidate, verifyFrontendContract, verifyVercelTarget, verifyProductionBaseline, verifyPromotion,
  createReceipt, verifyReceipt, manifestSha
};
module.exports = api;
if (require.main === module) {
  try {
    const command = process.argv[2];
    if (command === 'validate-target') validateTarget(process.env, arg('candidate-sha'), arg('release-phase'), arg('migration-versions'), arg('project-ref'));
    else if (command === 'classify-ledger') process.stdout.write(`${classifyLedger(arg('ledger'), arg('migration-dir'), arg('release-phase'), arg('migration-versions'))}\n`);
    else if (command === 'verify-ledger') verifyLedger(arg('mode'), arg('ledger'), arg('migration-dir'), arg('release-phase'), arg('migration-versions'));
    else if (command === 'prepare-audit-rehearsal') prepareAuditBatchRehearsal(arg('migration-dir'), arg('output'), arg('migration-versions'), arg('fingerprint'), arg('authenticated-canary'), arg('audit-postflight'));
    else if (command === 'prepare-cases-rehearsal') prepareAuditBatchRehearsal(arg('migration-dir'),arg('output'),arg('migration-versions'),arg('fingerprint'),arg('authenticated-canary'),arg('case-postflight'),RELEASE_PHASE_DATABASE_CASES,arg('case-canary'));
    else if (command === 'prepare-cases-apply') prepareAuditBatchApply(arg('migration-dir'),arg('output'),arg('migration-versions'),arg('ledger'),arg('case-postflight'),PRODUCTION_BASELINE_LEDGER,RELEASE_PHASE_DATABASE_CASES);
    else if (command === 'prepare-reports-rehearsal') prepareAuditBatchRehearsal(arg('migration-dir'),arg('output'),arg('migration-versions'),arg('fingerprint'),arg('authenticated-canary'),arg('receivables-postflight'),RELEASE_PHASE_DATABASE_REPORTS,arg('case-canary'),arg('utility-canary'),[arg('receivables-canary'),arg('profiles-canary')],arg('profiles-postflight'));
    else if (command === 'prepare-reports-apply') prepareAuditBatchApply(arg('migration-dir'),arg('output'),arg('migration-versions'),arg('ledger'),arg('receivables-postflight'),PRODUCTION_BASELINE_LEDGER,RELEASE_PHASE_DATABASE_REPORTS,arg('profiles-postflight'));
    else if (command === 'prepare-history-performance-rehearsal') prepareAuditBatchRehearsal(arg('migration-dir'),arg('output'),arg('migration-versions'),arg('fingerprint'),arg('authenticated-canary'),arg('receivables-postflight'),RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE,arg('case-canary'),arg('utility-canary'),[arg('receivables-canary'),arg('profiles-canary')],arg('profiles-postflight'),arg('amount-search-canary'),[arg('ar-reconciliation-canary'),arg('tax-source-canary')],arg('audit-readiness-canary'),arg('employee-reliability-canary'),arg('approval-history-canary'));
    else if (command === 'prepare-employee-reliability-rehearsal') prepareAuditBatchRehearsal(arg('migration-dir'),arg('output'),arg('migration-versions'),arg('fingerprint'),arg('authenticated-canary'),arg('receivables-postflight'),RELEASE_PHASE_DATABASE_EMPLOYEE_RELIABILITY,arg('case-canary'),arg('utility-canary'),[arg('receivables-canary'),arg('profiles-canary')],arg('profiles-postflight'),arg('amount-search-canary'),[arg('ar-reconciliation-canary'),arg('tax-source-canary')],arg('audit-readiness-canary'),arg('employee-reliability-canary'));
    else if (command === 'prepare-audit-readiness-rehearsal') prepareAuditBatchRehearsal(arg('migration-dir'),arg('output'),arg('migration-versions'),arg('fingerprint'),arg('authenticated-canary'),arg('receivables-postflight'),RELEASE_PHASE_DATABASE_AUDIT_READINESS,arg('case-canary'),arg('utility-canary'),[arg('receivables-canary'),arg('profiles-canary')],arg('profiles-postflight'),arg('amount-search-canary'),[arg('ar-reconciliation-canary'),arg('tax-source-canary')],arg('audit-readiness-canary'));
    else if (command === 'prepare-reporting-integrity-rehearsal') prepareAuditBatchRehearsal(arg('migration-dir'),arg('output'),arg('migration-versions'),arg('fingerprint'),arg('authenticated-canary'),arg('receivables-postflight'),RELEASE_PHASE_DATABASE_REPORTING_INTEGRITY,arg('case-canary'),arg('utility-canary'),[arg('receivables-canary'),arg('profiles-canary')],arg('profiles-postflight'),arg('amount-search-canary'),[arg('ar-reconciliation-canary'),arg('tax-source-canary')]);
    else if (command === 'prepare-history-performance-apply') prepareAuditBatchApply(arg('migration-dir'),arg('output'),arg('migration-versions'),arg('ledger'),arg('receivables-postflight'),PRODUCTION_BASELINE_LEDGER,RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE,arg('profiles-postflight'));
    else if (command === 'prepare-employee-reliability-apply') prepareAuditBatchApply(arg('migration-dir'),arg('output'),arg('migration-versions'),arg('ledger'),arg('receivables-postflight'),PRODUCTION_BASELINE_LEDGER,RELEASE_PHASE_DATABASE_EMPLOYEE_RELIABILITY,arg('profiles-postflight'));
    else if (command === 'prepare-audit-readiness-apply') prepareAuditBatchApply(arg('migration-dir'),arg('output'),arg('migration-versions'),arg('ledger'),arg('receivables-postflight'),PRODUCTION_BASELINE_LEDGER,RELEASE_PHASE_DATABASE_AUDIT_READINESS,arg('profiles-postflight'));
    else if (command === 'prepare-reporting-integrity-apply') prepareAuditBatchApply(arg('migration-dir'),arg('output'),arg('migration-versions'),arg('ledger'),arg('receivables-postflight'),PRODUCTION_BASELINE_LEDGER,RELEASE_PHASE_DATABASE_REPORTING_INTEGRITY,arg('profiles-postflight'));
    else if (command === 'prepare-amount-search-rehearsal') prepareAuditBatchRehearsal(arg('migration-dir'),arg('output'),arg('migration-versions'),arg('fingerprint'),arg('authenticated-canary'),arg('receivables-postflight'),RELEASE_PHASE_DATABASE_AMOUNT_SEARCH,arg('case-canary'),arg('utility-canary'),[arg('receivables-canary'),arg('profiles-canary')],arg('profiles-postflight'),arg('amount-search-canary'));
    else if (command === 'prepare-amount-search-apply') prepareAuditBatchApply(arg('migration-dir'),arg('output'),arg('migration-versions'),arg('ledger'),arg('receivables-postflight'),PRODUCTION_BASELINE_LEDGER,RELEASE_PHASE_DATABASE_AMOUNT_SEARCH,arg('profiles-postflight'));
    else if (command === 'prepare-utility-rehearsal') prepareAuditBatchRehearsal(arg('migration-dir'),arg('output'),arg('migration-versions'),arg('fingerprint'),arg('authenticated-canary'),arg('utility-postflight'),RELEASE_PHASE_DATABASE_UTILITY,arg('case-canary'),arg('utility-canary'));
    else if (command === 'prepare-utility-apply') prepareAuditBatchApply(arg('migration-dir'),arg('output'),arg('migration-versions'),arg('ledger'),arg('utility-postflight'),PRODUCTION_BASELINE_LEDGER,RELEASE_PHASE_DATABASE_UTILITY);
    else if (command === 'prepare-audit-apply') prepareAuditBatchApply(arg('migration-dir'), arg('output'), arg('migration-versions'), arg('ledger'), arg('audit-postflight'));
    else if (command === 'prepare-rehearsal') prepareRehearsal(arg('migration'), arg('output'), arg('migration-version'), arg('fingerprint'), arg('authenticated-canary'));
    else if (command === 'prepare-gate-query') prepareGateQuery(arg('input'), arg('output'), arg('migration-versions'));
    else if (command === 'prepare-phase-query') preparePhaseQuery(arg('input'), arg('output'), arg('release-phase'), arg('migration-versions'));
    else if (command === 'prepare-read-only-query') prepareReadOnlyQuery(arg('input'), arg('output'));
    else if (command === 'prepare-apply') prepareApply(arg('migration'), arg('output'), arg('migration-version'), arg('ledger'));
    else if (command === 'normalize-query-rows') normalizeQueryRows(arg('input'), arg('output'));
    else if (command === 'verify-finalize-canary') verifyFinalizeCanary(arg('input'));
    else if (command === 'verify-reports-canary') verifyReportsCanary(arg('input'),arg('domain'));
    else if (command === 'verify-amount-search-canary') verifyAmountSearchCanary(arg('input'));
    else if (command === 'verify-utility-canary') verifyUtilityCanary(arg('input'));
    else if (command === 'verify-authenticated-canary') verifyAuthenticatedCanary(arg('input'));
    else if (command === 'verify-supabase-public-key') verifySupabasePublicKey(arg('api-keys-json'), process.env.FINANCE_SUPABASE_ANON_KEY);
    else if (command === 'verify-candidate') verifyCandidate(arg('local-manifest'), arg('remote-manifest'), arg('candidate-sha'), arg('deployment-url'));
    else if (command === 'verify-frontend-contract') verifyFrontendContract(arg('index'), arg('manifest'), arg('candidate-sha'));
    else if (command === 'verify-vercel-target') verifyVercelTarget(arg('deployment-json'), arg('project-json'), arg('domains-json'), arg('candidate-sha'), arg('deployment-url'), optionalBooleanArg('allow-production-alias'));
    else if (command === 'verify-production-baseline') verifyProductionBaseline(arg('production-manifest'), arg('candidate-manifest'), arg('production-index'), arg('candidate-index'), arg('candidate-sha'), arg('release-phase'), arg('migration-versions'));
    else if (command === 'verify-promotion') verifyPromotion(arg('candidate-deployment-json'), arg('promoted-deployment-json'), arg('production-alias-json'), arg('production-manifest'), arg('candidate-manifest'));
    else if (command === 'create-receipt') createReceipt(arg('output'), arg('deployment-json'), arg('manifest'), arg('index'), arg('candidate-sha'), arg('release-phase'), arg('migration-versions'), arg('deployment-url'), arg('repository'), arg('run-id'));
    else if (command === 'verify-receipt') verifyReceipt(arg('receipt'), arg('deployment-json'), arg('manifest'), arg('index'), arg('candidate-sha'), arg('release-phase'), arg('migration-versions'), arg('deployment-url'), arg('repository'), arg('run-id'));
    else if (command === 'manifest-sha') process.stdout.write(`${manifestSha(arg('manifest'))}\n`);
    else fail('unknown command');
    if (!['manifest-sha','classify-ledger'].includes(command)) process.stdout.write(`PASS finance production release guard: ${command}\n`);
  } catch (error) { process.stderr.write(`FAIL ${error.message}\n`); process.exit(1); }
}
