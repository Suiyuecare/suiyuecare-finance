'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
function fn(name){const start=source.indexOf('function '+name+'(');assert.ok(start>=0,name);const end=source.indexOf('\n}',start)+2;return source.slice(start,end);}
const helper=source.slice(source.indexOf('var POSTED_ACCOUNTING_VIEWS='),source.indexOf('function buildAccountingLines('));
const clone=value=>JSON.parse(JSON.stringify(value));
let identity='auth-a',tenant='tenant-a',environment='production',response={},calls=[];
const c={Promise,WeakMap,Set,console,S:{user:{id:'reviewer'},demoLogin:false},financeWorkspaceIdentityBlocked:false,
 currentRoleKey:()=> 'accountant',currentFinanceAuthUserId:()=>identity,currentTenantId:()=>tenant,activeDataEnvironment:()=>environment,
 approvalFastBootstrapIdentity:()=>[identity,tenant,environment].join('|'),hasSupabase:()=>true,
 requestPostingLocked:r=>r.status==='completed',requestLedgerPostedAt:r=>r.ledgerPostedAt||'',
 cloneSettingValue:clone,num:n=>Number(n||0),requestBankFeeAmount:r=>r.bankFee||0,
 pettyIsInitial:r=>r.pettyMode==='initial',normalizeAccountingLine:l=>clone(l),sourceRowsForAccounting:()=>[],
 accountingLineFieldIsHuman:l=>!!l.manualOverride,principalAccountingLines:lines=>lines,
 canEditAccountingLineAmounts:()=>false,canEditAccountingLineSubjects:()=>false,accountingReviewDraftHtml:()=>'',
 fmt:n=>String(n),escAttr:v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])),
 getSb:()=>({from(table){const query={table,filters:[],then(resolve,reject){calls.push(query);return Promise.resolve(typeof response[table]==='function'?response[table]():response[table]).then(resolve,reject);}};for(const method of ['select','eq','order','range','maybeSingle'])query[method]=(...args)=>{query.filters.push([method,...args]);return query;};return query;}})};
