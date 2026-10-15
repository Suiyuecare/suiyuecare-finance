#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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
assert.deepEqual(guard.SUPPORTED_GATE_PHASES, [
  [], ['20260826070814'], ['20260826155840'], ['20260827052447'], ['20260902054834'], guard.AUDIT_MIGRATIONS, guard.CASE_MIGRATIONS, guard.UTILITY_MIGRATIONS, guard.REPORT_MIGRATIONS, guard.AMOUNT_SEARCH_MIGRATIONS, guard.REPORTING_INTEGRITY_MIGRATIONS, guard.AUDIT_READINESS_MIGRATIONS, guard.EMPLOYEE_RELIABILITY_MIGRATIONS, guard.HISTORY_PERFORMANCE_MIGRATIONS, guard.READ_LATENCY_MIGRATIONS, guard.AR_MAPPING_MIGRATIONS, guard.AUDIT_REMEDIATION_MIGRATIONS, guard.APPROVAL_SEARCH_BATCH, guard.HISTORY_SUMMARY_MIGRATIONS, guard.INVOICE_READ_SCOPE_MIGRATIONS, guard.AR_READ_SCOPE_MIGRATIONS, guard.HR_BRIDGE_MIGRATIONS, guard.AUDIT_SECURITY_MIGRATIONS, guard.REVENUE_REPAIR_MIGRATIONS, guard.OPERATIONAL_STABILITY_MIGRATIONS, guard.DEMO_PASSWORD_RETIREMENT_MIGRATIONS, guard.AUDIT_CONTROLS_20260927_MIGRATIONS, guard.HR_CONTRACTOR_MIGRATIONS, guard.PORTAL_SESSION_MIGRATIONS, guard.EXTERNAL_LABOR_MIGRATIONS, guard.ATTACHMENT_CLAIM_MIGRATIONS, guard.HUMAN_FLOAT_MIGRATIONS, guard.INCOME_RECONCILE_MIGRATIONS, guard.INVOICE_REVENUE_RESULT_MIGRATIONS, guard.PURCHASE_FINAL_AMOUNT_MIGRATIONS, guard.INVOICE_ITEM_BIND_MIGRATIONS, guard.PERSONAL_HISTORY_MIGRATIONS, guard.PERSONAL_HISTORY_PERMISSION_MIGRATIONS, guard.BILL_BATCH_BULK_MIGRATIONS, guard.INVOICE_BATCH_APPROVAL_MIGRATIONS, guard.PERSONAL_HISTORY_IDENTITY_ONCE_MIGRATIONS, guard.PERSONAL_BILL_BATCH_HISTORY_MIGRATIONS, guard.BOUNDED_LOGOUT_MIGRATIONS,guard.INVOICE_BATCH_BULK_MIGRATIONS, guard.BILL_APPROVAL_BULK_MIGRATIONS
]);
assert.deepEqual(guard.HR_BRIDGE_MIGRATIONS,['20260922072109','20260922072737','20260922075604']);
assert.deepEqual(guard.AR_READ_SCOPE_MIGRATIONS,['20260922072737']);
assert.deepEqual(guard.AUDIT_SECURITY_MIGRATIONS,['20260922133752']);
assert.deepEqual(guard.HR_DIRECTORY_EXPORT_MIGRATIONS,['20260924043205']);
assert.deepEqual(guard.HR_DIRECTORY_EXPORT_POSTFLIGHT_FILES,['finance_hr_directory_export_postflight.sql']);
assert.deepEqual(guard.MIGRATION_CHAIN, ['20260826070814', '20260826155840', '20260827052447']);
assert.equal(guard.MIGRATION_PORTAL_LINK_REPAIR, '20260828015718');
assert.equal(guard.MIGRATION_TOP_LEVEL_CEO_ROUTE, '20260831042040');
assert.equal(guard.MIGRATION_EXPENSE_DERIVED_STATUS, '20260831043517');
assert.equal(guard.MIGRATION_FINAL_ACCOUNTANT_SELF_POST, '20260901024020');
assert.equal(guard.MIGRATION_FORMAL_CASHIER_REPAIR, '20260901073241');
assert.equal(guard.MIGRATION_FORMAL_CASHIER_SELF_DISBURSEMENT, '20260901081807');
assert.equal(guard.MIGRATION_HUMAN_ACCOUNTING_AUTHORITY, '20260902054834');
assert.deepEqual(guard.REVIEWED_POST_BASELINE_MIGRATIONS, ['20260828015718', '20260831042040', '20260831043517', '20260901024020', '20260901073241', '20260901081807']);
assert.deepEqual(guard.REVIEWED_MIGRATION_CATALOG, [
  '20260826070814', '20260826155840', '20260827052447', '20260828015718',
  '20260831042040', '20260831043517', '20260901024020', '20260901073241',
  '20260901081807', '20260902054834', ...guard.AUDIT_MIGRATIONS, ...guard.CASE_MIGRATIONS, ...guard.UTILITY_MIGRATIONS, ...guard.REPORT_MIGRATIONS, ...guard.AMOUNT_SEARCH_MIGRATIONS, ...guard.REPORTING_INTEGRITY_MIGRATIONS, ...guard.AUDIT_READINESS_MIGRATIONS, ...guard.EMPLOYEE_RELIABILITY_MIGRATIONS, ...guard.HISTORY_PERFORMANCE_MIGRATIONS, ...guard.READ_LATENCY_MIGRATIONS, ...guard.AR_MAPPING_MIGRATIONS, ...guard.AUDIT_REMEDIATION_MIGRATIONS, ...guard.APPROVAL_SEARCH_MIGRATIONS, ...guard.HISTORY_SUMMARY_MIGRATIONS, ...guard.INVOICE_READ_SCOPE_MIGRATIONS, ...guard.HR_BRIDGE_MIGRATIONS, ...guard.AUDIT_SECURITY_MIGRATIONS, ...guard.HR_DIRECTORY_EXPORT_MIGRATIONS, ...guard.REVENUE_REPAIR_MIGRATIONS, ...guard.OPERATIONAL_STABILITY_MIGRATIONS, ...guard.DEMO_PASSWORD_RETIREMENT_MIGRATIONS, ...guard.AUDIT_CONTROLS_20260927_MIGRATIONS, ...guard.HR_CONTRACTOR_MIGRATIONS, ...guard.PORTAL_SESSION_MIGRATIONS, ...guard.EXTERNAL_LABOR_MIGRATIONS, ...guard.ATTACHMENT_CLAIM_MIGRATIONS, ...guard.ATTACHMENT_STAGED_CLEANUP_MIGRATIONS, ...guard.HUMAN_FLOAT_MIGRATIONS, ...guard.INCOME_RECONCILE_MIGRATIONS, ...guard.INVOICE_REVENUE_RESULT_MIGRATIONS, ...guard.PERSONNEL_CONFLICT_MIGRATIONS, ...guard.PERSONNEL_RECEIPT_MIGRATIONS, ...guard.PROCUREMENT_ACTION_MIGRATIONS, ...guard.APPLICANT_WITHDRAW_MIGRATIONS, ...guard.PURCHASE_FINAL_AMOUNT_MIGRATIONS, ...guard.INVOICE_ITEM_BIND_MIGRATIONS, ...guard.PERSONAL_HISTORY_MIGRATIONS, ...guard.PERSONAL_HISTORY_PERMISSION_MIGRATIONS, ...guard.BILL_BATCH_BULK_MIGRATIONS, ...guard.INVOICE_BATCH_APPROVAL_MIGRATIONS, ...guard.PERSONAL_HISTORY_IDENTITY_ONCE_MIGRATIONS, ...guard.PERSONAL_BILL_BATCH_HISTORY_MIGRATIONS, ...guard.BOUNDED_LOGOUT_MIGRATIONS, ...guard.INVOICE_BATCH_BULK_MIGRATIONS, ...guard.BILL_APPROVAL_BULK_MIGRATIONS
]);
assert.deepEqual(guard.APPLICANT_WITHDRAW_SOURCE_SHA256,{
  '20261005173534':'aa3ebaf3a098c83709de7e04c4a048c9cfb0881e42a4f8bb586caebe66e14b9f'
});
assert.deepEqual(guard.PURCHASE_FINAL_AMOUNT_SOURCE_SHA256,{
  '20261006153719':'8759835fe6f02605306b188af3be770de764e4f0efc82953df5be22c821fb72a'
});
assert.deepEqual(guard.INVOICE_ITEM_BIND_SOURCE_SHA256,{
  '20261008031845':'f0649d6350adc5ab1e34fe63662753c70f09dcbf9669cef49a88f0ca002f6ba6'
});
assert.deepEqual(guard.PERSONAL_HISTORY_SOURCE_SHA256,{
  '20261008055528':'f9b3eb3890767a4283c953c6069505bd5a8f979088c3887251b2424c83469886'
});
assert.deepEqual(guard.PERSONAL_HISTORY_PERMISSION_SOURCE_SHA256,{
  '20261008090000':'27cd24e182ad839ffcf10b5b304d98f5e51086b7009cdad2d8ad65ab6977b350'
});
assert.deepEqual(guard.BILL_BATCH_BULK_SOURCE_SHA256,{
  '20261008100000':'e32c37f775e7f08d42b36205802dc5ffbece17d5274f41567db265b45fb25a7a'
});
assert.deepEqual(guard.INVOICE_BATCH_APPROVAL_MIGRATIONS,['20261010120000','20261010130000']);
assert.deepEqual(guard.PERSONAL_BILL_BATCH_HISTORY_MIGRATIONS,['20261013091000']);
assert.deepEqual(guard.BOUNDED_LOGOUT_MIGRATIONS,['20261014123017']);
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261014123017_finance_bounded_global_logout.sql'))).digest('hex'),guard.BOUNDED_LOGOUT_SOURCE_SHA256['20261014123017']);
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261013091000_finance_personal_bill_batch_history_v1.sql'))).digest('hex'),guard.PERSONAL_BILL_BATCH_HISTORY_SOURCE_SHA256['20261013091000']);
for (const version of guard.INVOICE_BATCH_APPROVAL_MIGRATIONS) {
  const pinned = guard.INVOICE_BATCH_APPROVAL_SOURCE_SHA256[version];
  assert.match(pinned,/^[0-9a-f]{64}$/,'every invoice batch migration must have a final sealed SHA256');
  const filename=fs.readdirSync(path.join(__dirname,'../supabase/migrations'))
    .find(name=>name.startsWith(version+'_'));
  assert.ok(filename,`reviewed invoice batch migration ${version} is missing`);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../supabase/migrations',filename))).digest('hex'),pinned,
    `invoice batch migration ${version} differs from its reviewed SHA256`);
}
assert.deepEqual(guard.RELEASE_PHASES, {
  frontend_compat: 'none',
  database_v3: '20260827052447',
  database_human_accounting: '20260902054834',
  database_audit_20260907: guard.AUDIT_MIGRATIONS.join(','),
  database_cases_20260908: guard.CASE_MIGRATIONS.join(','),
  database_utility_tax_20260909: '20260909083825',
  database_reports_20260910: '20260910064324,20260910064325',
  database_amount_search_20260910: '20260910083000',
  database_reporting_integrity_20260911: '20260911135457,20260911135514',
  database_audit_readiness_20260911: '20260911151054',
  database_employee_reliability_20260912: '20260912145849',
  database_history_performance_20260913: '20260912164807',
  database_read_latency_20260913: '20260913042629',
  database_ar_mapping_20260913: '20260913061745',
  database_audit_remediation_20260914: '20260914001246,20260914001252',
  database_approval_search_20260914: '20260914001246,20260914001252,20260914091205',
  database_history_summary_20260915: '20260915050313',
  database_invoice_read_scope_20260915: '20260915080928',
  database_ar_read_scope_20260922: '20260922072737',
  database_hr_bridge_20260922: '20260922072109,20260922072737,20260922075604',
  database_audit_security_20260922: '20260922133752',
  database_revenue_repair_20260924: '20260924074010',
  database_operational_stability_20260924: '20260924155142',
  database_demo_password_retirement_20260925: '20260925170000',
  database_audit_controls_20260927: '20260927152432,20260927153326',
  database_hr_contractor_20260928: '20260927175827,20260927180005',
  database_portal_session_20260928:'20260927180201',
  database_external_labor_20260928:'20260928090000',
  database_attachment_claim_20261001:'20261001030323',
  database_human_float_20261002:'20261002035707',
  database_income_reconcile_20261002:'20261002130327',
  database_invoice_revenue_result_20261002:'20261002151725',
  database_purchase_final_amount_20261006:'20261006153719',
  database_invoice_item_bind_20261008:'20261008031845',
  database_personal_history_20261008:'20261008055528',
  database_personal_history_permission_20261008:'20261008090000',
  database_bill_batch_bulk_20261008:'20261008100000',
  database_invoice_batch_approval_20261010:'20261010120000,20261010130000',
  database_personal_history_identity_once_20261012:'20261012112652',
  database_personal_bill_batch_history_20261013:'20261013091000',
  database_invoice_batch_bulk_20261014:'20261014123427',
  database_bounded_global_logout_20261014:'20261014123017',
  database_bill_approval_bulk_20261015:'20261015060930'
});
assert.deepEqual(guard.migrationVersions('none'), []);
assert.throws(() => guard.migrationVersions('20260826070814,20260826070814'), /unique/);
assert.throws(() => guard.migrationVersions('20260826070814, 20260826155840'));
assert.throws(() => guard.migrationPhase('20260826070814,20260826155840'), /separate phases/);
assert.throws(() => guard.migrationPhase('20260826155840,20260827052447'), /separate phases/);
assert.deepEqual(guard.releasePlan('frontend_compat', 'none'), {
  releasePhase: 'frontend_compat', migrationVersions: 'none'
});
assert.deepEqual(guard.releasePlan('database_v3', '20260827052447'), {
  releasePhase: 'database_v3', migrationVersions: '20260827052447'
});
assert.deepEqual(guard.releasePlan('database_human_accounting', '20260902054834'), {
  releasePhase: 'database_human_accounting', migrationVersions: '20260902054834'
});
assert.throws(() => guard.releasePlan('frontend_compat', '20260827052447'), /must use migration_versions=none/);
assert.throws(() => guard.releasePlan('database_v3', 'none'), /must use migration_versions=20260827052447/);
assert.throws(() => guard.releasePlan(guard.RELEASE_PHASE_DATABASE_UTILITY, 'none'), /must use migration_versions=20260909083825/);
assert.throws(() => guard.releasePlan(guard.RELEASE_PHASE_DATABASE_UTILITY, guard.CASE_MIGRATIONS.join(',')), /must use migration_versions=20260909083825/);
assert.throws(() => guard.releasePlan('standard', 'none'), /release_phase/);


assert.deepEqual(guard.releasePlan('database_ar_mapping_20260913','20260913061745'),{releasePhase:'database_ar_mapping_20260913',migrationVersions:'20260913061745'});
for(const versions of ['none','20260913042629','20260913061745,20260913061746'])assert.throws(()=>guard.releasePlan('database_ar_mapping_20260913',versions),/must use migration_versions=20260913061745|no exact catalog contract/);

const catalog = guard.PRODUCTION_CATALOG;
const exactEnvironment = {
  SUPABASE_ACCESS_TOKEN: 'sbp_test-only',
  FINANCE_SUPABASE_URL: `https://${catalog.supabaseProjectRef}.supabase.co/`,
  FINANCE_SUPABASE_ANON_KEY: 'sb_publishable_test-only',
  VERCEL_TOKEN: 'test-only',
  VERCEL_ORG_ID: catalog.vercelOrgId,
  VERCEL_PROJECT_ID: catalog.vercelProjectId
};
guard.validateTarget(exactEnvironment, 'a'.repeat(40), 'frontend_compat', 'none', catalog.supabaseProjectRef);
guard.validateTarget(exactEnvironment, 'a'.repeat(40), guard.RELEASE_PHASE_DATABASE_INCOME_RECONCILE,
  guard.INCOME_RECONCILE_MIGRATIONS.join(','), catalog.supabaseProjectRef);
assert.throws(()=>guard.validateTarget(exactEnvironment,'a'.repeat(40),guard.RELEASE_PHASE_DATABASE_INCOME_RECONCILE,
  'none',catalog.supabaseProjectRef),/must use migration_versions=20261002130327/);
guard.validateTarget(exactEnvironment, 'a'.repeat(40), guard.RELEASE_PHASE_DATABASE_INVOICE_REVENUE_RESULT,
  guard.INVOICE_REVENUE_RESULT_MIGRATIONS.join(','), catalog.supabaseProjectRef);
assert.throws(()=>guard.validateTarget(exactEnvironment,'a'.repeat(40),guard.RELEASE_PHASE_DATABASE_INVOICE_REVENUE_RESULT,
  'none',catalog.supabaseProjectRef),/must use migration_versions=20261002151725/);
guard.validateTarget(exactEnvironment, 'a'.repeat(40), guard.RELEASE_PHASE_DATABASE_PURCHASE_FINAL_AMOUNT,
  guard.PURCHASE_FINAL_AMOUNT_MIGRATIONS.join(','), catalog.supabaseProjectRef);
assert.throws(()=>guard.validateTarget(exactEnvironment,'a'.repeat(40),guard.RELEASE_PHASE_DATABASE_PURCHASE_FINAL_AMOUNT,
  'none',catalog.supabaseProjectRef),/must use migration_versions=20261006153719/);
guard.validateTarget(exactEnvironment, 'a'.repeat(40), guard.RELEASE_PHASE_DATABASE_PERSONAL_HISTORY,
  guard.PERSONAL_HISTORY_MIGRATIONS.join(','), catalog.supabaseProjectRef);
guard.validateTarget(exactEnvironment, 'a'.repeat(40), guard.RELEASE_PHASE_DATABASE_INVOICE_BATCH_APPROVAL,
  guard.INVOICE_BATCH_APPROVAL_MIGRATIONS.join(','), catalog.supabaseProjectRef);
assert.throws(()=>guard.validateTarget(exactEnvironment,'a'.repeat(40),guard.RELEASE_PHASE_DATABASE_INVOICE_BATCH_APPROVAL,
  guard.INVOICE_BATCH_APPROVAL_MIGRATIONS[0],catalog.supabaseProjectRef),/no exact catalog contract|must use migration_versions=20261010120000,20261010130000/);
assert.throws(()=>guard.validateTarget(exactEnvironment,'a'.repeat(40),guard.RELEASE_PHASE_DATABASE_PERSONAL_HISTORY,
  'none',catalog.supabaseProjectRef),/must use migration_versions=20261008055528/);
assert.throws(() => guard.validateTarget(exactEnvironment, 'a'.repeat(40), 'database_v3', '20260827052447', catalog.supabaseProjectRef), /legacy database phases are archived/);
assert.throws(() => guard.validateTarget(exactEnvironment, 'a'.repeat(40), 'database_human_accounting', '20260902054834', catalog.supabaseProjectRef), /legacy database phases are archived/);
assert.throws(()=>guard.validateTarget(exactEnvironment, 'a'.repeat(40), guard.RELEASE_PHASE_DATABASE_AUDIT, guard.AUDIT_MIGRATIONS.join(','), catalog.supabaseProjectRef),/legacy database phases are archived/);
assert.throws(()=>guard.validateTarget(exactEnvironment, 'a'.repeat(40), guard.RELEASE_PHASE_DATABASE_CASES, guard.CASE_MIGRATIONS.join(','), catalog.supabaseProjectRef),/legacy database phases are archived/);
assert.throws(()=>guard.validateTarget(exactEnvironment, 'a'.repeat(40), guard.RELEASE_PHASE_DATABASE_UTILITY, guard.UTILITY_MIGRATIONS.join(','), catalog.supabaseProjectRef),/legacy database phases are archived/);
assert.throws(()=>guard.validateTarget(exactEnvironment,'a'.repeat(40),guard.RELEASE_PHASE_DATABASE_REPORTS,guard.REPORT_MIGRATIONS.join(','),catalog.supabaseProjectRef),/legacy database phases are archived/);
assert.throws(()=>guard.validateTarget(exactEnvironment,'a'.repeat(40),guard.RELEASE_PHASE_DATABASE_AMOUNT_SEARCH,guard.AMOUNT_SEARCH_MIGRATIONS.join(','),catalog.supabaseProjectRef),/legacy database phases are archived/);
assert.throws(()=>guard.validateTarget(exactEnvironment,'a'.repeat(40),guard.RELEASE_PHASE_DATABASE_REPORTING_INTEGRITY,guard.REPORTING_INTEGRITY_MIGRATIONS.join(','),catalog.supabaseProjectRef),/legacy database phases are archived/);
assert.throws(()=>guard.validateTarget(exactEnvironment,'a'.repeat(40),guard.RELEASE_PHASE_DATABASE_AUDIT_READINESS,guard.AUDIT_READINESS_MIGRATIONS.join(','),catalog.supabaseProjectRef),/legacy database phases are archived/);
assert.throws(()=>guard.validateTarget(exactEnvironment,'a'.repeat(40),guard.RELEASE_PHASE_DATABASE_EMPLOYEE_RELIABILITY,guard.EMPLOYEE_RELIABILITY_MIGRATIONS.join(','),catalog.supabaseProjectRef),/legacy database phases are archived/);
assert.throws(()=>guard.validateTarget(exactEnvironment,'a'.repeat(40),guard.RELEASE_PHASE_DATABASE_READ_LATENCY,guard.READ_LATENCY_MIGRATIONS.join(','),catalog.supabaseProjectRef),/legacy database phases are archived/);
assert.throws(()=>guard.validateTarget(exactEnvironment,'a'.repeat(40),guard.RELEASE_PHASE_DATABASE_AR_MAPPING,guard.AR_MAPPING_MIGRATIONS.join(','),catalog.supabaseProjectRef),/legacy database phases are archived/);
assert.throws(()=>guard.validateTarget(exactEnvironment,'a'.repeat(40),guard.RELEASE_PHASE_DATABASE_AUDIT_REMEDIATION,guard.AUDIT_REMEDIATION_MIGRATIONS.join(','),catalog.supabaseProjectRef),/legacy database phases are archived/);
assert.throws(()=>guard.validateTarget(exactEnvironment,'a'.repeat(40),guard.RELEASE_PHASE_DATABASE_APPROVAL_SEARCH,guard.APPROVAL_SEARCH_BATCH.join(','),catalog.supabaseProjectRef),/legacy database phases are archived/);
assert.throws(()=>guard.validateTarget(exactEnvironment,'a'.repeat(40),guard.RELEASE_PHASE_DATABASE_HISTORY_SUMMARY,guard.HISTORY_SUMMARY_MIGRATIONS.join(','),catalog.supabaseProjectRef),/legacy database phases are archived/);
assert.throws(()=>guard.validateTarget(exactEnvironment,'a'.repeat(40),guard.RELEASE_PHASE_DATABASE_INVOICE_READ_SCOPE,guard.INVOICE_READ_SCOPE_MIGRATIONS.join(','),catalog.supabaseProjectRef),/legacy database phases are archived/);
assert.throws(()=>guard.validateTarget(exactEnvironment,'a'.repeat(40),guard.RELEASE_PHASE_DATABASE_HR_BRIDGE,guard.HR_BRIDGE_MIGRATIONS.join(','),catalog.supabaseProjectRef),/legacy database phases are archived/);
assert.throws(()=>guard.validateTarget(exactEnvironment,'a'.repeat(40),guard.RELEASE_PHASE_DATABASE_AR_READ_SCOPE,guard.AR_READ_SCOPE_MIGRATIONS.join(','),catalog.supabaseProjectRef),/legacy database phases are archived/);
assert.throws(() => guard.validateTarget(exactEnvironment, 'a'.repeat(40), 'frontend_compat', '20260827052447', catalog.supabaseProjectRef), /must use/);
assert.throws(() => guard.validateTarget(exactEnvironment, 'a'.repeat(40), 'database_v3', 'none', catalog.supabaseProjectRef), /must use/);
assert.throws(() => guard.validateTarget({ ...exactEnvironment, VERCEL_ORG_ID: 'team_other' }, 'a'.repeat(40), 'frontend_compat', 'none', catalog.supabaseProjectRef), /organization/);
assert.throws(() => guard.validateTarget({ ...exactEnvironment, VERCEL_PROJECT_ID: 'prj_other' }, 'a'.repeat(40), 'frontend_compat', 'none', catalog.supabaseProjectRef), /project/);
assert.throws(() => guard.validateTarget(exactEnvironment, 'a'.repeat(40), 'frontend_compat', 'none', 'a'.repeat(20)), /immutable/);

const root = path.resolve(__dirname, '..');
const auditPostflight=fs.readFileSync(path.join(root,'scripts/finance_audit_20260907_postflight.sql'),'utf8');
for(const name of ['finance_org_integrity_postflight.sql','finance_approval_audit_postflight.sql'])assert.ok(auditPostflight.includes(fs.readFileSync(path.join(root,'scripts',name),'utf8').trim()),'combined postflight must include exact domain contract: '+name);
const workflow = fs.readFileSync(path.join(root, '.github/workflows/finance-production-release.yml'), 'utf8');
assert.equal((workflow.match(/cp scripts\/finance_applicant_withdraw_postflight\.sql/g)||[]).length,1,
  'protected release bundle includes the applicant withdrawal postflight');
assert.equal((workflow.match(/prepare-read-only-query --input "\$TOOLS\/scripts\/finance_applicant_withdraw_postflight\.sql"/g)||[]).length,2,
  'protected frontend release checks applicant withdrawal before and after promotion');
const applicantWithdrawPostflight=fs.readFileSync(path.join(root,'scripts/finance_applicant_withdraw_postflight.sql'),'utf8');
assert.match(applicantWithdrawPostflight,/^\\set ON_ERROR_STOP on\r?\n/,
  'applicant withdrawal postflight starts with the release guard fail-closed directive');
const cleanupPostflight=fs.readFileSync(path.join(root,'scripts/finance_attachment_staged_cleanup_postflight.sql'),'utf8');
assert.match(cleanupPostflight,/b7552f6a6199614a0ac46c6854402a95/);
assert.match(cleanupPostflight,/delete_policy\.qual is distinct from select_policy\.qual/);
assert.equal((workflow.match(/supabase db query --linked --file scripts\/finance_attachment_staged_cleanup_postflight\.sql/g)||[]).length,2,
  'protected frontend release checks the exact cleanup policy before and after promotion');
