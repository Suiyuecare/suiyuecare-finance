#!/usr/bin/env node
'use strict';

/**
 * Finance release source integrity gate.
 *
 * This gate is intentionally local and read-only. It proves that the exact
 * source used by GitHub Actions or Vercel is reproducible from Git, that every
 * migration is versioned, and that legacy schema SQL outside migrations has
 * not silently become a second schema source of truth.
 */

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const failures = [];
let passed = 0;

const LEGACY_SCHEMA_SQL_BASELINE = Object.freeze({
  'supabase/account_change_approval.sql': '9d3dcb377605af0a6ebb1b7a4686e2c3ec82a40699b2dfa2b08928594ecd54f5',
  'supabase/accounting_lines.sql': 'a68dea84ea9e35f63f810edc9b75ce0f8a18cf52eb22fef67b96af75a9a95f9c',
  'supabase/accounting_rpc.sql': '1e5c908ca0c42c49ee493557e1a31f0fcecff62f96e923f244f00d87ff175c72',
  'supabase/advance_two_stage_accounting.sql': '51b72f740345e1ffbb8046f1a904faec73062d3b83c58d417cb8a34bf72b552c',
  'supabase/approval_visibility_fix.sql': 'e8c0ebbc1508a1227d1c05c927cff7faf890586de44aebb33d4bc10757f75ab4',
  'supabase/attachment_download_permissions.sql': '712ed3c08232fca9d3c999e41656e59d71e3bee134654bd73cf784adfbc2072e',
  'supabase/audit_log_export.sql': 'f5b536102de412a15d8b7c2412bdcfff9ec3ea19db39147938113b722d256189',
  'supabase/backup_restore.sql': 'b136f42a8845ed01ce5fb17e0ccb55f84b6866d53bb6f4abc6a904ce96c0a15e',
  'supabase/compliance_and_drafts.sql': '4b64c8ffa9899eb0e10b745207064fa227ff4bf55612a73b65de5060c402bada',
  'supabase/data_environment_separation.sql': 'c737b46966aa8cb9ab5fbfd4527fb970104da741118d23576065119006e57b4d',
  'supabase/department_project_settings_seed.sql': '9200d50d845d4c89f8803450c3b50dc3fcd220c616e3e6e047b6e3440e754ebf',
  'supabase/fix_attachment_upload_authenticated_20260525.sql': '2826c16f2946ca4ddb97efd64f35a502110c78872710b82870a9a4a5ea809dd0',
  'supabase/fix_b1303_taipei_name_20260522.sql': '45c5105c0294e0d175cad538b0e6d20c40143875ee08e2f1943a4fb76fae926c',
  'supabase/fix_b1304_taipei_name_20260522.sql': '9c0cb140f8176ccc39fe389de0ea421df5e2ea661b174677ad392bcdf05f847e',
  'supabase/fix_finance_attachment_upload_policy_20260522.sql': 'b0beb0cf75736f8098c632812ad0551bf88ac93d2c33b4113628bdc595e69931',
  'supabase/fix_users_rls_recursion_20260524.sql': 'd23bce088d7f055fed7d931b0564bb1bd11d16ab0b31d711fa27b9c26a3ee754',
  'supabase/module_finance_production_schema.sql': '1d617ce7a36bd33c6f9cc63a190dc6538f1a652911dc915c9b587ef7ced96c11',
  'supabase/optional_tables_install_20260520.sql': 'e2758d76663355d38183c6cc4fb8daa669006036d0f7b852925edafaf45e6af4',
  'supabase/p0_production_hardening_20260519.sql': '6200dd52f45610b220be66ed371172c60bbe3d8997ea1cc8ffb833958e6c4a1e',
  'supabase/p1_accounting_rpc_invoker_hardening_20260519.sql': '022ad9320aedbecadf13eac892df1c185a76dce08260b193820fea1216bec07f',
  'supabase/p1_rls_helper_invoker_hardening_20260519.sql': '3ba67adf02c49f78fee8b7882385256b1cf1e14ba0791b206965d4eb44d203a1',
  'supabase/payee_bank_accounts_20260522.sql': 'ac293aed04fddcacaf850937ebe704c0b2b66cd591c985d848659eedf2cb91ee',
  'supabase/period_close_locking.sql': 'b2adcd62de6cc960e11da07207e31c47a197cbe23b10101a1a32901b6d78a028',
  'supabase/petty_cash_accounting_standard_20260522.sql': '06d3ca76670c2bf9830110ee9d69a41147e0cc20e15f144ba8e10912a6bcda1c',
  'supabase/petty_cash_non_duplicate_hardening.sql': 'c85d3d63e97d5e381fb512c77a7b849db7dc11a5a16ce5b6366e84556f155e20',
  'supabase/posting_idempotency_hardening.sql': '6d5a5ab38c4c346738e01dd9bb89cbf9e5b3ad5c5fc887baf4581247b7bdc086',
  'supabase/purchase_estimate_actual_hardening.sql': '6f17f04fa0f6aede20471de0d23716f162253d21fcef37bc1a437d04c54c6295',
  'supabase/reactivate_legacy_test_accounts_for_storage_20260522.sql': '49e458b2a5e555151556e3843b67af1b9363443ed83d9fe55183aa43a6f834cc',
  'supabase/rls_formal_apply.sql': '8abc8601432a98dfa333332fa0547746326c0a39f980249cefd12484541290ef',
  'supabase/rls_hardening.sql': '9ad5d6ac76872fa7f0027052adb8a0c69224ab99cff45fc462b05fd2815f5ded',
  'supabase/rls_v3_cleanup.sql': '81725958d94acb2a70e205b3ef0c9dbaaceaedfca4afe29755a38ce712f29cfe',
  'supabase/storage_attachments.sql': '707c3d1494d0f1035f58b4460b0a1134827ec4575e3b4b9bf210e323e0116f04',
  'supabase/system_setting_versions.sql': 'a8500d01bba5e7770af45b540fc4cafe810bce6214b8f63547e9223a471b129c',
  'supabase/system_settings_seed_v3_org.sql': '19defbbba553bc7197c3660f941687dde1a1ecb4f11867ae66796fd4c6d82eec',
  'supabase/trial_balance_checks.sql': '768c2ba33fdaaf1ce4448d0fb1c24e60892b47fcdbba3242fd2ff4d9c6986a99',
  'supabase/voucher_serials_immutability.sql': '35efceb1d69919aafb419a9c0fd2ef7f578b592e63f7b937169d07445adf7cae'
});