c.window=c;vm.createContext(c);vm.runInContext(helper+'\n'+['buildAccountingLines','entriesFromAccountingLines','pettyCashVoucherEntries','accountingLinesHtml'].map(fn).join('\n'),c);
const old={id:'line_1',description:'匿名修繕',departmentCode:'D1',netAmount:657,taxAmount:33,grossAmount:690,debitAccount:'6299',debitAccountName:'舊科目',creditAccount:'1111',creditAccountName:'零用金'};
const corrected={...old,netAmount:690,taxAmount:0,debitAccount:'6207',debitAccountName:'修繕費',creditAccount:'1112',manualOverride:true,manualFields:['debitAccount','netAmount','taxAmount'],reviewedAt:'2026-09-06T08:53:16Z'};
function request(){return {id:'request-a',no:'ANON-001',status:'completed',type:'petty_cash_request',amt:690,eid:'E1',dc:'D1',ver:7,voucherId:'V-001',ledgerPostedAt:'2026-09-06',tenantId:tenant,formPayload:{accountingLines:[clone(old)]}};}
function setResponses(r,lines=[corrected]){const work=clone(r);work.formPayload.accountingLines=clone(lines);const entries=c.pettyCashVoucherEntries(work,690,0);const voucher={id:r.voucherId,no:r.voucherId,request_id:r.id,entity_id:r.eid,tenant_id:tenant,data_environment:environment,posted:true,voided_at:null,total:1380,entries:clone(entries)};const rows=lines.map((l,i)=>({id:'app-'+i,request_id:r.id,request_no:r.no,line_index:i+1,entity_id:r.eid,department_code:r.dc,tenant_id:tenant,data_environment:environment,source:'expense_detail',description:l.description,net_amount:l.netAmount,tax_amount:l.taxAmount,gross_amount:l.grossAmount,debit_account:l.debitAccount,debit_account_name:l.debitAccountName,credit_account:l.creditAccount,credit_account_name:l.creditAccountName,payload:clone(l)}));response={vouchers:{data:voucher},application_accounting_lines:{data:rows}};return voucher;}
(async()=>{
 let r=request();setResponses(r);let before=JSON.stringify(r);
 const loading=c.accountingLinesHtml(r,false);assert.ok(loading.includes('正在讀取'));assert.ok(!loading.includes('舊科目'));
 const view=await c.ensurePostedAccountingView(r);assert.equal(view.status,'ready');assert.equal(view.lines[0].debitAccount,'6207');assert.equal(view.lines[0].taxAmount,0);assert.equal(JSON.stringify(r),before,'readonly view preserves source/audit snapshot');
 assert.equal(c.buildAccountingLines(r)[0].debitAccount,'6207');const rendered=c.accountingLinesHtml(r,false);assert.ok(rendered.includes('正式入帳會計明細')&&rendered.includes('修繕費'));assert.ok(!rendered.includes('舊科目'));assert.ok(rendered.includes('補足另貸 1112'));assert.ok(!rendered.includes('尚無法與此傳票完整對照'));
 for(const q of calls){for(const pair of [['tenant_id',tenant],['data_environment',environment],['request_id',r.id]])assert.ok(q.filters.some(x=>x[0]==='eq'&&x[1]===pair[0]&&x[2]===pair[1]));}
 r=request();setResponses(r);response.application_accounting_lines.data[0].debit_account='wrong';let mismatch=await c.ensurePostedAccountingView(r);assert.equal(mismatch.lines,null);let fallback=c.accountingLinesHtml(r,false);assert.ok(fallback.includes('正式入帳分錄')&&fallback.includes('6207'));assert.ok(!fallback.includes('舊科目'));
 r=request();setResponses(r);response.application_accounting_lines={error:{code:'42501'}};assert.equal((await c.ensurePostedAccountingView(r)).lines,null,'line read denied falls back only to verified voucher');
 r=request();setResponses(r);response.vouchers={error:{code:'42501'}};let denied=await c.ensurePostedAccountingView(r);assert.equal(denied.status,'error');assert.ok(c.accountingLinesHtml(r,false).includes('重新讀取'));assert.ok(!c.accountingLinesHtml(r,false).includes('舊科目'));
 r=request();setResponses(r);response.vouchers.data.tenant_id='other';assert.equal((await c.ensurePostedAccountingView(r)).status,'error');
 r=request();setResponses(r);response.vouchers.data.entries[0].amt=680;assert.equal((await c.ensurePostedAccountingView(r)).status,'error','unbalanced voucher never accepted');
 r=request();setResponses(r);let release;const deferred=new Promise(resolve=>release=resolve);const result=response.vouchers;response.vouchers=()=>deferred;const pending=c.ensurePostedAccountingView(r);await Promise.resolve();identity='auth-b';release(result);assert.equal(await pending,null);assert.notEqual(c.postedAccountingView(r).status,'ready','late result cannot cross account');identity='auth-a';
 r=request();setResponses(r);c.financeWorkspaceIdentityBlocked=true;const count=calls.length;assert.equal(await c.ensurePostedAccountingView(r),null);assert.equal(calls.length,count);c.financeWorkspaceIdentityBlocked=false;
 r=request();r.pettyMode='initial';assert.equal(c.postedAccountingLinesMatchVoucher(r,[corrected],{entries:[]}),false,'initial petty uses its actual asset voucher, not expense suggestions');
 r=request();r.status='pending_voucher';assert.equal(c.postedAccountingView(r),null,'pending review keeps original editing source');
 r=request();setResponses(r);response.application_accounting_lines.data[0].description='<img src=x onerror=alert(1)>';await c.ensurePostedAccountingView(r);assert.ok(!c.accountingLinesHtml(r,false).includes('<img'));
 console.log('PASS posted accounting view: actual voucher builders, corrected historical lines, immutable source, scoped reads, mismatch/denial fallback, errors, two-stage petty entries, identity race and escaped rendering');
})().catch(error=>{console.error(error);process.exitCode=1;});
