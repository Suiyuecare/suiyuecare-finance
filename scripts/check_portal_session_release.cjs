'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const guard=require('./finance_production_release_guard'),root=path.resolve(__dirname,'..');
const phase='database_portal_session_20260928',versions='20260927180201',migrations=path.join(root,'supabase/migrations'),scripts=path.join(root,'scripts');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'finance-contractor-release-'));let checks=0;const check=f=>{f();checks++};
try{
 check(()=>assert.deepEqual(guard.PORTAL_SESSION_MIGRATIONS,versions.split(',')));check(()=>assert.equal(guard.RELEASE_PHASES[phase],versions));
 const base=['20260801000000'],baseline={count:1,lastVersion:base[0],sha256:crypto.createHash('sha256').update(base[0]+'\n').digest('hex')},prior=[...base,...guard.REVIEWED_MIGRATION_CATALOG.filter(v=>v<versions.split(',')[0])].sort(),ledger=path.join(temp,'ledger.txt'),writeLedger=rows=>fs.writeFileSync(ledger,rows.join('\n')+'\n');
 writeLedger(prior);check(()=>assert.equal(guard.classifyLedger(ledger,migrations,phase,versions,baseline),'pending'));

 writeLedger([...prior,...versions.split(',')]);check(()=>assert.equal(guard.classifyLedger(ledger,migrations,phase,versions,baseline),'applied'));
 writeLedger(prior.filter(v=>v!=='20260927153326'));check(()=>assert.throws(()=>guard.classifyLedger(ledger,migrations,phase,versions,baseline),/every reviewed prerequisite/));
 writeLedger(prior);check(()=>assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',baseline),/portal session logout/));
 for(const [version,sha]of Object.entries(guard.PORTAL_SESSION_SOURCE_SHA256)){const file=fs.readdirSync(migrations).find(n=>n.startsWith(version+'_'));check(()=>assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(migrations,file))).digest('hex'),sha));}
 const rehearsal=path.join(temp,'rehearsal.sql');guard.preparePortalSessionRehearsal(migrations,rehearsal,versions,ledger,path.join(scripts,'finance_portal_session_fingerprint.sql'),path.join(scripts,'finance_portal_session_canary.sql'),path.join(scripts,'finance_canonical_receivables_postflight.sql'),path.join(scripts,'finance_reporting_profiles_postflight.sql'),baseline);
 const sql=fs.readFileSync(rehearsal,'utf8');check(()=>assert.match(sql,/finance-production-release-v1[\s\S]+lock table supabase_migrations[\s\S]+formal migration ledger changed before rollback rehearsal/));
 check(()=>assert.match(sql,/finance_release_fingerprint_before[\s\S]+savepoint finance_release_migration[\s\S]+rollback to savepoint finance_release_migration[\s\S]+finance_release_fingerprint_after[\s\S]+changed business fingerprints[\s\S]+changed the migration ledger[\s\S]+rollback;\s*$/));
 check(()=>assert.doesNotMatch(sql,/^\s*commit;|insert into supabase_migrations\.schema_migrations/im));
 for(const file of ['finance_production_db_postflight.sql','finance_hr_bridge_postflight.sql','finance_payroll_accrual_v1_postflight.sql','finance_portal_session_logout_postflight.sql'])check(()=>assert.ok(sql.includes('Reviewed reports postflight: '+file)));
 const apply=path.join(temp,'apply.sql');guard.prepareAuditBatchApply(migrations,apply,versions,ledger,path.join(scripts,'finance_canonical_receivables_postflight.sql'),baseline,phase,path.join(scripts,'finance_reporting_profiles_postflight.sql'));const applied=fs.readFileSync(apply,'utf8');
 check(()=>assert.equal((applied.match(/insert into supabase_migrations.schema_migrations/g)||[]).length,1));check(()=>assert.match(applied,/ledger changed after[\s\S]+20260927180201[\s\S]+finance_portal_session_logout_postflight.sql[\s\S]+commit;\s*$/));
 const workflow=fs.readFileSync(path.join(root,'.github/workflows/finance-production-release.yml'),'utf8'),branch=workflow.slice(workflow.indexOf('elif test "$PHASE_STATE" = "pending" && test "$RELEASE_PHASE" = "'+phase+'"'),workflow.indexOf('elif test "$PHASE_STATE" = "pending" && test "$RELEASE_PHASE" = "database_hr_contractor_20260928"'));
 check(()=>assert.match(branch,/database_hr_contractor_20260928 --migration-versions 20260927175827,20260927180005[\s\S]+prepare-portal-session-rehearsal[\s\S]+--ledger[\s\S]+prepare-portal-session-apply[\s\S]+--ledger/));
 check(()=>assert.equal((workflow.match(/verify-reports-canary --domain portal_session/g)||[]).length,2));check(()=>assert.ok(workflow.indexOf('pnpm test:portal-session')<workflow.indexOf('vercel@59.3.0 build --prod')));check(()=>assert.ok(fs.readFileSync(path.join(root,'.github/workflows/stability-gate.yml'),'utf8').includes('pnpm test:portal-session')));
 const canary=fs.readFileSync(path.join(scripts,'finance_portal_session_canary.sql'),'utf8');check(()=>assert.doesNotMatch(canary,/\b(?:insert\s+into|update\s+\S+\s+set|delete\s+from|set_config\s*\()/i));
 const result=path.join(temp,'canary.json');fs.writeFileSync(result,JSON.stringify([{portal_session_canary_result:{canary:'readonly_portal_session_v1',ok:true,rolled_back:true,privacy_preserved:true}}]));check(()=>assert.equal(guard.verifyReportsCanary(result,'portal_session'),true));
 console.log(JSON.stringify({ok:true,checks,phase,atomicBatch:versions,fullChainBeforeCommit:true,catalogOnlyCanary:true,browserRequired:true}));
}finally{fs.rmSync(temp,{recursive:true,force:true})}