const REQUIRED_RELEASE_FILES = Object.freeze([
  '.github/workflows/finance-production-release.yml',
  '.github/workflows/stability-gate.yml',
  '.gitignore',
  '.vercelignore',
  'assets/suiyue-logo-transparent.png',
  'assets/templates/hr_expense_template.xlsx',
  'assets/templates/labor_service_fee.docx',
  'docs/FINANCE_PRODUCTION_RELEASE.md',
  'docs/RELEASE_GATES.md',
  'docs/歲悅會計系統_V4修訂重點.html',
  'docs/歲悅會計系統教育訓練手冊_橘色版.docx',
  'docs/歲悅財務管理系統V4_使用教學.pptx',
  'index.html',
  'package.json',
  'pnpm-lock.yaml',
  'privacy.html',
  'scripts/build_www.js',
  'scripts/finance_build_environment.js',
  'scripts/check_environment_isolation_contract.js',
  'scripts/check_finance_production_release_contract.js',
  'scripts/check_release_source_integrity.js',
  'scripts/check_migration_lineage_contract.js',
  'scripts/check_root_cause_regressions.js',
  'scripts/check_release_artifact.js',
  'scripts/check_submission_identity_directory_contract.js',
  'scripts/check_notification_staff_access_reconciliation_contract.js',
  'scripts/check_finance_login_account_switch_contract.js',
  'scripts/check_receipt_attachment_dedup_and_labor_tax.js',
  'scripts/check_membership_org_expense_submission_contract.js',
  'scripts/check_submission_applicant_identity_contract.js',
  'scripts/check_submission_persona_routes.js',
  'scripts/test_expense_route_authority_v2.js',
  'scripts/check_incident_account_org_repair.js',
  'scripts/finance_production_db_fingerprint.sql',
  'scripts/finance_production_db_postflight.sql',
  'scripts/finance_production_db_preflight.sql',
  'scripts/finance_production_authenticated_canary.sql',
  'scripts/finance_production_release_guard.js',
  'supabase/config.toml',
  'vercel.json'
]);

