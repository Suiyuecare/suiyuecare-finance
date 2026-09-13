#!/usr/bin/env node
'use strict';
// Actual old/new SQL and canonical readers. All identities and financial rows
// here are fictional, local PGlite data; this script has no network transport.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const migrationFile='supabase/migrations/20260913061745_finance_ar_mapping_set_based_v1.sql';
const oldFile='supabase/migrations/20260910064324_finance_canonical_receivables_v1.sql';
const oldHash='335b602173ee9eefc0f3b3de84019c8d',newHash='328871795ff8787e301008540a1b4bee';
function fn(source,start,end='$f$;'){const a=source.indexOf(start);assert(a>=0,start);const b=source.indexOf(end,a);assert(b>a);return source.slice(a,b+end.length);}
const oldSql=fn(read(oldFile),'create function private.finance_ar_ledger_v1(');
const newSql=fn(read(migrationFile),'create or replace function private.finance_ar_ledger_v1(');
const oldBody=oldSql.slice(oldSql.indexOf('as $f$')+6,oldSql.lastIndexOf('$f$;'));
const newBody=newSql.slice(newSql.indexOf('as $f$')+6,newSql.lastIndexOf('$f$;'));
function strip(s){return s.replace(/^\\set ON_ERROR_STOP on\r?\n/,'');}
async function createArMappingFixture(db,options={}){
 const existing=read('scripts/check_canonical_receivables.js');
 const head=existing.slice(existing.indexOf("'use strict';"),existing.indexOf('(async()=>'));
 const setup=existing.slice(existing.indexOf(' await db.exec(schema'),existing.indexOf(" check('all new private tables"));
 const ar=read('scripts/check_ar_reconciliation_scope.cjs');
 const authority=ar.slice(ar.indexOf(' await db.exec(`alter table public.finance_users'),ar.indexOf(' async function readAr('));
 const make=new Function('require','__dirname','functionSql',head+'\nreturn async function(db){'+setup+authority+'return {make,ar,as,admin,fingerprint,tenant,other,today,prior,receipt,allowance,refund};};')(require,__dirname,fn);
 const f=await make(db);
 await db.exec('begin;'+read('supabase/migrations/20260911135457_finance_ar_reconciliation_scope_v1.sql')+'\ncommit;');
 await db.exec("alter table public.ledger_entries add primary key(id);alter table public.ledger_entries enable row level security;alter table public.ledger_entries force row level security;alter table public.invoices force row level security;");
 if(options.seed!==false){await f.make(db,'MAP-SEED',100);await f.admin(db,"set audit.uid=''");}
 if(options.install!==false)await db.exec('begin;'+read(migrationFile)+'\ncommit;');
 return f;
}
function sorted(rows){return rows.map(x=>JSON.stringify(x)).sort();}
async function mapper(db,tenant,env,date,id=null){return(await db.query('select * from private.finance_ar_ledger_v1($1,$2,$3,$4)',[tenant,env,date,id])).rows;}
async function rawPlan(db,body,t,date){const bound=body.trim().replace(/;$/,'').replace(/\bp_tenant\b/g,"'"+t+"'::uuid").replace(/\bp_environment\b/g,"'test'::text").replace(/\bp_as_of\b/g,"'"+date+"'::date").replace(/\bp_invoice_id\b/g,'null::text');return(await db.query('explain(analyze,buffers,format json) select count(invoice_id),sum(debit),sum(credit) from ('+bound+') mapped(invoice_id,entity_id,department_code,entry_date,debit,credit,category,source_ref)')).rows[0]['QUERY PLAN'][0];}
async function run(){
 let checks=0;const results=[];function check(label,value){assert.ok(value,label);checks++;results.push(label);console.log('PASS '+label);}
 const db=new PGlite();try{
  const f=await createArMappingFixture(db,{install:false,seed:false}),{tenant,other,today,prior}=f;
  check('original body matches live predecessor',crypto.createHash('md5').update(oldBody).digest('hex')===oldHash);
  check('candidate body matches postflight pin',crypto.createHash('md5').update(newBody).digest('hex')===newHash);
  const inv=async(id,opts={})=>f.make(db,id,opts.total||100,{revenue_posted:false,...opts});
  for(const [id,opts] of [['A',{}],['B',{}],['NULLCO',{entity_id:null}],['FOREIGN',{entity_id:'OTHER-CO'}],['FOREIGN-TENANT',{tenant_id:other}],['PROD',{data_environment:'production'}],['VOID-INVOICE',{status:'voided',voided_at:new Date().toISOString()}],['DUP-A',{no:'DUP-NO'}],['DUP-B',{no:'DUP-NO'}]])await inv(id,opts);
  let seq=0;async function journal(label,opts={}){await f.admin(db,'select 1');const row={id:crypto.randomUUID(),tenant_id:tenant,data_environment:'test',entry_date:prior,entity_id:'FICT-CO',department_code:'FICT-D',debit:100,credit:0,account_code:'1123',account_name:'Fictional',source_type:'invoice',source_id:'A',source_no:'',reference_no:'',voucher_no:'V-'+label,posting_key:'map:'+label,voided_at:null,...opts};await db.query('insert into public.ledger_entries select * from jsonb_populate_record(null::public.ledger_entries,$1)',[JSON.stringify(row)]);seq++;}
  const cases=[['direct',{}],['receipt',{debit:0,credit:40,posting_key:'map:receipt:A'}],['legacy-no',{source_id:null,source_no:'A'}],['legacy-ref',{source_id:'',reference_no:'A'}],['missing-id',{source_id:'missing',source_no:'B'}],['valid-other-id-no-fallback',{source_id:'B',source_no:'A'}],['other-company-id-no-fallback',{source_id:'FOREIGN',source_no:'A'}],['foreign-tenant-id-fallback',{source_id:'FOREIGN-TENANT',source_no:'A'}],['other-env-id-fallback',{source_id:'PROD',source_no:'A'}],['untyped-null',{source_type:null,source_id:null,source_no:'A'}],['untyped-invalid',{source_type:null,source_id:'missing',source_no:'A'}],['unsupported-source',{source_type:'adjustment',source_id:'A',source_no:'A'}],['reversal',{source_type:'invoice_reversal',debit:0,credit:20}],['ambiguous-two-refs',{source_id:null,source_no:'A',reference_no:'B'}],['ambiguous-duplicate-no',{source_id:null,source_no:'DUP-NO'}],['same-ref-twice',{source_id:null,source_no:'A',reference_no:'A'}],['null-company',{entity_id:null,source_id:'NULLCO'}],['other-company',{entity_id:'OTHER-CO',source_id:'FOREIGN'}],['null-company-mismatch',{source_id:'NULLCO'}],['invoice-voided-still-historical',{source_id:'VOID-INVOICE'}],['future',{entry_date:'2099-01-01'}],['void',{voided_at:new Date().toISOString()}],['other-account',{account_code:'1112'}],['null-tenant',{tenant_id:null}],['other-tenant',{tenant_id:other,source_id:'FOREIGN-TENANT'}],['production',{data_environment:'production',source_id:'PROD'}],['null-amounts',{debit:null,credit:null}],['both-sides',{debit:70,credit:70}],['zero',{debit:0,credit:0}],['negative',{debit:-15.25,credit:3.75}]];
  for(const [label,opts]of cases)await journal(label,opts);
  await db.query("insert into public.invoice_lifecycle_events(id,event_no,invoice_id,tenant_id,data_environment,event_type,event_date,amount,tax,total,status) values('EV-A','EV-NO-A','A',$1,'test','allowance',$2,20,0,20,'draft'),('EV-B','EV-NO-B','B',$1,'test','void',$2,20,0,20,'voided')",[tenant,prior]);
  for(const [label,opts]of [['event-id',{source_type:'allowance_invoice',source_id:'EV-A',debit:0,credit:20}],['event-no',{source_type:'refund',source_id:null,source_no:'EV-NO-A'}],['event-reference',{source_type:'refund',source_id:'missing',reference_no:'EV-NO-A'}],['event-ambiguity',{source_id:'A',source_no:'EV-NO-B'}],['event-dedup',{source_id:'EV-A',source_no:'EV-NO-A',reference_no:'EV-NO-A'}],['event-beats-receipt',{source_id:'EV-A',posting_key:'map:receipt:event'}],['void-event-preserved',{source_id:'EV-B'}]])await journal(label,opts);
  const args=[];for(const env of ['test','production'])for(const date of ['2000-01-01',prior,today,'2099-01-01'])for(const id of [null,'A','B','missing'])args.push([tenant,env,date,id]);args.push([other,'test',today,null],[null,'test',today,null],[tenant,null,today,null],[tenant,'test',null,null]);
  const before=[];for(const a of args)before.push(sorted(await mapper(db,...a)));
  const oldRows=await mapper(db,tenant,'test',today);const find=label=>oldRows.find(x=>x.source_ref==='V-'+label);
  check('fictional edge matrix includes ambiguous direct and lifecycle sources',oldRows.some(x=>x.invoice_id===null&&x.category==='allowance')&&oldRows.some(x=>x.invoice_id==='A'&&x.category==='receipt'));
  const payloads=[];for(const actor of ['accountant','employee']){await f.as(db,actor);payloads.push((await db.query("select public.finance_receivables_v1($1,'FICT-CO',null,'test') x",[today])).rows[0].x);}await f.admin(db,"set audit.uid=''");
  const sourceBefore=await f.fingerprint(db),aclBefore=(await db.query("select proacl::text,prosecdef,provolatile,proconfig,proargnames from pg_proc where oid='private.finance_ar_ledger_v1(uuid,text,date,text)'::regprocedure")).rows[0];
  await db.exec('begin;'+read(migrationFile)+'\nrollback;');check('migration rehearsal restores old source',(await db.query("select md5(prosrc) m from pg_proc where oid='private.finance_ar_ledger_v1(uuid,text,date,text)'::regprocedure")).rows[0].m===oldHash);
  await db.exec('begin;'+read(migrationFile)+'\ncommit;');
  for(let i=0;i<args.length;i++){assert.deepEqual(sorted(await mapper(db,...args[i])),before[i]);check('all financial columns and duplicate rows equal for scope '+JSON.stringify(args[i].slice(1)),true);}
  for(let i=0;i<2;i++){await f.as(db,i?'employee':'accountant');assert.deepEqual((await db.query("select public.finance_receivables_v1($1,'FICT-CO',null,'test') x",[today])).rows[0].x,payloads[i]);check((i?'employee':'accountant')+' complete canonical payload is unchanged',true);}await f.admin(db,"set audit.uid=''");
  assert.deepEqual((await db.query("select proacl::text,prosecdef,provolatile,proconfig,proargnames from pg_proc where oid='private.finance_ar_ledger_v1(uuid,text,date,text)'::regprocedure")).rows[0],aclBefore);check('signature owner mode search_path and ACL unchanged',true);
  check('migration and reads preserve full monetary source fingerprint',await f.fingerprint(db)===sourceBefore);
  await f.admin(db,"set audit.uid=''");for(const file of ['scripts/finance_canonical_receivables_postflight.sql','scripts/finance_ar_reconciliation_postflight.sql','scripts/finance_ar_mapping_postflight.sql']){await db.exec(strip(read(file)));check('unchanged caller/security postflight '+path.basename(file),true);}
  const canary=await db.exec(read('scripts/finance_ar_mapping_canary.sql'));check('exact readonly canary returns parity proof without employee claims',canary.some(x=>x.rows?.some(r=>r.ar_mapping_canary_result?.mapping_preserved===true)));check('readonly canary leaves every monetary row untouched',await f.fingerprint(db)===sourceBefore);
  const canaryCore=read('scripts/finance_ar_mapping_canary.sql').split('-- FINANCE_AUTHENTICATED_CANARY_CORE_BEGIN')[1].split('-- FINANCE_AUTHENTICATED_CANARY_CORE_END')[0];
  async function rejectChangedMapper(label,change,proof){await db.exec('begin;'+change);let error;try{await db.exec(proof);}catch(e){error=e;}await db.exec('rollback;');check(label,error&&['P0001','42501'].includes(error.code));}
  const ambiguousMutation=newSql.replace('case when x.n=1 then x.invoice_id','case when x.n>=1 then x.invoice_id');
  await rejectChangedMapper('readonly parity canary rejects assigning ambiguous journals',ambiguousMutation,canaryCore);
  await rejectChangedMapper('postflight rejects a changed mapper body',ambiguousMutation,strip(read('scripts/finance_ar_mapping_postflight.sql')));
  await rejectChangedMapper('canary rejects newly granted direct browser access','grant execute on function private.finance_ar_ledger_v1(uuid,text,date,text) to authenticated;',canaryCore);
  await rejectChangedMapper('postflight rejects newly granted service-role access','grant execute on function private.finance_ar_ledger_v1(uuid,text,date,text) to service_role;',strip(read('scripts/finance_ar_mapping_postflight.sql')));
  check('negative proof transactions restore the installed mapper and monetary data',(await db.query("select md5(prosrc) m from pg_proc where oid='private.finance_ar_ledger_v1(uuid,text,date,text)'::regprocedure")).rows[0].m===newHash&&await f.fingerprint(db)===sourceBefore);
  // Financial writers are not changed. Exercise the real recognition/allowance/
  // partial receipt/refund pipeline again with this mapper installed.
  const files=await f.make(db,'WRITER',100);await f.allowance(db,'WRITER',20,'WRITER-ALLOW',prior);await f.receipt(db,'accountant',['WRITER'],'submit',{files,amounts:{WRITER:40},date:prior});await f.receipt(db,'ceo',['WRITER'],'approve');let row=await f.ar(db,'WRITER');check('real allowance then partial collection still leaves forty',row.outstandingAmount===40&&row.receivedAmount===40&&row.arAllowanceAmount===20);
  await f.receipt(db,'accountant',['WRITER'],'submit',{files,amounts:{WRITER:40},date:today});await f.receipt(db,'ceo',['WRITER'],'approve');const al=await f.allowance(db,'WRITER',10,'WRITER-REFUND',today);await f.refund(db,al.event_id,4,0,{date:today});row=await f.ar(db,'WRITER');check('real partial refund preserves payable and receipt balances',row.refundedAmount===4&&row.refundPayable===6&&row.outstandingAmount===0);
  await f.admin(db,"set audit.uid=''");
  // Dataset size mirrors the observed production order of magnitude, but all
  // values/identifiers below are generated locally.
  await db.query("insert into public.invoices(id,no,tenant_id,data_environment,entity_id,department_code,invoice_date,total,amount,tax,status,approval_status,steps) select 'BULK-'||n,'BULK-'||n,$1,'test','FICT-CO','FICT-D',$2,100,100,0,'unpaid','draft','[]' from generate_series(1,1003)n",[tenant,prior]);
  await db.query("insert into public.ledger_entries(id,tenant_id,data_environment,entry_date,entity_id,department_code,account_code,debit,credit,source_type,source_id,reference_no,posting_key) select gen_random_uuid(),$1,'test',$2,'FICT-CO','FICT-D','1123',100,0,'invoice',case when n%4=0 then null else 'BULK-'||n end,'BULK-'||n,'bulk-map-'||n from generate_series(1,831)n",[tenant,prior]);
  const oldPlan=await rawPlan(db,oldBody,tenant,today),newPlan=await rawPlan(db,newBody,tenant,today);
  const perf={oldExecutionMs:oldPlan['Execution Time'],newExecutionMs:newPlan['Execution Time'],oldPlanningMs:oldPlan['Planning Time'],newPlanningMs:newPlan['Planning Time']};
  const oldBound=oldBody.trim().replace(/;$/,'').replace(/\bp_tenant\b/g,'$1::uuid').replace(/\bp_environment\b/g,'$2::text').replace(/\bp_as_of\b/g,'$3::date').replace(/\bp_invoice_id\b/g,'$4::text');
  const bulkOriginal=(await db.query('select * from ('+oldBound+') mapped(invoice_id,entity_id,department_code,entry_date,debit,credit,category,source_ref)',[tenant,'test',today,null])).rows;
  assert.deepEqual(sorted(await mapper(db,tenant,'test',today)),sorted(bulkOriginal));check('full production-scale fictional rows match original mapper exactly',true);
  function scans(plan,relation){let n=plan['Relation Name']===relation?plan['Actual Loops']:0;for(const p of plan.Plans||[])n+=scans(p,relation);return n;}
  check('candidate reads invoice relation only once for the full mapping',scans(newPlan.Plan,'invoices')===1);
  check('candidate reduces invoice relation scans compared with original',scans(oldPlan.Plan,'invoices')>scans(newPlan.Plan,'invoices'));
  console.log(JSON.stringify({checks,performance:perf}));
 }finally{await db.close();}
}
module.exports={createArMappingFixture,migrationFile,oldSql,oldBody,newSql,newBody,strip};
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