const attachmentClaimTemp=fs.mkdtempSync(path.join(os.tmpdir(),'finance-attachment-claim-release-'));
try {
  const migrationDir=path.join(root,'supabase/migrations');
  const prior=['20260825000000',...guard.REVIEWED_MIGRATION_CATALOG.filter(version=>version<guard.ATTACHMENT_CLAIM_MIGRATIONS[0])];
  const baseline={count:1,lastVersion:prior[0],sha256:guard.ledgerSha256([prior[0]])};
  const ledger=path.join(attachmentClaimTemp,'ledger.txt');
  fs.writeFileSync(ledger,prior.join('\n')+'\n');
  const phase=guard.RELEASE_PHASE_DATABASE_ATTACHMENT_CLAIM;
  const versions=guard.ATTACHMENT_CLAIM_MIGRATIONS.join(',');
  const scripts=name=>path.join(root,'scripts',name);
  assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'pending');
  const rehearsal=path.join(attachmentClaimTemp,'rehearsal.sql');
  guard.prepareAttachmentClaimRehearsal(migrationDir,rehearsal,versions,ledger,
    scripts('finance_attachment_claim_fingerprint.sql'),
    scripts('finance_attachment_claim_canary.sql'),
    scripts('finance_canonical_receivables_postflight.sql'),
    scripts('finance_reporting_profiles_postflight.sql'),baseline);
  const rehearsed=fs.readFileSync(rehearsal,'utf8');
  assert.match(rehearsed,/savepoint finance_release_migration;[\s\S]+insert into supabase_migrations\.schema_migrations\(version,statements,name,created_by\)[\s\S]+FINANCE_ATTACHMENT_CLAIM_POSTFLIGHT_OK[\s\S]+rollback to savepoint finance_release_migration;/);
  assert.match(rehearsed,/row\(schema_sha256,part_count\)/);
  assert.match(rehearsed,/90d74f07ec5ac883060dec34b6cdadfe/);
  assert.doesNotMatch(rehearsed,/addd18c5a918fb28b9781e41622eda30/);
  const apply=path.join(attachmentClaimTemp,'apply.sql');
  guard.prepareAuditBatchApply(migrationDir,apply,versions,ledger,
    scripts('finance_canonical_receivables_postflight.sql'),baseline,phase,
    scripts('finance_reporting_profiles_postflight.sql'));
  const appliedSql=fs.readFileSync(apply,'utf8');
  assert.match(appliedSql,/insert into supabase_migrations\.schema_migrations\(version,statements,name,created_by\)[\s\S]+FINANCE_ATTACHMENT_CLAIM_POSTFLIGHT_OK[\s\S]+commit;/);
  assert.match(appliedSql,/90d74f07ec5ac883060dec34b6cdadfe/);
  const frontendGate=path.join(attachmentClaimTemp,'frontend-gate.sql');
  guard.preparePhaseQuery(scripts('finance_production_db_postflight.sql'),frontendGate,'frontend_compat','none');
  const frontendAttachmentGate=fs.readFileSync(frontendGate,'utf8');
  assert.match(frontendAttachmentGate,/630e313afc532a88be3690bb87b93251[\s\S]+460d1de56a73764c103c61e38f6904034a1253064dcd652b22c43a6b568c1c59[\s\S]+FINANCE_ATTACHMENT_CLAIM_POSTFLIGHT_OK/);
  assert.doesNotMatch(frontendAttachmentGate,/90d74f07ec5ac883060dec34b6cdadfe|f6b0a07ae4ee42f178da9e09fa46aee85aa902cc98936175389449b06680bbe3/);
  const priorGate=path.join(attachmentClaimTemp,'prior-gate.sql');
  guard.preparePhaseQuery(scripts('finance_production_db_postflight.sql'),priorGate,
    guard.RELEASE_PHASE_DATABASE_EXTERNAL_LABOR,guard.EXTERNAL_LABOR_MIGRATIONS.join(','));
  assert.match(fs.readFileSync(priorGate,'utf8'),/addd18c5a918fb28b9781e41622eda30/);
  assert.doesNotMatch(fs.readFileSync(priorGate,'utf8'),/FINANCE_ATTACHMENT_CLAIM_POSTFLIGHT_OK/);
  const tampered=path.join(attachmentClaimTemp,'tampered');fs.mkdirSync(tampered);
  fs.writeFileSync(path.join(tampered,'20261001030323_fix_attachment_claim_path_lookup.sql'),
    fs.readFileSync(path.join(migrationDir,'20261001030323_fix_attachment_claim_path_lookup.sql'),'utf8')+'\n-- tampered\n');
  assert.throws(()=>guard.readAuditBatch(tampered,versions,phase),/sealed SHA256/);
  fs.appendFileSync(ledger,versions+'\n');
  assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'applied');
  assert.throws(()=>guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),/staged-attachment cleanup policy/);
  fs.appendFileSync(ledger,guard.ATTACHMENT_STAGED_CLEANUP_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),/income reconciliation migration/);
  fs.appendFileSync(ledger,[...guard.HUMAN_FLOAT_MIGRATIONS,...guard.INCOME_RECONCILE_MIGRATIONS].join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),/invoice revenue result RPC/);
  fs.appendFileSync(ledger,guard.INVOICE_REVENUE_RESULT_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),/nonretry personnel conflict migration/);
  fs.appendFileSync(ledger,guard.PERSONNEL_CONFLICT_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),/reliable personnel receipt migration/);
  fs.appendFileSync(ledger,guard.PERSONNEL_RECEIPT_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),/procurement specialized action guard/);
  fs.appendFileSync(ledger,guard.PROCUREMENT_ACTION_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),/applicant withdrawal transaction guard/);
  fs.appendFileSync(ledger,guard.APPLICANT_WITHDRAW_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),/purchase final amount exact lock/);
  fs.appendFileSync(ledger,guard.PURCHASE_FINAL_AMOUNT_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),/historical invoice item binding RPC/);
  fs.appendFileSync(ledger,guard.INVOICE_ITEM_BIND_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),/personal document history RPC/);
  fs.appendFileSync(ledger,guard.PERSONAL_HISTORY_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),/personal history permission guard/);
  fs.appendFileSync(ledger,guard.PERSONAL_HISTORY_PERMISSION_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),/personal bill batch history read model/);
  fs.appendFileSync(ledger,[...guard.BILL_BATCH_BULK_MIGRATIONS,...guard.INVOICE_BATCH_APPROVAL_MIGRATIONS,...guard.PERSONAL_HISTORY_IDENTITY_ONCE_MIGRATIONS,...guard.PERSONAL_BILL_BATCH_HISTORY_MIGRATIONS].join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),/invoice batch bulk transaction/);
  fs.appendFileSync(ledger,guard.INVOICE_BATCH_BULK_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),/bounded logout receipt migration/);
  fs.appendFileSync(ledger,guard.BOUNDED_LOGOUT_MIGRATIONS.join('\n')+'\n');
  fs.writeFileSync(ledger,fs.readFileSync(ledger,'utf8').trim().split('\n').sort().join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),/bill approval bulk transaction/);
  fs.appendFileSync(ledger,guard.BILL_APPROVAL_BULK_MIGRATIONS.join('\n')+'\n');
  fs.writeFileSync(ledger,fs.readFileSync(ledger,'utf8').trim().split('\n').sort().join('\n')+'\n');
  assert.equal(guard.classifyLedger(ledger,migrationDir,'frontend_compat','none',baseline),'compat');
  const pinnedPersonnelDir=path.join(attachmentClaimTemp,'personnel-source-pin');
  fs.mkdirSync(pinnedPersonnelDir);
  for(const version of [...guard.PERSONNEL_CONFLICT_MIGRATIONS,...guard.PERSONNEL_RECEIPT_MIGRATIONS,...guard.APPLICANT_WITHDRAW_MIGRATIONS,...guard.PURCHASE_FINAL_AMOUNT_MIGRATIONS,...guard.INVOICE_ITEM_BIND_MIGRATIONS,...guard.PERSONAL_HISTORY_MIGRATIONS,...guard.PERSONAL_HISTORY_PERMISSION_MIGRATIONS,...guard.INVOICE_BATCH_BULK_MIGRATIONS]){
    const filename=fs.readdirSync(migrationDir).find(name=>name.startsWith(version+'_'));
    fs.copyFileSync(path.join(migrationDir,filename),path.join(pinnedPersonnelDir,filename));
  }
  assert.equal(guard.classifyLedger(ledger,pinnedPersonnelDir,'frontend_compat','none',baseline),'compat');
  for(const version of [...guard.PERSONNEL_CONFLICT_MIGRATIONS,...guard.PERSONNEL_RECEIPT_MIGRATIONS]){
    const filename=fs.readdirSync(pinnedPersonnelDir).find(name=>name.startsWith(version+'_'));
    const file=path.join(pinnedPersonnelDir,filename),source=fs.readFileSync(file,'utf8');
    fs.writeFileSync(file,source+'\n-- source changed after review\n');
    assert.throws(()=>guard.classifyLedger(ledger,pinnedPersonnelDir,'frontend_compat','none',baseline),/personnel migration source differs from sealed SHA256/);
    fs.writeFileSync(file,source);
  }
  const withdrawalFilename=fs.readdirSync(pinnedPersonnelDir).find(name=>name.startsWith(guard.APPLICANT_WITHDRAW_MIGRATIONS[0]+'_'));
  const withdrawalFile=path.join(pinnedPersonnelDir,withdrawalFilename);
  const withdrawalSource=fs.readFileSync(withdrawalFile,'utf8');
  fs.writeFileSync(withdrawalFile,withdrawalSource+'\n-- unreviewed source change\n');
  assert.throws(()=>guard.classifyLedger(ledger,pinnedPersonnelDir,'frontend_compat','none',baseline),/applicant withdrawal migration source differs from sealed SHA256/);
  fs.writeFileSync(withdrawalFile,withdrawalSource);
  const purchaseFilename=fs.readdirSync(pinnedPersonnelDir).find(name=>name.startsWith(guard.PURCHASE_FINAL_AMOUNT_MIGRATIONS[0]+'_'));
  const purchaseFile=path.join(pinnedPersonnelDir,purchaseFilename);
  const purchaseSource=fs.readFileSync(purchaseFile,'utf8');
  fs.writeFileSync(purchaseFile,purchaseSource+'\n-- unreviewed source change\n');
  assert.throws(()=>guard.classifyLedger(ledger,pinnedPersonnelDir,'frontend_compat','none',baseline),/purchase final amount migration source differs from sealed SHA256/);
  fs.writeFileSync(purchaseFile,purchaseSource);
  const bindingFilename=fs.readdirSync(pinnedPersonnelDir).find(name=>name.startsWith(guard.INVOICE_ITEM_BIND_MIGRATIONS[0]+'_'));
  const bindingFile=path.join(pinnedPersonnelDir,bindingFilename);
  const bindingSource=fs.readFileSync(bindingFile,'utf8');
  fs.writeFileSync(bindingFile,bindingSource+'\n-- unreviewed source change\n');
  assert.throws(()=>guard.classifyLedger(ledger,pinnedPersonnelDir,'frontend_compat','none',baseline),/invoice item binding migration source differs from sealed SHA256/);
  fs.writeFileSync(bindingFile,bindingSource);
  const missingReceipt=fs.readdirSync(pinnedPersonnelDir).find(name=>name.startsWith(guard.PERSONNEL_RECEIPT_MIGRATIONS[0]+'_'));
  fs.rmSync(path.join(pinnedPersonnelDir,missingReceipt));
  assert.throws(()=>guard.classifyLedger(ledger,pinnedPersonnelDir,'frontend_compat','none',baseline),/personnel migration file is missing/);
} finally {fs.rmSync(attachmentClaimTemp,{recursive:true,force:true});}
const humanFloatTemp=fs.mkdtempSync(path.join(os.tmpdir(),'finance-human-float-release-'));
try {
  const migrationDir=path.join(root,'supabase/migrations');
  const prior=['20260825000000',...guard.REVIEWED_MIGRATION_CATALOG.filter(version=>version<guard.HUMAN_FLOAT_MIGRATIONS[0])];
  const baseline={count:1,lastVersion:prior[0],sha256:guard.ledgerSha256([prior[0]])};
  const ledger=path.join(humanFloatTemp,'ledger.txt');
  const phase=guard.RELEASE_PHASE_DATABASE_HUMAN_FLOAT;
  const versions=guard.HUMAN_FLOAT_MIGRATIONS.join(',');
  const scripts=name=>path.join(root,'scripts',name);
  assert.doesNotMatch(fs.readFileSync(scripts('finance_human_accounting_float_canary.sql'),'utf8'),/^\s*\\(?:set|i|include)\b/m,
    'the direct Supabase CLI canary must contain SQL only');
  fs.writeFileSync(ledger,prior.join('\n')+'\n');
  assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'pending');
  const rehearsal=path.join(humanFloatTemp,'rehearsal.sql');
  guard.prepareHumanFloatRehearsal(migrationDir,rehearsal,versions,ledger,
    scripts('finance_human_accounting_float_fingerprint.sql'),
    scripts('finance_human_accounting_float_canary.sql'),
    scripts('finance_human_accounting_float_preflight.sql'),
    scripts('finance_human_accounting_float_postflight.sql'),baseline);
  const rehearsed=fs.readFileSync(rehearsal,'utf8');
  assert.match(rehearsed,/FINANCE_HUMAN_FLOAT_PREFLIGHT_OK[\s\S]+savepoint finance_release_migration;[\s\S]+insert into supabase_migrations\.schema_migrations\(version,statements,name,created_by\)[\s\S]+FINANCE_HUMAN_FLOAT_POSTFLIGHT_OK[\s\S]+rollback to savepoint finance_release_migration;[\s\S]+human float rollback rehearsal changed schema fingerprints/);
  assert.match(rehearsed,/create temporary table finance_release_fingerprint_before[\s\S]+create temporary table finance_release_fingerprint_after/);
  const apply=path.join(humanFloatTemp,'apply.sql');
  guard.prepareAuditBatchApply(migrationDir,apply,versions,ledger,
    scripts('finance_human_accounting_float_postflight.sql'),baseline,phase);
  assert.match(fs.readFileSync(apply,'utf8'),/0\.000000001::numeric[\s\S]+insert into supabase_migrations\.schema_migrations[\s\S]+FINANCE_HUMAN_FLOAT_POSTFLIGHT_OK[\s\S]+commit;/);
  const gate=path.join(humanFloatTemp,'postflight.sql');
  guard.preparePhaseQuery(scripts('finance_human_accounting_float_postflight.sql'),gate,phase,versions);
  assert.match(fs.readFileSync(gate,'utf8'),/^begin read only;[\s\S]+FINANCE_HUMAN_FLOAT_POSTFLIGHT_OK[\s\S]+rollback;/);
  const tampered=path.join(humanFloatTemp,'tampered');fs.mkdirSync(tampered);
  fs.writeFileSync(path.join(tampered,'20261002035707_finance_human_accounting_float_residue_20261002.sql'),
    fs.readFileSync(path.join(migrationDir,'20261002035707_finance_human_accounting_float_residue_20261002.sql'),'utf8')+'\n-- tampered\n');
  assert.throws(()=>guard.readAuditBatch(tampered,versions,phase),/sealed SHA256/);
  fs.appendFileSync(ledger,versions+'\n');
  assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'applied');
  assert.throws(()=>guard.verifyLedger('pre',ledger,migrationDir,phase,versions,baseline),/must be pending/);
  guard.verifyLedger('post',ledger,migrationDir,phase,versions,baseline);
  const beforeAlias=path.join(humanFloatTemp,'before-alias.json');
  const afterAlias=path.join(humanFloatTemp,'after-alias.json');
  const beforeManifest=path.join(humanFloatTemp,'before-manifest.json');
  const afterManifest=path.join(humanFloatTemp,'after-manifest.json');
  const candidateDeployment=path.join(humanFloatTemp,'candidate-deployment.json');
  const alias={alias:guard.PRODUCTION_CATALOG.productionDomain,projectId:guard.PRODUCTION_CATALOG.vercelProjectId,deploymentId:'dpl_existing'};
  fs.writeFileSync(beforeAlias,JSON.stringify(alias));
  fs.writeFileSync(afterAlias,JSON.stringify(alias));
  fs.writeFileSync(beforeManifest,JSON.stringify({source_commit:'live_previous'}));
  fs.writeFileSync(afterManifest,JSON.stringify({source_commit:'live_previous'}));
  fs.writeFileSync(candidateDeployment,JSON.stringify({id:'dpl_candidate'}));
  guard.verifyDbOnlyAlias(beforeAlias,afterAlias,beforeManifest,afterManifest,candidateDeployment);
  fs.writeFileSync(afterAlias,JSON.stringify({...alias,deploymentId:'dpl_candidate'}));
  assert.throws(()=>guard.verifyDbOnlyAlias(beforeAlias,afterAlias,beforeManifest,afterManifest,candidateDeployment),/changed the production deployment alias/);
  fs.writeFileSync(afterAlias,JSON.stringify(alias));
  fs.writeFileSync(afterManifest,JSON.stringify({source_commit:'unexpected'}));
  assert.throws(()=>guard.verifyDbOnlyAlias(beforeAlias,afterAlias,beforeManifest,afterManifest,candidateDeployment),/changed the production frontend manifest/);
  fs.writeFileSync(afterManifest,JSON.stringify({source_commit:'live_previous'},null,2));
  assert.throws(()=>guard.verifyDbOnlyAlias(beforeAlias,afterAlias,beforeManifest,afterManifest,candidateDeployment),/changed production frontend manifest bytes/);
} finally {fs.rmSync(humanFloatTemp,{recursive:true,force:true});}
const incomeReconcileTemp=fs.mkdtempSync(path.join(os.tmpdir(),'finance-income-reconcile-release-'));
try {
  const migrationDir=path.join(root,'supabase/migrations');
  const prior=['20260825000000',...guard.REVIEWED_MIGRATION_CATALOG.filter(version=>version<guard.INCOME_RECONCILE_MIGRATIONS[0])];
  const baseline={count:1,lastVersion:prior[0],sha256:guard.ledgerSha256([prior[0]])};
  const ledger=path.join(incomeReconcileTemp,'ledger.txt');
  const phase=guard.RELEASE_PHASE_DATABASE_INCOME_RECONCILE;
  const versions=guard.INCOME_RECONCILE_MIGRATIONS.join(',');
  const scripts=name=>path.join(root,'scripts',name);
  const canary=fs.readFileSync(scripts('finance_income_reconcile_canary.sql'),'utf8');
  assert.doesNotMatch(canary,/^\s*\\(?:set|i|include)\b/m,'the direct Supabase CLI canary must contain SQL only');
  assert.match(canary,/begin isolation level repeatable read read only;[\s\S]+FINANCE_INCOME_RECONCILE_CANARY_ROLLED_BACK/);
  fs.writeFileSync(ledger,prior.join('\n')+'\n');
  assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'pending');
  const rehearsal=path.join(incomeReconcileTemp,'rehearsal.sql');
  guard.prepareIncomeReconcileRehearsal(migrationDir,rehearsal,versions,ledger,
    scripts('finance_income_reconcile_fingerprint.sql'),scripts('finance_income_reconcile_canary.sql'),
    scripts('finance_income_reconcile_preflight.sql'),scripts('finance_income_reconcile_postflight.sql'),baseline);
  assert.match(fs.readFileSync(rehearsal,'utf8'),/FINANCE_INCOME_RECONCILE_PREFLIGHT_OK[\s\S]+savepoint finance_release_migration;[\s\S]+insert into supabase_migrations\.schema_migrations\(version,statements,name,created_by\)[\s\S]+FINANCE_INCOME_RECONCILE_POSTFLIGHT_OK[\s\S]+rollback to savepoint finance_release_migration;[\s\S]+income reconciliation rollback rehearsal changed schema fingerprints/);
  const apply=path.join(incomeReconcileTemp,'apply.sql');
  guard.prepareAuditBatchApply(migrationDir,apply,versions,ledger,
    scripts('finance_income_reconcile_postflight.sql'),baseline,phase);
  assert.match(fs.readFileSync(apply,'utf8'),/finance_income_reconcile_submission_v1[\s\S]+insert into supabase_migrations\.schema_migrations[\s\S]+FINANCE_INCOME_RECONCILE_POSTFLIGHT_OK[\s\S]+commit;/);
  const gate=path.join(incomeReconcileTemp,'postflight.sql');
  guard.preparePhaseQuery(scripts('finance_income_reconcile_postflight.sql'),gate,phase,versions);
  assert.match(fs.readFileSync(gate,'utf8'),/^begin read only;[\s\S]+FINANCE_INCOME_RECONCILE_POSTFLIGHT_OK[\s\S]+rollback;/);
  const tampered=path.join(incomeReconcileTemp,'tampered');fs.mkdirSync(tampered);
  fs.writeFileSync(path.join(tampered,'20261002130327_finance_income_reconcile_submission_v1.sql'),
    fs.readFileSync(path.join(migrationDir,'20261002130327_finance_income_reconcile_submission_v1.sql'),'utf8')+'\n-- tampered\n');
  assert.throws(()=>guard.readAuditBatch(tampered,versions,phase),/sealed SHA256/);
  fs.appendFileSync(ledger,versions+'\n');
  assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'applied');
  assert.throws(()=>guard.verifyLedger('pre',ledger,migrationDir,phase,versions,baseline),/must be pending/);
  guard.verifyLedger('post',ledger,migrationDir,phase,versions,baseline);
} finally {fs.rmSync(incomeReconcileTemp,{recursive:true,force:true});}
const invoiceRevenueResultTemp=fs.mkdtempSync(path.join(os.tmpdir(),'finance-invoice-revenue-result-release-'));
try {
  const migrationDir=path.join(root,'supabase/migrations');
  const prior=['20260825000000',...guard.REVIEWED_MIGRATION_CATALOG.filter(version=>version<guard.INVOICE_REVENUE_RESULT_MIGRATIONS[0])];
  const baseline={count:1,lastVersion:prior[0],sha256:guard.ledgerSha256([prior[0]])};
  const ledger=path.join(invoiceRevenueResultTemp,'ledger.txt');
  const phase=guard.RELEASE_PHASE_DATABASE_INVOICE_REVENUE_RESULT;
  const versions=guard.INVOICE_REVENUE_RESULT_MIGRATIONS.join(',');
  const scripts=name=>path.join(root,'scripts',name);
  const canary=fs.readFileSync(scripts('finance_invoice_revenue_result_canary.sql'),'utf8');
  assert.doesNotMatch(canary,/^\s*\\(?:set|i|include)\b/m,'the direct Supabase CLI canary must contain SQL only');
  assert.match(canary,/begin isolation level repeatable read read only;[\s\S]+FINANCE_INVOICE_REVENUE_RESULT_CANARY_ROLLED_BACK/);
  fs.writeFileSync(ledger,prior.join('\n')+'\n');
  assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'pending');
  const rehearsal=path.join(invoiceRevenueResultTemp,'rehearsal.sql');
  guard.prepareInvoiceRevenueResultRehearsal(migrationDir,rehearsal,versions,ledger,
    scripts('finance_invoice_revenue_result_fingerprint.sql'),scripts('finance_invoice_revenue_result_canary.sql'),
    scripts('finance_invoice_revenue_result_preflight.sql'),scripts('finance_invoice_revenue_result_postflight.sql'),baseline);
  assert.match(fs.readFileSync(rehearsal,'utf8'),/FINANCE_INVOICE_REVENUE_RESULT_PREFLIGHT_OK[\s\S]+savepoint finance_release_migration;[\s\S]+insert into supabase_migrations\.schema_migrations\(version,statements,name,created_by\)[\s\S]+FINANCE_INVOICE_REVENUE_RESULT_POSTFLIGHT_OK[\s\S]+rollback to savepoint finance_release_migration;[\s\S]+invoice revenue result rollback rehearsal changed schema fingerprints/);
  const apply=path.join(invoiceRevenueResultTemp,'apply.sql');
  guard.prepareAuditBatchApply(migrationDir,apply,versions,ledger,
    scripts('finance_invoice_revenue_result_postflight.sql'),baseline,phase);
  assert.match(fs.readFileSync(apply,'utf8'),/finance_invoice_revenue_result_v1[\s\S]+insert into supabase_migrations\.schema_migrations[\s\S]+FINANCE_INVOICE_REVENUE_RESULT_POSTFLIGHT_OK[\s\S]+commit;/);
  const gate=path.join(invoiceRevenueResultTemp,'postflight.sql');
  guard.preparePhaseQuery(scripts('finance_invoice_revenue_result_postflight.sql'),gate,phase,versions);
  assert.match(fs.readFileSync(gate,'utf8'),/^begin read only;[\s\S]+FINANCE_INVOICE_REVENUE_RESULT_POSTFLIGHT_OK[\s\S]+rollback;/);
  const tampered=path.join(invoiceRevenueResultTemp,'tampered');fs.mkdirSync(tampered);
  fs.writeFileSync(path.join(tampered,'20261002151725_finance_invoice_revenue_result_v1.sql'),
    fs.readFileSync(path.join(migrationDir,'20261002151725_finance_invoice_revenue_result_v1.sql'),'utf8')+'\n-- tampered\n');
  assert.throws(()=>guard.readAuditBatch(tampered,versions,phase),/sealed SHA256/);
  fs.appendFileSync(ledger,versions+'\n');
  assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'applied');
  assert.throws(()=>guard.verifyLedger('pre',ledger,migrationDir,phase,versions,baseline),/must be pending/);
  guard.verifyLedger('post',ledger,migrationDir,phase,versions,baseline);
} finally {fs.rmSync(invoiceRevenueResultTemp,{recursive:true,force:true});}
const purchaseFinalAmountTemp=fs.mkdtempSync(path.join(os.tmpdir(),'finance-purchase-final-amount-release-'));
try {
  const migrationDir=path.join(root,'supabase/migrations');
  const prior=['20260825000000',...guard.REVIEWED_MIGRATION_CATALOG.filter(version=>version<guard.PURCHASE_FINAL_AMOUNT_MIGRATIONS[0])];
  const baseline={count:1,lastVersion:prior[0],sha256:guard.ledgerSha256([prior[0]])};
  const ledger=path.join(purchaseFinalAmountTemp,'ledger.txt');
  const phase=guard.RELEASE_PHASE_DATABASE_PURCHASE_FINAL_AMOUNT;
  const versions=guard.PURCHASE_FINAL_AMOUNT_MIGRATIONS.join(',');
  const scripts=name=>path.join(root,'scripts',name);
  const canary=fs.readFileSync(scripts('finance_purchase_final_amount_canary.sql'),'utf8');
  assert.doesNotMatch(canary,/^\s*\\(?:set|i|include)\b/m,'the direct Supabase CLI canary must contain SQL only');
  assert.match(canary,/begin isolation level repeatable read read only;[\s\S]+FINANCE_PURCHASE_FINAL_AMOUNT_CANARY_ROLLED_BACK/);
  fs.writeFileSync(ledger,prior.join('\n')+'\n');
  assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'pending');
  const rehearsal=path.join(purchaseFinalAmountTemp,'rehearsal.sql');
  guard.preparePurchaseFinalAmountRehearsal(migrationDir,rehearsal,versions,ledger,
    scripts('finance_purchase_final_amount_fingerprint.sql'),scripts('finance_purchase_final_amount_canary.sql'),
    scripts('finance_purchase_final_amount_preflight.sql'),scripts('finance_purchase_final_amount_postflight.sql'),baseline);
  assert.match(fs.readFileSync(rehearsal,'utf8'),/FINANCE_PURCHASE_FINAL_AMOUNT_PREFLIGHT_OK[\s\S]+savepoint finance_release_migration;[\s\S]+insert into supabase_migrations\.schema_migrations\(version,statements,name,created_by\)[\s\S]+FINANCE_PURCHASE_FINAL_AMOUNT_POSTFLIGHT_OK[\s\S]+rollback to savepoint finance_release_migration;[\s\S]+purchase final amount rollback rehearsal changed schema fingerprints/);
  const apply=path.join(purchaseFinalAmountTemp,'apply.sql');
  guard.prepareAuditBatchApply(migrationDir,apply,versions,ledger,
    scripts('finance_purchase_final_amount_postflight.sql'),baseline,phase);
  assert.match(fs.readFileSync(apply,'utf8'),/do \$purchase_final_amount_exact_lock\$[\s\S]+insert into supabase_migrations\.schema_migrations[\s\S]+FINANCE_PURCHASE_FINAL_AMOUNT_POSTFLIGHT_OK[\s\S]+commit;/);
  const gate=path.join(purchaseFinalAmountTemp,'postflight.sql');
  guard.preparePhaseQuery(scripts('finance_purchase_final_amount_postflight.sql'),gate,phase,versions);
  assert.match(fs.readFileSync(gate,'utf8'),/^begin read only;[\s\S]+FINANCE_PURCHASE_FINAL_AMOUNT_POSTFLIGHT_OK[\s\S]+rollback;/);
  const tampered=path.join(purchaseFinalAmountTemp,'tampered');fs.mkdirSync(tampered);
  fs.writeFileSync(path.join(tampered,'20261006153719_purchase_final_amount_exact_lock_v1.sql'),
    fs.readFileSync(path.join(migrationDir,'20261006153719_purchase_final_amount_exact_lock_v1.sql'),'utf8')+'\n-- tampered\n');
  assert.throws(()=>guard.readAuditBatch(tampered,versions,phase),/sealed SHA256/);
  fs.appendFileSync(ledger,versions+'\n');
  assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'applied');
  assert.throws(()=>guard.verifyLedger('pre',ledger,migrationDir,phase,versions,baseline),/must be pending/);
  guard.verifyLedger('post',ledger,migrationDir,phase,versions,baseline);
} finally {fs.rmSync(purchaseFinalAmountTemp,{recursive:true,force:true});}
const invoiceItemBindTemp=fs.mkdtempSync(path.join(os.tmpdir(),'finance-invoice-item-bind-release-'));
try {
  const migrationDir=path.join(root,'supabase/migrations');
  const prior=['20260825000000',...guard.REVIEWED_MIGRATION_CATALOG.filter(version=>version<guard.INVOICE_ITEM_BIND_MIGRATIONS[0])];
  const baseline={count:1,lastVersion:prior[0],sha256:guard.ledgerSha256([prior[0]])};
  const ledger=path.join(invoiceItemBindTemp,'ledger.txt');
  const phase=guard.RELEASE_PHASE_DATABASE_INVOICE_ITEM_BIND;
  const versions=guard.INVOICE_ITEM_BIND_MIGRATIONS.join(',');
  const scripts=name=>path.join(root,'scripts',name);
  const canary=fs.readFileSync(scripts('finance_invoice_item_bind_canary.sql'),'utf8');
  assert.doesNotMatch(canary,/^\s*\\(?:set|i|include)\b/m,'the direct Supabase CLI canary must contain SQL only');
  assert.match(canary,/begin isolation level repeatable read read only;[\s\S]+FINANCE_INVOICE_ITEM_BIND_CANARY_ROLLED_BACK/);
  fs.writeFileSync(ledger,prior.join('\n')+'\n');
  assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'pending');
  const rehearsal=path.join(invoiceItemBindTemp,'rehearsal.sql');
  guard.prepareInvoiceItemBindRehearsal(migrationDir,rehearsal,versions,ledger,
    scripts('finance_invoice_item_bind_fingerprint.sql'),scripts('finance_invoice_item_bind_canary.sql'),
    scripts('finance_invoice_item_bind_preflight.sql'),scripts('finance_invoice_item_bind_postflight.sql'),baseline);
  assert.match(fs.readFileSync(rehearsal,'utf8'),/FINANCE_INVOICE_ITEM_BIND_PREFLIGHT_OK[\s\S]+savepoint finance_release_migration;[\s\S]+insert into supabase_migrations\.schema_migrations\(version,statements,name,created_by\)[\s\S]+FINANCE_INVOICE_ITEM_BIND_POSTFLIGHT_OK[\s\S]+rollback to savepoint finance_release_migration;[\s\S]+invoice item binding rollback rehearsal changed schema fingerprints/);
  const apply=path.join(invoiceItemBindTemp,'apply.sql');
  guard.prepareAuditBatchApply(migrationDir,apply,versions,ledger,
    scripts('finance_invoice_item_bind_postflight.sql'),baseline,phase);
  assert.match(fs.readFileSync(apply,'utf8'),/finance_bind_expense_invoice_item_v1[\s\S]+insert into supabase_migrations\.schema_migrations[\s\S]+FINANCE_INVOICE_ITEM_BIND_POSTFLIGHT_OK[\s\S]+commit;/);
  const gate=path.join(invoiceItemBindTemp,'postflight.sql');
  guard.preparePhaseQuery(scripts('finance_invoice_item_bind_postflight.sql'),gate,phase,versions);
  assert.match(fs.readFileSync(gate,'utf8'),/^begin read only;[\s\S]+FINANCE_INVOICE_ITEM_BIND_POSTFLIGHT_OK[\s\S]+rollback;/);
  const tampered=path.join(invoiceItemBindTemp,'tampered');fs.mkdirSync(tampered);
  fs.writeFileSync(path.join(tampered,'20261008031845_finance_bind_expense_invoice_item_v1.sql'),
    fs.readFileSync(path.join(migrationDir,'20261008031845_finance_bind_expense_invoice_item_v1.sql'),'utf8')+'\n-- tampered\n');
  assert.throws(()=>guard.readAuditBatch(tampered,versions,phase),/sealed SHA256/);
  fs.appendFileSync(ledger,versions+'\n');
  assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'applied');
  assert.throws(()=>guard.verifyLedger('pre',ledger,migrationDir,phase,versions,baseline),/must be pending/);
  guard.verifyLedger('post',ledger,migrationDir,phase,versions,baseline);
} finally {fs.rmSync(invoiceItemBindTemp,{recursive:true,force:true});}
const personalHistoryTemp=fs.mkdtempSync(path.join(os.tmpdir(),'finance-personal-history-release-'));
try {
  const migrationDir=path.join(root,'supabase/migrations');
  const prior=['20260825000000',...guard.REVIEWED_MIGRATION_CATALOG.filter(version=>version<guard.PERSONAL_HISTORY_MIGRATIONS[0])];
  const baseline={count:1,lastVersion:prior[0],sha256:guard.ledgerSha256([prior[0]])};
  const ledger=path.join(personalHistoryTemp,'ledger.txt');
  const phase=guard.RELEASE_PHASE_DATABASE_PERSONAL_HISTORY;
  const versions=guard.PERSONAL_HISTORY_MIGRATIONS.join(',');
  const scripts=name=>path.join(root,'scripts',name);
  const canary=fs.readFileSync(scripts('finance_personal_history_canary.sql'),'utf8');
  assert.doesNotMatch(canary,/^\s*\\(?:set|i|include)\b/m,'the direct Supabase CLI canary must contain SQL only');
  assert.match(canary,/begin isolation level repeatable read read only;[\s\S]+rollback;/i);
  const canaryOutput=path.join(personalHistoryTemp,'canary.json');
  const expectedCanary={canary:'readonly_personal_history_v1',ok:true,rolled_back:true,identity_scope_preserved:true};
  fs.writeFileSync(canaryOutput,JSON.stringify([{personal_history_canary_result:expectedCanary}]));
  assert.equal(guard.verifyReportsCanary(canaryOutput,'personal_history'),true);
  fs.writeFileSync(canaryOutput,JSON.stringify([{personal_history_canary_result:{...expectedCanary,identity_scope_preserved:false}}]));
  assert.throws(()=>guard.verifyReportsCanary(canaryOutput,'personal_history'),/authenticated reports rollback canary did not complete safely/);
  fs.writeFileSync(ledger,prior.join('\n')+'\n');
  assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'pending');
  const rehearsal=path.join(personalHistoryTemp,'rehearsal.sql');
  guard.preparePersonalHistoryRehearsal(migrationDir,rehearsal,versions,ledger,
    scripts('finance_personal_history_fingerprint.sql'),scripts('finance_personal_history_canary.sql'),
    scripts('finance_personal_history_preflight.sql'),scripts('finance_personal_history_postflight.sql'),baseline);
  assert.match(fs.readFileSync(rehearsal,'utf8'),/savepoint finance_release_migration;[\s\S]+insert into supabase_migrations\.schema_migrations\(version,statements,name,created_by\)[\s\S]+rollback to savepoint finance_release_migration;[\s\S]+personal history rollback rehearsal changed schema fingerprints/);
  const apply=path.join(personalHistoryTemp,'apply.sql');
  guard.prepareAuditBatchApply(migrationDir,apply,versions,ledger,
    scripts('finance_personal_history_postflight.sql'),baseline,phase);
  assert.match(fs.readFileSync(apply,'utf8'),/finance_personal_document_authorized_v1[\s\S]+insert into supabase_migrations\.schema_migrations[\s\S]+commit;/);
  const gate=path.join(personalHistoryTemp,'postflight.sql');
  guard.preparePhaseQuery(scripts('finance_personal_history_postflight.sql'),gate,phase,versions);
  assert.match(fs.readFileSync(gate,'utf8'),/^begin read only;[\s\S]+rollback;/);
  const tampered=path.join(personalHistoryTemp,'tampered');fs.mkdirSync(tampered);
  fs.writeFileSync(path.join(tampered,'20261008055528_finance_personal_document_history_v1.sql'),
    fs.readFileSync(path.join(migrationDir,'20261008055528_finance_personal_document_history_v1.sql'),'utf8')+'\n-- tampered\n');
  assert.throws(()=>guard.readAuditBatch(tampered,versions,phase),/sealed SHA256/);
  fs.appendFileSync(ledger,versions+'\n');
  assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'applied');
  assert.throws(()=>guard.verifyLedger('pre',ledger,migrationDir,phase,versions,baseline),/must be pending/);
  guard.verifyLedger('post',ledger,migrationDir,phase,versions,baseline);
} finally {fs.rmSync(personalHistoryTemp,{recursive:true,force:true});}
const permissionHistoryTemp=fs.mkdtempSync(path.join(os.tmpdir(),'finance-personal-history-permission-release-'));
try {
  const migrationDir=path.join(root,'supabase/migrations');
  const prior=['20260825000000',...guard.REVIEWED_MIGRATION_CATALOG.filter(version=>version<guard.PERSONAL_HISTORY_PERMISSION_MIGRATIONS[0])];
  const baseline={count:1,lastVersion:prior[0],sha256:guard.ledgerSha256([prior[0]])};
  const ledger=path.join(permissionHistoryTemp,'ledger.txt');
  const phase=guard.RELEASE_PHASE_DATABASE_PERSONAL_HISTORY_PERMISSION;
  const versions=guard.PERSONAL_HISTORY_PERMISSION_MIGRATIONS.join(',');
  const scripts=name=>path.join(root,'scripts',name);
  fs.writeFileSync(ledger,prior.join('\n')+'\n');
  assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'pending');
  const canary=fs.readFileSync(scripts('finance_personal_history_permission_canary.sql'),'utf8');
  assert.doesNotMatch(canary,/^\s*\\(?:set|i|include)\b/m);
  const canaryOutput=path.join(permissionHistoryTemp,'canary.json');
  const expected={canary:'readonly_personal_history_permission_v1',ok:true,rolled_back:true,permission_guard_preserved:true};
  fs.writeFileSync(canaryOutput,JSON.stringify([{personal_history_permission_canary_result:expected}]));
  assert.equal(guard.verifyReportsCanary(canaryOutput,'personal_history_permission'),true);
  fs.writeFileSync(canaryOutput,JSON.stringify([{personal_history_permission_canary_result:{...expected,permission_guard_preserved:false}}]));
  assert.throws(()=>guard.verifyReportsCanary(canaryOutput,'personal_history_permission'));
  const rehearsal=path.join(permissionHistoryTemp,'rehearsal.sql');
  guard.preparePersonalHistoryRehearsal(migrationDir,rehearsal,versions,ledger,
    scripts('finance_personal_history_permission_fingerprint.sql'),
    scripts('finance_personal_history_permission_canary.sql'),
    scripts('finance_personal_history_permission_preflight.sql'),
    scripts('finance_personal_history_permission_postflight.sql'),baseline,phase);
  assert.match(fs.readFileSync(rehearsal,'utf8'),/savepoint finance_release_migration;[\s\S]+finance_personal_history_page_allows_v1[\s\S]+insert into supabase_migrations\.schema_migrations[\s\S]+rollback to savepoint finance_release_migration;/);
  const apply=path.join(permissionHistoryTemp,'apply.sql');
  guard.prepareAuditBatchApply(migrationDir,apply,versions,ledger,
    scripts('finance_personal_history_permission_postflight.sql'),baseline,phase);
  assert.match(fs.readFileSync(apply,'utf8'),/finance_personal_history_page_allows_v1[\s\S]+insert into supabase_migrations\.schema_migrations[\s\S]+commit;/);
  const gate=path.join(permissionHistoryTemp,'postflight.sql');
  guard.preparePhaseQuery(scripts('finance_personal_history_permission_postflight.sql'),gate,phase,versions);
  assert.match(fs.readFileSync(gate,'utf8'),/^begin read only;[\s\S]+rollback;/);
  const tampered=path.join(permissionHistoryTemp,'tampered');fs.mkdirSync(tampered);
  fs.writeFileSync(path.join(tampered,'20261008090000_finance_personal_history_permission_guard_v1.sql'),
    fs.readFileSync(path.join(migrationDir,'20261008090000_finance_personal_history_permission_guard_v1.sql'),'utf8')+'\n-- tampered\n');
  assert.throws(()=>guard.readAuditBatch(tampered,versions,phase),/sealed SHA256/);
  fs.appendFileSync(ledger,versions+'\n');
  assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'applied');
  guard.verifyLedger('post',ledger,migrationDir,phase,versions,baseline);
} finally {fs.rmSync(permissionHistoryTemp,{recursive:true,force:true});}
for(const name of ['finance_personal_history_permission_preflight.sql',
  'finance_personal_history_permission_postflight.sql',
  'finance_personal_history_permission_fingerprint.sql',
  'finance_personal_history_permission_canary.sql',
  'finance_approval_history_summary_permission_postflight.sql',
  'finance_approval_history_permission_postflight.sql',
  'finance_amount_search_permission_postflight.sql',
  'finance_approval_search_permission_postflight.sql',
  'finance_approval_search_permission_canary.sql']){
  for(const checker of ['check_release_artifact.js','check_release_source_integrity.js'])
    assert.ok(fs.readFileSync(path.join(root,'scripts',checker),'utf8').includes("'scripts/"+name+"'"),
      'personal history permission SQL gate must be source-sealed: '+name);
  assert.ok(workflow.includes('scripts/'+name),
    'personal history permission SQL gate must be in the verified bundle: '+name);
}
for(const checker of ['check_release_artifact.js','check_release_source_integrity.js'])
  assert.ok(fs.readFileSync(path.join(root,'scripts',checker),'utf8').includes(
    "'supabase/migrations/20261008090000_finance_personal_history_permission_guard_v1.sql'"),
    'personal history permission migration must be source-sealed');