const EXPECTED_RELEASE_SCRIPTS = Object.freeze({
  'release:source-integrity': 'node scripts/check_release_source_integrity.js',
  'release:environment-isolation': 'node scripts/check_environment_isolation_contract.js',
  'release:migration-lineage': 'node scripts/check_migration_lineage_contract.js',
  'release:production-contract': 'node scripts/check_finance_production_release_contract.js',
  'release:root-cause-regressions': 'node scripts/check_root_cause_regressions.js && node scripts/check_submission_identity_directory_contract.js && node scripts/check_notification_staff_access_reconciliation_contract.js && node scripts/check_membership_org_expense_submission_contract.js && node scripts/check_submission_applicant_identity_contract.js && node scripts/check_submission_persona_routes.js && node scripts/test_expense_route_authority_v2.js && node scripts/check_incident_account_org_repair.js',
  'release:preflight': 'pnpm release:source-integrity && pnpm release:environment-isolation && pnpm release:migration-lineage && pnpm release:production-contract && pnpm release:root-cause-regressions',
  'release:verify-artifact': 'node scripts/check_release_artifact.js --verify-manifest && node scripts/check_finance_login_account_switch_contract.js && node scripts/check_receipt_attachment_dedup_and_labor_tax.js',
  'release:build': 'pnpm release:preflight && node scripts/build_www.js && node scripts/check_release_artifact.js --write-manifest && pnpm release:verify-artifact'
});

const VERCEL_BUILD_REQUIRED_SCRIPTS = Object.freeze([
  'scripts/build_www.js',
  'scripts/finance_build_environment.js',
  'scripts/check_environment_isolation_contract.js',
  'scripts/check_finance_production_release_contract.js',
  'scripts/check_release_source_integrity.js',
  'scripts/check_migration_lineage_contract.js',
  'scripts/check_root_cause_regressions.js',
  'scripts/check_submission_identity_directory_contract.js',
  'scripts/check_notification_staff_access_reconciliation_contract.js',
  'scripts/check_membership_org_expense_submission_contract.js',
  'scripts/check_submission_applicant_identity_contract.js',
  'scripts/check_submission_persona_routes.js',
  'scripts/test_expense_route_authority_v2.js',
  'scripts/check_incident_account_org_repair.js',
  'scripts/check_release_artifact.js',
  'scripts/check_finance_login_account_switch_contract.js',
  'scripts/check_receipt_attachment_dedup_and_labor_tax.js',
  'scripts/finance_production_db_fingerprint.sql',
  'scripts/finance_production_db_postflight.sql',
  'scripts/finance_production_db_preflight.sql',
  'scripts/finance_production_authenticated_canary.sql',
  'scripts/finance_production_release_guard.js'
]);

function normalize(value) {
  return String(value || '').split(path.sep).join('/').replace(/^\.\//, '');
}

function sha256File(relativePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, relativePath))).digest('hex');
}

function git(args) {
  return childProcess.execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 10000,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function nulList(output) {
  return output.split('\0').filter(Boolean).map(normalize);
}

function listFiles(directory) {
  const absolute = path.join(ROOT, directory);
  if (!fs.existsSync(absolute)) return [];
  const output = [];
  const stack = [absolute];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        output.push(normalize(path.relative(ROOT, full)));
      } else if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        output.push(normalize(path.relative(ROOT, full)));
      }
    }
  }
  return output.sort();
}

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    process.stdout.write(`PASS ${label}\n`);
  } else {
    failures.push(`${label}${detail ? `: ${detail}` : ''}`);
    process.stderr.write(`FAIL ${label}${detail ? `: ${detail}` : ''}\n`);
  }
}

function releaseRelevant(relativePath) {
  const value = normalize(relativePath);
  return REQUIRED_RELEASE_FILES.includes(value)
    || value.startsWith('assets/engines/')
    || value.startsWith('assets/styles/')
    || value.startsWith('assets/templates/')
    || value.startsWith('supabase/migrations/');
}

let tracked = new Set();
let gitAvailable = false;
const isVercelBuild = Boolean(process.env.VERCEL_ENV);
try {
  tracked = new Set(nulList(git(['ls-files', '-z'])));
  gitAvailable = true;
  check('repository is readable by Git', tracked.size > 0, `${tracked.size} tracked files`);
} catch (error) {
  if (isVercelBuild) {
    check('Vercel source is bound to an exact Git commit without local Git metadata',
      /^[0-9a-f]{40}$/.test(String(process.env.VERCEL_GIT_COMMIT_SHA || '')));
  } else {
    check('repository is readable by Git', false, error.message);
  }
}

