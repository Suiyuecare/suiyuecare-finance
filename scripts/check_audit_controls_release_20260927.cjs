'use strict';
// Exact-batch renderer contracts, including state rejection and rollback invariants.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const guard=require('./finance_production_release_guard'),root=path.resolve(__dirname,'..');
const phase='database_audit_controls_20260927',versions='20260927152432,20260927153326',migrations=path.join(root,'supabase/migrations'),scripts=path.join(root,'scripts');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'finance-controls-release-'));
let checks=0;const check=(fn)=>{fn();checks++};
try{
 check(()=>assert.deepEqual(guard.AUDIT_CONTROLS_20260927_MIGRATIONS,versions.split(',')));
 check(()=>assert.deepEqual(guard.RELEASE_PHASES[phase],versions));
 check(()=>assert.throws(()=>guard.releasePlan(phase,'20260927152432'),/exact|requires/));
 const base=['20260801000000'],baseline={count:1,lastVersion:base[0],sha256:crypto.createHash('sha256').update(base[0]+'\n').digest('hex')};
 const prior=[...base,...guard.REVIEWED_MIGRATION_CATALOG.filter(v=>v<versions.split(',')[0])].sort(),ledger=path.join(temp,'ledger.txt');
 const writeLedger=items=>fs.writeFileSync(ledger,items.join('\n')+'\n');
 writeLedger(prior);check(()=>assert.equal(guard.classifyLedger(ledger,migrations,phase,versions,baseline),'pending'));
 writeLedger([...prior,versions.split(',')[0]]);check(()=>assert.throws(()=>guard.classifyLedger(ledger,migrations,phase,versions,baseline),/partial atomic/));
 writeLedger([...prior,...versions.split(',')]);check(()=>assert.equal(guard.classifyLedger(ledger,migrations,phase,versions,baseline),'applied'));
 writeLedger(prior.filter(v=>v!=='20260925170000'));check(()=>assert.throws(()=>guard.classifyLedger(ledger,migrations,phase,versions,baseline),/every reviewed prerequisite/));
 writeLedger(prior);check(()=>assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',baseline),/20260927 audit controls/));
 const rehearsal=path.join(temp,'rehearsal.sql');
 guard.prepareAuditControls20260927Rehearsal(migrations,rehearsal,versions,ledger,path.join(scripts,'finance_audit_controls_20260927_fingerprint.sql'),path.join(scripts,'finance_audit_controls_20260927_canary.sql'),path.join(scripts,'finance_canonical_receivables_postflight.sql'),path.join(scripts,'finance_reporting_profiles_postflight.sql'),baseline);
 const rehearsalSql=fs.readFileSync(rehearsal,'utf8');
 check(()=>assert.match(rehearsalSql,/begin isolation level repeatable read;[\s\S]+finance-production-release-v1[\s\S]+lock table supabase_migrations.schema_migrations in share row exclusive mode;[\s\S]+formal migration ledger changed before rollback rehearsal/));
 check(()=>assert.match(rehearsalSql,/create temporary table finance_release_fingerprint_before[\s\S]+savepoint finance_release_migration;[\s\S]+finance_payroll_accruals_v1[\s\S]+rollback to savepoint finance_release_migration;[\s\S]+finance_release_fingerprint_after[\s\S]+changed business fingerprints[\s\S]+changed the migration ledger[\s\S]+rollback;\s*$/));
 check(()=>assert.doesNotMatch(rehearsalSql,/^\s*commit\s*;/im));
 check(()=>assert.doesNotMatch(rehearsalSql,/insert into supabase_migrations\.schema_migrations/i));
 for(const name of ['finance_production_db_postflight.sql','finance_hr_bridge_postflight.sql','finance_reporting_profiles_postflight.sql','finance_operational_stability_postflight.sql','finance_demo_password_retirement_postflight.sql','finance_audit_controls_20260927_postflight.sql','finance_payroll_accrual_v1_postflight.sql'])check(()=>assert.ok(rehearsalSql.includes('Reviewed reports postflight: '+name),name+' must survive full rehearsal'));
 const apply=path.join(temp,'apply.sql');guard.prepareAuditBatchApply(migrations,apply,versions,ledger,path.join(scripts,'finance_canonical_receivables_postflight.sql'),baseline,phase,path.join(scripts,'finance_reporting_profiles_postflight.sql'));
 const applySql=fs.readFileSync(apply,'utf8');check(()=>assert.equal((applySql.match(/insert into supabase_migrations.schema_migrations/g)||[]).length,2));
 check(()=>assert.match(applySql,/formal migration ledger changed after the reviewed release gate[\s\S]+20260927152432[\s\S]+20260927153326[\s\S]+Reviewed reports postflight: finance_payroll_accrual_v1_postflight.sql[\s\S]+commit;\s*$/));
 check(()=>assert.throws(()=>guard.prepareAuditControls20260927Rehearsal(migrations,rehearsal,versions,ledger,path.join(scripts,'finance_audit_controls_20260927_fingerprint.sql'),path.join(scripts,'finance_audit_controls_20260927_canary.sql'),path.join(scripts,'finance_canonical_receivables_postflight.sql'),path.join(scripts,'finance_reporting_profiles_postflight.sql'),baseline),/EEXIST/));
 const workflow=read('.github/workflows/finance-production-release.yml'),buildAt=workflow.indexOf('vercel@59.3.0 build --prod');
 for(const command of ['pnpm test:audit-controls-native-concurrency','pnpm test:audit-controls-browser-20260927']){
  check(()=>assert.ok(workflow.indexOf(command)>workflow.indexOf('Configure private disposable PostgreSQL')&&workflow.indexOf(command)<buildAt));
  check(()=>assert.ok(read('.github/workflows/stability-gate.yml').includes(command)));
 }
 check(()=>assert.equal((workflow.match(/verify-reports-canary --domain audit_controls_20260927/g)||[]).length,2));
 const branch=workflow.slice(workflow.indexOf('elif test "$PHASE_STATE" = "pending" && test "$RELEASE_PHASE" = "'+phase+'"'),workflow.indexOf('elif test "$PHASE_STATE" = "pending" && test "$RELEASE_PHASE" = "database_demo_password_retirement_20260925"'));
 check(()=>assert.match(branch,/database_demo_password_retirement_20260925 --migration-versions 20260925170000[\s\S]+prepare-audit-controls-20260927-rehearsal[\s\S]+--ledger[\s\S]+audit-controls-rehearsal.json[\s\S]+prepare-audit-controls-20260927-apply[\s\S]+--ledger/));
 check(()=>assert.doesNotMatch(workflow.slice(workflow.indexOf('\n  promote:')),/prepare-audit-controls-20260927-(apply|rehearsal)/));
 const canary=read('scripts/finance_audit_controls_20260927_canary.sql');check(()=>assert.doesNotMatch(canary,/\b(?:insert\s+into|update\s+\S+\s+set|delete\s+from|set_config\s*\()/i));
 const result=path.join(temp,'result.json');fs.writeFileSync(result,JSON.stringify([{audit_controls_20260927_canary_result:{canary:'readonly_audit_controls_20260927_v1',ok:true,rolled_back:true,catalog_scope_preserved:true}}]));check(()=>assert.equal(guard.verifyReportsCanary(result,'audit_controls_20260927'),true));
 console.log(JSON.stringify({ok:true,checks,atomicBatch:versions,ledgerRecheck:true,rollbackBusinessFingerprint:true,fullPostflightBeforeCommit:true,nativeAndBrowserRequired:true}));
}finally{fs.rmSync(temp,{recursive:true,force:true});}