for(const name of ['finance_personal_history_preflight.sql','finance_personal_history_postflight.sql',
  'finance_personal_history_fingerprint.sql','finance_personal_history_canary.sql']){
  for(const checker of ['check_release_artifact.js','check_release_source_integrity.js'])
    assert.ok(fs.readFileSync(path.join(root,'scripts',checker),'utf8').includes("'scripts/"+name+"'"),
      'personal document history SQL gate must be source-sealed: '+name);
  assert.ok(workflow.includes('scripts/'+name), 'personal document history SQL gate must be in the verified bundle: '+name);
}
for(const checker of ['check_release_artifact.js','check_release_source_integrity.js'])
  assert.ok(fs.readFileSync(path.join(root,'scripts',checker),'utf8').includes("'supabase/migrations/20261008055528_finance_personal_document_history_v1.sql'"),
    'personal document history migration must be source-sealed');
const billBatchBulkTemp=fs.mkdtempSync(path.join(os.tmpdir(),'finance-bill-batch-bulk-release-'));
try {
  const migrationDir=path.join(root,'supabase/migrations');
  const prior=['20260825000000',...guard.REVIEWED_MIGRATION_CATALOG.filter(version=>version<guard.BILL_BATCH_BULK_MIGRATIONS[0])];
  const baseline={count:1,lastVersion:prior[0],sha256:guard.ledgerSha256([prior[0]])};
  const ledger=path.join(billBatchBulkTemp,'ledger.txt');
  const phase=guard.RELEASE_PHASE_DATABASE_BILL_BATCH_BULK;
  const versions=guard.BILL_BATCH_BULK_MIGRATIONS.join(',');
  const scripts=name=>path.join(root,'scripts',name);
  const canary=fs.readFileSync(scripts('finance_bill_batch_bulk_canary.sql'),'utf8');
  assert.doesNotMatch(canary,/^\s*\\(?:set|i|include)\b/m,'the direct Supabase CLI canary must contain SQL only');
  assert.match(canary,/begin isolation level repeatable read read only;[\s\S]+FINANCE_BILL_BATCH_BULK_CANARY_ROLLED_BACK/);
  assert.match(fs.readFileSync(scripts('finance_bill_batch_bulk_preflight.sql'),'utf8'),
    /version='20261008055528'[\s\S]+name='finance_personal_document_history_v1'/,
    'bill batch phase must follow the applied personal history migration');
  assert.match(fs.readFileSync(scripts('finance_bill_batch_bulk_preflight.sql'),'utf8'),
    /version='20261008090000'[\s\S]+name='finance_personal_history_permission_guard_v1'/,
    'bill batch phase must follow the applied personal history permission hotfix');
  fs.writeFileSync(ledger,prior.join('\n')+'\n');
  assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'pending');
  const rehearsal=path.join(billBatchBulkTemp,'rehearsal.sql');
  guard.prepareBillBatchBulkRehearsal(migrationDir,rehearsal,versions,ledger,
    scripts('finance_bill_batch_bulk_fingerprint.sql'),scripts('finance_bill_batch_bulk_canary.sql'),
    scripts('finance_bill_batch_bulk_preflight.sql'),scripts('finance_bill_batch_bulk_postflight.sql'),baseline);
  assert.match(fs.readFileSync(rehearsal,'utf8'),/FINANCE_BILL_BATCH_BULK_PREFLIGHT_OK[\s\S]+savepoint finance_release_migration;[\s\S]+insert into supabase_migrations\.schema_migrations\(version,statements,name,created_by\)[\s\S]+FINANCE_BILL_BATCH_BULK_POSTFLIGHT_OK[\s\S]+rollback to savepoint finance_release_migration;[\s\S]+bill batch bulk rollback rehearsal changed schema fingerprints/);
  const apply=path.join(billBatchBulkTemp,'apply.sql');
  guard.prepareAuditBatchApply(migrationDir,apply,versions,ledger,
    scripts('finance_bill_batch_bulk_postflight.sql'),baseline,phase);
  assert.match(fs.readFileSync(apply,'utf8'),/CREATE OR REPLACE FUNCTION public\.finance_submit_bill_batch[\s\S]+insert into supabase_migrations\.schema_migrations[\s\S]+FINANCE_BILL_BATCH_BULK_POSTFLIGHT_OK[\s\S]+commit;/);
  const gate=path.join(billBatchBulkTemp,'postflight.sql');
  guard.preparePhaseQuery(scripts('finance_bill_batch_bulk_postflight.sql'),gate,phase,versions);
  assert.match(fs.readFileSync(gate,'utf8'),/^begin read only;[\s\S]+FINANCE_BILL_BATCH_BULK_POSTFLIGHT_OK[\s\S]+rollback;/);
  assert.throws(()=>guard.preparePhaseQuery(scripts('finance_invoice_item_bind_postflight.sql'),
    path.join(billBatchBulkTemp,'wrong-postflight.sql'),phase,versions),/exact sealed postflight/);
  const tampered=path.join(billBatchBulkTemp,'tampered');fs.mkdirSync(tampered);
  fs.writeFileSync(path.join(tampered,'20261008100000_finance_bill_batch_bulk_insert_v1.sql'),
    fs.readFileSync(path.join(migrationDir,'20261008100000_finance_bill_batch_bulk_insert_v1.sql'),'utf8')+'\n-- tampered\n');
  assert.throws(()=>guard.readAuditBatch(tampered,versions,phase),/sealed SHA256/);
  fs.appendFileSync(ledger,versions+'\n');
  assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'applied');
  assert.throws(()=>guard.verifyLedger('pre',ledger,migrationDir,phase,versions,baseline),/must be pending/);
  guard.verifyLedger('post',ledger,migrationDir,phase,versions,baseline);
} finally {fs.rmSync(billBatchBulkTemp,{recursive:true,force:true});}
const identityOnceTemp=fs.mkdtempSync(path.join(os.tmpdir(),'finance-personal-history-identity-once-release-'));
try {
  const directory=path.join(root,'supabase/migrations'),phase=guard.RELEASE_PHASE_DATABASE_PERSONAL_HISTORY_IDENTITY_ONCE;
  const versions=guard.PERSONAL_HISTORY_IDENTITY_ONCE_MIGRATIONS.join(',');
  assert.equal(phase,'database_personal_history_identity_once_20261012');
  assert.deepEqual(guard.PERSONAL_HISTORY_IDENTITY_ONCE_MIGRATIONS,['20261012112652']);
  guard.validateTarget(exactEnvironment,'a'.repeat(40),phase,versions,catalog.supabaseProjectRef);
  assert.throws(()=>guard.validateTarget(exactEnvironment,'a'.repeat(40),phase,'none',catalog.supabaseProjectRef),/must use/);
  const prior=['20260825103034',...guard.REVIEWED_MIGRATION_CATALOG.filter(v=>v<versions)];
  const baseline={count:1,lastVersion:prior[0],sha256:guard.ledgerSha256([prior[0]])};
  const scripts=name=>path.join(root,'scripts',name);
  const ledger=path.join(identityOnceTemp,'ledger.txt');
  fs.writeFileSync(ledger,prior.join('\n')+'\n');
  assert.equal(guard.classifyLedger(ledger,directory,phase,versions,baseline),'pending');
  const sealed=guard.readAuditBatch(directory,versions,phase);assert.equal(sealed.length,1);
  const rehearsal=path.join(identityOnceTemp,'rehearsal.sql');
  guard.preparePersonalHistoryIdentityOnceRehearsal(directory,rehearsal,versions,ledger,
    scripts('finance_personal_history_identity_once_fingerprint.sql'),
    scripts('finance_personal_history_identity_once_canary.sql'),
    scripts('finance_personal_history_identity_once_preflight.sql'),
    scripts('finance_personal_history_identity_once_postflight.sql'),baseline);
  const rehearsed=fs.readFileSync(rehearsal,'utf8');
  let orderedAt=-1;
  for(const marker of ['begin isolation level repeatable read;','pg_advisory_xact_lock','finance_release_fingerprint_before','savepoint finance_release_migration;','CREATE OR REPLACE FUNCTION private.finance_personal_document_authorized_v1','insert into supabase_migrations.schema_migrations','FINANCE_PERSONAL_HISTORY_IDENTITY_ONCE_POSTFLIGHT_OK','history_identity_once_anonymous','rollback to savepoint finance_release_migration;','finance_release_fingerprint_after']){const found=rehearsed.indexOf(marker,orderedAt+1);assert(found>orderedAt,'actual migration rehearsal order: '+marker);orderedAt=found;}
  assert(rehearsed.trimEnd().endsWith('rollback;'));
  const apply=path.join(identityOnceTemp,'apply.sql');
  guard.prepareAuditBatchApply(directory,apply,versions,ledger,scripts('finance_personal_history_identity_once_postflight.sql'),baseline,phase);
  const applied=fs.readFileSync(apply,'utf8');orderedAt=-1;
  for(const marker of ['finance_personal_document_authorized_v1','insert into supabase_migrations.schema_migrations','FINANCE_PERSONAL_HISTORY_IDENTITY_ONCE_POSTFLIGHT_OK']){const found=applied.indexOf(marker,orderedAt+1);assert(found>orderedAt);orderedAt=found;}
  assert(applied.trimEnd().endsWith('commit;'));
  const gate=path.join(identityOnceTemp,'gate.sql');guard.preparePhaseQuery(scripts('finance_personal_history_identity_once_postflight.sql'),gate,phase,versions);
  assert.match(fs.readFileSync(gate,'utf8'),/^begin read only;[\s\S]+FINANCE_PERSONAL_HISTORY_IDENTITY_ONCE_POSTFLIGHT_OK[\s\S]+rollback;/);
  assert.throws(()=>guard.preparePhaseQuery(scripts('finance_production_db_postflight.sql'),path.join(identityOnceTemp,'wrong.sql'),phase,versions),/exact sealed postflight/);
  const canary=path.join(identityOnceTemp,'canary.json');
  const result={canary:'readonly_personal_history_identity_once_v1',ok:true,rolled_back:true,identity_scope_preserved:true,permission_guard_preserved:true,live_latency_proven:false};
  fs.writeFileSync(canary,JSON.stringify([{personal_history_identity_once_canary_result:result}]));assert(guard.verifyReportsCanary(canary,'personal_history_identity_once'));
  for(const key of ['rolled_back','identity_scope_preserved','permission_guard_preserved','live_latency_proven']){
    fs.writeFileSync(canary,JSON.stringify([{personal_history_identity_once_canary_result:{...result,[key]:!result[key]}}]));
    assert.throws(()=>guard.verifyReportsCanary(canary,'personal_history_identity_once'));
  }
  const tampered=path.join(identityOnceTemp,'tampered');fs.mkdirSync(tampered);fs.writeFileSync(path.join(tampered,sealed[0].filename),sealed[0].source+'\n-- tamper\n');
  assert.throws(()=>guard.readAuditBatch(tampered,versions,phase),/sealed SHA256/);
  fs.appendFileSync(ledger,versions+'\n');assert.equal(guard.classifyLedger(ledger,directory,phase,versions,baseline),'applied');
  guard.verifyLedger('post',ledger,directory,phase,versions,baseline);
} finally {fs.rmSync(identityOnceTemp,{recursive:true,force:true});}
const invoiceBatchApprovalTemp=fs.mkdtempSync(path.join(os.tmpdir(),'finance-invoice-batch-approval-release-'));
try {
  const migrationDir=path.join(root,'supabase/migrations');
  const phase=guard.RELEASE_PHASE_DATABASE_INVOICE_BATCH_APPROVAL;
  const versions=guard.INVOICE_BATCH_APPROVAL_MIGRATIONS.join(',');
  const prior=['20260825000000',...guard.REVIEWED_MIGRATION_CATALOG.filter(version=>version<guard.INVOICE_BATCH_APPROVAL_MIGRATIONS[0])];
  const baseline={count:1,lastVersion:prior[0],sha256:guard.ledgerSha256([prior[0]])};
  const ledger=path.join(invoiceBatchApprovalTemp,'ledger.txt');
  const scripts=name=>path.join(root,'scripts',name);
  const canary=fs.readFileSync(scripts('finance_invoice_batch_approval_canary.sql'),'utf8');
  assert.doesNotMatch(canary,/^\s*\\(?:set|i|include)\b/m,'the direct invoice batch canary must contain SQL only');
  assert.match(canary,/begin isolation level repeatable read read only;[\s\S]+FINANCE_INVOICE_BATCH_APPROVAL_CANARY_ROLLED_BACK/);
  const canaryOutput=path.join(invoiceBatchApprovalTemp,'canary.json');
  const expectedCanary={canary:'readonly_invoice_batch_approval_notification_v1',ok:true,rolled_back:true,authority_preserved:true};
  fs.writeFileSync(canaryOutput,JSON.stringify([{invoice_batch_approval_canary_result:expectedCanary}]));
  assert.equal(guard.verifyReportsCanary(canaryOutput,'invoice_batch_approval'),true);
  fs.writeFileSync(canaryOutput,JSON.stringify([{invoice_batch_approval_canary_result:{...expectedCanary,authority_preserved:false}}]));
  assert.throws(()=>guard.verifyReportsCanary(canaryOutput,'invoice_batch_approval'),/did not complete safely/);
  fs.writeFileSync(ledger,prior.join('\n')+'\n');
  assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'pending');
  const sealed=guard.readAuditBatch(migrationDir,versions,phase);
  assert.deepEqual(sealed.map(item=>item.version),guard.INVOICE_BATCH_APPROVAL_MIGRATIONS);
  const rehearsal=path.join(invoiceBatchApprovalTemp,'rehearsal.sql');
  guard.prepareBillBatchBulkRehearsal(migrationDir,rehearsal,versions,ledger,
    scripts('finance_invoice_batch_approval_fingerprint.sql'),
    scripts('finance_invoice_batch_approval_canary.sql'),
    scripts('finance_invoice_batch_approval_preflight.sql'),
    scripts('finance_invoice_batch_approval_postflight.sql'),baseline,phase);
  const rehearsed=fs.readFileSync(rehearsal,'utf8');
  assert.match(rehearsed,/FINANCE_INVOICE_BATCH_APPROVAL_PREFLIGHT_OK[\s\S]+savepoint finance_release_migration;[\s\S]+FINANCE_INVOICE_BATCH_APPROVAL_POSTFLIGHT_OK[\s\S]+rollback to savepoint finance_release_migration;[\s\S]+invoice batch approval rollback rehearsal changed schema fingerprints/);
  assert.equal((rehearsed.match(/insert into supabase_migrations\.schema_migrations\(version,statements,name,created_by\)/g)||[]).length,2,
    'the rehearsal must include both reviewed migration ledger entries');
  assert.match(rehearsed,/20261010120000[\s\S]+20261010130000/,'the two migrations must rehearse in version order');
  const apply=path.join(invoiceBatchApprovalTemp,'apply.sql');
  guard.prepareAuditBatchApply(migrationDir,apply,versions,ledger,
    scripts('finance_invoice_batch_approval_postflight.sql'),baseline,phase);
  const appliedSql=fs.readFileSync(apply,'utf8');
  assert.match(appliedSql,/finance_refresh_invoice_batch_approval_notification_v1[\s\S]+insert into supabase_migrations\.schema_migrations\(version,statements,name,created_by\) values \('20261010120000'[\s\S]+finance_personal_document_summary_v1[\s\S]+insert into supabase_migrations\.schema_migrations\(version,statements,name,created_by\) values \('20261010130000'[\s\S]+FINANCE_INVOICE_BATCH_APPROVAL_POSTFLIGHT_OK[\s\S]+commit;/,
    'notification and history migrations must apply atomically in order with the exact postflight');
  const gate=path.join(invoiceBatchApprovalTemp,'postflight.sql');
  guard.preparePhaseQuery(scripts('finance_invoice_batch_approval_postflight.sql'),gate,phase,versions);
  assert.match(fs.readFileSync(gate,'utf8'),/^begin read only;[\s\S]+FINANCE_INVOICE_BATCH_APPROVAL_POSTFLIGHT_OK[\s\S]+rollback;/);
  assert.throws(()=>guard.preparePhaseQuery(scripts('finance_production_db_postflight.sql'),
    path.join(invoiceBatchApprovalTemp,'wrong-postflight.sql'),phase,versions),/exact sealed postflight/);
  for(const target of sealed){
    const tampered=path.join(invoiceBatchApprovalTemp,'tampered-'+target.version);fs.mkdirSync(tampered);
    for(const item of sealed){
      fs.writeFileSync(path.join(tampered,item.filename),item.source+(item.version===target.version?'\n-- tampered\n':''));
    }
    assert.throws(()=>guard.readAuditBatch(tampered,versions,phase),/sealed SHA256/);
  }
  fs.appendFileSync(ledger,guard.INVOICE_BATCH_APPROVAL_MIGRATIONS[0]+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),/partially installed/);
  fs.appendFileSync(ledger,guard.INVOICE_BATCH_APPROVAL_MIGRATIONS[1]+'\n');
  assert.equal(guard.classifyLedger(ledger,migrationDir,phase,versions,baseline),'applied');
  assert.throws(()=>guard.verifyLedger('pre',ledger,migrationDir,phase,versions,baseline),/must be pending/);
  guard.verifyLedger('post',ledger,migrationDir,phase,versions,baseline);
} finally {fs.rmSync(invoiceBatchApprovalTemp,{recursive:true,force:true});}
for(const name of ['finance_invoice_batch_approval_preflight.sql','finance_invoice_batch_approval_postflight.sql',
  'finance_invoice_batch_approval_fingerprint.sql','finance_invoice_batch_approval_canary.sql']){
  for(const checker of ['check_release_artifact.js','check_release_source_integrity.js'])
    assert.ok(fs.readFileSync(path.join(root,'scripts',checker),'utf8').includes("'scripts/"+name+"'"),
      'invoice batch approval SQL gate must be source-sealed: '+name);
  assert.ok(workflow.includes('scripts/'+name),'invoice batch approval SQL gate must be in the verified bundle: '+name);
}
for(const filename of ['20261010120000_finance_invoice_batch_approval_notification_v1.sql',
  '20261010130000_finance_personal_invoice_batch_history_v1.sql']){
  for(const checker of ['check_release_artifact.js','check_release_source_integrity.js'])
    assert.ok(fs.readFileSync(path.join(root,'scripts',checker),'utf8').includes("'supabase/migrations/"+filename+"'"),
      'invoice batch approval migration must be source-sealed: '+filename);
}
for(const name of ['check_bill_batch_bulk_insert_20261008.cjs','fixtures/finance_bill_batch_live_before_20261008.sql','finance_bill_batch_bulk_preflight.sql',
  'finance_bill_batch_bulk_postflight.sql','finance_bill_batch_bulk_fingerprint.sql',
  'finance_bill_batch_bulk_canary.sql']){
  for(const checker of ['check_release_artifact.js','check_release_source_integrity.js'])
    assert.ok(fs.readFileSync(path.join(root,'scripts',checker),'utf8').includes("'scripts/"+name+"'"),
      'bill batch bulk release source must be sealed: '+name);
}
for(const name of ['finance_bill_batch_bulk_preflight.sql','finance_bill_batch_bulk_postflight.sql',
  'finance_bill_batch_bulk_fingerprint.sql','finance_bill_batch_bulk_canary.sql'])
  assert.ok(workflow.includes('scripts/'+name), 'bill batch bulk SQL gate must be in the verified bundle: '+name);
for(const name of ['check_invoice_item_manual_binding_sql.cjs','finance_invoice_item_bind_preflight.sql',
  'finance_invoice_item_bind_postflight.sql','finance_invoice_item_bind_fingerprint.sql',
  'finance_invoice_item_bind_canary.sql']){
  for(const checker of ['check_release_artifact.js','check_release_source_integrity.js'])
    assert.ok(fs.readFileSync(path.join(root,'scripts',checker),'utf8').includes("'scripts/"+name+"'"),
      'invoice item binding release source must be sealed: '+name);
}
for(const name of ['finance_invoice_item_bind_preflight.sql','finance_invoice_item_bind_postflight.sql',
  'finance_invoice_item_bind_fingerprint.sql','finance_invoice_item_bind_canary.sql'])
  assert.ok(workflow.includes('scripts/'+name), 'invoice item binding SQL gate must be in the verified bundle: '+name);
for(const name of ['check_purchase_final_amount_contract.js','finance_purchase_final_amount_preflight.sql',
  'finance_purchase_final_amount_postflight.sql','finance_purchase_final_amount_fingerprint.sql',
  'finance_purchase_final_amount_canary.sql']){
  for(const checker of ['check_release_artifact.js','check_release_source_integrity.js'])
    assert.ok(fs.readFileSync(path.join(root,'scripts',checker),'utf8').includes("'scripts/"+name+"'"),
      'purchase final amount release source must be sealed: '+name);
}
for(const name of ['finance_purchase_final_amount_preflight.sql','finance_purchase_final_amount_postflight.sql',
  'finance_purchase_final_amount_fingerprint.sql','finance_purchase_final_amount_canary.sql'])
  assert.ok(workflow.includes('scripts/'+name), 'purchase final amount SQL gate must be in the verified bundle: '+name);