for (const relativePath of REQUIRED_RELEASE_FILES) {
  const absolute = path.join(ROOT, relativePath);
  const exists = fs.existsSync(absolute);
  check(`required release file exists: ${relativePath}`, exists && fs.statSync(absolute).isFile());
  if (gitAvailable) check(`required release file is tracked: ${relativePath}`, tracked.has(relativePath));
  if (exists) check(`required release file is non-empty: ${relativePath}`, fs.statSync(absolute).size > 0);
}

let untracked = [];
let modified = [];
if (gitAvailable) try {
  const releaseFilesOnDisk = [...new Set(
    REQUIRED_RELEASE_FILES.filter((item) => fs.existsSync(path.join(ROOT, item)))
      .concat(listFiles('assets/engines'))
      .concat(listFiles('assets/styles'))
      .concat(listFiles('assets/templates'))
      .concat(listFiles('supabase/migrations'))
  )].sort();
  // Compare the filesystem to Git instead of relying on --exclude-standard so
  // an accidentally ignored runtime asset or migration cannot enter a build.
  untracked = releaseFilesOnDisk.filter((item) => !tracked.has(item));
  modified = [...new Set(
    nulList(git(['diff', '--name-only', '-z', '--']))
      .concat(nulList(git(['diff', '--cached', '--name-only', '-z', '--'])))
      .filter(releaseRelevant)
  )].sort();
} catch (error) {
  failures.push(`cannot inspect worktree: ${error.message}`);
}
if (gitAvailable) {
  check('no untracked release source, migration, or test exists', untracked.length === 0, untracked.slice(0, 30).join(', '));
  check('release worktree is clean before build', modified.length === 0, modified.slice(0, 30).join(', '));
}

const migrations = listFiles('supabase/migrations').filter((item) => item.endsWith('.sql'));
check('at least one migration exists', migrations.length > 0);
const migrationVersions = new Set();
for (const migration of migrations) {
  const name = path.basename(migration);
  const match = /^(\d{14})_[a-z0-9_]+\.sql$/.exec(name);
  check(`migration filename is canonical: ${name}`, Boolean(match));
  if (match) {
    check(`migration version is unique: ${match[1]}`, !migrationVersions.has(match[1]));
    migrationVersions.add(match[1]);
  }
  if (gitAvailable) check(`migration is tracked: ${name}`, tracked.has(migration));
  check(`migration is non-empty: ${name}`, fs.statSync(path.join(ROOT, migration)).size > 0);
}

const schemaSqlOutsideMigrations = listFiles('supabase')
  .filter((item) => item.endsWith('.sql') && !item.startsWith('supabase/migrations/'));
const baselinePaths = Object.keys(LEGACY_SCHEMA_SQL_BASELINE).sort();
check(
  'schema SQL outside migrations matches the explicit legacy allowlist',
  JSON.stringify(schemaSqlOutsideMigrations) === JSON.stringify(baselinePaths),
  schemaSqlOutsideMigrations.filter((item) => !LEGACY_SCHEMA_SQL_BASELINE[item]).join(', ')
);
for (const relativePath of baselinePaths) {
  const exists = fs.existsSync(path.join(ROOT, relativePath));
  check(`legacy schema baseline exists: ${relativePath}`, exists);
  if (!exists) continue;
  if (gitAvailable) check(`legacy schema baseline remains tracked: ${relativePath}`, tracked.has(relativePath));
  check(
    `legacy schema baseline is frozen: ${relativePath}`,
    sha256File(relativePath) === LEGACY_SCHEMA_SQL_BASELINE[relativePath],
    'schema changes must be added as a new supabase/migrations file'
  );
}

let pkg = null;
try {
  pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  check('package.json parses', true);
} catch (error) {
  check('package.json parses', false, error.message);
}
if (pkg) {
  check('release runtime is pinned to Node 22', pkg.engines && pkg.engines.node === '>=22 <23');
  for (const [name, command] of Object.entries(EXPECTED_RELEASE_SCRIPTS)) {
    check(`package release script is exact: ${name}`, pkg.scripts && pkg.scripts[name] === command);
  }
}

