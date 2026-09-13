'use strict';
// Shipped owner loader, mapper, cache and bootstrap functions. All identities and
// rows are anonymous fixtures; only the read transport, UI and clock are mocked.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const {fixture:createBroadFixture}=require('./check_dashboard_financial_sources.cjs');
function extract(name){
 let start=source.indexOf('function '+name+'(');assert(start>=0,'Shipped function '+name);
 if(source.slice(start-6,start)==='async ')start-=6;
 const end=source.indexOf('\n',start);
 return source.slice(start,end).endsWith('}')?source.slice(start,end):source.slice(start,source.indexOf('\n}',end)+2);
}
const clone=x=>JSON.parse(JSON.stringify(x)),tick=()=>new Promise(r=>setImmediate(r));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};}
let passed=0;function pass(label){passed++;console.log('PASS '+label);}
function row(id='draft-a',patch={}){return Object.assign({id,tenant_id:'tenant-a',data_environment:'production',owner_id:'finance-a',owner_email:'a@example.invalid',owner_name:'匿名本人',application_type:'expense_reimbursement',title:'離線草稿',amount:136,updated_at:'2026-09-13T01:00:00Z',payload:{state:{fields:{purpose:'虛構水費'}}},files:[]},patch);}
function fixture(options={}){
 const c={Date,Promise,Number,Object,String,Array,Math,Error,AbortController,console:{warn(){}},
  S:{user:{id:'finance-a',authUserId:'auth-a',email:'a@example.invalid',role:'employee'},demoLogin:false,page:'approvals',aT:'drafts'},
  tenant:'tenant-a',environment:'production',connected:true,financeWorkspaceIdentityBlocked:false,CURRENT_PERMISSION_SNAPSHOT:{verified:true,permissions:['drafts']},
  DEFAULT_TENANT_ID:'tenant-a',DATA_ENV_PRODUCTION:'production',SUPABASE_ATTACHMENT_BUCKET:'finance-attachments',
  DRAFTS:[],APPROVAL_SOURCE_COMPLETENESS:{identity:'',draft_requests:false},queries:[],paints:[],timers:[],
  approvalBootstrapGeneration:0,APPROVAL_HISTORY_RUNTIME:{controller:null,requestSeq:0},approvalHistorySearchTimer:null,
  setTimeout(fn,ms){const timer={fn,ms,active:true};c.timers.push(timer);return timer},clearTimeout(timer){if(timer)timer.active=false}
 };
 c.expire=()=>c.timers.filter(t=>t.active).forEach(t=>{t.active=false;t.fn()});
 c.transport=options.transport||((q)=>({data:[],count:0,error:null}));
 const client={from(table){const q={table,filters:[],orders:[],select(columns,options){q.columns=columns;q.countRequested=options&&options.count;return q},eq(k,v){q.filters.push([k,v]);return q},or(filter){q.ownerFilter=filter;return q},order(k,v){q.orders.push([k,v]);return q},range(start,end){q.start=start;q.end=end;return q},abortSignal(signal){q.signal=signal;return q},then(resolve,reject){c.queries.push(q);return Promise.resolve().then(()=>c.transport(q,c)).then(resolve,reject)}};return q}};
 Object.assign(c,{window:{},num:x=>Number(x)||0,normalizedRoleKey:u=>{assert.equal(typeof u,'object');return u.role},currentTenantId:()=>c.tenant,activeDataEnvironment:()=>c.environment,hasSupabase:()=>c.connected,getSb:()=>c.noClient?null:client,
  approvalFastBootstrapCacheKey:()=>'',sessionRemoveItem(){},updateApprovalTodoBadge(){},
  updateDraftCounters(){},buildApprovals(){c.paints.push({status:c.FINANCE_DRAFT_READ_RUNTIME.status,complete:c.FINANCE_DRAFT_READ_RUNTIME.complete,total:c.FINANCE_DRAFT_READ_RUNTIME.total,identity:c.FINANCE_DRAFT_READ_RUNTIME.identity,ids:c.DRAFTS.map(r=>r.id)})}
 });
 vm.createContext(c);
 const vars=['FINANCE_DRAFT_READ_RUNTIME','FINANCE_DRAFT_READ_TIMEOUT_MS','FINANCE_DRAFT_IDENTITY_EPOCH'].map(name=>{const line=source.split('\n').find(x=>x.startsWith('var '+name+'='));assert(line,name);return line}).join('\n');
 const names=['currentFinanceAuthUserId','approvalFastBootstrapIdentity','rowTenantId','rowDataEnvironment','resetApprovalSourceCompleteness','setApprovalSourceCompleteness','financeDraftReadIdentity','draftReadinessForCurrentUser','paintCurrentUserDrafts','financeDraftOwnerFilter','loadCurrentUserDrafts','notifyDraftMutation','approvalDraftsCompleteForCurrentUser','sanitizeDraftFile','sanitizeTravelDraftFiles','sanitizeDraftForStorage','mapRemoteDraft','clearApprovalFastBootstrapState'];
 vm.runInContext(vars+'\n'+names.map(extract).join('\n'),c);
 c.seed=async(rows)=>{c.transport=()=>({data:rows,count:rows.length});return c.loadCurrentUserDrafts({force:true})};
 return c;
}
function expectUnknown(c){const s=c.draftReadinessForCurrentUser();assert.equal(s.complete,false);assert.equal(s.total,null);assert.equal(c.approvalDraftsCompleteForCurrentUser(),false);return s;}
async function expectError(c){const result=await c.loadCurrentUserDrafts({force:true});assert(result.error);assert.equal(result.complete,false);assert.equal(result.count,null);assert.equal(expectUnknown(c).status,'error');return result;}