assert.deepEqual(guard.REPORT_POSTFLIGHT_FILES,['finance_production_db_postflight.sql','finance_audit_20260907_postflight.sql','finance_finalize_accounting_lines_postflight.sql','finance_utility_tax_postflight.sql','finance_production_human_accounting_canary.sql','finance_canonical_receivables_postflight.sql','finance_reporting_profiles_postflight.sql'],'Reports must retain every inherited/new postflight in its transaction');
for(const name of guard.REPORT_POSTFLIGHT_FILES){assert.ok(workflow.includes('cp scripts/'+name+' "$BUNDLE/release-tools/scripts/"'),'Every reports transaction check must be sealed: '+name);for(const checker of ['check_release_artifact.js','check_release_source_integrity.js'])assert.ok(fs.readFileSync(path.join(root,'scripts',checker),'utf8').includes("'scripts/"+name+"'"),'Reports postflight must be source-pinned: '+name);}
assert.deepEqual([...workflow.matchAll(/^          - (frontend_compat|database_\S+)$/gm)].map(match=>match[1]), ['frontend_compat','database_audit_security_20260922','database_revenue_repair_20260924','database_operational_stability_20260924','database_demo_password_retirement_20260925','database_audit_controls_20260927','database_hr_contractor_20260928','database_portal_session_20260928','database_external_labor_20260928','database_attachment_claim_20261001','database_human_float_20261002','database_income_reconcile_20261002','database_invoice_revenue_result_20261002','database_purchase_final_amount_20261006','database_invoice_item_bind_20261008','database_personal_history_20261008','database_personal_history_permission_20261008','database_bill_batch_bulk_20261008','database_invoice_batch_approval_20261010','database_personal_history_identity_once_20261012','database_personal_bill_batch_history_20261013','database_invoice_batch_bulk_20261014','database_bill_approval_bulk_20261015','database_bounded_global_logout_20261014'], 'Only reviewed current phases may be dispatched');
const releaseGuide = fs.readFileSync(path.join(root, 'docs/FINANCE_PRODUCTION_RELEASE.md'), 'utf8');
const required = [
  'actions: read',
  'environment:\n      name: finance-production',
  'ref: main',
  'test "$GITHUB_SHA" = "$CANDIDATE_SHA"',
  'test "$(git rev-parse main)" = "$CANDIDATE_SHA"',
  'release_phase:',
  'RELEASE_CONFIRMATION: ${{ inputs.confirmation }}',
  'test "$RELEASE_CONFIRMATION" = "PROMOTE FINANCE PRODUCTION"',
  '--release-phase "$RELEASE_PHASE"',
  'pnpm release:preflight',
  'vercel@59.3.0 build --prod --standalone',
  'deploy --prebuilt --prod --skip-domain',
  '--meta "financeCandidateSha=$CANDIDATE_SHA"',
  '/v13/deployments/${DEPLOYMENT_HOST}?teamId=${VERCEL_ORG_ID}',
  '/v9/projects/${VERCEL_PROJECT_ID}/domains?teamId=${VERCEL_ORG_ID}',
  'verify-vercel-target',
  'verify-frontend-contract',
  'verify-production-baseline',
  'SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}',
  'supabase link --project-ref "$FINANCE_PRODUCTION_SUPABASE_PROJECT_REF"',
  'verify-supabase-public-key',
  '/auth/v1/settings',
  'external?.google!==true',
  '/rest/v1/finance_users?select=id&limit=1',
  'finance_production_authenticated_canary.sql',
  'finance_production_human_accounting_canary.sql',
  'authenticated-canary-before.json',
  'authenticated-canary-after.json',
  'promotion-authenticated-canary.json',
  'verify-authenticated-canary',
  'finance_production_db_preflight.sql',
  'supabase db query --linked --output csv',
  'prepare-rehearsal',
  '--authenticated-canary "$TOOLS/scripts/finance_production_authenticated_canary.sql"',
  'prepare-apply',
  'finance_production_db_fingerprint.sql',
  '--fingerprint "$TOOLS/scripts/finance_production_db_fingerprint.sql"',
  '--ledger "$LEDGER"',
  'production-immediately-before-db-contract-manifest.json',
  'production-immediately-before-db-contract-index.html',
  'finance_production_db_postflight.sql',
  'create-receipt',
  'verify-receipt',
  'cp supabase/migrations/*.sql "$BUNDLE/release-tools/supabase/migrations/"',
  '-name "${MIGRATION_VERSIONS}_*.sql"',
  'finance-verified-candidate-${{ inputs.candidate_sha }}',
  'EXPECTED_DEPLOYMENT_ID: ${{ needs.candidate.outputs.deployment_id }}',
  'EXPECTED_MANIFEST_SHA256: ${{ needs.candidate.outputs.manifest_sha256 }}',
  'PHASE_STATE="$(node "$GUARD" classify-ledger',
  'if test "$PHASE_STATE" = "compat" && test "$RELEASE_PHASE" = "frontend_compat"; then',
  'elif test "$PHASE_STATE" = "pending" && { test "$RELEASE_PHASE" = "database_v3" || test "$RELEASE_PHASE" = "database_human_accounting"; }; then',
  'elif test "$PHASE_STATE" = "applied" && { test "$RELEASE_PHASE" = "database_personal_history_permission_20261008" || test "$RELEASE_PHASE" = "database_personal_history_20261008" || test "$RELEASE_PHASE" = "database_invoice_item_bind_20261008" || test "$RELEASE_PHASE" = "database_purchase_final_amount_20261006" || test "$RELEASE_PHASE" = "database_invoice_revenue_result_20261002" || test "$RELEASE_PHASE" = "database_income_reconcile_20261002" || test "$RELEASE_PHASE" = "database_human_float_20261002" || test "$RELEASE_PHASE" = "database_v3" || test "$RELEASE_PHASE" = "database_human_accounting" || test "$RELEASE_PHASE" = "database_audit_20260907" || test "$RELEASE_PHASE" = "database_cases_20260908" || test "$RELEASE_PHASE" = "database_utility_tax_20260909" || test "$RELEASE_PHASE" = "database_reports_20260910" || test "$RELEASE_PHASE" = "database_amount_search_20260910" || test "$RELEASE_PHASE" = "database_reporting_integrity_20260911" || test "$RELEASE_PHASE" = "database_audit_readiness_20260911" || test "$RELEASE_PHASE" = "database_employee_reliability_20260912" || test "$RELEASE_PHASE" = "database_history_performance_20260913" || test "$RELEASE_PHASE" = "database_read_latency_20260913" || test "$RELEASE_PHASE" = "database_ar_mapping_20260913" || test "$RELEASE_PHASE" = "database_audit_remediation_20260914" || test "$RELEASE_PHASE" = "database_approval_search_20260914" || test "$RELEASE_PHASE" = "database_history_summary_20260915" || test "$RELEASE_PHASE" = "database_invoice_read_scope_20260915" || test "$RELEASE_PHASE" = "database_audit_security_20260922" || test "$RELEASE_PHASE" = "database_revenue_repair_20260924" || test "$RELEASE_PHASE" = "database_operational_stability_20260924" || test "$RELEASE_PHASE" = "database_demo_password_retirement_20260925" || test "$RELEASE_PHASE" = "database_hr_contractor_20260928" || test "$RELEASE_PHASE" = "database_portal_session_20260928" || test "$RELEASE_PHASE" = "database_external_labor_20260928" || test "$RELEASE_PHASE" = "database_attachment_claim_20261001" || test "$RELEASE_PHASE" = "database_audit_controls_20260927" || test "$RELEASE_PHASE" = "database_hr_bridge_20260922" || test "$RELEASE_PHASE" = "database_ar_read_scope_20260922" || test "$RELEASE_PHASE" = "database_bill_batch_bulk_20261008" || test "$RELEASE_PHASE" = "database_invoice_batch_approval_20261010" || test "$RELEASE_PHASE" = "database_personal_history_identity_once_20261012" || test "$RELEASE_PHASE" = "database_personal_bill_batch_history_20261013" || test "$RELEASE_PHASE" = "database_invoice_batch_bulk_20261014" || test "$RELEASE_PHASE" = "database_bounded_global_logout_20261014" || test "$RELEASE_PHASE" = "database_bill_approval_bulk_20261015"; }; then',
  '--allow-production-alias true',
  'for ATTEMPT in 1 2 3',
  'promote "$DEPLOYMENT_URL" --yes',
  'verify-promotion',
  '/v4/aliases/${FINANCE_PRODUCTION_DOMAIN}?teamId=${VERCEL_ORG_ID}',
  '--production-alias-json "$RUNNER_TEMP/production-alias.json"'
];
for (const marker of required) assert.ok(workflow.includes(marker), `workflow missing ${marker}`);
assert.ok(releaseGuide.includes('缺少該欄位的舊分頁一律以 `55000` 要求重新整理'));
assert.ok(releaseGuide.includes('已完成的歷史簽核人與已移除的舊金額關卡保持不可變'));
assert.ok(releaseGuide.includes('`frontend_compat` | `none`'));
assert.ok(releaseGuide.includes('`database_audit_20260907` | `'+guard.AUDIT_MIGRATIONS.join(',')+'`'));
assert.ok(releaseGuide.includes('歷史紀錄：`database_v3`（此版本不接受 dispatch）'));
assert.ok(releaseGuide.includes('歷史紀錄：`database_human_accounting`（此版本不接受 dispatch）'));
assert.ok(releaseGuide.includes('20260828015718_repair_admin_ntpc_portal_employee_link_20260828'));
assert.ok(releaseGuide.includes('20260901073241_assign_ceo_cashier_and_reassign_pending_cashier'));
assert.ok(releaseGuide.includes('目前只接受 `applied` recovery 路徑'));
assert.ok(releaseGuide.includes('不宣稱或依賴未比較的 artifact digest'));
assert.ok(!releaseGuide.includes('## 四種 migration phase'));
assert.doesNotMatch(releaseGuide, /相容前端仍可一次性送件|保持舊前端一次性送件相容/);
assert.ok(!workflow.includes('git fetch'), 'private-repository release must not fetch after checkout');
assert.ok(!workflow.includes('ref: ${{ inputs.candidate_sha }}'), 'private-repository checkout must resolve protected main itself');
assert.ok(!workflow.includes('continue-on-error'));
{
  const lines = workflow.split(/\r?\n/);
  const runLines = [];
  let runIndent = null;
  for (const line of lines) {
    const run = line.match(/^(\s*)run:\s*\|\s*$/);
    if (run) {
      runIndent = run[1].length;
      continue;
    }
    if (runIndent === null) continue;
    const indent = (line.match(/^\s*/) || [''])[0].length;
    if (line.trim() && indent <= runIndent) {
      runIndent = null;
      continue;
    }
    runLines.push(line);
  }
  assert.doesNotMatch(
    runLines.join('\n'),
    /\$\{\{\s*inputs\./,
    'workflow dispatch inputs must enter shell steps only through environment variables'
  );
}
assert.ok(!workflow.includes('artifact_digest') && !workflow.includes('EXPECTED_ARTIFACT_DIGEST'), 'workflow must not claim to verify an artifact digest it never compares');
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
assert.match(candidateJob, /pnpm release:preflight[\s\S]+vercel@59\.3\.0 build --prod --standalone[\s\S]+pnpm release:verify-artifact[\s\S]+deploy --prebuilt --prod --skip-domain[\s\S]+verify-frontend-contract[\s\S]+verify-vercel-target[\s\S]+create-receipt[\s\S]+upload-artifact/);
assert.match(candidateJob, /frontend-app-path[\s\S]+candidate-app\.js[\s\S]+cmp -s "www\/\$APP_ASSET_PATH" "\$RUNNER_TEMP\/candidate-app\.js"[\s\S]+cp "\$RUNNER_TEMP\/candidate-app\.js" "\$BUNDLE\/candidate-app\.js"/, 'candidate must read back the exact deployed app asset and seal its bytes');
assert.doesNotMatch(candidateJob, /supabase db push|vercel@59\.3\.0 promote/);
assert.match(databaseJob, /needs: candidate/);
assert.match(databaseJob, /download-artifact[\s\S]+validate-target[\s\S]+supabase link[\s\S]+verify-receipt[\s\S]+verify-candidate[\s\S]+verify-frontend-contract[\s\S]+verify-vercel-target[\s\S]+classify-ledger/);
assert.doesNotMatch(databaseJob, /vercel@59\.3\.0 (?:build|deploy|promote)/, 'database job must consume the sealed candidate without rebuilding or promoting it');
assert.match(promoteJob, /needs: \[candidate, database\]/);
assert.match(promoteJob, /download-artifact[\s\S]+validate-target[\s\S]+supabase link[\s\S]+verify-receipt[\s\S]+finance_production_db_postflight\.sql[\s\S]+promote "\$DEPLOYMENT_URL" --yes[\s\S]+verify-promotion[\s\S]+verify-frontend-contract/);
assert.match(promoteJob, /frontend-app-path[\s\S]+production-app\.js[\s\S]+cmp -s "\$BUNDLE\/candidate-app\.js" "\$RUNNER_TEMP\/production-app\.js"/, 'production alias must serve the sealed app bytes');
assert.doesNotMatch(promoteJob, /vercel@59\.3\.0 (?:build|deploy)|prepare-apply/, 'retryable promote job must not rebuild, redeploy or reapply DB migrations');
const compatAt = databaseJob.indexOf('if test "$PHASE_STATE" = "compat" && test "$RELEASE_PHASE" = "frontend_compat"; then');
const pendingAt = databaseJob.indexOf('elif test "$PHASE_STATE" = "pending" && { test "$RELEASE_PHASE" = "database_v3" || test "$RELEASE_PHASE" = "database_human_accounting"; }; then');
const appliedAt = databaseJob.indexOf('elif test "$PHASE_STATE" = "applied" && { test "$RELEASE_PHASE" = "database_personal_history_permission_20261008" || test "$RELEASE_PHASE" = "database_personal_history_20261008" || test "$RELEASE_PHASE" = "database_invoice_item_bind_20261008" || test "$RELEASE_PHASE" = "database_purchase_final_amount_20261006"');
const auditPendingAt=databaseJob.indexOf('elif test "$PHASE_STATE" = "pending" && test "$RELEASE_PHASE" = "database_audit_20260907"; then');
assert.ok(auditPendingAt>compatAt&&auditPendingAt<pendingAt);
assert.ok(databaseJob.indexOf('prepare-audit-rehearsal')>auditPendingAt);
assert.ok(databaseJob.indexOf('prepare-audit-apply')>databaseJob.indexOf('audit-rehearsal.json'));
assert.ok(databaseJob.indexOf('prepare-audit-apply')<pendingAt);
assert.doesNotMatch(promoteJob,/prepare-audit-apply/);
const casesPendingAt=databaseJob.indexOf('elif test "$PHASE_STATE" = "pending" && test "$RELEASE_PHASE" = "database_cases_20260908"; then');
assert.ok(casesPendingAt>compatAt&&casesPendingAt<auditPendingAt);
const utilityPendingAt=databaseJob.indexOf('elif test "$PHASE_STATE" = "pending" && test "$RELEASE_PHASE" = "database_utility_tax_20260909"; then');
assert.ok(utilityPendingAt>compatAt&&utilityPendingAt<casesPendingAt);
const utilityBranch=databaseJob.slice(utilityPendingAt,casesPendingAt);
assert.match(utilityBranch,/finance-utility-prerequisites[\s\S]+--release-phase database_cases_20260908 --migration-versions 20260908065050[\s\S]+utility-prerequisites\.json[\s\S]+prepare-utility-rehearsal[\s\S]+finance_cases_20260908_fingerprint\.sql[\s\S]+finance_production_authenticated_canary\.sql[\s\S]+finance_finalize_accounting_lines_canary\.sql[\s\S]+finance_utility_tax_canary\.sql[\s\S]+finance_utility_tax_postflight\.sql[\s\S]+utility-rehearsal\.json[\s\S]+prepare-utility-apply[\s\S]+--ledger "\$LEDGER"[\s\S]+finance_utility_tax_postflight\.sql[\s\S]+utility-apply\.json/);
const reportsPendingAt=databaseJob.indexOf('elif test "$PHASE_STATE" = "pending" && test "$RELEASE_PHASE" = "database_reports_20260910"; then');
assert.ok(reportsPendingAt>compatAt&&reportsPendingAt<utilityPendingAt);
const amountPendingAt=databaseJob.indexOf('elif test "$PHASE_STATE" = "pending" && test "$RELEASE_PHASE" = "database_amount_search_20260910"; then');
assert.ok(amountPendingAt>compatAt&&amountPendingAt<reportsPendingAt);
const amountBranch=databaseJob.slice(amountPendingAt,reportsPendingAt);
const integrityPendingAt=databaseJob.indexOf('elif test "$PHASE_STATE" = "pending" && test "$RELEASE_PHASE" = "database_reporting_integrity_20260911"; then');
assert.ok(integrityPendingAt>compatAt&&integrityPendingAt<amountPendingAt);
const integrityBranch=databaseJob.slice(integrityPendingAt,amountPendingAt);
const readinessPendingAt=databaseJob.indexOf('elif test "$PHASE_STATE" = "pending" && test "$RELEASE_PHASE" = "database_audit_readiness_20260911"; then');
assert.ok(readinessPendingAt>compatAt&&readinessPendingAt<integrityPendingAt);
const readinessBranch=databaseJob.slice(readinessPendingAt,integrityPendingAt);
const employeePendingAt=databaseJob.indexOf('elif test "$PHASE_STATE" = "pending" && test "$RELEASE_PHASE" = "database_employee_reliability_20260912"; then');
assert.ok(employeePendingAt>compatAt&&employeePendingAt<readinessPendingAt);
const historyPendingAt=databaseJob.indexOf('elif test "$PHASE_STATE" = "pending" && test "$RELEASE_PHASE" = "database_history_performance_20260913"; then');
const readLatencyPendingAt=databaseJob.indexOf('elif test "$PHASE_STATE" = "pending" && test "$RELEASE_PHASE" = "database_read_latency_20260913"; then');
assert.ok(readLatencyPendingAt>compatAt&&readLatencyPendingAt<historyPendingAt);
const arMappingPendingAt=databaseJob.indexOf('elif test "$PHASE_STATE" = "pending" && test "$RELEASE_PHASE" = "database_ar_mapping_20260913"; then');
assert.ok(arMappingPendingAt>compatAt&&arMappingPendingAt<readLatencyPendingAt);
const arMappingBranch=databaseJob.slice(arMappingPendingAt,readLatencyPendingAt);
assert.match(arMappingBranch,/ar-mapping-prerequisites[\s\S]+--release-phase database_read_latency_20260913 --migration-versions 20260913042629[\s\S]+prepare-ar-mapping-rehearsal[\s\S]+finance_statement_source_fingerprint\.sql[\s\S]+finance_ar_mapping_canary\.sql[\s\S]+prepare-ar-mapping-apply[\s\S]+--ledger[\s\S]+ar-mapping-apply\.json/);
assert.doesNotMatch(arMappingBranch,/finance_production_authenticated_canary|finance_finalize_accounting_lines_canary|finance_approval_history_canary|finance_statement_source_canary/,'AR mapping release must not run employee or synthetic actor write canaries');
assert.doesNotMatch(promoteJob,/prepare-ar-mapping-(?:apply|rehearsal)/);
assert.equal((workflow.match(/verify-reports-canary --domain ar_mapping/g)||[]).length,2);
for(const name of [...guard.AR_MAPPING_POSTFLIGHT_FILES,'finance_ar_mapping_canary.sql'])assert.ok(candidateJob.includes('cp scripts/'+name+' "$BUNDLE/release-tools/scripts/"'),'AR mapping checks must be sealed: '+name);
const readLatencyBranch=databaseJob.slice(readLatencyPendingAt,historyPendingAt);
assert.match(readLatencyBranch,/read-latency-prerequisites[\s\S]+--release-phase database_history_performance_20260913 --migration-versions 20260912164807[\s\S]+prepare-read-latency-rehearsal[\s\S]+finance_statement_source_fingerprint\.sql[\s\S]+finance_statement_source_canary\.sql[\s\S]+prepare-read-latency-apply[\s\S]+--ledger[\s\S]+read-latency-apply\.json/);
assert.doesNotMatch(readLatencyBranch,/finance_production_authenticated_canary|finance_finalize_accounting_lines_canary|finance_approval_history_canary/,'Read-only RPC release uses its entirely synthetic actor, not employee claims');
assert.doesNotMatch(promoteJob,/prepare-read-latency-(?:apply|rehearsal)/);
assert.equal((workflow.match(/verify-reports-canary --domain statement_source/g)||[]).length,2);
assert.match(databaseJob,/name: Prove authenticated submit[^\n]+\n\s+if: inputs\.release_phase != 'database_read_latency_20260913' && inputs\.release_phase != 'database_ar_mapping_20260913'/);
for(const job of [databaseJob,promoteJob]) {
  const guarded=job.indexOf('if test "$RELEASE_PHASE" != "database_read_latency_20260913" && test "$RELEASE_PHASE" != "database_ar_mapping_20260913" && test "$RELEASE_PHASE" != "database_audit_remediation_20260914" && test "$RELEASE_PHASE" != "database_approval_search_20260914" && test "$RELEASE_PHASE" != "database_history_summary_20260915" && test "$RELEASE_PHASE" != "database_invoice_read_scope_20260915" && test "$RELEASE_PHASE" != "frontend_compat" && test "$RELEASE_PHASE" != "database_audit_security_20260922" && test "$RELEASE_PHASE" != "database_revenue_repair_20260924" && test "$RELEASE_PHASE" != "database_operational_stability_20260924" && test "$RELEASE_PHASE" != "database_hr_bridge_20260922" && test "$RELEASE_PHASE" != "database_ar_read_scope_20260922"' + (job === databaseJob ? ' && test "$RELEASE_PHASE" != "database_human_float_20261002" && test "$RELEASE_PHASE" != "database_income_reconcile_20261002" && test "$RELEASE_PHASE" != "database_invoice_revenue_result_20261002" && test "$RELEASE_PHASE" != "database_purchase_final_amount_20261006" && test "$RELEASE_PHASE" != "database_invoice_item_bind_20261008" && test "$RELEASE_PHASE" != "database_personal_history_20261008" && test "$RELEASE_PHASE" != "database_personal_history_permission_20261008" && test \"$RELEASE_PHASE\" != \"database_bill_batch_bulk_20261008\" && test \"$RELEASE_PHASE\" != \"database_invoice_batch_bulk_20261014\" && test \"$RELEASE_PHASE\" != \"database_invoice_batch_approval_20261010\" && test \"$RELEASE_PHASE\" != \"database_personal_history_identity_once_20261012\"' : ' && test "$RELEASE_PHASE" != "database_invoice_batch_approval_20261010" && test "$RELEASE_PHASE" != "database_personal_history_identity_once_20261012"') + ' && test "$RELEASE_PHASE" != "database_personal_bill_batch_history_20261013" && test "$RELEASE_PHASE" != "database_bounded_global_logout_20261014" && test "$RELEASE_PHASE" != "database_bill_approval_bulk_20261015"; then');
  assert.ok(guarded>=0);
  assert.match(job.slice(guarded,job.indexOf('\n          fi',guarded)),/finance_production_authenticated_canary\.sql[\s\S]+verify-authenticated-canary/);
  assert.match(job,/if test "\$RELEASE_PHASE" = "database_read_latency_20260913"; then[\s\S]+finance_statement_source_canary\.sql[\s\S]+verify-reports-canary --domain statement_source/);
}
assert.ok(historyPendingAt>compatAt&&historyPendingAt<employeePendingAt);
const historyBranch=databaseJob.slice(historyPendingAt,employeePendingAt);
assert.match(historyBranch,/history-performance-prerequisites[\s\S]+--release-phase database_employee_reliability_20260912 --migration-versions 20260912145849[\s\S]+prepare-history-performance-rehearsal[\s\S]+finance_employee_reliability_fingerprint\.sql[\s\S]+finance_employee_reliability_canary\.sql[\s\S]+finance_approval_history_canary\.sql[\s\S]+history-performance-rehearsal\.json[\s\S]+prepare-history-performance-apply[\s\S]+--ledger[\s\S]+history-performance-apply\.json/);
assert.doesNotMatch(promoteJob,/prepare-history-performance-(?:apply|rehearsal)/);
assert.equal((workflow.match(/verify-reports-canary --domain approval_history /g)||[]).length,2);
for(const name of [...guard.HISTORY_PERFORMANCE_POSTFLIGHT_FILES,'finance_approval_history_canary.sql']){
 assert.ok(candidateJob.includes('cp scripts/'+name+' "$BUNDLE/release-tools/scripts/"'));
 for(const checker of ['check_release_artifact.js','check_release_source_integrity.js'])assert.ok(fs.readFileSync(path.join(root,'scripts',checker),'utf8').includes("'scripts/"+name+"'"));
}
// Execute the real shell conditions as a latest-phase contract: none of the
// inherited post-apply or promotion checks may be silently skipped.
const {spawnSync}=require('node:child_process');
// Execute the actual packaging commands in a fresh workspace. Candidate download
// inputs are fictional; scripts, migrations, functions and vendor bytes are real.
// This contract also runs before build, so only the generated manifest may use
// a fixture when no local build exists. Never create directories on behalf of cp.
const packagingTemp=fs.mkdtempSync(path.join(os.tmpdir(),'finance-release-packaging-'));
try {
 const sealName='      - name: Seal exact candidate, DB contracts and migration catalog as immutable artifact';
 const sealAt=candidateJob.indexOf(sealName),sealEnd=candidateJob.indexOf('\n      - name:',sealAt+sealName.length);
 assert.ok(sealAt>=0&&sealEnd>sealAt,'actual candidate sealing step must exist');
 const seal=candidateJob.slice(sealAt,sealEnd);
 const commands=seal.split(/\r?\n/).map(line=>line.trim()).filter(line=>/^(mkdir -p|cp) /.test(line));
 assert.ok(commands.some(line=>line.startsWith('mkdir -p '))&&commands.filter(line=>line.startsWith('cp ')).length>=100,
  'packaging rehearsal must include the complete actual mkdir/cp command set');
 const staging=path.join(packagingTemp,'workspace'),runnerTemp=path.join(packagingTemp,'runner');
 fs.mkdirSync(staging);fs.mkdirSync(runnerTemp);
 for(const directory of ['scripts','supabase','assets'])fs.symlinkSync(path.join(root,directory),path.join(staging,directory),'dir');
 fs.mkdirSync(path.join(staging,'www'));
 const realManifest=path.join(root,'www/release-manifest.json');
 fs.writeFileSync(path.join(staging,'www/release-manifest.json'),fs.existsSync(realManifest)?fs.readFileSync(realManifest):JSON.stringify({scope:'fictional generated artifact for packaging contract only'}));
 for(const name of ['candidate-deployment-url.txt','candidate-deployment.json','candidate-release-manifest.json','candidate-index.html','candidate-app.js'])
  fs.writeFileSync(path.join(runnerTemp,name),'fictional candidate download: '+name+'\n');
 const bundle=path.join(packagingTemp,'bundle');
 const runPackaging=(lines,target)=>spawnSync('bash',['-c','set -euo pipefail\n'+lines.join('\n')],{
  cwd:staging,env:{PATH:process.env.PATH,RUNNER_TEMP:runnerTemp,BUNDLE:target},encoding:'utf8',timeout:30000
 });
 const packaged=runPackaging(commands,bundle);
 assert.ifError(packaged.error);assert.equal(packaged.status,0,'actual candidate packaging must succeed on a fresh filesystem: '+packaged.stderr);
 for(const directory of ['scripts','scripts/fixtures','supabase/migrations','supabase/functions/finance-labor-external','assets/vendor'])
  assert.ok(fs.statSync(path.join(bundle,'release-tools',directory)).isDirectory(),'candidate packaging creates required parent '+directory);
 const resolveToken=token=>token.replace(/^"|"$/g,'').replace(/\$RUNNER_TEMP/g,runnerTemp).replace(/\$BUNDLE/g,bundle);
 const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 let copied=0;
 for(const command of commands.filter(line=>line.startsWith('cp '))){
  const tokens=command.match(/"[^"]*"|\S+/g).slice(1).map(resolveToken),destination=tokens.pop();
  for(const token of tokens){
   const absolute=path.resolve(staging,token);
   const sources=token.includes('*')?fs.readdirSync(path.dirname(absolute)).filter(name=>name.endsWith('.sql')).map(name=>path.join(path.dirname(absolute),name)):[absolute];
   if(token.includes('*'))assert.equal(token,'supabase/migrations/*.sql','new packaging glob requires explicit source expansion verification');
   assert.ok(sources.length>0,'copy source glob must not be empty');
   for(const source of sources){
    const target=destination.endsWith('/')?path.join(destination,path.basename(source)):destination;
    assert.ok(fs.statSync(target).isFile(),'sealed copy is a regular file: '+target);
    assert.equal(hash(target),hash(source),'sealed copy keeps exact source bytes: '+source);copied++;
   }
  }
 }
 for(const job of [databaseJob,promoteJob])for(const match of job.matchAll(/(?:\$TOOLS\/scripts\/|--file scripts\/)([A-Za-z0-9_.-]+)/g))
  assert.ok(fs.statSync(path.join(bundle,'release-tools/scripts',match[1])).isFile(),'later DB/promotion read exists in sealed tools: '+match[1]);
 const fixtureDirectory='"$BUNDLE/release-tools/scripts/fixtures"';
 const withoutFixtures=commands.map(line=>line.startsWith('mkdir -p ')?line.replace(fixtureDirectory,''):line);
 assert.notDeepEqual(withoutFixtures,commands,'missing-fixtures mutation must remove the real mkdir argument');
 const brokenBundle=path.join(packagingTemp,'without-fixtures');
 const broken=runPackaging(withoutFixtures,brokenBundle);
 assert.ifError(broken.error);assert.notEqual(broken.status,0,'omitting fixtures mkdir must fail actual cp before sealing');
 assert.match(broken.stderr,/scripts\/fixtures/,'negative case fails specifically at the missing fixture destination');
 assert.ok(!fs.existsSync(path.join(brokenBundle,'release-tools/scripts/fixtures')),'failed packaging must not manufacture a fixtures file or directory');
 console.log('PASS actual candidate packaging copies '+copied+' exact source files and rejects missing fixtures parent');
} finally {fs.rmSync(packagingTemp,{recursive:true,force:true});}
for(const job of [databaseJob,promoteJob])for(const line of job.split('\n').filter(l=>l.trimStart().startsWith('if test "$RELEASE_PHASE"')&&l.includes('frontend_compat')&&!l.includes('database_read_latency_20260913')&&!l.includes('database_ar_mapping_20260913')&&!l.includes('database_audit_remediation_20260914')&&!l.includes('database_approval_search_20260914')&&!l.includes('database_history_summary_20260915')&&!l.includes('database_invoice_read_scope_20260915')&&!l.includes('database_ar_read_scope_20260922')&&!l.includes('database_audit_security_20260922')&&!l.includes('database_operational_stability_20260924')&&!l.trimStart().startsWith('if test "$RELEASE_PHASE" = "frontend_compat"')&&!l.trimStart().startsWith('if test "$RELEASE_PHASE" = "database_audit_controls_20260927"')&&!l.trimStart().startsWith('if test "$RELEASE_PHASE" = "database_hr_contractor_20260928"')&&!l.trimStart().startsWith('if test "$RELEASE_PHASE" = "database_portal_session_20260928"')&&!l.trimStart().startsWith('if test "$RELEASE_PHASE" = "database_external_labor_20260928"')&&!l.trimStart().startsWith('if test "$RELEASE_PHASE" = "database_attachment_claim_20261001"'))){
 const condition=line.trim().replace(/; then$/,'');
 const evaluated=spawnSync('sh',['-c',condition+'; then exit 0; else exit 1; fi'],{env:{...process.env,RELEASE_PHASE:guard.RELEASE_PHASE_DATABASE_HISTORY_PERFORMANCE},encoding:'utf8'});
 assert.equal(evaluated.status,0,'History phase must retain gate: '+line+' '+evaluated.stderr);
}


for(const job of [databaseJob,promoteJob])for(const line of job.split('\n').filter(l=>l.trimStart().startsWith('if test "$RELEASE_PHASE"')&&(l.includes('frontend_compat')||l.includes('!= "database_read_latency_20260913"')))){
 const condition=line.trim().replace(/; then$/,'');
 const evaluated=spawnSync('sh',['-c',condition+'; then exit 0; else exit 1; fi'],{env:{...process.env,RELEASE_PHASE:guard.RELEASE_PHASE_DATABASE_AR_MAPPING},encoding:'utf8'});
 assert.equal(evaluated.status,line.includes('= "database_ar_mapping_20260913"')&&!line.includes('!= "database_ar_mapping_20260913"')?0:1,'AR phase must execute only its read-only parity canary: '+line+' '+evaluated.stderr);
}

const remediationPendingAt=databaseJob.indexOf('elif test "$PHASE_STATE" = "pending" && test "$RELEASE_PHASE" = "database_audit_remediation_20260914"; then');
assert.ok(remediationPendingAt>0&&remediationPendingAt<arMappingPendingAt);
const remediationBranch=databaseJob.slice(remediationPendingAt,arMappingPendingAt);
assert.match(remediationBranch,/--release-phase database_ar_mapping_20260913 --migration-versions 20260913061745[\s\S]+prepare-audit-remediation-rehearsal[\s\S]+finance_statement_source_fingerprint\.sql[\s\S]+finance_dashboard_scope_canary\.sql[\s\S]+finance_google_projection_canary\.sql[\s\S]+prepare-audit-remediation-apply[\s\S]+--ledger/);
assert.doesNotMatch(promoteJob,/prepare-audit-remediation-(?:apply|rehearsal)/);
for(const name of [...guard.AUDIT_REMEDIATION_POSTFLIGHT_FILES,'finance_dashboard_scope_canary.sql','finance_google_projection_canary.sql'])assert.ok(candidateJob.includes('cp scripts/'+name+' "$BUNDLE/release-tools/scripts/"'));
for(const domain of ['dashboard_scope','google_projection'])assert.equal((workflow.match(new RegExp('verify-reports-canary --domain '+domain,'g'))||[]).length,2);
for(const job of [databaseJob,promoteJob])for(const line of job.split('\n').filter(l=>l.trimStart().startsWith('if test "$RELEASE_PHASE"')&&(l.includes('frontend_compat')||l.includes('!= "database_read_latency_20260913"')))){
 const condition=line.trim().replace(/; then$/,'');
 const evaluated=spawnSync('sh',['-c',condition+'; then exit 0; else exit 1; fi'],{env:{...process.env,RELEASE_PHASE:guard.RELEASE_PHASE_DATABASE_AUDIT_REMEDIATION},encoding:'utf8'});
 assert.equal(evaluated.status,line.includes('= "database_audit_remediation_20260914"')&&!line.includes('!= "database_audit_remediation_20260914"')?0:1,'remediation executes only its read-only canaries: '+line);
}
const searchPendingAt=databaseJob.indexOf('elif test "$PHASE_STATE" = "pending" && test "$RELEASE_PHASE" = "database_approval_search_20260914"; then');
assert.ok(searchPendingAt>0&&searchPendingAt<remediationPendingAt);
const searchBranch=databaseJob.slice(searchPendingAt,remediationPendingAt);
const summaryPendingAt=databaseJob.indexOf('elif test "$PHASE_STATE" = "pending" && test "$RELEASE_PHASE" = "database_history_summary_20260915"; then');
assert.ok(summaryPendingAt>compatAt&&summaryPendingAt<searchPendingAt);
const summaryBranch=databaseJob.slice(summaryPendingAt,searchPendingAt);
const invoicePendingAt=databaseJob.indexOf('elif test "$PHASE_STATE" = "pending" && test "$RELEASE_PHASE" = "database_invoice_read_scope_20260915"; then');
assert.ok(invoicePendingAt>compatAt&&invoicePendingAt<summaryPendingAt);
const invoiceBranch=databaseJob.slice(invoicePendingAt,summaryPendingAt);
assert.match(invoiceBranch,/prepare-invoice-read-scope-prerequisite-query[\s\S]+--ledger[\s\S]+prepare-invoice-read-scope-rehearsal[\s\S]+finance_approval_history_summary_fingerprint\.sql[\s\S]+finance_dashboard_scope_canary\.sql[\s\S]+finance_google_projection_canary\.sql[\s\S]+finance_approval_search_canary\.sql[\s\S]+finance_approval_history_summary_canary\.sql[\s\S]+finance_invoice_select_initplan_canary\.sql[\s\S]+prepare-invoice-read-scope-apply[\s\S]+--ledger/);
assert.doesNotMatch(invoiceBranch,/finance_production_authenticated_canary|finance_finalize_accounting_lines_canary|finance_approval_history_canary/);
assert.doesNotMatch(promoteJob,/prepare-invoice-read-scope-(?:apply|rehearsal)/);
for(const file of [...guard.INVOICE_READ_SCOPE_POSTFLIGHT_FILES,'finance_invoice_select_initplan_canary.sql']){
 assert.ok(candidateJob.includes('cp scripts/'+file+' "$BUNDLE/release-tools/scripts/"'));
 for(const checker of ['check_release_artifact.js','check_release_source_integrity.js'])assert.ok(fs.readFileSync(path.join(root,'scripts',checker),'utf8').includes("'scripts/"+file+"'"));
}
assert.equal((workflow.match(/verify-reports-canary --domain invoice_read_scope /g)||[]).length,2);
for(const job of [databaseJob,promoteJob]){
 const at=job.indexOf('verify-reports-canary --domain invoice_read_scope ');
 const preceding=job.slice(0,at).split('\n').filter(line=>line.trimStart().startsWith('if test "$RELEASE_PHASE"')).at(-1);
 for(const selected of [guard.RELEASE_PHASE_DATABASE_INVOICE_READ_SCOPE,'frontend_compat'])assert.equal(spawnSync('sh',['-c',preceding.trim().replace(/; then$/,'')+'; then exit 0; else exit 1; fi'],{env:{...process.env,RELEASE_PHASE:selected}}).status,0);
}
const hrPendingAt=databaseJob.indexOf('elif test "$PHASE_STATE" = "pending" && test "$RELEASE_PHASE" = "database_hr_bridge_20260922"; then');
assert.ok(hrPendingAt>compatAt&&hrPendingAt<invoicePendingAt);
const hrBranch=databaseJob.slice(hrPendingAt,databaseJob.indexOf('elif test "$PHASE_STATE" = "pending" && test "$RELEASE_PHASE" = "database_ar_read_scope_20260922"; then'));
assert.match(hrBranch,/prepare-hr-bridge-prerequisite-query[\s\S]+--ledger[\s\S]+prepare-hr-bridge-rehearsal[\s\S]+finance_hr_bridge_fingerprint\.sql[\s\S]+finance_dashboard_scope_canary\.sql[\s\S]+finance_google_projection_canary\.sql[\s\S]+finance_approval_search_canary\.sql[\s\S]+finance_approval_history_summary_canary\.sql[\s\S]+finance_invoice_select_initplan_canary\.sql[\s\S]+finance_ar_verified_accounting_scope_canary\.sql[\s\S]+prepare-hr-bridge-apply[\s\S]+--ledger/);
assert.doesNotMatch(hrBranch,/finance_production_authenticated_canary|finance_finalize_accounting_lines_canary|finance_approval_history_canary/);
assert.doesNotMatch(promoteJob,/prepare-hr-bridge-(?:apply|rehearsal)/);
for(const file of [...guard.HR_BRIDGE_POSTFLIGHT_FILES,'finance_hr_bridge_fingerprint.sql']){
 assert.ok(candidateJob.includes('cp scripts/'+file+' "$BUNDLE/release-tools/scripts/"'));
 for(const checker of ['check_release_artifact.js','check_release_source_integrity.js'])assert.ok(fs.readFileSync(path.join(root,'scripts',checker),'utf8').includes("'scripts/"+file+"'"));
}
for(const job of [databaseJob,promoteJob])for(const line of job.split('\n').filter(l=>l.trimStart().startsWith('if test "$RELEASE_PHASE"')&&(l.includes('frontend_compat')||l.includes('!= "database_read_latency_20260913"')))){
 const condition=line.trim().replace(/; then$/,'');
 const evaluated=spawnSync('sh',['-c',condition+'; then exit 0; else exit 1; fi'],{env:{...process.env,RELEASE_PHASE:guard.RELEASE_PHASE_DATABASE_HR_BRIDGE},encoding:'utf8'});
 assert.equal(evaluated.status,line.includes('= "database_hr_bridge_20260922"')&&!line.includes('!= "database_hr_bridge_20260922"')?0:1,'HR bridge executes only read-only canaries: '+line);
}
assert.ok(candidateJob.indexOf('pnpm test:hr-voucher-browser')>candidateJob.indexOf('pnpm test:hr-bridge-browser')&&candidateJob.indexOf('pnpm test:hr-voucher-browser')<candidateJob.indexOf('vercel@59.3.0 build --prod'));
assert.ok(candidateJob.indexOf('pnpm test:hr-bridge-browser')>candidateJob.indexOf('pnpm exec playwright install')&&candidateJob.indexOf('pnpm test:hr-bridge-browser')<candidateJob.indexOf('vercel@59.3.0 build --prod'));
for(const name of ['test:hr-bridge','test:hr-bridge-release','test:hr-voucher-posting','test:hr-accounting-privacy'])assert.ok(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).scripts['release:preflight'].includes('pnpm '+name));
const securityPendingAt=databaseJob.indexOf('elif test "$PHASE_STATE" = "pending" && test "$RELEASE_PHASE" = "database_audit_security_20260922"; then');
assert.ok(securityPendingAt>compatAt&&securityPendingAt<hrPendingAt);
const securityBranch=databaseJob.slice(securityPendingAt,hrPendingAt);
assert.match(securityBranch,/prepare-audit-security-prerequisite-query[\s\S]+--ledger[\s\S]+prepare-audit-security-rehearsal[\s\S]+finance_audit_security_fingerprint\.sql[\s\S]+finance_dashboard_scope_canary\.sql[\s\S]+finance_google_projection_canary\.sql[\s\S]+finance_approval_search_canary\.sql[\s\S]+finance_approval_history_summary_canary\.sql[\s\S]+finance_invoice_select_initplan_canary\.sql[\s\S]+finance_ar_verified_accounting_scope_canary\.sql[\s\S]+finance_audit_security_canary\.sql[\s\S]+prepare-audit-security-apply[\s\S]+--ledger/);
assert.doesNotMatch(securityBranch,/finance_production_authenticated_canary|finance_finalize_accounting_lines_canary|finance_approval_history_canary/);
assert.doesNotMatch(promoteJob,/prepare-audit-security-(?:apply|rehearsal)/);
for(const file of [...guard.AUDIT_SECURITY_POSTFLIGHT_FILES,'finance_audit_security_fingerprint.sql','finance_audit_security_canary.sql']){
 assert.ok(candidateJob.includes('cp scripts/'+file+' "$BUNDLE/release-tools/scripts/"'));
 for(const checker of ['check_release_artifact.js','check_release_source_integrity.js'])assert.ok(fs.readFileSync(path.join(root,'scripts',checker),'utf8').includes("'scripts/"+file+"'"));
}
assert.equal((workflow.match(/verify-reports-canary --domain audit_security /g)||[]).length,2);
guard.validateTarget(exactEnvironment,'a'.repeat(40),guard.RELEASE_PHASE_DATABASE_AUDIT_SECURITY,guard.AUDIT_SECURITY_MIGRATIONS.join(','),catalog.supabaseProjectRef);
for(const selected of [guard.RELEASE_PHASE_DATABASE_AUDIT_SECURITY,'frontend_compat'])for(const job of [databaseJob,promoteJob])for(const line of job.split('\n').filter(l=>l.trimStart().startsWith('if test "$RELEASE_PHASE"'))){
 const condition=line.trim().replace(/; then$/,'');
 const evaluated=spawnSync('sh',['-c',condition+'; then exit 0; else exit 1; fi'],{env:{...process.env,RELEASE_PHASE:selected}});
 assert.equal(evaluated.status,(line.includes('= "database_audit_security_20260922"')&&!line.includes('!= "database_audit_security_20260922"'))||(selected==='frontend_compat'&&(line.trimStart().startsWith('if test "$RELEASE_PHASE" = "frontend_compat"')||line.includes('= "database_audit_controls_20260927"')||line.includes('= "database_hr_contractor_20260928"')||line.includes('= "database_portal_session_20260928"')||line.includes('= "database_external_labor_20260928"')||line.includes('= "database_attachment_claim_20261001"')))?0:1,selected+' executes its required readonly canaries without employee claims: '+line);
}
assert.ok(candidateJob.indexOf('pnpm test:finance-ui-interactions')>candidateJob.indexOf('pnpm exec playwright install')&&candidateJob.indexOf('pnpm test:finance-ui-interactions')<candidateJob.indexOf('vercel@59.3.0 build --prod'));
assert.ok(candidateJob.indexOf('pnpm test:invoice-item-bind-browser')>candidateJob.indexOf('pnpm exec playwright install')&&candidateJob.indexOf('pnpm test:invoice-item-bind-browser')<candidateJob.indexOf('vercel@59.3.0 build --prod'));
assert.ok(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).scripts['release:preflight'].includes('pnpm test:audit-security'));