let vercel = null;
try {
  vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  check('vercel.json parses', true);
} catch (error) {
  check('vercel.json parses', false, error.message);
}
if (vercel) {
  check('Vercel uses the verified release build', vercel.buildCommand === 'pnpm release:build');
  check('Vercel output is the verified artifact directory', vercel.outputDirectory === 'www');
  check('Vercel cannot auto-publish main before database verification',
    vercel.git && vercel.git.deploymentEnabled && vercel.git.deploymentEnabled.main === false);
}

const vercelIgnore = fs.existsSync(path.join(ROOT, '.vercelignore'))
  ? fs.readFileSync(path.join(ROOT, '.vercelignore'), 'utf8')
  : '';
const vercelIgnoreLines = new Set(
  vercelIgnore.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
);
const activeVercelIgnoreLines = [...vercelIgnoreLines]
  .filter((line) => !line.startsWith('#') && !line.startsWith('!'));
check('Vercel source includes Supabase config and migration contracts',
  !activeVercelIgnoreLines.some((line) => /^\/?supabase\/?(?:$|\*|\*\*)/.test(line)));
check('Vercel source includes build assets',
  !activeVercelIgnoreLines.some((line) => /^\/?assets\/?(?:$|\*|\*\*)/.test(line)));
check('Vercel does not exclude the complete scripts directory',
  !activeVercelIgnoreLines.some((line) => /^\/?scripts\/?$/.test(line)));
for (const requiredScript of VERCEL_BUILD_REQUIRED_SCRIPTS) {
  check(`Vercel source includes release script: ${requiredScript}`,
    !vercelIgnoreLines.has('scripts/*') || vercelIgnoreLines.has(`!${requiredScript}`));
}
check('Vercel source includes the release gate contract',
  !vercelIgnoreLines.has('docs/*') || vercelIgnoreLines.has('!docs/RELEASE_GATES.md'));

const workflow = fs.existsSync(path.join(ROOT, '.github/workflows/stability-gate.yml'))
  ? fs.readFileSync(path.join(ROOT, '.github/workflows/stability-gate.yml'), 'utf8')
  : '';
check('CI runs source and root-cause gates before build',
  workflow.indexOf('pnpm release:preflight') > -1
    && workflow.indexOf('pnpm release:preflight') < workflow.indexOf('pnpm release:build'));
check('CI explicitly runs the environment isolation contract before preflight and build',
  workflow.indexOf('pnpm release:environment-isolation') > -1
    && workflow.indexOf('pnpm release:environment-isolation') < workflow.indexOf('pnpm release:preflight')
    && workflow.indexOf('pnpm release:preflight') < workflow.indexOf('pnpm release:build'));
check('CI candidate is an explicit offline preview build',
  /FINANCE_BUILD_TARGET:\s*preview/.test(workflow));
check('CI does not claim an unsupported clean-slate database replay',
  !/(?:supabase\s+(?:start|stop)|supabase\s+db\s+reset)/i.test(workflow));
check('CI verifies and uploads the exact generated artifact',
  workflow.includes('pnpm release:verify-artifact')
    && workflow.includes('actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02'));
check('release workflow contains no deployment command or production secret',
  !/(?:vercel\s+(?:deploy|promote|--prod)|supabase\s+(?:link|db\s+push)|VERCEL_TOKEN|SUPABASE_SERVICE_ROLE|SUPABASE_DB_PASSWORD|secrets\.)/i.test(workflow));

if (isVercelBuild) {
  let head = '';
  if (gitAvailable) {
    try { head = git(['rev-parse', 'HEAD']).trim(); } catch (_) { /* handled below */ }
  }
  const buildSha = String(process.env.VERCEL_GIT_COMMIT_SHA || '').trim();
  check('Vercel build exposes an exact commit SHA', /^[0-9a-f]{40}$/.test(buildSha));
  if (gitAvailable) {
    check('Vercel build commit matches the checked-out source', Boolean(head) && buildSha === head, `${buildSha || '(missing)'} != ${head || '(missing)'}`);
  }
}

process.stdout.write(`\nRelease source integrity: ${passed} checks passed, ${failures.length} failed.\n`);
if (failures.length) {
  process.stderr.write('Release is blocked. Resolve every failure; this gate has no bypass.\n');
  process.exit(1);
}
