#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
const block=html.slice(html.indexOf('function approvalHistoryIdentity(){'),html.indexOf('async function performRemoteDataLoad(){'));
const fn=name=>{const start=html.indexOf('function '+name+'(');return html.slice(start,html.indexOf('\n}',start)+2);};
let checks=0;function check(name,condition=true){assert(condition,name);checks++;console.log('PASS '+name);}
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(mode){
 const c={window:{},Promise,Date,Number,String,Object,Array,Math,JSON,Error,AbortController,console:{warn(){},error(){}},setTimeout:(f,ms)=>setTimeout(f,Math.min(ms,20)),clearTimeout,
 S:{user:{id:'FICTION',authUserId:'AUTH'},page:'approvals',aT:'h',apprPage:1,apprQuery:'',demoLogin:false},REQS:[],BILLS:[],INVS:[],calls:[],paint:[],env:'test',tenant:'T',financeWorkspaceIdentityBlocked:false,
 APPROVAL_HISTORY_RUNTIME:{identity:'',status:'idle',items:[],total:0,allTotal:0,page:1,limit:50,query:'',error:'',updatedAt:'',promise:null,requestSeq:0}};
 Object.assign(c,{approvalFastBootstrapIdentity:()=>c.tenant+'|auth:'+c.S.user?.authUserId,currentTenantId:()=>c.tenant,activeDataEnvironment:()=>c.env,DEFAULT_TENANT_ID:'T',getSb:()=>({rpc:(name,args)=>{c.calls.push(args);return mode(args,c);}}),updateApprovalTodoBadge:()=>{},buildApprovals:()=>c.paint.push(c.APPROVAL_HISTORY_RUNTIME.status),remoteReadIssueText:e=>e.message,recordRemoteReadIssue:()=>{},escAttr:x=>String(x),el:()=>null,mapReq:x=>({...x}),mapBill:x=>({...x}),mapInv:x=>({...x}),mergeRemoteRowsByKey:(a,b)=>[...a,...b.filter(x=>!a.some(y=>x.id===y.id))]});
 vm.createContext(c);vm.runInContext(fn('withOperationTimeout')+'\n'+block,c);return c;
}
function payload(c,{offset=0,total=1,all=total,ids=null}={}){const rows=ids||Array.from({length:Math.min(50,Math.max(0,total-offset))},(_,i)=>'R'+(i+offset));return{ok:true,identity:{finance_user_id:c.S.user.id,auth_user_id:c.S.user.authUserId,tenant_id:c.tenant,data_environment:c.env},total,all_total:all,page:{limit:50,offset,has_more:offset+50<total},items:rows.map(id=>({record_type:'expense_requests',kind:'req',record_id:id,history_key:'expense_requests:'+id,source_rows:[{id,tenant_id:c.tenant,data_environment:c.env}],personally_acted:true}))};}
(async()=>{
 for(const mode of ['57014','hang','sync']){
  const c=fixture(()=>{if(mode==='sync')throw Error('Client init failed');if(mode==='hang')return new Promise(()=>{});return Promise.resolve({error:{code:'57014',message:'canceling statement due to statement timeout'}});});
  const result=await c.loadApprovalHistoryPage();check(mode+' settles to error with no stuck loading/promise',!result.ok&&c.APPROVAL_HISTORY_RUNTIME.status==='error'&&!c.APPROVAL_HISTORY_RUNTIME.promise&&c.APPROVAL_HISTORY_RUNTIME.updatedAt==='');
  check(mode+' exposes real global retry action',typeof c.window.loadApprovalHistoryPage==='function'&&c.approvalHistoryStatusHtml().includes('loadApprovalHistoryPage({force:true})'));
  c.getSb=()=>({rpc:()=>Promise.resolve({data:payload(c)})});assert((await c.window.loadApprovalHistoryPage({force:true})).ok);check(mode+' retry restores authoritative rows/count',c.APPROVAL_HISTORY_RUNTIME.total===1&&c.REQS.length===1);
 }
 {
  const c=fixture((args,c)=>Promise.resolve({data:payload(c,{offset:args.p_offset,total:123})}));let ids=[];
  for(let p=1;p<=3;p++){const out=await c.loadApprovalHistoryPage({page:p});assert(out.ok);ids.push(...out.items.map(x=>x.raw.id));assert.equal(c.APPROVAL_HISTORY_RUNTIME.total,123);assert.equal(c.S.apprPage,p);}
  check('all 123 authorized records remain reachable across three server pages',ids.length===123&&new Set(ids).size===123&&c.calls.length===3);
  const out=await c.loadApprovalHistoryPage({page:9});check('a now-out-of-range page recovers the authoritative last page',out.ok&&c.APPROVAL_HISTORY_RUNTIME.page===3&&c.APPROVAL_HISTORY_RUNTIME.items.length===23);
 }
 {
  let resolveOld;const c=fixture((args,c)=>args.p_search==='old'?new Promise(r=>resolveOld=r):Promise.resolve({data:payload(c,{ids:['NEW']})}));
  const old=c.loadApprovalHistoryPage({query:'old'});await tick();const oldPayload=payload(c,{ids:['OLD']});await c.loadApprovalHistoryPage({force:true,query:'new'});resolveOld({data:oldPayload});assert((await old).stale);check('slow old search cannot overwrite newer results or cache',c.REQS.length===1&&c.REQS[0].id==='NEW');
 }
 for(const change of ['user','auth','tenant','env','lock','reset']){
  let resolve;const c=fixture(()=>new Promise(r=>resolve=r));const pending=c.loadApprovalHistoryPage();await tick();const result=payload(c);
  if(change==='user')c.S.user.id='OTHER';if(change==='auth')c.S.user.authUserId='OTHER';if(change==='tenant')c.tenant='OTHER';if(change==='env')c.env='production';if(change==='lock')c.financeWorkspaceIdentityBlocked=true;if(change==='reset')c.APPROVAL_HISTORY_RUNTIME={...c.APPROVAL_HISTORY_RUNTIME,promise:null};
  resolve({data:result});assert((await pending).stale);check(change+' prevents late response from merging another workspace',c.REQS.length===0);
 }
 for(const bad of ['total-null','total-string','all-missing','rows-truncated','wrong-page','duplicate','wrong-auth','wrong-env','empty-source']){
  const c=fixture((args,c)=>{const p=payload(c,{total:2});if(bad==='total-null')p.total=null;if(bad==='total-string')p.total='2';if(bad==='all-missing')delete p.all_total;if(bad==='rows-truncated')p.items.pop();if(bad==='wrong-page')p.page.offset=50;if(bad==='duplicate')p.items[1]=p.items[0];if(bad==='wrong-auth')p.identity.auth_user_id='OTHER';if(bad==='wrong-env')p.items[0].source_rows[0].data_environment='production';if(bad==='empty-source')p.items[0].source_rows=[];return Promise.resolve({data:p});});
  const out=await c.loadApprovalHistoryPage();check(bad+' is rejected before source-cache mutation and never called zero history',!out.ok&&c.REQS.length===0&&c.APPROVAL_HISTORY_RUNTIME.status==='error'&&!c.APPROVAL_HISTORY_RUNTIME.updatedAt);
 }
 {
  const c=fixture((args,c)=>Promise.resolve({data:payload(c)}));c.buildApprovals=()=>{throw Error('View failure');};assert((await c.loadApprovalHistoryPage()).ok);check('view exception cannot prevent query dispatch or strand loading',c.calls.length===1&&c.APPROVAL_HISTORY_RUNTIME.status==='ready'&&!c.APPROVAL_HISTORY_RUNTIME.promise);
 }
 {
  let aborts=0,thenCalls=0;const c=fixture(()=>({abortSignal(signal){signal.addEventListener('abort',()=>aborts++);return this;},then(){thenCalls++;return new Promise(()=>{});}}));const out=await c.loadApprovalHistoryPage();check('timed-out query is aborted once without awaiting an uncooperative transport forever',!out.ok&&aborts===1&&thenCalls===1&&!c.APPROVAL_HISTORY_RUNTIME.promise);
 }
 {
  const c=fixture((args,c)=>Promise.resolve({data:payload(c)}));await c.loadApprovalHistoryPage();c.getSb=()=>({rpc:()=>Promise.resolve({error:{code:'57014',message:'timeout'}})});await c.loadApprovalHistoryPage({force:true});check('failed same-page refresh keeps last verified records and count',c.APPROVAL_HISTORY_RUNTIME.items.length===1&&c.APPROVAL_HISTORY_RUNTIME.total===1&&!!c.APPROVAL_HISTORY_RUNTIME.updatedAt);
 }
 {
  const c=fixture((args,c)=>Promise.resolve({data:payload(c,{total:2})}));let mapped=0;c.mapReq=row=>{if(++mapped===2)throw Error('Malformed stored detail');return row;};const out=await c.loadApprovalHistoryPage();check('a late row-mapping failure cannot partly merge an incomplete page',!out.ok&&c.REQS.length===0&&c.APPROVAL_HISTORY_RUNTIME.items.length===0);
 }
 console.log('History loading: '+checks+' actual handler checks passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