const revenuePendingAt=databaseJob.indexOf('elif test "$PHASE_STATE" = "pending" && test "$RELEASE_PHASE" = "database_revenue_repair_20260924"; then');
assert.ok(revenuePendingAt>securityPendingAt&&revenuePendingAt<hrPendingAt);
const revenueBranch=databaseJob.slice(revenuePendingAt,hrPendingAt);
assert.match(revenueBranch,/prepare-revenue-repair-prerequisite-query[\s\S]+--ledger[\s\S]+prepare-revenue-repair-rehearsal[\s\S]+finance_revenue_repair_fingerprint\.sql[\s\S]+finance_audit_security_canary\.sql[\s\S]+finance_revenue_repair_canary\.sql[\s\S]+prepare-revenue-repair-apply[\s\S]+--ledger/);
assert.doesNotMatch(revenueBranch,/finance_production_authenticated_canary|finance_finalize_accounting_lines_canary|finance_approval_history_canary/);
assert.doesNotMatch(promoteJob,/prepare-revenue-repair-(?:apply|rehearsal)/);
for(const file of [...guard.REVENUE_REPAIR_POSTFLIGHT_FILES,'finance_revenue_repair_fingerprint.sql','finance_revenue_repair_canary.sql']){
 assert.ok(candidateJob.includes('cp scripts/'+file+' "$BUNDLE/release-tools/scripts/"'));
 for(const checker of ['check_release_artifact.js','check_release_source_integrity.js'])assert.ok(fs.readFileSync(path.join(root,'scripts',checker),'utf8').includes("'scripts/"+file+"'"));
}
assert.equal((workflow.match(/verify-reports-canary --domain revenue_repair /g)||[]).length,2);
guard.validateTarget(exactEnvironment,'a'.repeat(40),guard.RELEASE_PHASE_DATABASE_REVENUE_REPAIR,guard.REVENUE_REPAIR_MIGRATIONS.join(','),catalog.supabaseProjectRef);
for(const job of [databaseJob,promoteJob])for(const line of job.split('\n').filter(l=>l.trimStart().startsWith('if test "$RELEASE_PHASE"'))){
 const condition=line.trim().replace(/; then$/,'');
 const evaluated=spawnSync('sh',['-c',condition+'; then exit 0; else exit 1; fi'],{env:{...process.env,RELEASE_PHASE:guard.RELEASE_PHASE_DATABASE_REVENUE_REPAIR}});
 assert.equal(evaluated.status,line.includes('= "database_revenue_repair_20260924"')&&!line.includes('!= "database_revenue_repair_20260924"')?0:1,'revenue repair executes eight readonly canaries without employee claims: '+line);
}
assert.ok(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).scripts['release:preflight'].includes('pnpm test:revenue-repair-release'));
const operationalPendingAt=databaseJob.indexOf('elif test "$PHASE_STATE" = "pending" && test "$RELEASE_PHASE" = "database_operational_stability_20260924"; then');
assert.ok(operationalPendingAt>revenuePendingAt&&operationalPendingAt<hrPendingAt);
const operationalBranch=databaseJob.slice(operationalPendingAt,hrPendingAt);
assert.match(operationalBranch,/operational-stability-prerequisites\.sql[\s\S]+prepare-operational-stability-rehearsal[\s\S]+finance_statement_source_fingerprint\.sql[\s\S]+finance_operational_stability_canary\.sql[\s\S]+finance_operational_stability_postflight\.sql[\s\S]+prepare-operational-stability-apply/);
assert.doesNotMatch(promoteJob,/prepare-operational-stability-(?:apply|rehearsal)/);
assert.equal((workflow.match(/verify-reports-canary --domain operational_stability /g)||[]).length,2);
guard.validateTarget(exactEnvironment,'a'.repeat(40),guard.RELEASE_PHASE_DATABASE_OPERATIONAL_STABILITY,guard.OPERATIONAL_STABILITY_MIGRATIONS.join(','),catalog.supabaseProjectRef);
guard.validateTarget(exactEnvironment,'a'.repeat(40),guard.RELEASE_PHASE_DATABASE_DEMO_PASSWORD_RETIREMENT,guard.DEMO_PASSWORD_RETIREMENT_MIGRATIONS.join(','),catalog.supabaseProjectRef);
for(const file of ['finance_operational_stability_postflight.sql','finance_operational_stability_canary.sql']){
 assert.ok(candidateJob.includes(file),'Operational stability sources must be sealed: '+file);
 if(file.startsWith('scripts/'))for(const checker of ['check_release_artifact.js','check_release_source_integrity.js'])assert.ok(fs.readFileSync(path.join(root,'scripts',checker),'utf8').includes("'"+file+"'"));
}
assert.ok(candidateJob.includes('cp supabase/migrations/*.sql "$BUNDLE/release-tools/supabase/migrations/"'),'All reviewed migrations, including operational stability, are sealed');
assert.ok(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).scripts['release:preflight'].includes('pnpm test:operational-stability-release'));
for(const job of [databaseJob,promoteJob])for(const line of job.split('\n').filter(l=>l.trimStart().startsWith('if test "$RELEASE_PHASE"'))){
 const condition=line.trim().replace(/; then$/,'');
 const evaluated=spawnSync('sh',['-c',condition+'; then exit 0; else exit 1; fi'],{env:{...process.env,RELEASE_PHASE:guard.RELEASE_PHASE_DATABASE_OPERATIONAL_STABILITY}});
 assert.equal(evaluated.status,line.includes('= "database_operational_stability_20260924"')&&!line.includes('!= "database_operational_stability_20260924"')?0:1,'Operational stability runs only its intended canary gates: '+line);
}
const passwordRetirementPendingAt=databaseJob.indexOf('elif test "$PHASE_STATE" = "pending" && test "$RELEASE_PHASE" = "database_demo_password_retirement_20260925"; then');
assert.ok(passwordRetirementPendingAt>operationalPendingAt&&passwordRetirementPendingAt<hrPendingAt);
const passwordRetirementBranch=databaseJob.slice(passwordRetirementPendingAt,hrPendingAt);
assert.match(passwordRetirementBranch,/database_operational_stability_20260924[\s\S]+prepare-demo-password-retirement-rehearsal[\s\S]+finance_statement_source_fingerprint\.sql[\s\S]+finance_demo_password_retirement_canary\.sql[\s\S]+prepare-demo-password-retirement-apply[\s\S]+finance_demo_password_retirement_postflight\.sql/);
assert.doesNotMatch(promoteJob,/prepare-demo-password-retirement-(?:apply|rehearsal)/);
assert.equal((workflow.match(/verify-reports-canary --domain demo_password_retirement /g)||[]).length,2);
for(const file of ['finance_demo_password_retirement_postflight.sql','finance_demo_password_retirement_canary.sql']){
 assert.ok(candidateJob.includes('cp scripts/'+file+' "$BUNDLE/release-tools/scripts/"'));
 for(const checker of ['check_release_artifact.js','check_release_source_integrity.js'])assert.ok(fs.readFileSync(path.join(root,'scripts',checker),'utf8').includes("'scripts/"+file+"'"));
}
assert.ok(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).scripts['release:preflight'].includes('pnpm test:demo-password-retirement'));

assert.match(candidateJob,/name: Retain fictional UI interaction evidence even on failure\n\s+if: always\(\)[\s\S]+path: \/tmp\/finance-ui-interaction-20260922[\s\S]+retention-days: 14/);
const arReadPendingAt=databaseJob.indexOf('elif test "$PHASE_STATE" = "pending" && test "$RELEASE_PHASE" = "database_ar_read_scope_20260922"; then');
assert.ok(arReadPendingAt>compatAt&&arReadPendingAt<invoicePendingAt);
const arReadBranch=databaseJob.slice(arReadPendingAt,invoicePendingAt);
assert.match(arReadBranch,/prepare-ar-read-scope-prerequisite-query[\s\S]+--ledger[\s\S]+prepare-ar-read-scope-rehearsal[\s\S]+finance_approval_history_summary_fingerprint\.sql[\s\S]+finance_dashboard_scope_canary\.sql[\s\S]+finance_google_projection_canary\.sql[\s\S]+finance_approval_search_canary\.sql[\s\S]+finance_approval_history_summary_canary\.sql[\s\S]+finance_invoice_select_initplan_canary\.sql[\s\S]+finance_ar_verified_accounting_scope_canary\.sql[\s\S]+prepare-ar-read-scope-apply[\s\S]+--ledger/);
assert.doesNotMatch(arReadBranch,/finance_production_authenticated_canary|finance_finalize_accounting_lines_canary|finance_approval_history_canary/);
assert.doesNotMatch(promoteJob,/prepare-ar-read-scope-(?:apply|rehearsal)/);
for(const file of [...guard.AR_READ_SCOPE_POSTFLIGHT_FILES,'finance_ar_verified_accounting_scope_canary.sql']){
 assert.ok(candidateJob.includes('cp scripts/'+file+' "$BUNDLE/release-tools/scripts/"'));
 for(const checker of ['check_release_artifact.js','check_release_source_integrity.js'])assert.ok(fs.readFileSync(path.join(root,'scripts',checker),'utf8').includes("'scripts/"+file+"'"));
}
assert.equal((workflow.match(/verify-reports-canary --domain ar_read_scope /g)||[]).length,2);
for(const job of [databaseJob,promoteJob]){
 const at=job.indexOf('verify-reports-canary --domain ar_read_scope ');
 const preceding=job.slice(0,at).split('\n').filter(line=>line.trimStart().startsWith('if test "$RELEASE_PHASE"')).at(-1);
 for(const selected of [guard.RELEASE_PHASE_DATABASE_AR_READ_SCOPE,guard.RELEASE_PHASE_DATABASE_HR_BRIDGE,'frontend_compat'])assert.equal(spawnSync('sh',['-c',preceding.trim().replace(/; then$/,'')+'; then exit 0; else exit 1; fi'],{env:{...process.env,RELEASE_PHASE:selected}}).status,0);
 for(const line of job.split('\n').filter(l=>l.trimStart().startsWith('if test "$RELEASE_PHASE"')&&(l.includes('frontend_compat')||l.includes('!= "database_read_latency_20260913"')))){
  const code=spawnSync('sh',['-c',line.trim().replace(/; then$/,'')+'; then exit 0; else exit 1; fi'],{env:{...process.env,RELEASE_PHASE:guard.RELEASE_PHASE_DATABASE_AR_READ_SCOPE}}).status;
  assert.equal(code,line.includes('= "database_ar_read_scope_20260922"')&&!line.includes('!= "database_ar_read_scope_20260922"')?0:1,'AR read scope runs only reviewed readonly canaries: '+line);
 }
}
assert.match(summaryBranch,/prepare-history-summary-prerequisite-query[\s\S]+--ledger[\s\S]+prepare-history-summary-rehearsal[\s\S]+finance_approval_history_summary_fingerprint\.sql[\s\S]+finance_dashboard_scope_canary\.sql[\s\S]+finance_google_projection_canary\.sql[\s\S]+finance_approval_search_canary\.sql[\s\S]+finance_approval_history_summary_canary\.sql[\s\S]+prepare-history-summary-apply[\s\S]+--ledger/);
assert.doesNotMatch(summaryBranch,/finance_production_authenticated_canary|finance_finalize_accounting_lines_canary|finance_approval_history_canary/,'Summary release canaries never set employee claims or write operational data');
assert.doesNotMatch(promoteJob,/prepare-history-summary-(?:apply|rehearsal)/);
for(const file of [...guard.HISTORY_SUMMARY_POSTFLIGHT_FILES,'finance_approval_history_summary_canary.sql','finance_approval_history_summary_fingerprint.sql']){
 assert.ok(candidateJob.includes('cp scripts/'+file+' "$BUNDLE/release-tools/scripts/"'));
 for(const checker of ['check_release_artifact.js','check_release_source_integrity.js'])assert.ok(fs.readFileSync(path.join(root,'scripts',checker),'utf8').includes("'scripts/"+file+"'"));
}
assert.ok(candidateJob.indexOf('pnpm test:history-summary-browser')>candidateJob.indexOf('node scripts/check_personnel_login_browser.cjs'));
assert.match(candidateJob,/name: Retain fictional search acceptance evidence even on failure\n\s+if: always\(\)[\s\S]+path: \/tmp\/finance-search-summary-acceptance-20260915[\s\S]+retention-days: 14/);
assert.equal((workflow.match(/verify-reports-canary --domain approval_history_summary /g)||[]).length,2);
for(const job of [databaseJob,promoteJob])for(const domain of ['dashboard_scope','google_projection','approval_search','approval_history_summary']){
 const at=job.indexOf('verify-reports-canary --domain '+domain+' '),start=job.lastIndexOf('if test "$RELEASE_PHASE"',at),end=job.indexOf('\n',start);
 assert.ok(at>=0&&start>=0&&end>start);
 const condition=job.slice(start,end).trim().replace(/; then$/,'');
 for(const selected of [guard.RELEASE_PHASE_DATABASE_HISTORY_SUMMARY,guard.RELEASE_PHASE_DATABASE_INVOICE_READ_SCOPE,'frontend_compat'])assert.equal(spawnSync('sh',['-c',condition+'; then exit 0; else exit 1; fi'],{env:{...process.env,RELEASE_PHASE:selected}}).status,0,'Current phase must execute '+domain+' in every post-apply and promotion check');
}

assert.match(searchBranch,/prepare-approval-search-prerequisite-query[\s\S]+--ledger[\s\S]+prepare-approval-search-rehearsal[\s\S]+--ledger[\s\S]+finance_statement_source_fingerprint\.sql[\s\S]+finance_dashboard_scope_canary\.sql[\s\S]+finance_google_projection_canary\.sql[\s\S]+finance_approval_search_canary\.sql[\s\S]+prepare-approval-search-apply[\s\S]+--ledger/);
assert.doesNotMatch(promoteJob,/prepare-approval-search-(?:apply|rehearsal)/);
for(const name of [...guard.APPROVAL_SEARCH_POSTFLIGHT_FILES,'finance_approval_search_canary.sql'])assert.ok(candidateJob.includes('cp scripts/'+name+' "$BUNDLE/release-tools/scripts/"'));
assert.equal((workflow.match(/verify-reports-canary --domain approval_search/g)||[]).length,2);
for(const job of [databaseJob,promoteJob])for(const line of job.split('\n').filter(l=>l.trimStart().startsWith('if test "$RELEASE_PHASE"')&&(l.includes('frontend_compat')||l.includes('!= "database_read_latency_20260913"')))){
 const condition=line.trim().replace(/; then$/,'');
 const evaluated=spawnSync('sh',['-c',condition+'; then exit 0; else exit 1; fi'],{env:{...process.env,RELEASE_PHASE:guard.RELEASE_PHASE_DATABASE_APPROVAL_SEARCH},encoding:'utf8'});
 assert.equal(evaluated.status,line.includes('= "database_approval_search_20260914"')&&!line.includes('!= "database_approval_search_20260914"')?0:1,'approval search executes only its read-only canaries: '+line);
}
const browserAt=candidateJob.indexOf('pnpm exec playwright install --with-deps chromium');
assert.ok(browserAt>candidateJob.indexOf('pnpm release:preflight')&&browserAt<candidateJob.indexOf('vercel@59.3.0 build --prod'));
assert.ok(candidateJob.includes('FINANCE_BROWSER_CHANNEL: chromium'));
for(const test of ['check_admin_action_browser.cjs','check_shareholder_invoice_ocr_browser.cjs','check_personnel_login_browser.cjs','check_human_accounting_browser_20261002.cjs'])assert.ok(candidateJob.indexOf('node scripts/'+test)>browserAt&&candidateJob.indexOf('node scripts/'+test)<candidateJob.indexOf('vercel@59.3.0 build --prod'));

const employeeBranch=databaseJob.slice(employeePendingAt,readinessPendingAt);
assert.match(employeeBranch,/employee-reliability-prerequisites[\s\S]+--release-phase database_audit_readiness_20260911 --migration-versions 20260911151054[\s\S]+prepare-employee-reliability-rehearsal[\s\S]+finance_employee_reliability_fingerprint\.sql[\s\S]+finance_employee_reliability_canary\.sql[\s\S]+finance_audit_readiness_canary\.sql[\s\S]+employee-reliability-rehearsal\.json[\s\S]+prepare-employee-reliability-apply[\s\S]+--ledger[\s\S]+employee-reliability-apply\.json/);
assert.doesNotMatch(promoteJob,/prepare-employee-reliability-(?:apply|rehearsal)/);
assert.equal((workflow.match(/verify-reports-canary --domain employee_reliability/g)||[]).length,2);
for(const name of ['finance_employee_reliability_fingerprint.sql',...guard.EMPLOYEE_RELIABILITY_POSTFLIGHT_FILES,'finance_employee_reliability_canary.sql']){
 assert.ok(candidateJob.includes('cp scripts/'+name+' "$BUNDLE/release-tools/scripts/"'));
 for(const checker of ['check_release_artifact.js','check_release_source_integrity.js'])assert.ok(fs.readFileSync(path.join(root,'scripts',checker),'utf8').includes("'scripts/"+name+"'"));
}

assert.match(readinessBranch,/readiness-prerequisites[\s\S]+--release-phase database_reporting_integrity_20260911 --migration-versions 20260911135457,20260911135514[\s\S]+prepare-audit-readiness-rehearsal[\s\S]+finance_audit_readiness_fingerprint\.sql[\s\S]+finance_ar_reconciliation_canary\.sql[\s\S]+finance_tax_source_integrity_canary\.sql[\s\S]+finance_audit_readiness_canary\.sql[\s\S]+readiness-rehearsal\.json[\s\S]+prepare-audit-readiness-apply[\s\S]+--ledger[\s\S]+readiness-apply\.json/);
assert.doesNotMatch(promoteJob,/prepare-audit-readiness-(?:apply|rehearsal)/);
assert.equal((workflow.match(/verify-reports-canary --domain audit_readiness/g)||[]).length,2);
for(const name of ['finance_audit_readiness_fingerprint.sql',...guard.AUDIT_READINESS_POSTFLIGHT_FILES,'finance_audit_readiness_canary.sql']){
 assert.ok(candidateJob.includes('cp scripts/'+name+' "$BUNDLE/release-tools/scripts/"'),'Audit readiness must be sealed: '+name);
 for(const checker of ['check_release_artifact.js','check_release_source_integrity.js'])assert.ok(fs.readFileSync(path.join(root,'scripts',checker),'utf8').includes("'scripts/"+name+"'"),'Audit readiness contract must be source-pinned: '+name);
}

assert.match(integrityBranch,/integrity-prerequisites[\s\S]+--release-phase database_amount_search_20260910 --migration-versions 20260910083000[\s\S]+prepare-reporting-integrity-rehearsal[\s\S]+finance_reporting_integrity_fingerprint\.sql[\s\S]+finance_ar_reconciliation_canary\.sql[\s\S]+finance_tax_source_integrity_canary\.sql[\s\S]+integrity-rehearsal\.json[\s\S]+prepare-reporting-integrity-apply[\s\S]+--ledger[\s\S]+integrity-apply\.json/);
assert.doesNotMatch(promoteJob,/prepare-reporting-integrity-(?:apply|rehearsal)/);
for(const domain of ['ar_reconciliation','tax_source_integrity'])assert.equal((workflow.match(new RegExp('verify-reports-canary --domain '+domain,'g'))||[]).length,2);
for(const name of ['finance_reporting_integrity_fingerprint.sql',...guard.REPORTING_INTEGRITY_POSTFLIGHT_FILES,'finance_ar_reconciliation_canary.sql','finance_tax_source_integrity_canary.sql']){
 assert.ok(candidateJob.includes(name),'Reporting integrity gate must be sealed: '+name);
 for(const checker of ['check_release_artifact.js','check_release_source_integrity.js'])assert.ok(fs.readFileSync(path.join(root,'scripts',checker),'utf8').includes("'scripts/"+name+"'"),'Reporting integrity contract must be source-pinned: '+name);
}

assert.match(amountBranch,/amount-search-prerequisites[\s\S]+--release-phase database_reports_20260910 --migration-versions 20260910064324,20260910064325[\s\S]+prepare-amount-search-rehearsal[\s\S]+finance_amount_search_fingerprint\.sql[\s\S]+finance_amount_search_canary\.sql[\s\S]+amount-search-rehearsal\.json[\s\S]+prepare-amount-search-apply[\s\S]+--ledger[\s\S]+amount-search-apply\.json/);
assert.doesNotMatch(promoteJob,/prepare-amount-search-(?:apply|rehearsal)/);
assert.equal((workflow.match(/verify-amount-search-canary/g)||[]).length,2);
for(const name of ['finance_amount_search_fingerprint.sql','finance_amount_search_postflight.sql','finance_amount_search_canary.sql'])assert.ok(candidateJob.includes(name),'Amount search gate must be sealed: '+name);
const reportsBranch=databaseJob.slice(reportsPendingAt,utilityPendingAt);
assert.match(reportsBranch,/finance-reports-prerequisites[\s\S]+--release-phase database_utility_tax_20260909 --migration-versions 20260909083825[\s\S]+reports-prerequisites\.json[\s\S]+prepare-reports-rehearsal[\s\S]+finance_reports_20260910_fingerprint\.sql[\s\S]+finance_production_authenticated_canary\.sql[\s\S]+finance_finalize_accounting_lines_canary\.sql[\s\S]+finance_utility_tax_canary\.sql[\s\S]+finance_canonical_receivables_canary\.sql[\s\S]+finance_reporting_profiles_canary\.sql[\s\S]+reports-rehearsal\.json[\s\S]+prepare-reports-apply[\s\S]+--ledger "\$LEDGER"[\s\S]+finance_canonical_receivables_postflight\.sql[\s\S]+finance_reporting_profiles_postflight\.sql[\s\S]+reports-apply\.json/);
assert.doesNotMatch(promoteJob,/prepare-reports-(?:apply|rehearsal)/);
for(const domain of ['receivables','profiles']){assert.match(databaseJob,new RegExp('verify-reports-canary --domain '+domain));assert.match(promoteJob,new RegExp('verify-reports-canary --domain '+domain+'[\\s\\S]+promote \"\\$DEPLOYMENT_URL\" --yes'));}
for(const domain of ['receivables','profiles']){
  assert.equal((workflow.match(new RegExp('verify-reports-canary --domain '+domain,'g'))||[]).length,2,'Each domain runs once after DB verification and once before promotion');
  assert.ok(databaseJob.indexOf('verify-reports-canary --domain '+domain)>databaseJob.indexOf('verify-ledger --mode post'),'New standalone canary cannot run before the batch is installed');
}
for(const file of ['finance_reports_20260910_fingerprint.sql','finance_canonical_receivables_canary.sql','finance_reporting_profiles_canary.sql','finance_canonical_receivables_postflight.sql','finance_reporting_profiles_postflight.sql'])assert.ok(candidateJob.includes(file),'Reports gate is sealed: '+file);
assert.doesNotMatch(databaseJob.slice(compatAt,databaseJob.indexOf('elif test',compatAt)),/prepare-.*(?:apply|rehearsal)/,'Frontend compatibility never generates mutation SQL');
assert.doesNotMatch(databaseJob.slice(appliedAt),/prepare-(?:history-summary|approval-search|read-latency|history-performance|employee-reliability|audit-readiness|reporting-integrity|amount-search|reports|utility|cases|audit)-apply|prepare-apply/,'Applied recovery never reapplies a migration');
assert.doesNotMatch(promoteJob,/prepare-utility-(?:apply|rehearsal)/);
assert.match(databaseJob,/finance_utility_tax_canary\.sql[\s\S]+verify-utility-canary/);
assert.match(promoteJob,/finance_utility_tax_canary\.sql[\s\S]+verify-utility-canary[\s\S]+promote "\$DEPLOYMENT_URL" --yes/);
assert.ok(candidateJob.includes('finance_utility_tax_postflight.sql')&&candidateJob.includes('finance_utility_tax_canary.sql'),'New gates are sealed into the candidate');
const casesBranch=databaseJob.slice(casesPendingAt,auditPendingAt);
assert.match(casesBranch,/finance-cases-prerequisites[\s\S]+prepare-cases-rehearsal[\s\S]+finance_cases_20260908_fingerprint\.sql[\s\S]+finance_production_authenticated_canary\.sql[\s\S]+finance_finalize_accounting_lines_canary\.sql[\s\S]+finance_finalize_accounting_lines_postflight\.sql[\s\S]+cases-rehearsal\.json[\s\S]+prepare-cases-apply[\s\S]+--ledger "\$LEDGER"[\s\S]+finance_finalize_accounting_lines_postflight\.sql[\s\S]+cases-apply\.json/);
assert.doesNotMatch(promoteJob,/prepare-cases-apply|prepare-cases-rehearsal/);
assert.match(promoteJob,/finance_finalize_accounting_lines_canary\.sql[\s\S]+verify-finalize-canary[\s\S]+promote "\$DEPLOYMENT_URL" --yes/);
assert.match(databaseJob,/authenticated-canary-after\.json[\s\S]+finance_finalize_accounting_lines_canary\.sql[\s\S]+verify-finalize-canary/);
const applies = [...databaseJob.matchAll(/prepare-apply/g)];
assert.equal(applies.length, 1, 'database job must generate exactly one atomic apply payload');
assert.ok(compatAt >= 0 && pendingAt > compatAt && applies[0].index > pendingAt && applies[0].index < appliedAt, 'DB mutation must exist only in a reviewed pending database phase; frontend_compat/applied are read-only paths');
assert.ok((databaseJob.match(/supabase db query --linked/g) || []).length >= 4, 'database job must use pinned linked queries for ledger, gates, rehearsal and apply');
assert.match(databaseJob, /verify-supabase-public-key[\s\S]+auth\/v1\/settings[\s\S]+rest\/v1\/finance_users[\s\S]+finance_submit_expense_request[\s\S]+finance_resubmit_expense_request[\s\S]+classify-ledger/);
assert.match(databaseJob, /prepare-rehearsal[\s\S]+--fingerprint[\s\S]+production-immediately-before-db-contract-manifest\.json[\s\S]+production-immediately-before-db-contract-index\.html[\s\S]+verify-production-baseline[\s\S]+prepare-apply[\s\S]+--ledger "\$LEDGER"/);
const canaryBeforeAt = databaseJob.indexOf('authenticated-canary-before.json');
const classifyAt = databaseJob.indexOf('PHASE_STATE="$(node "$GUARD" classify-ledger');
const canaryAfterAt = databaseJob.indexOf('authenticated-canary-after.json');
const receiptRevalidatedAt = databaseJob.indexOf('node "$GUARD" verify-receipt');
const targetRevalidatedAt = databaseJob.indexOf('node "$GUARD" verify-vercel-target');
const liveFrontendBeforeDbAt = databaseJob.indexOf('production-before-db-contract-index.html');
assert.ok(
  receiptRevalidatedAt >= 0 && targetRevalidatedAt > receiptRevalidatedAt
    && liveFrontendBeforeDbAt > targetRevalidatedAt
    && canaryBeforeAt > liveFrontendBeforeDbAt && canaryBeforeAt < classifyAt,
  'live frontend proof and authenticated canary must run after sealed target revalidation and before DB mutation is classified'
);
assert.ok(canaryAfterAt > classifyAt, 'authenticated canary must pass again after the exact DB phase postflight');
const humanFloatBeforeGate = databaseJob.slice(
  databaseJob.indexOf('- name: Prove authenticated submit, supervisor return and applicant resubmit before DB mutation'),
  databaseJob.indexOf('- name: Classify ledger and apply only when the exact phase remains pending')
);
assert.match(humanFloatBeforeGate, /inputs\.release_phase != 'database_human_float_20261002'/,
  'only this DB-only phase must avoid the unrelated canary that requires employees to be signed in');