async function run(){
 {
  const pending=deferred(),c=fixture({transport:()=>pending.promise});
  assert.equal(expectUnknown(c).status,'idle');
  const first=c.loadCurrentUserDrafts();assert.equal(c.FINANCE_DRAFT_READ_RUNTIME.status,'loading');assert.equal(c.FINANCE_DRAFT_READ_RUNTIME.promise,first);
  assert.equal(c.loadCurrentUserDrafts(),first);assert.equal(c.loadCurrentUserDrafts({force:true}),first);
  await tick();assert.equal(c.queries.length,1);assert(c.paints.every(p=>!p.complete&&p.total===null));
  const q=c.queries[0];assert.equal(q.table,'draft_requests');assert.equal(q.columns,'*');assert.equal(q.countRequested,'exact');
  assert.deepEqual(clone(q.filters),[['tenant_id','tenant-a'],['data_environment','production']]);
  assert(q.ownerFilter.includes('owner_id.eq."finance-a"'));assert(q.ownerFilter.includes('owner_id.is.null'));assert(!q.ownerFilter.includes('auth-a'));
  assert.deepEqual(clone(q.orders),[['updated_at',{ascending:false}],['id',{ascending:true}]]);assert.equal(q.start,0);assert.equal(q.end,99);
  pending.resolve({data:[row()],count:1});const result=await first;assert(result.complete);assert.equal(result.count,1);assert.equal(c.DRAFTS[0].id,'draft-a');
  assert.equal(c.approvalDraftsCompleteForCurrentUser(),true);assert.equal((await c.loadCurrentUserDrafts()).count,1);assert.equal(c.queries.length,1);
  pass('cold load is independently owner/tenant/environment scoped, exact-count ordered, installed before paint, and force shares one pending request');
 }
 {
  const pending=deferred(),c=fixture({transport:()=>pending.promise}),read=c.loadCurrentUserDrafts();await tick();
  assert.equal(c.timers.find(t=>t.active).ms,12000);c.expire();const result=await read;assert(result.error);assert.equal(result.count,null);assert(c.queries[0].signal.aborted);assert.equal(expectUnknown(c).status,'error');
  for(let i=0;i<3;i++)assert((await c.loadCurrentUserDrafts()).error);assert.equal(c.queries.length,1);
  c.transport=()=>({data:[row('retry')],count:1});assert((await c.loadCurrentUserDrafts({force:true})).complete);
  const paints=c.paints.length;pending.resolve({data:[row('late')],count:1});await tick();assert.deepEqual(clone(c.DRAFTS.map(r=>r.id)),['retry']);assert.equal(c.paints.length,paints);
  pass('one actual 12s deadline aborts a never-settling transport, stays error without paint retry, and explicit retry rejects old late success');
 }
 {
  const c=fixture({transport:()=>({error:{code:'57014',message:'canceling statement due to statement timeout'},data:null,count:null})});await expectError(c);
  await c.loadCurrentUserDrafts();assert.equal(c.queries.length,1);c.transport=()=>({data:[],count:0});assert.equal((await c.loadCurrentUserDrafts({force:true})).count,0);
  assert.equal(c.approvalDraftsCompleteForCurrentUser(),true);assert.equal(c.FINANCE_DRAFT_READ_RUNTIME.status,'ready');
  pass('SQL 57014 remains unverified instead of zero; only exact successful empty result becomes ready zero');
 }
 for(const missing of ['connection','client','auth','identity','blocked']){
  const c=fixture();if(missing==='connection')c.connected=false;if(missing==='client')c.noClient=true;if(missing==='auth')c.S.user.authUserId='';if(missing==='identity')c.S.user=null;if(missing==='blocked')c.financeWorkspaceIdentityBlocked=true;
  await expectError(c);assert.equal(c.queries.length,0);assert(c.paints.some(p=>p.status==='error'));
  pass('missing '+missing+' produces explicit retryable error without reading another owner');
 }
 {
  const c=fixture();c.S.demoLogin=true;const result=await c.loadCurrentUserDrafts();assert(result.unavailable);assert(!result.complete);assert.equal(c.queries.length,0);
  pass('demo never starts a formal draft query or claims a verified empty formal result');
 }
 const invalid=[
  ['null result',null],['null rows',{data:null,count:0}],['unknown count',{data:[],count:null}],['missing count',{data:[]}],['fraction count',{data:[],count:.5}],['string count',{data:[],count:'0'}],['negative count',{data:[],count:-1}],
  ['duplicate ids',{data:[row(),row()],count:2}],['missing id',{data:[row('')],count:1}],['foreign tenant',{data:[row('x',{tenant_id:'tenant-b'})],count:1}],['foreign environment',{data:[row('x',{data_environment:'test'})],count:1}],
  ['foreign raw owner despite self payload',{data:[row('x',{owner_id:'foreign',payload:{ownerId:'finance-a'}})],count:1}],['empty owner is not NULL legacy',{data:[row('x',{owner_id:'',owner_email:'a@example.invalid'})],count:1}],
  ['absent envelope owner',{data:[row('x',{owner_id:undefined,payload:{ownerId:'finance-a'}})],count:1}],['rows exceed count',{data:[row()],count:0}],['short incomplete page',{data:[row()],count:2}]
 ];
 for(const [name,response] of invalid){const c=fixture({transport:()=>response});await expectError(c);assert.equal(c.DRAFTS.length,0);pass(name+' cannot certify a partial or foreign draft set');}
 {
  const candidates=Array.from({length:100},(_,i)=>row('candidate-'+i,{owner_id:null,owner_email:'prefix-a@example.invalid',payload:{ownerId:'finance-a'}}));
  candidates.push(row('legacy',{owner_id:null,owner_email:'  A@EXAMPLE.INVALID  ',payload:{ownerId:'other',dataEnv:'test'}}));
  candidates.push(row('owned',{owner_id:'finance-a',owner_email:'other@example.invalid',payload:{ownerId:'other',dataEnv:'test'}}));
  const c=fixture({transport:q=>({data:candidates.slice(q.start,q.end+1),count:candidates.length})});assert((await c.loadCurrentUserDrafts()).complete);
  assert.equal(c.queries.length,2);assert.deepEqual(c.queries.map(q=>q.start),[0,100]);assert.deepEqual(clone(c.DRAFTS.map(r=>r.id)),['legacy','owned']);assert.equal(c.FINANCE_DRAFT_READ_RUNTIME.total,2);
  assert.equal(c.DRAFTS[0].ownerId,'');assert.equal(c.DRAFTS[1].ownerId,'finance-a');assert(c.DRAFTS.every(r=>r.dataEnv==='production'));
  pass('all legacy candidates paginate before exact NULL-owner trim/email filtering; nonowners never appear and payload cannot claim ownership/environment');
 }
 {
  const c=fixture();const text=c.financeDraftOwnerFilter('id"\\),foreign','a_%*"\\@example.invalid');assert(text.includes('owner_id.eq."id\\"\\\\),foreign"'));
  assert(text.includes('owner_email.ilike."%a\\\\_\\\\%\\\\*\\"\\\\\\\\@example.invalid%"'));
  pass('owner/email filter quotes delimiters and escapes literal ILIKE wildcard characters');
 }
 {
  const c=fixture({transport:q=>q.start===0?{data:Array.from({length:100},(_,i)=>row('p'+i)),count:101}:{data:[row('last')],count:102}});await expectError(c);assert.equal(c.DRAFTS.length,0);
  pass('count change between pages rejects a mixed snapshot instead of publishing 101 of 102');
 }
 {
  const second=deferred(),c=fixture({transport:q=>q.start===0?{data:Array.from({length:100},(_,i)=>row('p'+i)),count:101}:second.promise});const p=c.loadCurrentUserDrafts();await tick();assert.equal(c.queries.length,2);assert.equal(c.timers.length,1);c.expire();assert((await p).error);assert(c.queries.every(q=>q.signal.aborted));assert.equal(c.DRAFTS.length,0);
  second.resolve({data:[row('last')],count:101});await tick();assert.equal(c.DRAFTS.length,0);
  pass('pagination shares a single overall deadline; late final page cannot publish a partial timed-out set');
 }
 {
  const attachment={name:'原件.pdf',type:'application/pdf',size:136,path:'tenant-a/fictional/private.pdf',bucket:'finance-attachments',uploadedAt:'2026-09-13T01:00:00Z',kind:'draft_file'};
  const raw=row('files',{files:[attachment],payload:{state:{fields:{description:'不可遺失'},travelFiles:{ticket:[{...attachment,path:'tenant-a/fictional/ticket.pdf'}]},passbookFiles:[{...attachment,path:'tenant-a/fictional/passbook.pdf'}]}}});
  const c=fixture();await c.seed([raw]);assert.equal(c.DRAFTS[0].files[0].path,attachment.path);assert.equal(c.DRAFTS[0].files[0].storagePath,attachment.path);assert.equal(c.DRAFTS[0].files[0].bucket,attachment.bucket);
  assert.equal(c.DRAFTS[0].state.travelFiles.ticket[0].path,'tenant-a/fictional/ticket.pdf');assert.equal(c.DRAFTS[0].state.passbookFiles[0].path,'tenant-a/fictional/passbook.pdf');assert.equal(c.DRAFTS[0].state.fields.description,'不可遺失');assert.equal(c.DRAFTS[0].files[0].draftOnly,false);
  pass('actual remote mapping preserves source attachment paths, buckets, travel/passbook attachments and form values');
 }
 {
  const c=fixture();await c.seed([row('kept')]);c.transport=()=>({error:Error('refresh denied')});await expectError(c);assert.deepEqual(clone(c.DRAFTS.map(r=>r.id)),['kept']);
  const identity=c.financeDraftReadIdentity();assert(c.notifyDraftMutation(null,'kept',identity));assert.equal(c.FINANCE_DRAFT_READ_RUNTIME.total,0);assert.equal(c.approvalDraftsCompleteForCurrentUser(),true);
  pass('failed refresh retains the last verified set without current count; confirmed deletion updates that set safely');
 }
 for(const kind of ['save','delete']){
  const c=fixture();await c.seed([row('existing')]);const stale=deferred();c.transport=()=>stale.promise;const pending=c.loadCurrentUserDrafts({force:true});await tick();
  const identity=c.financeDraftReadIdentity();const draft=kind==='save'?{id:'new',ownerId:'finance-a',dataEnv:'production',files:[{name:'saved.pdf',path:'tenant-a/fictional/saved.pdf'}],state:{fields:{purpose:'本次已保存'}}}:null;
  assert(c.notifyDraftMutation(draft,kind==='save'?'new':'existing',identity));assert((await pending).stale);assert(c.queries.at(-1).signal.aborted);const expected=clone(c.DRAFTS.map(r=>r.id));assert.deepEqual(expected,kind==='save'?['new','existing']:[]);
  stale.resolve({data:[row('existing')],count:1});await tick();assert.deepEqual(clone(c.DRAFTS.map(r=>r.id)),expected);assert.equal(c.FINANCE_DRAFT_READ_RUNTIME.total,expected.length);assert(c.approvalDraftsCompleteForCurrentUser());
  pass('confirmed '+kind+' cancels old loader generation and a late read cannot erase or resurrect a draft');
 }
 {
  const c=fixture(),identity=c.draftReadinessForCurrentUser().identity;assert(c.notifyDraftMutation({id:'new',files:[]},'new',identity));assert.deepEqual(clone(c.DRAFTS.map(r=>r.id)),['new']);expectUnknown(c);
  c.transport=()=>({data:[row('other-existing'),row('new')],count:2});assert((await c.loadCurrentUserDrafts()).complete);assert.equal(c.FINANCE_DRAFT_READ_RUNTIME.total,2);
  pass('saving before a complete read does not assert other drafts are absent; next read restores the complete set');
 }
 const changes={auth:c=>c.S.user.authUserId='auth-b',finance_id:c=>c.S.user.id='finance-b',email:c=>c.S.user.email='b@example.invalid',tenant:c=>c.tenant='tenant-b',environment:c=>c.environment='test',role:c=>c.S.user.role='accountant',permission:c=>c.CURRENT_PERMISSION_SNAPSHOT={verified:true,permissions:[]},lock:c=>c.financeWorkspaceIdentityBlocked=true};
 for(const [name,change] of Object.entries(changes)){
  const late=deferred(),c=fixture({transport:()=>late.promise}),pending=c.loadCurrentUserDrafts();await tick();const oldId=c.financeDraftReadIdentity();change(c);expectUnknown(c);assert((await pending).stale);assert(c.queries[0].signal.aborted);
  const paints=c.paints.length;late.resolve({data:[row('private-old')],count:1});await tick();assert.equal(c.DRAFTS.length,0);assert.equal(c.paints.length,paints);assert.equal(c.notifyDraftMutation({id:'late-saved',files:[]},'late-saved',oldId),false);
  pass('changed '+name+' isolates cache, cancels previous read and rejects old mutation confirmation');
 }
 {
  const late=deferred(),c=fixture({transport:()=>late.promise}),pending=c.loadCurrentUserDrafts();await tick();const oldId=c.financeDraftReadIdentity();c.clearApprovalFastBootstrapState();
  assert.equal(c.FINANCE_DRAFT_IDENTITY_EPOCH,1);assert.notEqual(c.financeDraftReadIdentity(),oldId);assert((await pending).stale);assert(c.queries[0].signal.aborted);assert.equal(expectUnknown(c).status,'idle');assert.equal(c.notifyDraftMutation({id:'old',files:[]},'old',oldId),false);
  c.transport=()=>({data:[row('after-reauth')],count:1});assert((await c.loadCurrentUserDrafts()).complete);late.resolve({data:[row('before-logout')],count:1});await tick();assert.deepEqual(clone(c.DRAFTS.map(r=>r.id)),['after-reauth']);
  const identity=c.financeDraftReadIdentity();c.approvalBootstrapGeneration++;assert.equal(c.financeDraftReadIdentity(),identity);assert(c.approvalDraftsCompleteForCurrentUser());
  pass('real clear aborts and resets same-account state immediately; reauthentication can reload while ordinary bootstrap generation preserves save identity');
 }
 {
  const late=deferred(),c=fixture({transport:()=>late.promise}),pending=c.loadCurrentUserDrafts();await tick();c.financeWorkspaceIdentityBlocked=true;late.resolve({data:[row('late')],count:1});assert((await pending).stale);assert.equal(c.FINANCE_DRAFT_READ_RUNTIME.promise,null);
  c.financeWorkspaceIdentityBlocked=false;c.transport=()=>({data:[row('again')],count:1});assert((await c.loadCurrentUserDrafts({force:true})).complete);assert.equal(c.DRAFTS[0].id,'again');
  pass('identity-stale settlement always releases its own promise so same-person explicit retry cannot remain locked');
 }
 {
  const c=createBroadFixture();let held=false;const waiting=deferred();c.syncRemoteFinanceUsersDirectory=()=>{held=true;return waiting.promise};
  const broad=c.performRemoteDataLoad();await tick();assert(held);assert.equal(c.draftReadinessForCurrentUser().status,'ready');assert.equal(c.FINANCE_DRAFT_READ_RUNTIME.total,0);assert.equal(c.queries.filter(q=>q.table==='draft_requests').length,1);
  waiting.resolve({users:[c.S.user]});assert.equal(await broad,true);assert(c.max<=2);assert(c.maxWide<=1);
  pass('actual broad bootstrap loads owner drafts before even its blocked users prerequisite finishes, outside the financial read lanes');
 }
 {
  let rows=[row('first')];const c=createBroadFixture({transport:q=>q.table==='draft_requests'?Promise.resolve({data:rows,count:rows.length}):null});
  assert.equal(await c.performRemoteDataLoad(),true);assert.deepEqual(clone(c.DRAFTS.map(r=>r.id)),['first']);
  rows=[row('external-new')];assert.equal(await c.performRemoteDataLoad(),true);assert.deepEqual(clone(c.DRAFTS.map(r=>r.id)),['external-new']);assert.equal(c.queries.filter(q=>q.table==='draft_requests').length,2);assert(c.max<=2);assert(c.maxWide<=1);
  pass('a second real full synchronization force-reads external draft additions/deletions even after a ready cache');
 }
 {
  const tail=deferred();let reached=false;const c=createBroadFixture({transport:q=>q.table==='draft_requests'?Promise.resolve({data:[row('before-tail')],count:1}):null,fallback:rows=>{reached=true;return tail.promise.then(()=>rows)}});
  const broad=c.performRemoteDataLoad();for(let i=0;i<30&&!reached;i++)await tick();assert(reached);
  vm.runInContext(extract('notifyDraftMutation')+'\n'+extract('sanitizeDraftForStorage')+'\n'+extract('sanitizeTravelDraftFiles')+'\n'+extract('sanitizeDraftFile'),c);
  c.num=x=>Number(x)||0;c.SUPABASE_ATTACHMENT_BUCKET='finance-attachments';const identity=c.financeDraftReadIdentity();assert(c.notifyDraftMutation(null,'before-tail',identity));assert.equal(c.DRAFTS.length,0);
  tail.resolve();assert.equal(await broad,true);assert.equal(c.DRAFTS.length,0);assert.equal(c.FINANCE_DRAFT_READ_RUNTIME.total,0);
  pass('late broad result processing cannot reapply an earlier draft result after a confirmed mutation');
 }
 console.log('OK: '+passed+' actual draft readiness checks');
}
module.exports={fixture};
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1});
