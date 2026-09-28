'use strict';
// Structural rehearsal of the protected DB phase; no production connections.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const guard=require('./finance_production_release_guard');
const root=path.resolve(__dirname,'..'),scripts=path.join(root,'scripts');
const migrations=path.join(root,'supabase/migrations'),phase='database_external_labor_20260928';
const versions='20260928090000',temp=fs.mkdtempSync(path.join(os.tmpdir(),'finance-external-labor-release-'));
let checks=0;const check=fn=>{fn();checks++};
try{
 check(()=>assert.deepEqual(guard.EXTERNAL_LABOR_MIGRATIONS,[versions]));
 check(()=>assert.equal(guard.RELEASE_PHASES[phase],versions));
 const source=path.join(migrations,versions+'_finance_external_labor_v1.sql');
 check(()=>assert.equal(crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),
  guard.EXTERNAL_LABOR_SOURCE_SHA256[versions]));
 const base=['20260801000000'],baseline={count:1,lastVersion:base[0],
  sha256:crypto.createHash('sha256').update(base[0]+'\n').digest('hex')};
 const prior=[...base,...guard.REVIEWED_MIGRATION_CATALOG.filter(v=>v<versions)].sort();
 const ledger=path.join(temp,'ledger.txt'),write=rows=>fs.writeFileSync(ledger,rows.join('\n')+'\n');
 write(prior);check(()=>assert.equal(guard.classifyLedger(ledger,migrations,phase,versions,baseline),'pending'));
 write([...prior,versions]);check(()=>assert.equal(guard.classifyLedger(ledger,migrations,phase,versions,baseline),'applied'));
 write(prior.filter(v=>v!=='20260927180201'));
 check(()=>assert.throws(()=>guard.classifyLedger(ledger,migrations,phase,versions,baseline),/every reviewed prerequisite/));
 write(prior);check(()=>assert.throws(()=>guard.classifyLedger(ledger,migrations,'frontend_compat','none',baseline),/external labor/));
 const rehearsal=path.join(temp,'rehearsal.sql');
 guard.prepareExternalLaborRehearsal(migrations,rehearsal,versions,ledger,
  path.join(scripts,'finance_external_labor_fingerprint.sql'),path.join(scripts,'finance_external_labor_canary.sql'),
  path.join(scripts,'finance_canonical_receivables_postflight.sql'),
  path.join(scripts,'finance_reporting_profiles_postflight.sql'),baseline);
 const rehearsalSql=fs.readFileSync(rehearsal,'utf8');
 check(()=>assert.match(rehearsalSql,/finance_release_fingerprint_before[\s\S]+savepoint finance_release_migration[\s\S]+rollback to savepoint finance_release_migration[\s\S]+finance_release_fingerprint_after[\s\S]+rollback;\s*$/));
 check(()=>assert.match(rehearsalSql,/Reviewed reports postflight: finance_external_labor_postflight\.sql/));
 check(()=>assert.doesNotMatch(rehearsalSql,/^\s*commit;|insert into supabase_migrations\.schema_migrations/im));
 const apply=path.join(temp,'apply.sql');
 guard.prepareAuditBatchApply(migrations,apply,versions,ledger,
  path.join(scripts,'finance_canonical_receivables_postflight.sql'),baseline,phase,
  path.join(scripts,'finance_reporting_profiles_postflight.sql'));
 const applySql=fs.readFileSync(apply,'utf8');
 check(()=>assert.equal((applySql.match(/insert into supabase_migrations\.schema_migrations/g)||[]).length,1));
 check(()=>assert.match(applySql,/20260928090000[\s\S]+finance_external_labor_postflight\.sql[\s\S]+commit;\s*$/));
 const workflow=fs.readFileSync(path.join(root,'.github/workflows/finance-production-release.yml'),'utf8');
 check(()=>assert.match(workflow,/prepare-external-labor-rehearsal[\s\S]+prepare-external-labor-apply/));
 check(()=>assert.equal((workflow.match(/verify-reports-canary --domain external_labor/g)||[]).length,2));
 check(()=>assert.ok(workflow.indexOf('pnpm test:external-labor-browser')<workflow.indexOf('vercel@59.3.0 build --prod')));
 const canary=fs.readFileSync(path.join(scripts,'finance_external_labor_canary.sql'),'utf8');
 check(()=>assert.doesNotMatch(canary,/\b(?:insert\s+into|update\s+\S+\s+set|delete\s+from|set_config\s*\()/i));
 const result=path.join(temp,'canary.json');fs.writeFileSync(result,JSON.stringify([{
  finance_external_labor_canary_result:{canary:'readonly_external_labor_v1',ok:true,rolled_back:true,
   privacy_preserved:true,legacy_finalization_blocked:true,posting_sealed:true}}]));
 check(()=>assert.equal(guard.verifyReportsCanary(result,'external_labor'),true));
 console.log(JSON.stringify({ok:true,checks,phase,atomicBatch:versions,rollbackRehearsal:true,canaryReadonly:true}));
}finally{fs.rmSync(temp,{recursive:true,force:true})}