assert.match(humanFloatBeforeGate, /inputs\.release_phase != 'database_income_reconcile_20261002'/,
  'income reconciliation DB-only phase must avoid the unrelated employee-session canary');
assert.match(humanFloatBeforeGate, /inputs\.release_phase != 'database_invoice_revenue_result_20261002'/,
  'invoice revenue result DB-only phase must avoid the unrelated employee-session canary');
assert.match(humanFloatBeforeGate, /inputs\.release_phase != 'database_purchase_final_amount_20261006'/,
  'purchase final amount DB-only phase must avoid the unrelated employee-session canary');
const afterAuthConditionAt = databaseJob.lastIndexOf('if test "$RELEASE_PHASE" != "database_read_latency_20260913"', canaryAfterAt);
assert.ok(afterAuthConditionAt >= 0, 'postflight authenticated canary condition must remain present');
assert.match(databaseJob.slice(afterAuthConditionAt, canaryAfterAt), /test "\$RELEASE_PHASE" != "database_human_float_20261002"/,
  'the same DB-only phase must avoid the session-dependent postflight canary');
assert.match(databaseJob.slice(afterAuthConditionAt, canaryAfterAt), /test "\$RELEASE_PHASE" != "database_income_reconcile_20261002"/,
  'income reconciliation must avoid the session-dependent postflight canary');
assert.match(databaseJob.slice(afterAuthConditionAt, canaryAfterAt), /test "\$RELEASE_PHASE" != "database_invoice_revenue_result_20261002"/,
  'invoice revenue result must avoid the session-dependent postflight canary');
assert.match(databaseJob.slice(afterAuthConditionAt, canaryAfterAt), /test "\$RELEASE_PHASE" != "database_purchase_final_amount_20261006"/,
  'purchase final amount must avoid the session-dependent postflight canary');
assert.ok(databaseJob.indexOf('finance_human_accounting_float_canary.sql') > classifyAt,
  'the dedicated rollback-only human accounting canary must remain in the DB phase');
assert.ok(databaseJob.indexOf('finance_income_reconcile_canary.sql') > classifyAt,
  'the dedicated rollback-only income reconciliation canary must remain in the DB phase');
assert.ok(databaseJob.indexOf('finance_invoice_revenue_result_canary.sql') > classifyAt,
  'the dedicated rollback-only invoice revenue result canary must remain in the DB phase');
assert.ok(databaseJob.indexOf('finance_purchase_final_amount_canary.sql') > classifyAt,
  'the dedicated rollback-only purchase final amount canary must remain in the DB phase');
assert.match(databaseJob,/prepare-income-reconcile-rehearsal[\s\S]+prepare-income-reconcile-apply[\s\S]+finance_income_reconcile_postflight\.sql[\s\S]+finance_income_reconcile_canary\.sql/,
  'the income reconciliation phase must rehearse, apply atomically, and verify independently');
assert.match(databaseJob,/database_income_reconcile_20261002[\s\S]+verify-db-only-alias/,
  'DB-only reconciliation must verify the production alias and frontend manifest did not change');
assert.match(databaseJob,/prepare-invoice-revenue-result-rehearsal[\s\S]+prepare-invoice-revenue-result-apply[\s\S]+finance_invoice_revenue_result_postflight\.sql[\s\S]+finance_invoice_revenue_result_canary\.sql/,
  'invoice revenue result phase must rehearse, apply atomically, and verify independently');
assert.match(databaseJob,/prepare-purchase-final-amount-rehearsal[\s\S]+prepare-purchase-final-amount-apply[\s\S]+finance_purchase_final_amount_postflight\.sql[\s\S]+finance_purchase_final_amount_canary\.sql/,
  'purchase final amount phase must rehearse, apply atomically, and verify independently');
assert.match(databaseJob,/prepare-invoice-item-bind-rehearsal[\s\S]+prepare-invoice-item-bind-apply[\s\S]+finance_invoice_item_bind_postflight\.sql[\s\S]+finance_invoice_item_bind_canary\.sql/,
  'invoice item binding phase must rehearse, apply atomically, and verify independently');
assert.match(databaseJob,/prepare-personal-history-rehearsal[\s\S]+prepare-personal-history-apply[\s\S]+finance_personal_history_postflight\.sql[\s\S]+finance_personal_history_canary\.sql/,
  'personal document history phase must rehearse, apply atomically, and verify independently');
assert.equal((databaseJob.match(/if test "\$RELEASE_PHASE" = "database_human_float_20261002"[^\n]*test "\$RELEASE_PHASE" = "database_personal_history_permission_20261008" \|\| test "\$RELEASE_PHASE" = "database_bill_batch_bulk_20261008" \|\| test "\$RELEASE_PHASE" = "database_invoice_batch_bulk_20261014" \|\| test "\$RELEASE_PHASE" = "database_bounded_global_logout_20261014" \|\| test "\$RELEASE_PHASE" = "database_bill_approval_bulk_20261015"; then/g)||[]).length,2,
  'both DB-only alias checks must cover personal history permission');
assert.match(databaseJob,/prepare-personal-history-permission-rehearsal[\s\S]+prepare-personal-history-permission-apply[\s\S]+finance_personal_history_permission_postflight\.sql[\s\S]+finance_personal_history_permission_canary\.sql/,
  'personal history permission phase must rehearse, apply atomically, and verify independently');
assert.equal((workflow.match(/if test "\$RELEASE_PHASE" = "frontend_compat"; then\n\s+\(cd "\$TOOLS" && supabase db query --linked --file scripts\/finance_personal_history_permission_canary\.sql/g)||[]).length,2,
  'frontend compatibility and promotion both recheck personal history grants and retired legacy RPCs');
assert.equal((workflow.match(/case "\$RELEASE_PHASE" in frontend_compat\) APPROVAL_SEARCH_CANARY="scripts\/finance_approval_search_permission_canary\.sql" ;; esac/g)||[]).length,2,
  'frontend compatibility and promotion use the successor search canary after retiring the oldest history RPC');
assert.match(databaseJob,/prepare-bill-batch-bulk-rehearsal[\s\S]+prepare-bill-batch-bulk-apply[\s\S]+finance_bill_batch_bulk_postflight\.sql[\s\S]+finance_bill_batch_bulk_canary\.sql/,
  'bill batch bulk phase must rehearse, apply atomically, and verify independently');
