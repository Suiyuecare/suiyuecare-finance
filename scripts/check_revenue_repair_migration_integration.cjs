'use strict';
// Offline PostgreSQL integration. Real migration, real revenue writer, real V2
// body, and real repair checks execute together. Historical module postflights
// retain their own full-schema fixtures; this compact fixture substitutes only
// those 23 prerequisites, never the migration or its final repair postflight.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {createRevenueGapFixture,detector}=require('./check_dashboard_revenue_gap.cjs');
const {seed,fingerprint}=require('./check_home_care_revenue_repair.cjs');
const guard=require('./finance_production_release_guard.js');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const sig='public.finance_executive_dashboard_v2(date,date,date,date,date,text,text)',v3='public.finance_executive_dashboard_v3(date,date,date,date,date,text,text)';
const migration=read('supabase/migrations/20260924074010_finance_e8_g1101_home_care_revenue_repair_v1.sql');
const post=read('scripts/finance_revenue_repair_postflight.sql').replace(/^\\set[^\n]*\n/gm,'');
const scopePost=read('scripts/finance_dashboard_scope_postflight.sql').replace(/^\\set[^\n]*\n/gm,'');
const scopeCanary=read('scripts/finance_dashboard_scope_canary.sql');
let checks=0;const check=(label,value)=>{assert.ok(value,label);checks++;console.log('PASS '+label);};
async function main(){
 let definition;
 const scope=new PGlite();try{
  const f=await createRevenueGapFixture(scope);await f.admin(scope,"set audit.uid=''");
  definition=(await scope.query('select pg_get_functiondef($1::regprocedure) definition',[sig])).rows[0].definition;
  const d3=(await scope.query('select pg_get_functiondef($1::regprocedure) definition',[v3])).rows[0].definition;
  await scope.exec(d3.replace('begin\n',"begin\n perform finance_hr_private.finance_hr_accounting_scope((public.current_finance_user()).tenant_id,nullif(nullif(btrim(p_entity_id),''),'all'),p_data_environment);\n\n"));
  await scope.exec("create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key);insert into supabase_migrations.schema_migrations values('20260922072109'),('20260922072737'),('20260922075604');grant usage on schema finance_hr_private to authenticated; ");
  for(const [name,sql]of[['scope postflight',scopePost],['scope read-only canary',scopeCanary]]){
   await scope.exec(sql);check(name+' accepts the prior complete HR chain',true);
   await scope.exec('begin');
   try{
    await scope.exec("insert into supabase_migrations.schema_migrations values('20260924074010')");
    const rejectPin=async(label)=>{await scope.exec('savepoint pin');await assert.rejects(()=>scope.exec(sql.replace(/^begin isolation level[^;]*;/m,'').replace(/^rollback;$/gm,'')),/source\/authority mismatch|complete reviewed HR bridge/);await scope.exec('rollback to savepoint pin');check(label,true);};
    await rejectPin(name+' rejects new ledger with old code');
    await scope.exec(detector);
    await scope.exec(sql.replace(/^begin isolation level[^;]*;/m,'').replace(/^rollback;$/gm,''));check(name+' accepts exact repair and retained HR hooks',true);
    await scope.exec("delete from supabase_migrations.schema_migrations where version='20260924074010'");await rejectPin(name+' rejects new code without migration ledger');
    await scope.exec("insert into supabase_migrations.schema_migrations values('20260924074010');delete from supabase_migrations.schema_migrations where version='20260922072109'");await rejectPin(name+' rejects incomplete HR predecessor');
    await scope.exec("insert into supabase_migrations.schema_migrations values('20260922072109')");
    const patched=(await scope.query('select pg_get_functiondef($1::regprocedure) definition',[sig])).rows[0].definition;
    await scope.exec(patched.replace('declare\n','declare\n -- unexpected drift\n'));await rejectPin(name+' rejects unreviewed function drift');
   }finally{await scope.exec('rollback');}
   await scope.exec(sql);check(name+' remains compatible after rollback',true);
  }
 }finally{await scope.close();}
 const db=new PGlite(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'finance-real-revenue-repair-'));try{
  await seed(db);
  await db.exec('set check_function_bodies=off;'+definition+`;revoke all on function ${sig} from public,anon;grant execute on function ${sig} to authenticated,service_role;set check_function_bodies=on;`);
  const versions=guard.REVENUE_REPAIR_MIGRATIONS.join(','),prerequisites=['20260820000000',...guard.REVIEWED_MIGRATION_CATALOG.filter(v=>v<guard.REVENUE_REPAIR_MIGRATIONS[0])];
  const baseline={count:1,lastVersion:prerequisites[0],sha256:guard.ledgerSha256([prerequisites[0]])};
  await db.exec('create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text,created_by text);');
  for(const v of prerequisites)await db.query('insert into supabase_migrations.schema_migrations(version) values($1)',[v]);
  const ledger=path.join(dir,'ledger.txt');fs.writeFileSync(ledger,prerequisites.join('\n')+'\n');
  for(const file of fs.readdirSync(path.join(root,'scripts')).filter(s=>s.endsWith('_postflight.sql')))fs.writeFileSync(path.join(dir,file),'\\set ON_ERROR_STOP on\nselect 1;\n');
  for(const file of guard.REPORT_POSTFLIGHT_FILES)if(!fs.existsSync(path.join(dir,file)))fs.writeFileSync(path.join(dir,file),'\\set ON_ERROR_STOP on\nselect 1;\n');
  fs.appendFileSync(path.join(dir,guard.REPORT_POSTFLIGHT_FILES[0]),"select set_config('finance.release_migration_versions', :'migration_versions', true);\n");
  const final=path.join(dir,'finance_revenue_repair_postflight.sql');let serial=0;
  const render=()=>{const output=path.join(dir,'apply-'+serial+++'.sql');guard.prepareAuditBatchApply(path.join(root,'supabase/migrations'),output,versions,ledger,path.join(dir,'finance_canonical_receivables_postflight.sql'),baseline,guard.RELEASE_PHASE_DATABASE_REVENUE_REPAIR,path.join(dir,'finance_reporting_profiles_postflight.sql'));return fs.readFileSync(output,'utf8');};
  const snapshot=async()=>JSON.stringify({money:await fingerprint(db),catalog:(await db.query('select md5(prosrc) hash,proacl::text acl from pg_proc where oid=$1::regprocedure',[sig])).rows,ledger:(await db.query('select * from supabase_migrations.schema_migrations order by version')).rows});
  const before=await snapshot();
  fs.writeFileSync(final,'\\set ON_ERROR_STOP on\n'+post+"\ndo $late$ begin raise exception 'intentional late repair postflight';end;$late$;\n");
  const late=render();check('sealed renderer retains the entire untrimmed migration',late.includes(migration.trimEnd()));
  await assert.rejects(()=>db.exec(late),/intentional late repair postflight/);await db.exec('rollback');check('late final failure restores rules, both sources, every ledger row, function ACL/body and migration ledger',await snapshot()===before);
  fs.writeFileSync(final,'\\set ON_ERROR_STOP on\n'+post);
  const apply=render();await db.exec(apply);await db.exec(post);
  const canary=await db.exec(read('scripts/finance_revenue_repair_canary.sql'));check('complete migration passes real repair postflight and read-only cash proof',canary.some(x=>x.rows?.some(r=>r.revenue_repair_canary_result?.cash_preserved)));
  check('complete migration updates only the reviewed V2 body',(await db.query('select md5(prosrc) hash from pg_proc where oid=$1::regprocedure',[sig])).rows[0].hash==='cec3d2e9b694c30e189aca9b1f2431a0');
  check('migration ledger stores the full real repair and detector',(await db.query("select statements from supabase_migrations.schema_migrations where version='20260924074010'")).rows[0].statements[0]===migration.trimEnd());
  const applied=await snapshot();await assert.rejects(()=>db.exec(apply),/ledger changed/);await db.exec('rollback');check('stale protected apply cannot post twice',await snapshot()===applied);
  await db.exec('begin;'+migration+'\ncommit;');check('entire migration is idempotent including revenue writer and detector',await snapshot()===applied);
  check('real source income remains exactly 1,046,512',(await db.query("select sum(credit-debit)::numeric income from public.ledger_entries where source_type='invoice' and account_code='4101'")).rows[0].income==='1046512');
 }finally{await db.close();fs.rmSync(dir,{recursive:true,force:true});}
 console.log('OK: '+checks+' complete revenue migration and versioned catalog integration checks');
}
main().catch(e=>{console.error({message:e.message,code:e.code,where:e.where,stack:e.code?undefined:e.stack});process.exitCode=1});
