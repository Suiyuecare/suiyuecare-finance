'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function between(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a,start);return source.slice(a,b);}
let assertions=0;
function equal(a,b,message){assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)),message);assertions++;}
function fixture(){
  const alerts=[],events=[],downloads=[],session=new Map(),c={console,TextEncoder,Uint8Array,Set,BigInt,Blob,crypto:webcrypto,
    sessionStorage:{get length(){return session.size;},key:index=>Array.from(session.keys())[index]||null,setItem:(key,value)=>session.set(key,value),getItem:key=>session.get(key)||null,removeItem:key=>session.delete(key)},
    S:{user:{id:'reviewer',n:'Fictional reviewer'},demoLogin:true},identity:'reviewer',tenant:'tenant-A',env:'test',
    USERS:[{id:'reviewer',n:'Fictional reviewer',tenantId:'tenant-A',pw:'never-export'}],REQS:[{id:'request-1',eid:'A',desc:'fixture',dataEnv:'test'}],INVS:[],VOUCHERS:[],LEDGER:[],BILLS:[],NOTIFS:[],
    SYSTEM_SETTINGS:{bank_transfer_fee:15,department_history_aliases:[{old:'old-dept',current:'new-dept'}],organization_chart:[{uid:'reviewer',managerId:'manager'}]},
    PERIOD_CLOSES:[{id:'close-1',eid:'A',period:'2026-09',by:'Fictional reviewer',time:'2026-09-27',dataEnv:'test'}],
    ARCHIVES:[{id:'arc-1',eid:'A',docs:2,fileCount:3,by:'Fictional reviewer',time:'2026-09-27',retainDocsUntil:'2036-12-31',dataEnv:'test'}],ANNUAL_REVIEWS:[],AUDIT_LOGS:[],FINANCE_USER_SAFE_COLUMNS:'id,name,tenant_id',SYSTEM_SETTINGS_RUNTIME_KEYS:['entities','departments','accounts'],
    financeAccountingReadReady:()=>true,currentSystemSettings:()=>({entities:[{id:'A'}],departments:[],accounts:[]}),activeDataEnvironment(){return c.env;},currentTenantId(){return c.tenant;},
    approvalFastBootstrapIdentity(){return c.identity;},dataEnvLabel:()=> 'test',currentRoleKey:()=> 'accountant',inActiveDataEnvironment:r=>r.dataEnv==='test',sanitizeLocalReq:r=>r,
    allowLocalPersistence:()=>true,requireFinanceAccountingRead:()=>true,isFinance:()=>true,
    financeBootstrapRead:async q=>await q,alert:x=>alerts.push(x),confirm:()=>true,recordBackupEvent:async(...args)=>events.push(args),backupSummary:p=>Object.fromEntries(Object.entries(p.data).map(([k,v])=>[k,Array.isArray(v)?v.length:0])),backupReadableSummary:()=> 'fixture',
    downloadTextFile:(data,name)=>downloads.push({data,name}),buildCompliance:()=>{},el:()=>null,initFilters:()=>{},buildAll:()=>{},
    saveLocalAppState:()=>{},saveComplianceStore:()=>{},DATA_ENV_PRODUCTION:'production',prompt:()=> '還原測試資料',
    ENTS:[],DEPTS:[],ACCTS:[],BANK_TRANSFER_FEES:{},ROLE_PERMISSIONS:{},PRODUCT_MODULES:[],WORKFLOW_TEMPLATES:[],FORM_FIELD_CONFIGS:[],ACCOUNTING_TEMPLATES:[],CUSTOMER_PROFILES:[],DEFAULT_CUSTOMER_PROFILE_ID:'',
    ensureSharedAccountingConfig:()=>{},normalizeRolePermissionsConfig:v=>v,normalizeProductModules:v=>v,normalizeWorkflowTemplates:v=>v,normalizeFormFieldConfigs:v=>v,normalizeAccountingTemplates:v=>v,normalizeCustomerProfiles:v=>v,normalizeDefaultCustomerProfileId:v=>v,
    normalizeFiles:f=>f||[],mapUser:r=>r,mapReq:r=>r,mapInv:r=>r,mapVoucher:r=>r,mapLedger:r=>r,mapBill:r=>r,mapNotif:r=>r,mapPeriodClose:r=>r,mapComplianceArchive:r=>r,mapAnnualReview:r=>r,mapComplianceAudit:r=>r,
    compEntity:()=> 'A',compPeriod:()=> '2026-09',inPeriod:(d,p)=>d.startsWith(p),accountingControlRecordDate:(_,r)=>r.date,accountingControlFiles:(_,r)=>r.files||[],
    attachmentStoragePath:f=>f.path||'',canDownloadAttachment:()=>true,SUPABASE_ATTACHMENT_BUCKET:'finance-attachments',recordAttachmentAccess:()=>{},
  };
  c.window=c;vm.createContext(c);
  c.financeReportEngine=()=>null;vm.runInContext(between('function fmt(', 'function fmtMoney('),c);
  c.applySystemSettings=rows=>{c.SYSTEM_SETTINGS=Object.fromEntries(rows.map(row=>[row.key,row.value]));};
  vm.runInContext(between('function adjustmentEntriesFromVoucher(', 'window.createAdjustmentVoucher='),c);
  vm.runInContext(between('function buildBackupPackage(', 'window.downloadBackupPackage='),c);
  vm.runInContext(between('window.createAdjustmentVoucher=', 'window.archivePeriodDocuments='),c);
  vm.runInContext(between('window.downloadBackupPackage=', 'window.backupFileChange='),c);
  vm.runInContext(between('function restoreRows(', 'window.buildCompliance='),c);
  vm.runInContext(between('function documentArchiveStatus(', 'window.exportAnnualPackage='),c);
  return {c,alerts,events,downloads};
}
function remoteClient(c,counts={},options={}){
  const calls=[];
  return {calls,from(table){let offset=0,end=249,head=false,order='id';
    const q={select(_,opts={}){head=!!opts.head;return q;},eq(){return q;},in(){return q;},order(value){order=value;return q;},range(a,b){offset=a;end=b;return q;},then(resolve){
      calls.push({table,offset,end,head});
      if(options.errorTable===table)return Promise.resolve({error:{message:'fixture read failed'}}).then(resolve);
      const count=counts[table]||0;
      const data=head?null:Array.from({length:Math.max(0,Math.min(end+1,count)-offset)},(_,i)=>({[order]:String(offset+i+1),tenant_id:c.tenant,...(['finance_users','system_settings'].includes(table)?{}:{data_environment:c.env})}));
      if(options.afterPage)options.afterPage(table,offset);
      return Promise.resolve({data,error:null,count:head&&options.changedTable===table?count+1:count}).then(resolve);
    }};return q;
  }};
}
(async()=>{
  let f=fixture(),v={total:100,entries:[{t:'dr',ac:'1000',amt:100},{t:'cr',ac:'2000',amt:100}]};
  equal([f.c.fmt(10.50),f.c.fmt(0.30),f.c.fmt(-10.50),f.c.fmt(1000)],['NT$10.50','NT$0.30','NT$-10.50','NT$1,000']);
  equal(f.c.adjustmentEntriesFromVoucher(v,10.50).map(e=>e.amt),[10.50,10.50]);
  equal(f.c.adjustmentEntriesFromVoucher({total:0.30,entries:[{t:'dr',ac:'1000',amt:0.30},{t:'cr',ac:'2000',amt:0.30}]},0.30).map(e=>e.amt),[0.30,0.30]);
  const multi={total:1,entries:[{t:'dr',ac:'1',amt:0.33},{t:'dr',ac:'2',amt:0.33},{t:'dr',ac:'3',amt:0.34},{t:'cr',ac:'4',amt:0.5},{t:'cr',ac:'5',amt:0.5}]};
  for(const amount of [0.01,0.02,0.03,0.17,0.99,1]){
    const rows=f.c.adjustmentEntriesFromVoucher(multi,amount);
    equal(['dr','cr'].map(side=>rows.filter(e=>e.t===side).reduce((s,e)=>s+Math.round(e.amt*100),0)),[Math.round(amount*100),Math.round(amount*100)]);
  }
  for(const amount of [-1,0,101,NaN,'','1.001','1e2']){assert.throws(()=>f.c.adjustmentEntriesFromVoucher(v,amount));assertions++;}
  assert.throws(()=>f.c.adjustmentEntriesFromVoucher({...v,entries:[{t:'dr',ac:'1',amt:99},{t:'cr',ac:'2',amt:100}]},10));assertions++;
  const precisionFixture=fixture(),pc=precisionFixture.c;pc.S.demoLogin=false;pc.VOUCHERS=[{...v,id:'original',eid:'A',no:'V-fixture'}];
  const fields={'adj-voucher':{value:'original'},'adj-type':{value:'adjustment'},'adj-amount':{value:'10.50'},'adj-reason':{value:'fictional correction'}};pc.el=id=>fields[id];
  let rpcCalls=[],localNo=0,auditCalls=0;pc.console={error:()=>{}};pc.num=Number;pc.voucherLocked=()=>true;pc.ensureOpenPostingPeriod=()=>true;pc.todayIso=()=> '2026-09-27';pc.hasSupabase=()=>true;pc.loadRemoteData=async()=>true;pc.renderVouchers=()=>{};pc.accountingPeriodOf=()=> '2026-09';pc.auditLog=async()=>{auditCalls++;};pc.nextVoucherNo=async()=>{localNo++;return 'fictional-number';};
  pc.callAccountingRpc=async(name,payload)=>{rpcCalls.push({name,payload});return {ok:false,error:{message:'fixture denied'}};};
  await pc.createAdjustmentVoucher();equal(localNo,0);equal(pc.VOUCHERS.length,1);equal(pc.LEDGER.length,0);equal(auditCalls,0);
  pc.callAccountingRpc=async(name,payload)=>{rpcCalls.push({name,payload});return {ok:true,data:{voucher_no:'posted-fixture'}};};
  await pc.createAdjustmentVoucher();equal(rpcCalls.at(-1).payload.p_entries.map(e=>e.amt),[10.50,10.50]);equal(auditCalls,1);
  pc.callAccountingRpc=async()=>{pc.identity='another-reviewer';return {ok:true};};await pc.createAdjustmentVoucher();equal(auditCalls,1);
  let pkg=f.c.buildBackupPackage();pkg.fileHash=await f.c.backupStrictHash(JSON.stringify(pkg,null,2));await f.c.validateBackupPackage(pkg);
  equal(f.c.restoreRows(pkg.data.periodCloses),pkg.data.periodCloses);
  equal(f.c.restoreRows(pkg.data.archives),pkg.data.archives);
  assert(!Object.hasOwn(pkg.data.users[0],'pw'));assertions++;
  for(const change of [p=>p.data.requests[0].desc='changed',p=>p.tenantId='tenant-B',p=>p.dataEnvironment='production',p=>p.version=1,p=>p.fileHash='fallback_123',p=>delete p.data.ledger]){
    let altered=JSON.parse(JSON.stringify(pkg));change(altered);await assert.rejects(f.c.validateBackupPackage(altered));assertions++;
  }
  f.c.S.restorePackage=pkg;f.c.S.demoLogin=false;
  let before=JSON.stringify(f.c.REQS);await f.c.restoreBackupPackage();equal(JSON.stringify(f.c.REQS),before);equal(f.events.map(e=>e.slice(0,2)),[['validation','verified']]);
  assert(f.alerts.some(a=>/正式帳務與畫面未更動/.test(a)));assertions++;
  f=fixture();f.c.S.restorePackage=pkg;f.c.PERIOD_CLOSES=[];f.c.ARCHIVES=[];
  await f.c.restoreBackupPackage();equal(f.c.PERIOD_CLOSES,pkg.data.periodCloses);equal(f.c.ARCHIVES,pkg.data.archives);equal(f.c.SYSTEM_SETTINGS,pkg.data.settings);
  f=fixture();f.c.S.demoLogin=false;let client=remoteClient(f.c,{expense_requests:501,vouchers:251});f.c.getSb=()=>client;
  const full=await f.c.buildVerifiedRemoteBackupPackage(f.c.backupOperationIdentity());equal(full.data.requests.length,501);equal(full.data.vouchers.length,251);
  full.fileHash=await f.c.backupStrictHash(JSON.stringify(full,null,2));await f.c.validateBackupPackage(full);
  equal(client.calls.filter(c=>c.table==='expense_requests'&&!c.head).map(c=>c.offset),[0,250,500]);
  client=remoteClient(f.c,{expense_requests:1},{errorTable:'vouchers'});f.c.getSb=()=>client;await f.c.downloadBackupPackage();equal(f.downloads.length,0);
  client=remoteClient(f.c,{expense_requests:1},{changedTable:'expense_requests'});f.c.getSb=()=>client;await f.c.downloadBackupPackage();equal(f.downloads.length,0);
  client=remoteClient(f.c,{expense_requests:501},{afterPage:(table,offset)=>{if(table==='expense_requests'&&offset===0)f.c.identity='another-reviewer';}});f.c.getSb=()=>client;
  await f.c.downloadBackupPackage();equal(f.downloads.length,0);
  function archiveFixture(mode){
    const f=fixture();f.c.S.demoLogin=false;f.c.env='production';const objects=new Map(),uploads=[],rpcs=[];let first=true;
    f.c.documentArchiveStatus=text=>f.alerts.push(text);
    const file={path:'tenant-A/expense_requests/production/original.pdf',n:'fixture.pdf'};
    f.c.loadBackupTablePages=async(_,spec)=>spec.table==='expense_requests'?[{id:'r1',no:'fixture',eid:'A',date:'2026-09-01',files:[file]}]:[];
    const client={storage:{from:bucket=>({download:async storagePath=>bucket==='finance-attachments'?{data:new Blob(['original fixture'],{type:'application/pdf'}),error:null}:objects.has(storagePath)?{data:objects.get(storagePath),error:null}:{error:{message:'not found'}},upload:async(storagePath,blob)=>{
      uploads.push(storagePath);if(mode==='upload-failure'&&first){first=false;return {error:{message:'connection lost'}};}
      if(objects.has(storagePath))return {error:{message:'duplicate'}};
      objects.set(storagePath,mode==='corrupt'?new Blob(['corrupt']):blob);
      if(mode==='cancel')f.c.cancelDocumentArchiveOperation();
      if(mode==='lost-response')return {error:{message:'connection lost'}};return {error:null};
    }})},rpc:async(name,payload)=>{rpcs.push({name,payload});if(name==='finance_seal_document_archive_v1')return {data:{ok:true,archiveId:payload.p_manifest.archiveId},error:null};
      if(name==='finance_document_archives_v1')return {data:{ok:true,archives:[{archiveId:'sealed-uuid',manifest:f.c.manifest}]},error:null};
      return {data:{ok:true},error:null};}};
    f.c.getSb=()=>client;return {...f,objects,uploads,rpcs};
  }
  f=archiveFixture('success');await f.c.sealPeriodDocuments();equal(f.rpcs.filter(r=>r.name==='finance_seal_document_archive_v1').length,1,f.alerts.join('\n'));equal(f.uploads.length,1);assert(!f.c.S.documentArchiveRetry);assertions++;
  f.manifest=f.c.manifest=f.rpcs[0].payload.p_manifest;await f.c.verifyPeriodDocumentArchive();equal(f.rpcs.filter(r=>r.name==='finance_verify_document_archive_v1').length,1,f.alerts.join('\n'));
  f.objects.set(f.manifest.files[0].path,new Blob(['different bytes']));await f.c.verifyPeriodDocumentArchive();equal(f.rpcs.filter(r=>r.name==='finance_verify_document_archive_v1').length,1);
  f=archiveFixture('corrupt');await f.c.sealPeriodDocuments();equal(f.rpcs.length,0);assert(f.c.S.documentArchiveRetry);assertions++;
  f=archiveFixture('lost-response');await f.c.sealPeriodDocuments();equal(f.rpcs.filter(r=>r.name==='finance_seal_document_archive_v1').length,1);
  f=archiveFixture('upload-failure');await f.c.sealPeriodDocuments();equal(f.rpcs.length,0);const retained=f.c.S.documentArchiveRetry.manifest.archiveId;
  equal(f.c.loadDocumentArchiveRetry('another-reviewer','A','2026-09'),null);f.c.S.documentArchiveRetry=null;
  await f.c.sealPeriodDocuments();equal(f.rpcs[0].payload.p_manifest.archiveId,retained);equal(new Set(f.uploads).size,1);
  equal(f.c.loadDocumentArchiveRetry(f.c.backupOperationIdentity(),'A','2026-09'),null);
  f=archiveFixture('cancel');await f.c.sealPeriodDocuments();equal(f.rpcs.length,0);assert(f.c.S.documentArchiveRetry);assertions++;
  f=archiveFixture('success');f.c.loadBackupTablePages=async(_,spec)=>spec.table==='expense_requests'?[{id:'r1',no:'fixture',eid:'A',date:'2026-09-01',files:Array.from({length:101},(_,index)=>({path:'original-'+index,n:'fixture-'+index+'.pdf'}))}]:[];
  await f.c.sealPeriodDocuments();equal(f.uploads.length,101);equal(f.rpcs[0].payload.p_manifest.files.length,101);
  f=archiveFixture('success');let sourceReads=0;f.c.loadBackupTablePages=async(_,spec)=>spec.table==='expense_requests'?[{id:'r1',no:'fixture',eid:'A',date:'2026-09-01',files:[{path:++sourceReads===1?'original-old':'original-new',n:'fixture.pdf'}]}]:[];
  await f.c.sealPeriodDocuments();equal(f.rpcs.length,0);const previousArchive=f.c.S.documentArchiveRetry.manifest.archiveId;
  await f.c.restartPeriodDocumentArchive();equal(f.rpcs.length,1);assert.notEqual(f.rpcs[0].payload.p_manifest.archiveId,previousArchive);assertions++;
  f=archiveFixture('upload-failure');await f.c.sealPeriodDocuments();assert(f.c.loadDocumentArchiveRetry(f.c.backupOperationIdentity(),'A','2026-09'));assertions++;
  f.c.clearDocumentArchiveRetryForCurrentIdentity();equal(f.c.loadDocumentArchiveRetry(f.c.backupOperationIdentity(),'A','2026-09'),null);
  f=archiveFixture('success');f.c.canDownloadAttachment=()=>false;await f.c.sealPeriodDocuments();equal(f.uploads.length,0);equal(f.rpcs.length,0);
  console.log('PASS accounting cents, verified scoped backup and original archive checks: '+assertions);
})().catch(error=>{console.error(error);process.exitCode=1;});