const identityOncePendingAt=databaseJob.indexOf('elif test "$PHASE_STATE" = "pending" && test "$RELEASE_PHASE" = "database_personal_history_identity_once_20261012"; then');
const identityOncePendingEnd=databaseJob.indexOf('\n          elif test "$PHASE_STATE"',identityOncePendingAt+1);
assert(identityOncePendingAt>=0&&identityOncePendingEnd>identityOncePendingAt);
assert.match(databaseJob.slice(identityOncePendingAt,identityOncePendingEnd),/finance_personal_history_identity_once_preflight\.sql[\s\S]+prepare-personal-history-identity-once-rehearsal[\s\S]+finance_personal_history_identity_once_fingerprint\.sql[\s\S]+finance_personal_history_identity_once_canary\.sql[\s\S]+finance_personal_history_identity_once_postflight\.sql[\s\S]+prepare-personal-history-identity-once-apply/);
assert.match(databaseJob,/database_personal_history_identity_once_20261012"; then\n\s+POSTFLIGHT_SOURCE="\$TOOLS\/scripts\/finance_personal_history_identity_once_postflight.sql"[\s\S]+run_gate "\$POSTFLIGHT_SOURCE"[\s\S]+database_personal_history_identity_once_20261012"; then\n\s+\(cd "\$TOOLS" && supabase db query[\s\S]+verify-reports-canary --domain personal_history_identity_once/);
assert.match(promoteJob,/database_personal_history_identity_once_20261012"; then\n\s+PROMOTION_POSTFLIGHT_SOURCE="\$TOOLS\/scripts\/finance_personal_history_identity_once_postflight.sql"[\s\S]+prepare-phase-query[\s\S]+database_personal_history_identity_once_20261012"; then\n\s+\(cd "\$TOOLS" && supabase db query[\s\S]+verify-reports-canary --domain personal_history_identity_once[\s\S]+promote "\$DEPLOYMENT_URL" --yes/);
assert.doesNotMatch(workflow,/database_personal_history_identity_once_20261010/,'new canary phase must never silently miss because of a reused date');
assert.equal((workflow.match(/verify-reports-canary --domain personal_history_identity_once/g)||[]).length,2,'database and promotion must execute the new exact canary');
assert.doesNotMatch(promoteJob,/prepare-personal-history-identity-once-(?:rehearsal|apply)/);
assert.doesNotMatch(promoteJob.match(/^    if: \$\{\{[^\n]+/m)?.[0]||'',/database_personal_history_identity_once_20261012/);
assert(workflow.includes('FINANCE_HISTORY_NATIVE_REQUIRED=1 pnpm test:personal-history-identity-once'),'sealed candidate must prove native parity before formal DDL');
assert(workflow.includes('pnpm test:personnel-workspace-browser')&&workflow.includes('pnpm test:history-search-browser'));
for(const filename of ['finance_personal_history_identity_once_preflight.sql','finance_personal_history_identity_once_postflight.sql','finance_personal_history_identity_once_fingerprint.sql','finance_personal_history_identity_once_canary.sql','check_finance_personal_history_identity_once_20261012.cjs','fixtures/finance_history_identity_authorities_20261012.json']){
  assert(workflow.includes('scripts/'+filename),'identity-once gate/fixture must be copied into sealed release tools: '+filename);
  for(const checker of ['check_release_artifact.js','check_release_source_integrity.js'])assert(fs.readFileSync(path.join(root,'scripts',checker),'utf8').includes("'scripts/"+filename+"'"));
}
const invoiceBatchApprovalPendingAt=databaseJob.indexOf('elif test "$PHASE_STATE" = "pending" && test "$RELEASE_PHASE" = "database_invoice_batch_approval_20261010"; then');
const invoiceBatchApprovalPendingEnd=databaseJob.indexOf('\n          elif test "$PHASE_STATE"',invoiceBatchApprovalPendingAt+1);
assert.ok(invoiceBatchApprovalPendingAt>=0 && invoiceBatchApprovalPendingEnd>invoiceBatchApprovalPendingAt,
  'invoice batch approval must have its own pending DB phase');
const invoiceBatchApprovalPending=databaseJob.slice(invoiceBatchApprovalPendingAt,invoiceBatchApprovalPendingEnd);
assert.match(invoiceBatchApprovalPending,/finance_invoice_batch_approval_preflight\.sql[\s\S]+prepare-invoice-batch-approval-rehearsal[\s\S]+finance_invoice_batch_approval_fingerprint\.sql[\s\S]+finance_invoice_batch_approval_canary\.sql[\s\S]+finance_invoice_batch_approval_postflight\.sql[\s\S]+prepare-invoice-batch-approval-apply[\s\S]+finance_invoice_batch_approval_postflight\.sql/,
  'invoice batch approval must preflight, rehearse both migrations, apply and postflight as one reviewed phase');
assert.match(databaseJob,/verify-ledger --mode post[\s\S]+POSTFLIGHT_SOURCE="\$TOOLS\/scripts\/finance_production_db_postflight\.sql"[\s\S]+database_invoice_batch_approval_20261010"; then\n\s+POSTFLIGHT_SOURCE="\$TOOLS\/scripts\/finance_invoice_batch_approval_postflight\.sql"[\s\S]+run_gate "\$POSTFLIGHT_SOURCE"[\s\S]+finance_invoice_batch_approval_canary\.sql[\s\S]+verify-reports-canary --domain invoice_batch_approval/,
  'invoice batch approval recovery must independently recheck exact postflight and rollback-only canary');
assert.match(promoteJob,/database_invoice_batch_approval_20261010"; then\n\s+PROMOTION_POSTFLIGHT_SOURCE="\$TOOLS\/scripts\/finance_invoice_batch_approval_postflight\.sql"[\s\S]+prepare-phase-query[\s\S]+promotion-postflight\.sql[\s\S]+finance_invoice_batch_approval_canary\.sql[\s\S]+verify-reports-canary --domain invoice_batch_approval[\s\S]+promote "\$DEPLOYMENT_URL" --yes/,
  'promotion must recheck exact invoice batch postflight and canary before alias mutation');
const promotionLegacyCanaryAt=promoteJob.indexOf('> "$RUNNER_TEMP/promotion-authenticated-canary.json"');
assert.ok(promotionLegacyCanaryAt>promoteJob.indexOf('verify-reports-canary --domain invoice_batch_approval'));
const promotionLegacyGate=promoteJob.slice(0,promotionLegacyCanaryAt).split('\n').filter(line=>line.trimStart().startsWith('if test "$RELEASE_PHASE"')).at(-1)?.trim();
assert.match(promotionLegacyGate,/test "\$RELEASE_PHASE" != "database_invoice_batch_approval_20261010"/);
for(const [phase,expected] of [[guard.RELEASE_PHASE_DATABASE_INVOICE_BATCH_APPROVAL,1],['database_demo_password_retirement_20260925',0]]){
  const result=spawnSync('sh',['-c',promotionLegacyGate.replace(/; then$/,'')+'; then exit 0; else exit 1; fi'],{env:{...process.env,RELEASE_PHASE:phase},encoding:'utf8'});
  assert.equal(result.status,expected,`legacy promotion auth canary gate for ${phase}: ${result.stderr}`);
}
assert.doesNotMatch(promoteJob,/prepare-invoice-batch-approval-(?:apply|rehearsal)/,
  'promotion must never reapply invoice batch migrations');
assert.match(promoteJob,/if: \$\{\{[^\n]+\}\}/,
  'the frontend candidate must still be promoted by the reviewed phase');
assert.doesNotMatch(promoteJob.match(/^    if: \$\{\{[^\n]+/m)?.[0]||'',/database_invoice_batch_approval_20261010/,
  'the invoice batch approval phase must not be treated as DB-only');
assert.equal((databaseJob.match(/if test "\$RELEASE_PHASE" = "database_human_float_20261002" \|\| test "\$RELEASE_PHASE" = "database_income_reconcile_20261002" \|\| test "\$RELEASE_PHASE" = "database_invoice_revenue_result_20261002" \|\| test "\$RELEASE_PHASE" = "database_purchase_final_amount_20261006" \|\| test "\$RELEASE_PHASE" = "database_invoice_item_bind_20261008" \|\| test "\$RELEASE_PHASE" = "database_personal_history_20261008" \|\| test "\$RELEASE_PHASE" = "database_personal_history_permission_20261008" \|\| test "\$RELEASE_PHASE" = "database_bill_batch_bulk_20261008" \|\| test "\$RELEASE_PHASE" = "database_invoice_batch_bulk_20261014" \|\| test "\$RELEASE_PHASE" = "database_bounded_global_logout_20261014" \|\| test "\$RELEASE_PHASE" = "database_bill_approval_bulk_20261015"; then/g)||[]).length,2,
  'both DB-only alias checks must cover invoice item binding, permission, and bill batch bulk');
assert.match(promoteJob,/inputs\.release_phase != 'database_income_reconcile_20261002'/,
  'income reconciliation DB-only phase must not promote a frontend candidate');
assert.match(promoteJob,/inputs\.release_phase != 'database_invoice_revenue_result_20261002'/,
  'invoice revenue result DB-only phase must not promote a frontend candidate');
assert.match(promoteJob,/inputs\.release_phase != 'database_bill_batch_bulk_20261008'/,
  'bill batch bulk DB-only phase must not promote a frontend candidate');
assert.match(promoteJob,/inputs\.release_phase != 'database_purchase_final_amount_20261006'/,
  'purchase final amount DB-only phase must not promote a frontend candidate');
assert.match(promoteJob,/inputs\.release_phase != 'database_personal_history_20261008'/,
  'personal document history DB-only phase must not promote a frontend candidate');
assert.match(promoteJob,/inputs\.release_phase != 'database_personal_history_permission_20261008'/,
  'personal history permission DB-only phase must not promote a frontend candidate');
assert.match(promoteJob, /finance_production_db_postflight\.sql[\s\S]+promotion-authenticated-canary\.json[\s\S]+promote "\$DEPLOYMENT_URL" --yes/);
const rehearsalAt = databaseJob.indexOf('node "$GUARD" prepare-rehearsal');
const finalLiveFrontendProofAt = databaseJob.lastIndexOf('node "$GUARD" verify-production-baseline');
assert.ok(
  rehearsalAt >= 0 && finalLiveFrontendProofAt > rehearsalAt && finalLiveFrontendProofAt < applies[0].index,
  'database_v3 must re-prove the live SHA/meta immediately after rehearsal and before prepare-apply'
);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-release-contract-'));
try {
  const canaryWrapped = path.join(temp, 'canary-wrapped.json');
  const canaryDirect = path.join(temp, 'canary-direct.json');
  const canaryString = path.join(temp, 'canary-string.json');
  const canaryUnsafe = path.join(temp, 'canary-unsafe.json');
  const canaryWorkerUnsafe = path.join(temp, 'canary-worker-unsafe.json');
  const canaryResult = {
    canary: 'authenticated_submit_return_resubmit',
    notification_worker_contract_verified: true,
    notifications_enqueued: false,
    ok: true,
    rolled_back: true
  };
  fs.writeFileSync(canaryWrapped, JSON.stringify({ boundary: 'x', rows: [{ authenticated_canary_result: canaryResult }] }));
  fs.writeFileSync(canaryDirect, JSON.stringify([{ authenticated_canary_result: canaryResult }]));
  fs.writeFileSync(canaryString, JSON.stringify({ data: [{ authenticated_canary_result: JSON.stringify(canaryResult) }] }));
  fs.writeFileSync(canaryUnsafe, JSON.stringify({ rows: [{ authenticated_canary_result: { ...canaryResult, rolled_back: false } }] }));
  fs.writeFileSync(canaryWorkerUnsafe, JSON.stringify({ rows: [{ authenticated_canary_result: { ...canaryResult, notification_worker_contract_verified: false } }] }));
  guard.verifyAuthenticatedCanary(canaryWrapped);
  guard.verifyAuthenticatedCanary(canaryDirect);
  guard.verifyAuthenticatedCanary(canaryString);
  assert.throws(() => guard.verifyAuthenticatedCanary(canaryUnsafe), /did not complete safely/);
  assert.throws(() => guard.verifyAuthenticatedCanary(canaryWorkerUnsafe), /did not complete safely/);
  assert.throws(() => guard.verifyAuthenticatedCanary(path.join(temp, 'missing-canary.json')), /not valid JSON/);

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
  const v3Target = path.join(migrations, '20260827052447_route_v3.sql');
  const portalLinkRepair = path.join(migrations, '20260828015718_portal_link_repair.sql');
  const topLevelCeoRoute = path.join(migrations, '20260831042040_top_level_ceo_self_route.sql');
  const expenseDerivedStatus = path.join(migrations, '20260831043517_expense_submit_derived_status.sql');
  const finalAccountantSelfPost = path.join(migrations, '20260901024020_final_accountant_self_post.sql');
  const formalCashierRepair = path.join(migrations, '20260901073241_assign_ceo_cashier_and_reassign_pending_cashier.sql');
  const formalCashierSelfDisbursement = path.join(migrations, '20260901081807_allow_formal_cashier_self_disbursement.sql');
  const humanAccounting = path.join(migrations, '20260902054834_preserve_human_accounting_authority_v1.sql');
  fs.writeFileSync(notification, '-- comment\nselect 1;\n');
  fs.writeFileSync(target, '-- comment\nselect 2;\n');
  fs.writeFileSync(v3Target, '-- comment\nselect 3;\n');
  fs.writeFileSync(portalLinkRepair, '-- comment\nselect 4;\n');
  fs.writeFileSync(topLevelCeoRoute, '-- comment\nselect 5;\n');
  fs.writeFileSync(expenseDerivedStatus, '-- comment\nselect 6;\n');
  fs.writeFileSync(finalAccountantSelfPost, '-- comment\nselect 7;\n');
  fs.writeFileSync(formalCashierRepair, '-- comment\nselect 8;\n');
  fs.writeFileSync(formalCashierSelfDisbursement, '-- comment\nselect 9;\n');
  fs.writeFileSync(humanAccounting, '-- comment\nselect 10;\n');
  fs.writeFileSync(path.join(migrations,guard.AR_MAPPING_MIGRATIONS[0]+'_ar_mapping.sql'),'select 15;\n');
  for(const version of guard.APPROVAL_SEARCH_MIGRATIONS)fs.writeFileSync(path.join(migrations,version+'_approval_search.sql'),'select 18;\n');
  for(const version of guard.AUDIT_REMEDIATION_MIGRATIONS)fs.writeFileSync(path.join(migrations,version+'_audit_remediation.sql'),'select 16;\n');
  const ledger = path.join(temp, 'ledger');
  fs.writeFileSync(ledger, '20260825000000\n');
  const syntheticVersions = ['20260825000000'];
  const syntheticBaseline = { count: 1, lastVersion: syntheticVersions[0], sha256: guard.ledgerSha256(syntheticVersions) };
  assert.throws(() => guard.classifyLedger(ledger, migrations, 'frontend_compat', 'none', syntheticBaseline), /complete v1\/v2\/v3 authority chain/);
  fs.appendFileSync(ledger, '20260826070814\n');
  fs.appendFileSync(ledger, '20260826155840\n');
  assert.throws(() => guard.classifyLedger(ledger, migrations, 'frontend_compat', 'none', syntheticBaseline), /complete v1\/v2\/v3 authority chain/);
  assert.equal(guard.classifyLedger(ledger, migrations, 'database_v3', '20260827052447', syntheticBaseline), 'pending');
  guard.verifyLedger('pre', ledger, migrations, 'database_v3', '20260827052447', syntheticBaseline);
  assert.throws(() => guard.classifyLedger(ledger, migrations, 'database_v3', 'none', syntheticBaseline), /must use/);
  fs.appendFileSync(ledger, '20260827052447\n');
  assert.throws(() => guard.classifyLedger(ledger, migrations, 'frontend_compat', 'none', syntheticBaseline), /reviewed adopted migration/);
  assert.throws(() => guard.classifyLedger(ledger, migrations, 'database_v3', '20260827052447', syntheticBaseline), /reviewed adopted migration/);
  fs.appendFileSync(ledger, '20260828015718\n');
  assert.throws(() => guard.classifyLedger(ledger, migrations, 'frontend_compat', 'none', syntheticBaseline), /reviewed adopted migration/);
  fs.appendFileSync(ledger, '20260831042040\n');
  assert.throws(() => guard.classifyLedger(ledger, migrations, 'frontend_compat', 'none', syntheticBaseline), /reviewed adopted migration/);
  fs.appendFileSync(ledger, '20260831043517\n');
  assert.throws(() => guard.classifyLedger(ledger, migrations, 'frontend_compat', 'none', syntheticBaseline), /reviewed adopted migration/);
  fs.appendFileSync(ledger, '20260901024020\n');
  assert.throws(() => guard.classifyLedger(ledger, migrations, 'frontend_compat', 'none', syntheticBaseline), /reviewed adopted migration/);
  fs.appendFileSync(ledger, '20260901073241\n');
  assert.throws(() => guard.classifyLedger(ledger, migrations, 'frontend_compat', 'none', syntheticBaseline), /reviewed adopted migration/);
  fs.appendFileSync(ledger, '20260901081807\n');
  assert.equal(guard.classifyLedger(ledger, migrations, 'database_v3', '20260827052447', syntheticBaseline), 'applied');
  guard.verifyLedger('post', ledger, migrations, 'database_v3', '20260827052447', syntheticBaseline);
  assert.equal(guard.classifyLedger(ledger, migrations, 'database_human_accounting', '20260902054834', syntheticBaseline), 'pending');
  guard.verifyLedger('pre', ledger, migrations, 'database_human_accounting', '20260902054834', syntheticBaseline);
  assert.throws(() => guard.classifyLedger(ledger, migrations, 'frontend_compat', 'none', syntheticBaseline), /requires applied migration/);
  fs.appendFileSync(ledger, '20260902054834\n');
  assert.equal(guard.classifyLedger(ledger, migrations, 'database_human_accounting', '20260902054834', syntheticBaseline), 'applied');
  guard.verifyLedger('post', ledger, migrations, 'database_human_accounting', '20260902054834', syntheticBaseline);
  assert.throws(() => guard.classifyLedger(ledger, migrations, 'frontend_compat', 'none', syntheticBaseline), /complete audit migration batch/);
  fs.appendFileSync(ledger, guard.AUDIT_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/database cases migration batch/);
  fs.appendFileSync(ledger,guard.CASE_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/utility tax migration batch/);
  fs.appendFileSync(ledger,guard.UTILITY_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/financial reports migration batch/);
  fs.appendFileSync(ledger,guard.REPORT_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/amount search migration/);
  fs.appendFileSync(ledger,guard.AMOUNT_SEARCH_MIGRATIONS.join('\n')+'\n');
assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/reporting integrity migration batch/);
fs.appendFileSync(ledger,guard.REPORTING_INTEGRITY_MIGRATIONS.join('\n')+'\n');
assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/audit readiness migration batch/);
fs.appendFileSync(ledger,guard.AUDIT_READINESS_MIGRATIONS.join('\n')+'\n');
assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/employee reliability migration batch/);
fs.appendFileSync(ledger,guard.EMPLOYEE_RELIABILITY_MIGRATIONS.join('\n')+'\n');
assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/history performance migration batch/);
fs.appendFileSync(ledger,guard.HISTORY_PERFORMANCE_MIGRATIONS.join('\n')+'\n');
assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/read latency migration batch/);
fs.appendFileSync(ledger,guard.READ_LATENCY_MIGRATIONS.join('\n')+'\n');
assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/AR mapping migration batch/);
assert.equal(guard.classifyLedger(ledger,migrations,guard.RELEASE_PHASE_DATABASE_AR_MAPPING,guard.AR_MAPPING_MIGRATIONS.join(','),syntheticBaseline),'pending');
fs.appendFileSync(ledger,guard.AR_MAPPING_MIGRATIONS.join('\n')+'\n');
assert.equal(guard.classifyLedger(ledger,migrations,guard.RELEASE_PHASE_DATABASE_AR_MAPPING,guard.AR_MAPPING_MIGRATIONS.join(','),syntheticBaseline),'applied');
assert.equal(guard.classifyLedger(ledger,migrations,guard.RELEASE_PHASE_DATABASE_AUDIT_REMEDIATION,guard.AUDIT_REMEDIATION_MIGRATIONS.join(','),syntheticBaseline),'pending');
assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/audit remediation migration batch/);
fs.appendFileSync(ledger,guard.AUDIT_REMEDIATION_MIGRATIONS[0]+'\n');
assert.throws(()=>guard.classifyLedger(ledger,migrations,guard.RELEASE_PHASE_DATABASE_AUDIT_REMEDIATION,guard.AUDIT_REMEDIATION_MIGRATIONS.join(','),syntheticBaseline),/partially installed/);
fs.appendFileSync(ledger,guard.AUDIT_REMEDIATION_MIGRATIONS[1]+'\n');
assert.equal(guard.classifyLedger(ledger,migrations,guard.RELEASE_PHASE_DATABASE_AUDIT_REMEDIATION,guard.AUDIT_REMEDIATION_MIGRATIONS.join(','),syntheticBaseline),'applied');
  assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/approval search migration batch/);
  fs.appendFileSync(ledger,guard.APPROVAL_SEARCH_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/history summary migration batch/);
  fs.appendFileSync(ledger,guard.HISTORY_SUMMARY_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/invoice.*(?:scope|read).*migration batch/i);
  fs.appendFileSync(ledger,guard.INVOICE_READ_SCOPE_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/AR read scope migration batch/);
  fs.appendFileSync(ledger,guard.AR_READ_SCOPE_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/HR bridge migration batch/);
  fs.appendFileSync(ledger,guard.HR_BRIDGE_MIGRATIONS.filter(v=>!guard.AR_READ_SCOPE_MIGRATIONS.includes(v)).join('\n')+'\n');
  fs.writeFileSync(ledger,fs.readFileSync(ledger,'utf8').trim().split('\n').sort().join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/audit security migration batch/);
  fs.appendFileSync(ledger,guard.AUDIT_SECURITY_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/adopted HR directory export migration/);
  fs.appendFileSync(ledger,guard.HR_DIRECTORY_EXPORT_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/20260927 audit controls/);
  fs.appendFileSync(ledger,[...guard.REVENUE_REPAIR_MIGRATIONS,...guard.OPERATIONAL_STABILITY_MIGRATIONS,...guard.DEMO_PASSWORD_RETIREMENT_MIGRATIONS,...guard.AUDIT_CONTROLS_20260927_MIGRATIONS].join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/complete HR contractor/);
  fs.appendFileSync(ledger,guard.HR_CONTRACTOR_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/portal session logout/);
  fs.appendFileSync(ledger,guard.PORTAL_SESSION_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/external labor batch/);
  fs.appendFileSync(ledger,guard.EXTERNAL_LABOR_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/attachment claim batch/);
  fs.appendFileSync(ledger,guard.ATTACHMENT_CLAIM_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/staged-attachment cleanup policy/);
  fs.appendFileSync(ledger,guard.ATTACHMENT_STAGED_CLEANUP_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/income reconciliation migration/);
  fs.appendFileSync(ledger,[...guard.HUMAN_FLOAT_MIGRATIONS,...guard.INCOME_RECONCILE_MIGRATIONS].join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/invoice revenue result RPC/);
  fs.appendFileSync(ledger,guard.INVOICE_REVENUE_RESULT_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/nonretry personnel conflict migration/);
  fs.appendFileSync(ledger,guard.PERSONNEL_CONFLICT_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/reliable personnel receipt migration/);
  fs.appendFileSync(ledger,guard.PERSONNEL_RECEIPT_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/procurement specialized action guard/);
  fs.appendFileSync(ledger,guard.PROCUREMENT_ACTION_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/applicant withdrawal transaction guard/);
  fs.appendFileSync(ledger,guard.APPLICANT_WITHDRAW_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/purchase final amount exact lock/);
  fs.appendFileSync(ledger,guard.PURCHASE_FINAL_AMOUNT_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/historical invoice item binding RPC/);
  fs.appendFileSync(ledger,guard.INVOICE_ITEM_BIND_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger, migrations, 'frontend_compat', 'none', syntheticBaseline),/personal document history RPC/);
  fs.appendFileSync(ledger,guard.PERSONAL_HISTORY_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/personal history permission guard/);
  fs.appendFileSync(ledger,guard.PERSONAL_HISTORY_PERMISSION_MIGRATIONS.join('\n')+'\n');
  assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/personnel migration file is missing/);
  for(const version of [...guard.PERSONNEL_CONFLICT_MIGRATIONS,...guard.PERSONNEL_RECEIPT_MIGRATIONS,...guard.APPLICANT_WITHDRAW_MIGRATIONS,...guard.PURCHASE_FINAL_AMOUNT_MIGRATIONS,...guard.INVOICE_ITEM_BIND_MIGRATIONS,...guard.PERSONAL_HISTORY_MIGRATIONS,...guard.PERSONAL_HISTORY_PERMISSION_MIGRATIONS,...guard.INVOICE_BATCH_BULK_MIGRATIONS]){
    const filename=fs.readdirSync(path.join(root,'supabase/migrations')).find(name=>name.startsWith(version+'_'));
    fs.copyFileSync(path.join(root,'supabase/migrations',filename),path.join(migrations,filename));
  }
  assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',syntheticBaseline),/invoice batch bulk transaction/);
  fs.appendFileSync(ledger,guard.INVOICE_BATCH_BULK_MIGRATIONS.join('\n')+'\n');
  assert.equal(guard.classifyLedger(ledger, migrations, 'frontend_compat', 'none', syntheticBaseline), 'compat');
  guard.verifyLedger('pre', ledger, migrations, 'frontend_compat', 'none', syntheticBaseline);
  guard.verifyLedger('post', ledger, migrations, 'frontend_compat', 'none', syntheticBaseline);
  fs.appendFileSync(ledger, '20991231000000\n');
  assert.throws(() => guard.classifyLedger(ledger, migrations, 'frontend_compat', 'none', syntheticBaseline), /unreviewed post-baseline migration/);
  const duplicateDir = path.join(temp, 'duplicate'); fs.mkdirSync(duplicateDir);
  fs.writeFileSync(path.join(duplicateDir, '20260826070814_a.sql'), 'begin;\ncommit;\n');
  fs.writeFileSync(path.join(duplicateDir, '20260826070814_b.sql'), 'begin;\ncommit;\n');
  assert.throws(() => guard.migrationFiles(duplicateDir), /duplicated/);
  const rehearsalFingerprint = path.join(temp, 'fingerprint.sql');
  fs.writeFileSync(rehearsalFingerprint, "\\set ON_ERROR_STOP on\nwith value as (select 'stable'::text fingerprint) select md5(fingerprint) fingerprint from value;\n");
  const rehearsalCanary = path.join(temp, 'authenticated-canary.sql');
  fs.writeFileSync(rehearsalCanary, [
    '-- rollback-only authenticated test',
    'begin isolation level repeatable read read only;',
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
  const legacyCanary = path.join(temp, 'authenticated-canary-legacy.sql');
  fs.writeFileSync(legacyCanary, fs.readFileSync(rehearsalCanary, 'utf8').replace(' repeatable read read only;', ' repeatable read;'));
  guard.prepareRehearsal(target, path.join(temp, 'legacy-canary-rehearsal.sql'), '20260826155840', rehearsalFingerprint, legacyCanary);
  const gateSource = path.join(temp, 'gate.sql');
  const gateOutput = path.join(temp, 'gate-rendered.sql');
  fs.writeFileSync(gateSource, "\\set ON_ERROR_STOP on\nselect set_config('finance.release_migration_versions', :'migration_versions', false);\nselect 1;\n");
  guard.prepareGateQuery(gateSource, gateOutput, '20260826070814');
  assert.match(fs.readFileSync(gateOutput, 'utf8'), /^begin read only;\nset local statement_timeout/);
  assert.match(fs.readFileSync(gateOutput, 'utf8'), /'20260826070814'/);
  assert.doesNotMatch(fs.readFileSync(gateOutput, 'utf8'), /\\set|:'migration_versions'/);
  const phasePostflightSource = path.join(temp, 'finance_production_db_postflight.sql');
  const compatGateOutput = path.join(temp, 'compat-gate-rendered.sql');
  fs.writeFileSync(phasePostflightSource, "\\set ON_ERROR_STOP on\nselect set_config('finance.release_migration_versions', :'migration_versions', false);\nselect 1;\n");
  fs.writeFileSync(path.join(temp,'finance_audit_20260907_postflight.sql'), '\\set ON_ERROR_STOP on\nselect 2;\n');
  fs.writeFileSync(path.join(temp,'finance_finalize_accounting_lines_postflight.sql'), '\\set ON_ERROR_STOP on\nselect 3;\n');
  fs.writeFileSync(path.join(temp,'finance_utility_tax_postflight.sql'), '\\set ON_ERROR_STOP on\nselect 4;\n');
  fs.writeFileSync(path.join(temp,'finance_production_human_accounting_canary.sql'), '\\set ON_ERROR_STOP on\nselect 7;\n');
  fs.writeFileSync(path.join(temp,'finance_canonical_receivables_postflight.sql'), '\\set ON_ERROR_STOP on\nselect 5;\n');
  fs.writeFileSync(path.join(temp,'finance_reporting_profiles_postflight.sql'), '\\set ON_ERROR_STOP on\nselect 6;\n');
  fs.writeFileSync(path.join(temp,'finance_amount_search_postflight.sql'), '\\set ON_ERROR_STOP on\nselect 8;\n');
  fs.writeFileSync(path.join(temp,'finance_ar_reconciliation_postflight.sql'), '\\set ON_ERROR_STOP on\nselect 9;\n');
  fs.writeFileSync(path.join(temp,'finance_tax_source_integrity_postflight.sql'), '\\set ON_ERROR_STOP on\nselect 10;\n');
  fs.writeFileSync(path.join(temp,'finance_audit_readiness_postflight.sql'), '\\set ON_ERROR_STOP on\nselect 11;\n');
  fs.writeFileSync(path.join(temp,'finance_employee_reliability_postflight.sql'), '\\set ON_ERROR_STOP on\nselect 12;\n');
  fs.writeFileSync(path.join(temp,'finance_approval_history_postflight.sql'), '\\set ON_ERROR_STOP on\nselect 13;\n');
  fs.writeFileSync(path.join(temp,'finance_statement_source_postflight.sql'), '\\set ON_ERROR_STOP on\nselect 14;\n');
  fs.writeFileSync(path.join(temp,'finance_ar_mapping_postflight.sql'), '\\set ON_ERROR_STOP on\nselect 15;\n');
  fs.writeFileSync(path.join(temp,'finance_revenue_repair_postflight.sql'), '\\set ON_ERROR_STOP on\nselect 25;\n');
  fs.writeFileSync(path.join(temp,'finance_operational_stability_postflight.sql'), '\\set ON_ERROR_STOP on\nselect 24;\n');
  guard.APPROVAL_SEARCH_POSTFLIGHT_FILES.forEach(name=>fs.writeFileSync(path.join(temp,name),'\\set ON_ERROR_STOP on\nselect 18;\n'));
  guard.HISTORY_SUMMARY_POSTFLIGHT_FILES.forEach(name=>fs.writeFileSync(path.join(temp,name),'\\set ON_ERROR_STOP on\nselect 19;\n'));
  fs.writeFileSync(path.join(temp,'finance_approval_history_summary_permission_postflight.sql'),'\\set ON_ERROR_STOP on\nselect 29;\n');
  fs.writeFileSync(path.join(temp,'finance_personal_history_permission_postflight.sql'),'\\set ON_ERROR_STOP on\nselect 30;\n');
  fs.writeFileSync(path.join(temp,'finance_approval_history_permission_postflight.sql'),'\\set ON_ERROR_STOP on\nselect 31;\n');
  fs.writeFileSync(path.join(temp,'finance_amount_search_permission_postflight.sql'),'\\set ON_ERROR_STOP on\nselect 32;\n');
  fs.writeFileSync(path.join(temp,'finance_approval_search_permission_postflight.sql'),'\\set ON_ERROR_STOP on\nselect 33;\n');
  guard.HR_BRIDGE_POSTFLIGHT_FILES.forEach(name=>fs.writeFileSync(path.join(temp,name),'\\set ON_ERROR_STOP on\nselect 22;\n'));
  guard.AUDIT_SECURITY_POSTFLIGHT_FILES.forEach(name=>fs.writeFileSync(path.join(temp,name),'\\set ON_ERROR_STOP on\nselect 23;\n-- addd18c5a918fb28b9781e41622eda30\n'));
  guard.INVOICE_READ_SCOPE_POSTFLIGHT_FILES.forEach(name=>fs.writeFileSync(path.join(temp,name),'\\set ON_ERROR_STOP on\nselect 20;\n'));
  guard.AR_READ_SCOPE_POSTFLIGHT_FILES.forEach(name=>fs.writeFileSync(path.join(temp,name),'\\set ON_ERROR_STOP on\nselect 21;\n'));
  guard.AUDIT_REMEDIATION_POSTFLIGHT_FILES.forEach((name,i)=>fs.writeFileSync(path.join(temp,name),'\\set ON_ERROR_STOP on\nselect '+(16+i)+';\n'));
  for(const name of ['finance_demo_password_retirement_postflight.sql','finance_audit_controls_20260927_postflight.sql','finance_payroll_accrual_v1_postflight.sql','finance_hr_contractor_postflight.sql','finance_portal_session_logout_postflight.sql','finance_external_labor_postflight.sql'])fs.writeFileSync(path.join(temp,name),'\\set ON_ERROR_STOP on\nselect 27;\n');
  const attachmentPredecessorSha='f6b0a07ae4ee42f178da9e09fa46aee85aa902cc98936175389449b06680bbe3';
  const attachmentFixture='\\set ON_ERROR_STOP on\nselect 28;\n-- '+attachmentPredecessorSha+'\n';
  fs.writeFileSync(path.join(temp,'finance_attachment_claim_postflight.sql'),attachmentFixture);
  guard.preparePhaseQuery(phasePostflightSource, compatGateOutput, 'frontend_compat', 'none');
  assert.match(fs.readFileSync(compatGateOutput,'utf8'),/select 10;[\s\S]+select 11;[\s\S]+select 12;[\s\S]+select 31;[\s\S]+select 14;[\s\S]+select 15;[\s\S]+select 16;[\s\S]+select 17;[\s\S]+select 33;[\s\S]+select 29;[\s\S]+select 20;[\s\S]+select 21;[\s\S]+select 22;[\s\S]+select 23;[\s\S]+select 30;/,'Current frontend requires successor history ACL and personal permission postflights');
  assert.doesNotMatch(fs.readFileSync(compatGateOutput,'utf8'),/select (8|13|18|19);/,'Current frontend cannot retain retired grouped-history grant contracts');
  const historicalClaimOutput=path.join(temp,'attachment-claim-historical-gate.sql');
  guard.preparePhaseQuery(phasePostflightSource,historicalClaimOutput,guard.RELEASE_PHASE_DATABASE_ATTACHMENT_CLAIM,guard.ATTACHMENT_CLAIM_MIGRATIONS.join(','));
  assert.match(fs.readFileSync(historicalClaimOutput,'utf8'),/select 8;[\s\S]+select 13;[\s\S]+select 18;[\s\S]+select 19;[\s\S]+select 28;/,'Historical attachment-claim phase keeps all immutable grouped-history postflights');
  assert.doesNotMatch(fs.readFileSync(historicalClaimOutput,'utf8'),/select (29|30|31|32|33);/);
  assert.match(fs.readFileSync(historicalClaimOutput,'utf8'),/90d74f07ec5ac883060dec34b6cdadfe/);
  assert.match(fs.readFileSync(historicalClaimOutput,'utf8'),new RegExp(attachmentPredecessorSha));
  for(const [name,mutation] of [['missing',attachmentFixture.replace(attachmentPredecessorSha,'unreviewed')],['duplicate',attachmentFixture+'-- '+attachmentPredecessorSha+'\n']]){
    fs.writeFileSync(path.join(temp,'finance_attachment_claim_postflight.sql'),mutation);
    assert.throws(()=>guard.preparePhaseQuery(phasePostflightSource,path.join(temp,'invalid-successor-'+name+'.sql'),'frontend_compat','none'),/predecessor hash exactly once/);
  }
  fs.writeFileSync(path.join(temp,'finance_attachment_claim_postflight.sql'),attachmentFixture);
  const hrBridgeGateOutput=path.join(temp,'hr-bridge-gate-rendered.sql');
  guard.preparePhaseQuery(phasePostflightSource,hrBridgeGateOutput,guard.RELEASE_PHASE_DATABASE_HR_BRIDGE,guard.HR_BRIDGE_MIGRATIONS.join(','));
  assert.match(fs.readFileSync(hrBridgeGateOutput,'utf8'),/select 20;[\s\S]+select 21;[\s\S]+select 22;/,'HR phase includes both AR and private HR postflights');
  const arReadScopeGateOutput=path.join(temp,'ar-read-scope-gate-rendered.sql');
  guard.preparePhaseQuery(phasePostflightSource,arReadScopeGateOutput,guard.RELEASE_PHASE_DATABASE_AR_READ_SCOPE,guard.AR_READ_SCOPE_MIGRATIONS.join(','));
  assert.match(fs.readFileSync(arReadScopeGateOutput,'utf8'),/select 20;[\s\S]+select 21;/);
  assert.doesNotMatch(fs.readFileSync(arReadScopeGateOutput,'utf8'),/select 22;/,'AR-only phase remains valid before private HR tables exist');
  const operationalGateOutput=path.join(temp,'operational-stability-gate-rendered.sql');
  guard.preparePhaseQuery(phasePostflightSource,operationalGateOutput,guard.RELEASE_PHASE_DATABASE_OPERATIONAL_STABILITY,guard.OPERATIONAL_STABILITY_MIGRATIONS.join(','));
  assert.match(fs.readFileSync(operationalGateOutput,'utf8'),/select 23;[\s\S]+select 24;[\s\S]+rollback;/,'Operational stability gate retains every prior postflight and its new checks');
  assert.match(fs.readFileSync(compatGateOutput, 'utf8'), /'20260827052447'/);
  assert.match(fs.readFileSync(compatGateOutput, 'utf8'), /select 2;[\s\S]+select 3;[\s\S]+select 4;/, 'Frontend compatibility requires audit, finalize and utility postflights');
  assert.match(fs.readFileSync(compatGateOutput,'utf8'),/select 6;[\s\S]+select 32;[\s\S]+select 9;[\s\S]+select 10;/,'Frontend cannot omit updated amount search contract');
  assert.match(fs.readFileSync(compatGateOutput,'utf8'),/select 4;[\s\S]+select 5;[\s\S]+select 6;/,'Frontend requires both reports domains');
  assert.match(fs.readFileSync(compatGateOutput,'utf8'),/select 4;[\s\S]+select 7;[\s\S]+select 5;/,'Recovery and frontend gates preserve the human accounting check in the shared full chain');
  const reportsGateOutput=path.join(temp,'reports-gate-rendered.sql');
  guard.preparePhaseQuery(phasePostflightSource,reportsGateOutput,guard.RELEASE_PHASE_DATABASE_REPORTS,guard.REPORT_MIGRATIONS.join(','));
  assert.match(fs.readFileSync(reportsGateOutput,'utf8'),/^begin read only;[\s\S]+select 4;[\s\S]+select 5;[\s\S]+select 6;[\s\S]+rollback;\s*$/);
  const utilityGateOutput=path.join(temp,'utility-gate-rendered.sql');
  guard.preparePhaseQuery(phasePostflightSource,utilityGateOutput,guard.RELEASE_PHASE_DATABASE_UTILITY,guard.UTILITY_MIGRATIONS.join(','));
  assert.match(fs.readFileSync(utilityGateOutput,'utf8'),/^begin read only;[\s\S]+select 2;[\s\S]+select 3;[\s\S]+select 4;[\s\S]+rollback;\s*$/);
  assert.doesNotMatch(fs.readFileSync(utilityGateOutput,'utf8'),/select [56];/,'Historical utility prerequisite remains valid before reports tables exist');
  const utilityPrereqOutput=path.join(temp,'utility-prereq-rendered.sql');
  guard.preparePhaseQuery(phasePostflightSource,utilityPrereqOutput,guard.RELEASE_PHASE_DATABASE_CASES,guard.CASE_MIGRATIONS.join(','));
  assert.match(fs.readFileSync(utilityPrereqOutput,'utf8'),/select 2;[\s\S]+select 3;/);
  assert.doesNotMatch(fs.readFileSync(utilityPrereqOutput,'utf8'),/select 4;/,'Historical cases prerequisite must be usable before utility migration exists');
  const phasePreflightSource = path.join(temp, 'finance_production_db_preflight.sql');
  const v3GateOutput = path.join(temp, 'v3-gate-rendered.sql');
  fs.writeFileSync(phasePreflightSource, "\\set ON_ERROR_STOP on\nselect set_config('finance.release_migration_versions', :'migration_versions', false);\nselect 1;\n");
  guard.preparePhaseQuery(phasePreflightSource, v3GateOutput, 'database_v3', '20260827052447');
  assert.match(fs.readFileSync(v3GateOutput, 'utf8'), /'20260827052447'/);
  const humanGateOutput = path.join(temp, 'human-gate-rendered.sql');
  guard.preparePhaseQuery(phasePostflightSource, humanGateOutput, 'database_human_accounting', '20260902054834');
  assert.match(fs.readFileSync(humanGateOutput, 'utf8'), /'20260827052447'/);
  assert.throws(() => guard.preparePhaseQuery(phasePreflightSource, path.join(temp, 'bad-human-gate.sql'), 'database_human_accounting', '20260902054834'), /may only render/);
  assert.throws(() => guard.preparePhaseQuery(phasePreflightSource, path.join(temp, 'bad-compat-gate.sql'), 'frontend_compat', 'none'), /requires the reviewed/);
  assert.throws(() => guard.preparePhaseQuery(phasePostflightSource, path.join(temp, 'bad-pair-gate.sql'), 'database_v3', 'none'), /must use/);
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
  const humanApply = path.join(temp, 'human-apply.sql');
  const humanApplyLedger = path.join(temp, 'human-apply-ledger');
  fs.writeFileSync(humanApplyLedger, [
    '20260825000000',
    '20260826070814',
    '20260826155840',
    '20260827052447',
    '20260828015718',
    '20260831042040',
    '20260831043517',
    '20260901024020',
    '20260901073241',
    '20260901081807'
  ].join('\n') + '\n');
  guard.prepareApply(humanAccounting, humanApply, '20260902054834', humanApplyLedger, syntheticBaseline);
  assert.match(fs.readFileSync(humanApply, 'utf8'), /20260902054834/);
  assert.match(fs.readFileSync(humanApply, 'utf8'), /select 10;/);
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
  const candidateIndex = path.join(temp, 'candidate-index.html');
  const productionIndex = path.join(temp, 'production-index.html');
  const validIndex = '<!doctype html><html><head><meta name="finance-release-sha" content="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"><meta name="finance-release-contract" content="expense-submit-resilience-v3-20260827"></head><body><script>const submissionAttemptId = "test";</script></body></html>';
  fs.writeFileSync(localManifest, JSON.stringify(manifest)); fs.writeFileSync(remoteManifest, JSON.stringify(manifest));
  fs.writeFileSync(candidateIndex, validIndex); fs.writeFileSync(productionIndex, validIndex);
  guard.verifyCandidate(localManifest, remoteManifest, 'a'.repeat(40), 'https://candidate.vercel.app/');
  guard.verifyFrontendContract(candidateIndex, localManifest, 'a'.repeat(40));
  for (const bad of [validIndex.replace('name="finance-release-sha"','name="missing-release-sha"'),validIndex.replace('content="'+ 'a'.repeat(40)+'"','content="'+'b'.repeat(40)+'"'),validIndex+'<meta name="finance-release-sha" content="'+'a'.repeat(40)+'">']) {
    const badPath=path.join(temp,'bad-sha-index.html');fs.writeFileSync(badPath,bad);
    assert.throws(()=>guard.verifyFrontendContract(badPath,localManifest,'a'.repeat(40)),/release SHA must exactly match/);
  }
  const externalIndex = path.join(temp, 'external-app-index.html');
  const appPath = 'assets/finance-app-' + 'c'.repeat(16) + '.js';
  fs.writeFileSync(externalIndex, validIndex.replace('<script>const submissionAttemptId = "test";</script>', `<script src="${appPath}"></script>`));
  assert.equal(guard.frontendAppAssetPath(fs.readFileSync(externalIndex, 'utf8')), appPath);
  guard.verifyFrontendContract(externalIndex, localManifest, 'a'.repeat(40));
  fs.writeFileSync(externalIndex, fs.readFileSync(externalIndex, 'utf8').replace(appPath, 'https://evil.invalid/finance-app-' + 'c'.repeat(16) + '.js'));
  assert.throws(() => guard.verifyFrontendContract(externalIndex, localManifest, 'a'.repeat(40)), /same-origin content-addressed/);
  guard.verifyProductionBaseline(remoteManifest, localManifest, productionIndex, candidateIndex, 'a'.repeat(40), 'database_v3', '20260827052447');
  assert.throws(() => guard.verifyProductionBaseline(remoteManifest, localManifest, productionIndex, candidateIndex, 'a'.repeat(40), 'frontend_compat', 'none'), /only valid before database_v3/);
  fs.writeFileSync(productionIndex, validIndex.replace('</body>', '<script>window.PRODUCTION_DRIFT=true;</script></body>'));
  assert.throws(
    () => guard.verifyProductionBaseline(remoteManifest, localManifest, productionIndex, candidateIndex, 'a'.repeat(40), 'database_v3', '20260827052447'),
    /index\.html bytes to match/,
    'database_v3 must reject production HTML drift even when the manifest and feature markers still match'
  );
  fs.writeFileSync(productionIndex, validIndex);
  const missingAttemptIndex = path.join(temp, 'missing-attempt-index.html');
  fs.writeFileSync(missingAttemptIndex, '<meta name="finance-release-sha" content="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"><meta name="finance-release-contract" content="expense-submit-resilience-v3-20260827">');
  assert.throws(() => guard.verifyFrontendContract(missingAttemptIndex, localManifest, 'a'.repeat(40)), /submissionAttemptId/);
  const duplicateMetaIndex = path.join(temp, 'duplicate-meta-index.html');
  fs.writeFileSync(duplicateMetaIndex, `${validIndex}<meta name="finance-release-contract" content="expense-submit-resilience-v3-20260827">`);
  assert.throws(() => guard.verifyFrontendContract(duplicateMetaIndex, localManifest, 'a'.repeat(40)), /exactly one/);
  const invalidFrontendManifest = path.join(temp, 'invalid-frontend-manifest.json');
  fs.writeFileSync(invalidFrontendManifest, JSON.stringify({ ...manifest, runtime_mode: 'offline-demo' }));
  assert.throws(() => guard.verifyFrontendContract(candidateIndex, invalidFrontendManifest, 'a'.repeat(40)), /manifest contract/);

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
  guard.createReceipt(receiptPath, deploymentPath, localManifest, candidateIndex, 'a'.repeat(40), 'frontend_compat', 'none', 'https://candidate.vercel.app/', 'owner/repository', '12345');
  guard.verifyReceipt(receiptPath, deploymentPath, localManifest, candidateIndex, 'a'.repeat(40), 'frontend_compat', 'none', 'https://candidate.vercel.app/', 'owner/repository', '12345');
  assert.throws(() => guard.verifyReceipt(receiptPath, deploymentPath, localManifest, candidateIndex, 'a'.repeat(40), 'database_v3', '20260827052447', 'https://candidate.vercel.app/', 'owner/repository', '12345'), /differs/);
  assert.throws(() => guard.verifyReceipt(receiptPath, deploymentPath, localManifest, candidateIndex, 'a'.repeat(40), 'frontend_compat', 'none', 'https://candidate.vercel.app/', 'owner/repository', '99999'), /differs/);
  fs.appendFileSync(candidateIndex, '<!-- drift -->');
  assert.throws(() => guard.verifyReceipt(receiptPath, deploymentPath, localManifest, candidateIndex, 'a'.repeat(40), 'frontend_compat', 'none', 'https://candidate.vercel.app/', 'owner/repository', '12345'), /differs/);
  fs.writeFileSync(candidateIndex, validIndex);
  const promotedPath = path.join(temp, 'promoted.json');
  const productionAliasPath = path.join(temp, 'production-alias.json');
  fs.writeFileSync(promotedPath, JSON.stringify(deployment));
  fs.writeFileSync(productionAliasPath, JSON.stringify({
    alias: catalog.productionDomain,
    projectId: catalog.vercelProjectId,
    deploymentId: deployment.id
  }));
  guard.verifyPromotion(deploymentPath, promotedPath, productionAliasPath, remoteManifest, localManifest);
  fs.writeFileSync(productionAliasPath, JSON.stringify({
    alias: catalog.productionDomain,
    projectId: catalog.vercelProjectId,
    deploymentId: 'dpl_Other'
  }));
  assert.throws(
    () => guard.verifyPromotion(deploymentPath, promotedPath, productionAliasPath, remoteManifest, localManifest),
    /production alias does not point/
  );
  fs.writeFileSync(productionAliasPath, JSON.stringify({
    alias: 'other.example.com',
    projectId: catalog.vercelProjectId,
    deploymentId: deployment.id
  }));
  assert.throws(
    () => guard.verifyPromotion(deploymentPath, promotedPath, productionAliasPath, remoteManifest, localManifest),
    /production alias does not point/
  );
  fs.writeFileSync(productionAliasPath, JSON.stringify({
    alias: catalog.productionDomain,
    projectId: 'prj_other',
    deploymentId: deployment.id
  }));
  assert.throws(
    () => guard.verifyPromotion(deploymentPath, promotedPath, productionAliasPath, remoteManifest, localManifest),
    /production alias does not point/
  );
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
  'private.finance_expense_assert_authoritative_route_v2',
  'private.finance_expense_assert_authoritative_route_v3',
  'private.finance_expense_assert_dept_manager_autoskip_v3',
  'private.finance_expense_assert_applicant_revision_future_route_v3',
  'public.finance_expense_resubmit_applicant_revision(text,text,text,integer,timestamptz,integer,text,jsonb,jsonb,text)',
  'private.finance_expense_resubmit_applicant_revision_v1_unsafe',
  'public.claim_approval_notification_delivery_events(integer,text,integer)',
  'private.approval_notification_assignment_state',
  'none phase requires v3 to be recorded'
]) assert.ok(dbPreflight.includes(marker), `DB preflight missing ${marker}`);
for (const marker of [
  "v_phase = 'none'", 'relrowsecurity and relforcerowsecurity',
  'v1 compatibility alias is not an exact generated storage_path alias',
  'v2 must retain the exact generated read-only storage_path compatibility alias',
  'finance_expense_assert_authoritative_route_v2', 'finance_expense_assert_authoritative_route_v3',
  'finance_expense_assert_dept_manager_autoskip_v3',
  'finance_expense_assert_applicant_revision_future_route_v3',
  'finance_expense_resubmit_applicant_revision_v1_unsafe',
  'v_historical_key_count', 'v_historical_anchor_index',
  'v3 route guards must remain SECURITY DEFINER',
  'public.claim_approval_notification_delivery_events(integer,text,integer)',
  'private.approval_notification_assignment_state',
  'pg_get_functiondef', 'has_function_privilege', '20260828015718',
  'repair_admin_ntpc_portal_employee_link_20260828',
  'u_1785138353548',
  'FINANCE_PORTAL_IDENTITY_CURRENT_V1_BEGIN', 'FINANCE_PORTAL_IDENTITY_CURRENT_V1_END',
  'FINANCE_PORTAL_LATEST_AUTHORITY_V2', 'GOOGLE_WORKSPACE_PRIMARY_EMAIL_RENAME_V1',
  'private.finance_member_admin_events_v1', 'identity_finance.member_revision',
  'private.finance_membership_org_versions_v1', 'private.finance_user_offboarding_operations',
  'order by a.created_at desc,a.id desc limit 1',
  'Portal current personnel revision lacks matching authorized source',
  'Portal current Auth/company/employee linkage is inconsistent',
  'Portal offboarded identity retained an active access projection',
  'Portal pending first login prematurely retained an authenticated identity',
  'Portal pending target obtained premature access or is inconsistent',
  "(current_timestamp at time zone 'Asia/Taipei')::date",
  'the six audited Portal roles did not converge to one Finance entry each'
]) assert.ok(dbPostflight.includes(marker), `DB postflight missing ${marker}`);
const currentPortalGuard = dbPostflight.split('-- FINANCE_PORTAL_IDENTITY_CURRENT_V1_BEGIN')[1]
  .split('-- FINANCE_PORTAL_IDENTITY_CURRENT_V1_END')[0];
assert.doesNotMatch(currentPortalGuard, /admin\.ntpc@suiyuecare\.com|d114b583-824e-42c9-9d4e-5ab3cf17ac65|73c0ce88-c0f7-4276-ba0e-938cea9d53ce|6c101aa3-b91d-4590-ae7a-5df070af2793/,
  'current Portal postflight must follow authorized personnel revisions, not freeze former email/company/employee values');
for (const marker of ['pg_get_functiondef', 'proacl', 'finance_expense_assert_authoritative_route_v2', 'finance_expense_assert_authoritative_route_v3', 'finance_expense_assert_dept_manager_autoskip_v3', 'finance_expense_assert_applicant_revision_future_route_v3', 'finance_expense_resubmit_applicant_revision', 'claim_approval_notification_delivery_events', 'approval_notification_assignment_state', 'finance_portal_roles', 'relrowsecurity', 'relforcerowsecurity']) {
  assert.ok(dbFingerprint.includes(marker), `DB fingerprint missing ${marker}`);
}
for (const marker of [
  'begin isolation level repeatable read', "'data_environment', 'test'",
  "set local role authenticated", 'finance_submit_expense_request',
  'finance_expense_act_active_step', 'finance_expense_resubmit_applicant_revision',
  'notification_delivery_events', 'cash_movement_evidence_links',
  'approval_step_actor_snapshots', 'finance_income_document_operations',
  'claim_approval_notification_delivery_events',
  'notification_worker_contract_verified',
  'set local role service_role',
  'submissionAttemptId', 'idempotent_replay', 'same_direct_supervisor_and_dept_manager',
  "'u5', 'A1100'", "sqlstate '42501'", 'forged u5/A1100 manager self-skip',
  'forged future assignee through the actual RPC',
  'actual applicant-revision replay failed',
  'revalidated immutable completed history',
  'stale-tab canary did not fail closed',
  'u_1779419399401', 'B1302', 'E5', '徐靖雯 authenticated public submit canary failed',
  'rollback;', 'rolled_back', 'notifications_enqueued'
]) assert.ok(authenticatedCanary.includes(marker), `authenticated canary missing ${marker}`);
assert.equal(
  [...authenticatedCanary.matchAll(/'rk', 'cashier', 'uid', v_ceo_id/g)].length,
  2,
  'both authenticated canary routes must use the formal cashier'
);
assert.equal(
  [...authenticatedCanary.matchAll(/'step_key', 'cashier', 'finance_user_id', v_ceo_id/g)].length,
  2,
  'both authenticated canary actor requests must use the formal cashier'
);
assert.doesNotMatch(
  authenticatedCanary,
  /'rk', 'cashier', 'uid', v_applicant_id|\'step_key\', \'cashier\', \'finance_user_id\', v_applicant_id/,
  'authenticated canary must not reintroduce the general-affairs applicant as cashier'
);
const canaryResultSelect = authenticatedCanary.match(
  /select pg_catalog\.jsonb_build_object\(([\s\S]*?)\) as authenticated_canary_result;/
);
assert.ok(canaryResultSelect, 'authenticated canary must emit one final result object');
assert.deepEqual(
  [...canaryResultSelect[1].matchAll(/^\s*'([^']+)'\s*,/gm)].map((match) => match[1]).sort(),
  ['canary', 'notification_worker_contract_verified', 'notifications_enqueued', 'ok', 'rolled_back'].sort(),
  'authenticated canary SQL result keys must exactly match the release guard contract'
);
assert.doesNotMatch(authenticatedCanary, /^\s*commit\s*;/im, 'authenticated canary must never commit its test request');
const billHistoryPhase=guard.RELEASE_PHASE_DATABASE_PERSONAL_BILL_BATCH_HISTORY;
const billHistoryVersion=guard.PERSONAL_BILL_BATCH_HISTORY_MIGRATIONS.join(',');
assert.deepEqual(guard.releasePlan(billHistoryPhase,billHistoryVersion),{releasePhase:billHistoryPhase,migrationVersions:billHistoryVersion});
guard.validateTarget(exactEnvironment,'a'.repeat(40),billHistoryPhase,billHistoryVersion,catalog.supabaseProjectRef);
for(const versions of ['none','20261012112652','20261012112652,20261013091000'])
  assert.throws(()=>guard.releasePlan(billHistoryPhase,versions),/must use migration_versions=20261013091000|no exact catalog contract/);
const billHistoryTemp=fs.mkdtempSync(path.join(os.tmpdir(),'finance-bill-history-release-contract-'));
try {
  const directory=path.join(root,'supabase/migrations');
  const ledger=path.join(billHistoryTemp,'ledger.txt');
  const prior=['00000000000001',...guard.REVIEWED_MIGRATION_CATALOG.filter(version=>version<billHistoryVersion)];
  const baseline={count:1,lastVersion:prior[0],sha256:guard.ledgerSha256([prior[0]])};
  const writeLedger=rows=>fs.writeFileSync(ledger,rows.join('\n')+'\n');
  writeLedger(prior);
  assert.equal(guard.classifyLedger(ledger,directory,billHistoryPhase,billHistoryVersion,baseline),'pending');
  for(const missing of prior.slice(1)) {
    writeLedger(prior.filter(version=>version!==missing));
    assert.throws(()=>guard.classifyLedger(ledger,directory,billHistoryPhase,billHistoryVersion,baseline),/every reviewed prerequisite migration/);
  }
  writeLedger([...prior,billHistoryVersion]);
  assert.equal(guard.classifyLedger(ledger,directory,billHistoryPhase,billHistoryVersion,baseline),'applied');
  const tampered=path.join(billHistoryTemp,'tampered');
  fs.mkdirSync(tampered);
  const filename=fs.readdirSync(directory).find(name=>name.startsWith(billHistoryVersion+'_'));
  fs.writeFileSync(path.join(tampered,filename),fs.readFileSync(path.join(directory,filename),'utf8')+'\n-- unreviewed comment\n');
  assert.throws(()=>guard.classifyLedger(ledger,tampered,billHistoryPhase,billHistoryVersion,baseline),/sealed SHA256/);
  assert.throws(()=>guard.classifyLedger(ledger,tampered,'frontend_compat','none',baseline),/sealed SHA256/);
  assert.throws(()=>guard.readAuditBatch(tampered,billHistoryVersion,billHistoryPhase),/sealed SHA256/);
  assert.throws(()=>guard.preparePhaseQuery(path.join(root,'scripts/finance_personal_history_identity_once_postflight.sql'),path.join(billHistoryTemp,'wrong.sql'),billHistoryPhase,billHistoryVersion),/exact sealed postflight/);
  guard.preparePhaseQuery(path.join(root,'scripts/finance_personal_bill_batch_history_postflight.sql'),path.join(billHistoryTemp,'readonly.sql'),billHistoryPhase,billHistoryVersion);
  assert.match(fs.readFileSync(path.join(billHistoryTemp,'readonly.sql'),'utf8'),/^begin read only;[\s\S]+rollback;\n$/);
  const canaryPath=path.join(billHistoryTemp,'canary.json');
  const result={canary:'readonly_personal_bill_batch_history_v1',ok:true,rolled_back:true,identity_scope_preserved:true,permission_guard_preserved:true,live_latency_proven:false};
  const writeCanary=value=>fs.writeFileSync(canaryPath,JSON.stringify({rows:[{personal_bill_batch_history_canary_result:value}]}));
  writeCanary(result);
  guard.verifyReportsCanary(canaryPath,'personal_bill_batch_history');
  for(const [key,value] of [['canary','different'],['ok',false],['rolled_back',false],['identity_scope_preserved',false],['permission_guard_preserved',false],['live_latency_proven',true]]) {
    writeCanary({...result,[key]:value});
    assert.throws(()=>guard.verifyReportsCanary(canaryPath,'personal_bill_batch_history'),/did not complete safely/);
  }
} finally {fs.rmSync(billHistoryTemp,{recursive:true,force:true});}
const billHistoryPendingAt=databaseJob.indexOf('elif test "$PHASE_STATE" = "pending" && test "$RELEASE_PHASE" = "database_personal_bill_batch_history_20261013"; then');
const billHistoryPendingEnd=databaseJob.indexOf('\n          elif test "$PHASE_STATE"',billHistoryPendingAt+1);
assert(billHistoryPendingAt>=0&&billHistoryPendingEnd>billHistoryPendingAt);
assert.match(databaseJob.slice(billHistoryPendingAt,billHistoryPendingEnd),/finance_personal_bill_batch_history_preflight\.sql[\s\S]+prepare-personal-bill-batch-history-rehearsal[\s\S]+finance_personal_bill_batch_history_fingerprint\.sql[\s\S]+finance_personal_bill_batch_history_canary\.sql[\s\S]+finance_personal_bill_batch_history_postflight\.sql[\s\S]+prepare-personal-bill-batch-history-apply/);
assert.match(databaseJob,/database_personal_bill_batch_history_20261013"; then\n\s+POSTFLIGHT_SOURCE="\$TOOLS\/scripts\/finance_personal_bill_batch_history_postflight.sql"[\s\S]+run_gate "\$POSTFLIGHT_SOURCE"[\s\S]+verify-reports-canary --domain personal_bill_batch_history/);
assert.match(promoteJob,/database_personal_bill_batch_history_20261013"; then\n\s+PROMOTION_POSTFLIGHT_SOURCE="\$TOOLS\/scripts\/finance_personal_bill_batch_history_postflight.sql"[\s\S]+prepare-phase-query[\s\S]+verify-reports-canary --domain personal_bill_batch_history[\s\S]+promote "\$DEPLOYMENT_URL" --yes/);
assert.equal((workflow.match(/verify-reports-canary --domain personal_bill_batch_history/g)||[]).length,4,'dedicated database/promotion and later frontend compatibility/promotion must all recheck the exact read-only contract');
assert.doesNotMatch(promoteJob,/prepare-personal-bill-batch-history-(?:rehearsal|apply)/);
assert.doesNotMatch(promoteJob.match(/^    if: \$\{\{[^\n]+/m)?.[0]||'',/database_personal_bill_batch_history_20261013/);
assert(workflow.includes('FINANCE_HISTORY_NATIVE_REQUIRED=1 pnpm test:personal-bill-batch-history'));
assert(workflow.includes('pnpm test:personal-bill-batch-history-browser'));
for(const filename of ['finance_personal_bill_batch_history_preflight.sql','finance_personal_bill_batch_history_postflight.sql','finance_personal_bill_batch_history_fingerprint.sql','finance_personal_bill_batch_history_canary.sql','check_finance_personal_bill_batch_history.cjs','check_personal_bill_batch_browser_20261013.cjs']) {
  assert(workflow.includes('scripts/'+filename),'bill history release tool must be sealed: '+filename);
  for(const checker of ['check_release_artifact.js','check_release_source_integrity.js'])assert(fs.readFileSync(path.join(root,'scripts',checker),'utf8').includes("'scripts/"+filename+"'"));
}

const invoiceBulkPhase=guard.RELEASE_PHASE_DATABASE_INVOICE_BATCH_BULK;
const invoiceBulkVersion=guard.INVOICE_BATCH_BULK_MIGRATIONS.join(',');
assert.equal(invoiceBulkVersion,'20261014123427');
assert.deepEqual(guard.releasePlan(invoiceBulkPhase,invoiceBulkVersion),{releasePhase:invoiceBulkPhase,migrationVersions:invoiceBulkVersion});
guard.validateTarget(exactEnvironment,'a'.repeat(40),invoiceBulkPhase,invoiceBulkVersion,catalog.supabaseProjectRef);
for(const wrong of ['none','20261008100000','20261014123427,20261014123428'])
  assert.throws(()=>guard.releasePlan(invoiceBulkPhase,wrong));
const invoiceBulkTemp=fs.mkdtempSync(path.join(os.tmpdir(),'finance-invoice-bulk-release-contract-'));
try {
  const directory=path.join(root,'supabase/migrations');
  const ledger=path.join(invoiceBulkTemp,'ledger.txt');
  const prior=['00000000000001',...guard.REVIEWED_MIGRATION_CATALOG.filter(version=>version<invoiceBulkVersion)];
  const baseline={count:1,lastVersion:prior[0],sha256:guard.ledgerSha256([prior[0]])};
  const writeLedger=rows=>fs.writeFileSync(ledger,rows.join('\n')+'\n');
  writeLedger(prior);
  assert.equal(guard.classifyLedger(ledger,directory,invoiceBulkPhase,invoiceBulkVersion,baseline),'pending');
  assert.throws(()=>guard.classifyLedger(ledger,directory,'frontend_compat','none',baseline),/invoice batch bulk transaction/);
  for(const missing of prior.slice(1)) {
    writeLedger(prior.filter(version=>version!==missing));
    assert.throws(()=>guard.classifyLedger(ledger,directory,invoiceBulkPhase,invoiceBulkVersion,baseline),/every reviewed prerequisite migration/);
  }
  writeLedger([...prior,invoiceBulkVersion]);
  assert.equal(guard.classifyLedger(ledger,directory,invoiceBulkPhase,invoiceBulkVersion,baseline),'applied');
  const tampered=path.join(invoiceBulkTemp,'tampered'); fs.mkdirSync(tampered);
  const filename=fs.readdirSync(directory).find(name=>name.startsWith(invoiceBulkVersion+'_'));
  const source=fs.readFileSync(path.join(directory,filename),'utf8');
  assert.equal(crypto.createHash('sha256').update(source).digest('hex'),guard.INVOICE_BATCH_BULK_SOURCE_SHA256[invoiceBulkVersion]);
  fs.writeFileSync(path.join(tampered,filename),source+'\n-- unreviewed alteration\n');
  assert.throws(()=>guard.classifyLedger(ledger,tampered,invoiceBulkPhase,invoiceBulkVersion,baseline),/sealed SHA256/);
  assert.throws(()=>guard.readAuditBatch(tampered,invoiceBulkVersion,invoiceBulkPhase),/sealed SHA256/);
  assert.throws(()=>guard.preparePhaseQuery(path.join(root,'scripts/finance_bill_batch_bulk_postflight.sql'),path.join(invoiceBulkTemp,'wrong.sql'),invoiceBulkPhase,invoiceBulkVersion),/exact sealed postflight/);
  guard.preparePhaseQuery(path.join(root,'scripts/finance_invoice_batch_bulk_postflight.sql'),path.join(invoiceBulkTemp,'readonly.sql'),invoiceBulkPhase,invoiceBulkVersion);
  assert.match(fs.readFileSync(path.join(invoiceBulkTemp,'readonly.sql'),'utf8'),/^begin read only;[\s\S]+rollback;\n$/);
  writeLedger(prior);
  const scripts=n=>path.join(root,'scripts',n);
  const rehearsal=path.join(invoiceBulkTemp,'rehearsal.sql');
  guard.prepareInvoiceBatchBulkRehearsal(directory,rehearsal,invoiceBulkVersion,ledger,
    scripts('finance_invoice_batch_bulk_fingerprint.sql'),scripts('finance_invoice_batch_bulk_canary.sql'),
    scripts('finance_invoice_batch_bulk_preflight.sql'),scripts('finance_invoice_batch_bulk_postflight.sql'),baseline);
  assert.match(fs.readFileSync(rehearsal,'utf8'),/savepoint finance_release_migration;[\s\S]+insert into supabase_migrations\.schema_migrations[\s\S]+rollback to savepoint finance_release_migration;[\s\S]+invoice batch bulk rollback rehearsal changed schema fingerprints/);
  const apply=path.join(invoiceBulkTemp,'apply.sql');
  guard.prepareAuditBatchApply(directory,apply,invoiceBulkVersion,ledger,scripts('finance_invoice_batch_bulk_postflight.sql'),baseline,invoiceBulkPhase);
  assert.match(fs.readFileSync(apply,'utf8'),/^begin;[\s\S]+finance_submit_invoice_batch[\s\S]+insert into supabase_migrations\.schema_migrations[\s\S]+commit;/);
  const canaryPath=path.join(invoiceBulkTemp,'canary.json');
  const result={canary:'readonly_invoice_batch_bulk_v1',ok:true,rolled_back:true,identity_scope_preserved:true,live_latency_proven:false};
  const writeCanary=value=>fs.writeFileSync(canaryPath,JSON.stringify({rows:[{invoice_batch_bulk_canary_result:value}]}));
  writeCanary(result);guard.verifyReportsCanary(canaryPath,'invoice_batch_bulk');
  for(const [key,value] of [['canary','different'],['ok',false],['rolled_back',false],['identity_scope_preserved',false],['live_latency_proven',true]]) {
    writeCanary({...result,[key]:value});
    assert.throws(()=>guard.verifyReportsCanary(canaryPath,'invoice_batch_bulk'),/did not complete safely/);
  }
} finally {fs.rmSync(invoiceBulkTemp,{recursive:true,force:true});}
assert.match(promoteJob,/inputs\.release_phase != 'database_invoice_batch_bulk_20261014'/,'bulk DB phase cannot promote before exact separate frontend gate');
assert.equal((workflow.match(/verify-reports-canary --domain invoice_batch_bulk/g)||[]).length,3,'DB apply and both frontend gates require exact installed bulk contract');
for(const text of ['FINANCE_INVOICE_NATIVE_REQUIRED=1 pnpm test:invoice-batch-bulk','pnpm test:income-recovery-storage-browser','pnpm test:income-rpc-http','node scripts/check_submission_acceptance_manifest.cjs']) {
  assert(workflow.includes(text),'production candidate misses reliability gate: '+text);
  assert(fs.readFileSync(path.join(root,'.github/workflows/stability-gate.yml'),'utf8').includes(text),'PR gate misses reliability case: '+text);
}
for(const filename of ['finance_invoice_batch_bulk_preflight.sql','finance_invoice_batch_bulk_postflight.sql','finance_invoice_batch_bulk_fingerprint.sql','finance_invoice_batch_bulk_canary.sql','check_invoice_batch_bulk_insert_20261014.cjs','check_income_recovery_storage_browser.cjs','check_income_rpc_http_20261014.cjs','check_submission_acceptance_manifest.cjs','fixtures/finance_invoice_batch_live_catalog_20261014.json','fixtures/finance_invoice_batch_fixture_20261014.cjs','fixtures/finance_income_http_scope_20261014.json']) {
  assert(workflow.includes('scripts/'+filename),'invoice reliability tool must be sealed: '+filename);
  for(const checker of ['check_release_artifact.js','check_release_source_integrity.js'])assert(fs.readFileSync(path.join(root,'scripts',checker),'utf8').includes("'scripts/"+filename+"'"));
}

console.log('PASS protected production release workflow contract');
// Additive bounded logout phase uses a fixed sealed migration, never frontend promotion.
const boundedPhase=guard.RELEASE_PHASE_DATABASE_BOUNDED_LOGOUT,boundedVersion=guard.BOUNDED_LOGOUT_MIGRATIONS.join(',');
assert.deepEqual(guard.releasePlan(boundedPhase,boundedVersion),{releasePhase:boundedPhase,migrationVersions:boundedVersion});
for(const wrong of ['none','20260927180201','20260927180201,'+boundedVersion])assert.throws(()=>guard.releasePlan(boundedPhase,wrong),/must use migration_versions=20261014123017|no exact catalog contract/);
const boundedTemp=fs.mkdtempSync(path.join(os.tmpdir(),'finance-bounded-contract-'));
try{
 const dir=path.join(root,'supabase/migrations'),ledger=path.join(boundedTemp,'ledger');
 const prior=['00000000000001',...guard.REVIEWED_MIGRATION_CATALOG.filter(v=>v<boundedVersion)],baseline={count:1,lastVersion:prior[0],sha256:guard.ledgerSha256([prior[0]])};
 fs.writeFileSync(ledger,prior.join('\n')+'\n');assert.equal(guard.classifyLedger(ledger,dir,boundedPhase,boundedVersion,baseline),'pending');
 for(const missing of prior.slice(1)){fs.writeFileSync(ledger,prior.filter(v=>v!==missing).join('\n')+'\n');assert.throws(()=>guard.classifyLedger(ledger,dir,boundedPhase,boundedVersion,baseline),/every reviewed prerequisite migration/);}
 fs.writeFileSync(ledger,[...prior,boundedVersion].join('\n')+'\n');assert.equal(guard.classifyLedger(ledger,dir,boundedPhase,boundedVersion,baseline),'applied');
 const filename=fs.readdirSync(dir).find(n=>n.startsWith(boundedVersion+'_')),tampered=path.join(boundedTemp,'tampered');fs.mkdirSync(tampered);fs.writeFileSync(path.join(tampered,filename),fs.readFileSync(path.join(dir,filename),'utf8')+'\n-- altered\n');
 assert.throws(()=>guard.classifyLedger(ledger,tampered,boundedPhase,boundedVersion,baseline),/sealed SHA256/);assert.throws(()=>guard.readAuditBatch(tampered,boundedVersion,boundedPhase),/sealed SHA256/);
 assert.throws(()=>guard.preparePhaseQuery(path.join(root,'scripts/finance_personal_bill_batch_history_postflight.sql'),path.join(boundedTemp,'wrong.sql'),boundedPhase,boundedVersion),/exact sealed postflight/);
 guard.preparePhaseQuery(path.join(root,'scripts/finance_bounded_global_logout_postflight.sql'),path.join(boundedTemp,'readonly.sql'),boundedPhase,boundedVersion);assert.match(fs.readFileSync(path.join(boundedTemp,'readonly.sql'),'utf8'),/^begin read only;[\s\S]+rollback;\n$/);
}finally{fs.rmSync(boundedTemp,{recursive:true,force:true});}
const boundedStart=databaseJob.indexOf('elif test "$PHASE_STATE" = "pending" && test "$RELEASE_PHASE" = "database_bounded_global_logout_20261014"; then'),boundedEnd=databaseJob.indexOf('\n          elif test "$PHASE_STATE"',boundedStart+1);
assert(boundedStart>=0&&boundedEnd>boundedStart);assert.match(databaseJob.slice(boundedStart,boundedEnd),/finance_bounded_global_logout_preflight\.sql[\s\S]+prepare-bounded-global-logout-rehearsal[\s\S]+finance_bounded_global_logout_fingerprint\.sql[\s\S]+finance_bounded_global_logout_canary\.sql[\s\S]+finance_bounded_global_logout_postflight\.sql[\s\S]+prepare-bounded-global-logout-apply/);
assert.match(promoteJob.match(/^    if: \$\{\{[^\n]+/m)?.[0]||'',/inputs\.release_phase != 'database_bounded_global_logout_20261014'/);
assert.doesNotMatch(promoteJob,/prepare-bounded-global-logout-(?:rehearsal|apply)/);
assert.equal((databaseJob.match(/if test "\$RELEASE_PHASE" = "database_human_float_20261002"[^\n]*test "\$RELEASE_PHASE" = "database_bounded_global_logout_20261014" \|\| test "\$RELEASE_PHASE" = "database_bill_approval_bulk_20261015"; then/g)||[]).length,2,'both DB-only before/after alias assertions include bounded phase');
assert.equal((workflow.match(/verify-reports-canary --domain bounded_global_logout/g)||[]).length,4,'fixed DB, independent gate, compatibility and promotion all retain bounded logout proof');
for(const part of ['preflight','postflight','fingerprint','canary'])for(const checker of ['check_release_artifact.js','check_release_source_integrity.js'])assert(fs.readFileSync(path.join(root,'scripts',checker),'utf8').includes("'scripts/finance_bounded_global_logout_"+part+".sql'"));
console.log('PASS bounded logout fixed phase/source/prerequisites/DB-only alias and publication contracts');

// Bill approval bulk phase: real sealed DDL, complete prerequisite chain and DB-only publication.
const billApprovalBulkPhase=guard.RELEASE_PHASE_DATABASE_BILL_APPROVAL_BULK;
const billApprovalBulkVersion=guard.BILL_APPROVAL_BULK_MIGRATIONS.join(',');
assert.equal(billApprovalBulkVersion,'20261015060930');
assert.deepEqual(guard.releasePlan(billApprovalBulkPhase,billApprovalBulkVersion),{releasePhase:billApprovalBulkPhase,migrationVersions:billApprovalBulkVersion});
guard.validateTarget(exactEnvironment,'a'.repeat(40),billApprovalBulkPhase,billApprovalBulkVersion,catalog.supabaseProjectRef);
for(const wrong of ['none','20261008100000','20261015060930,20261015060931'])
  assert.throws(()=>guard.releasePlan(billApprovalBulkPhase,wrong));
const billApprovalBulkTemp=fs.mkdtempSync(path.join(os.tmpdir(),'finance-invoice-bulk-release-contract-'));
try {
  const directory=path.join(root,'supabase/migrations');
  const ledger=path.join(billApprovalBulkTemp,'ledger.txt');
  const prior=['00000000000001',...guard.REVIEWED_MIGRATION_CATALOG.filter(version=>version<billApprovalBulkVersion)];
  const baseline={count:1,lastVersion:prior[0],sha256:guard.ledgerSha256([prior[0]])};
  const writeLedger=rows=>fs.writeFileSync(ledger,rows.join('\n')+'\n');
  writeLedger(prior);
  assert.equal(guard.classifyLedger(ledger,directory,billApprovalBulkPhase,billApprovalBulkVersion,baseline),'pending');
  assert.throws(()=>guard.classifyLedger(ledger,directory,'frontend_compat','none',baseline),/bill approval bulk transaction/);
  for(const missing of prior.slice(1)) {
    writeLedger(prior.filter(version=>version!==missing));
    assert.throws(()=>guard.classifyLedger(ledger,directory,billApprovalBulkPhase,billApprovalBulkVersion,baseline),/every reviewed prerequisite migration/);
  }
  writeLedger([...prior,billApprovalBulkVersion]);
  assert.equal(guard.classifyLedger(ledger,directory,billApprovalBulkPhase,billApprovalBulkVersion,baseline),'applied');
  const tampered=path.join(billApprovalBulkTemp,'tampered'); fs.mkdirSync(tampered);
  const filename=fs.readdirSync(directory).find(name=>name.startsWith(billApprovalBulkVersion+'_'));
  const source=fs.readFileSync(path.join(directory,filename),'utf8');
  assert.equal(crypto.createHash('sha256').update(source).digest('hex'),guard.BILL_APPROVAL_BULK_SOURCE_SHA256[billApprovalBulkVersion]);
  fs.writeFileSync(path.join(tampered,filename),source+'\n-- unreviewed alteration\n');
  assert.throws(()=>guard.classifyLedger(ledger,tampered,billApprovalBulkPhase,billApprovalBulkVersion,baseline),/sealed SHA256/);
  assert.throws(()=>guard.readAuditBatch(tampered,billApprovalBulkVersion,billApprovalBulkPhase),/sealed SHA256/);
  assert.throws(()=>guard.preparePhaseQuery(path.join(root,'scripts/finance_bill_batch_bulk_postflight.sql'),path.join(billApprovalBulkTemp,'wrong.sql'),billApprovalBulkPhase,billApprovalBulkVersion),/exact sealed postflight/);
  guard.preparePhaseQuery(path.join(root,'scripts/finance_bill_approval_bulk_postflight.sql'),path.join(billApprovalBulkTemp,'readonly.sql'),billApprovalBulkPhase,billApprovalBulkVersion);
  assert.match(fs.readFileSync(path.join(billApprovalBulkTemp,'readonly.sql'),'utf8'),/^begin read only;[\s\S]+rollback;\n$/);
  writeLedger(prior);
  const scripts=n=>path.join(root,'scripts',n);
  const rehearsal=path.join(billApprovalBulkTemp,'rehearsal.sql');
  guard.prepareBillApprovalBulkRehearsal(directory,rehearsal,billApprovalBulkVersion,ledger,
    scripts('finance_bill_approval_bulk_fingerprint.sql'),scripts('finance_bill_approval_bulk_canary.sql'),
    scripts('finance_bill_approval_bulk_preflight.sql'),scripts('finance_bill_approval_bulk_postflight.sql'),baseline);
  assert.match(fs.readFileSync(rehearsal,'utf8'),/savepoint finance_release_migration;[\s\S]+insert into supabase_migrations\.schema_migrations[\s\S]+rollback to savepoint finance_release_migration;[\s\S]+bill approval bulk rollback rehearsal changed schema fingerprints/);
  const apply=path.join(billApprovalBulkTemp,'apply.sql');
  guard.prepareAuditBatchApply(directory,apply,billApprovalBulkVersion,ledger,scripts('finance_bill_approval_bulk_postflight.sql'),baseline,billApprovalBulkPhase);
  assert.match(fs.readFileSync(apply,'utf8'),/^begin;[\s\S]+finance_bill_act_active_step_v2[\s\S]+CREATE OR REPLACE FUNCTION private\.finance_claim_attachment_metadata_v2[\s\S]+insert into supabase_migrations\.schema_migrations[\s\S]+commit;/);
  const canaryPath=path.join(billApprovalBulkTemp,'canary.json');
  const result={canary:'readonly_bill_approval_bulk_v1',ok:true,rolled_back:true,identity_scope_preserved:true,live_latency_proven:false};
  const writeCanary=value=>fs.writeFileSync(canaryPath,JSON.stringify({rows:[{bill_approval_bulk_canary_result:value}]}));
  writeCanary(result);guard.verifyReportsCanary(canaryPath,'bill_approval_bulk');
  for(const [key,value] of [['canary','different'],['ok',false],['rolled_back',false],['identity_scope_preserved',false],['live_latency_proven',true]]) {
    writeCanary({...result,[key]:value});
    assert.throws(()=>guard.verifyReportsCanary(canaryPath,'bill_approval_bulk'),/did not complete safely/);
  }
} finally {fs.rmSync(billApprovalBulkTemp,{recursive:true,force:true});}
assert.match(promoteJob.match(/^    if: \$\{\{[^\n]+/m)?.[0]||'',/inputs\.release_phase != 'database_bill_approval_bulk_20261015'/);
assert.doesNotMatch(promoteJob,/prepare-bill-approval-bulk-(?:rehearsal|apply)/);
assert.equal((workflow.match(/verify-reports-canary --domain bill_approval_bulk/g)||[]).length,3,'fixed DB and future frontend before/after gates preserve the installed approval contract');
const billApprovalStart=databaseJob.indexOf('elif test "$PHASE_STATE" = "pending" && test "$RELEASE_PHASE" = "database_bill_approval_bulk_20261015"; then');
const billApprovalEnd=databaseJob.indexOf('\n          elif ',billApprovalStart+1);
assert(billApprovalStart>=0&&billApprovalEnd>billApprovalStart);
assert.match(databaseJob.slice(billApprovalStart,billApprovalEnd),/finance_bill_approval_bulk_preflight\.sql[\s\S]+prepare-bill-approval-bulk-rehearsal[\s\S]+finance_bill_approval_bulk_fingerprint\.sql[\s\S]+finance_bill_approval_bulk_canary\.sql[\s\S]+finance_bill_approval_bulk_postflight\.sql[\s\S]+prepare-bill-approval-bulk-apply/);
for(const file of ['.github/workflows/stability-gate.yml','.github/workflows/finance-production-release.yml'])assert(fs.readFileSync(path.join(root,file),'utf8').includes('FINANCE_BILL_APPROVAL_NATIVE_REQUIRED=1 pnpm test:bill-approval-bulk'));
for(const file of ['.github/workflows/stability-gate.yml','.github/workflows/finance-production-release.yml'])assert.match(fs.readFileSync(path.join(root,file),'utf8'),/if: always\(\)[\s\S]+\/tmp\/finance-bill-approval-bulk-20261015/,'failed shared-attachment timing evidence must be retained');
assert(fs.readFileSync(path.join(root,'package.json'),'utf8').includes('&& pnpm test:bill-approval-bulk'));
for(const filename of ['finance_bill_approval_bulk_preflight.sql', 'finance_bill_approval_bulk_postflight.sql', 'finance_bill_approval_bulk_fingerprint.sql', 'finance_bill_approval_bulk_canary.sql', 'check_bill_approval_bulk_20261015.cjs', 'test_bill_approval_bulk_release_batch.mjs', 'fixtures/finance_bill_approval_fixture_20261015.cjs', 'fixtures/finance_bill_approval_live_catalog_20261015.json', 'finance_audit_security_canary_20261015.sql']) {
  assert(workflow.includes('scripts/'+filename),'bill approval release tool is sealed: '+filename);
  for(const checker of ['check_release_artifact.js','check_release_source_integrity.js'])assert(fs.readFileSync(path.join(root,'scripts',checker),'utf8').includes("'scripts/"+filename+"'"));
}
const priorAttachmentAudit=fs.readFileSync(path.join(root,'scripts/finance_audit_security_canary_20261001.sql'),'utf8');
const successorAttachmentAudit=fs.readFileSync(path.join(root,'scripts/finance_audit_security_canary_20261015.sql'),'utf8');
assert.equal(successorAttachmentAudit,priorAttachmentAudit
  .replace('Versioned audit-security canary for attachment-claim trigger revision.','Versioned audit-security canary for bill shared-attachment query-plan revision.')
  .replace('90d74f07ec5ac883060dec34b6cdadfe','630e313afc532a88be3690bb87b93251'),
  'successor audit canary retains every previous identity, RLS, attachment and grant assertion');
assert.equal((workflow.match(/if test "\$RELEASE_PHASE" = "frontend_compat"; then\n\s+AUDIT_SECURITY_CANARY="scripts\/finance_audit_security_canary_20261015\.sql"/g)||[]).length,2,
  'frontend before/after gates use successor helper audit contract; older phases retain old canaries');
for(const part of ['preflight','postflight','fingerprint','canary'])assert(fs.readFileSync(path.join(root,'scripts/finance_bill_approval_bulk_'+part+'.sql'),'utf8').includes('private.finance_claim_attachment_metadata_v2()'),part+' must include the attachment helper in two-function release proof');
console.log('PASS bill approval bulk fixed phase/source/prerequisites/rehearsal/DB-only contracts');
