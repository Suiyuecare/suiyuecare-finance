'use strict';
// Actual application handlers and DOM with fictional local data only.
// Composition events exercise the DOM, not an OS IME or real Google login.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),{applyBuildEnvironment}=require('./finance_build_environment');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.env.FINANCE_UI_EVIDENCE||'/tmp/finance-ui-interaction-20260922');
assert(out!==root&&!out.startsWith(root+path.sep));
const source=fs.readFileSync(path.join(root,'index.html'),'utf8'),anchor='bootAuthGate();\n\n})();';assert(source.includes(anchor));
const html=applyBuildEnvironment(source,{target:'local',supabaseUrl:'',supabaseAnonKey:''}).replace(anchor,'window.__uiQA={run:async function(code){return await eval(code)}};\n'+anchor).replace(/<script\b[^>]*src=["']https?:[^>]*><\/script>/gi,'');
const server=http.createServer((req,res)=>{
 const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
 if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
 if(file===root||file===path.join(root,'index.html')){res.setHeader('content-type','text/html');return res.end(html);}
 if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
 res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(file));
});
const evidence={scope:'Local shipped UI, fictional CEO and employee; no production login or business writes. DOM composition events, not OS IME.',checks:[],screens:[]};
function check(name,value){assert.ok(value,name);evidence.checks.push(name);console.log('PASS '+name);}
let browser;
(async()=>{
 fs.mkdirSync(out,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:1000}});
  await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  const page=await context.newPage(),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
  await page.goto(origin);await page.waitForFunction(()=>window.__uiQA);
  const run=c=>page.evaluate(c=>window.__uiQA.run(c),c);
  const fillPurpose=async value=>{const input=page.locator('#nr-desc-purpose'),section=input.locator('xpath=ancestor::details[1]');if(await section.count()&&!await section.evaluate(n=>n.open))await section.locator('summary').first().click();await input.fill(value);};
  await run(`(function(){
   USERS=[{id:'fixture-ceo',n:'匿名主管',email:'ceo@example.invalid',role:'ceo',rL:'執行長',eid:'F1',dc:'DAYCARE',active:true},{id:'fixture-employee',n:'匿名員工',email:'employee@example.invalid',role:'employee',rL:'組員',eid:'F1',dc:'DAYCARE',active:true}];
   ENTS=Array.from({length:10},function(_,i){return{id:'F'+(i+1),s:'虛構公司'+(i+1),full:'虛構公司'+(i+1),active:true}});
   DEPTS=[{c:'DAYCARE',n:'測試日照課',eid:'F1',entityCodes:['F1'],newFormEntityCodes:['F1'],lv:4,active:true,isPostingUnit:true}];
   MEMBERSHIP_ORG_RUNTIME={available:false,graph:null};REQS=[];INVS=[];BILLS=[];VOUCHERS=[];NOTIFS=[];ORG_CHART=[];LEDGER=[];quickLogin('ceo');
   window.__rpcCalls=[];window.__writes=[];getSb=function(){throw Error('No remote client in local fixture')};nav('vouchers');
  })()`);
  if(width<600)await page.locator('#pg-vouchers [data-mobile-page-toggle="filter"]').click();
  const combo=page.locator('[data-for-select="v-ent"] .combo-input');await combo.click();const active=[];
  for(let n=0;n<4;n++){await combo.press('ArrowDown');active.push(await page.locator('[data-for-select="v-ent"] .combo-option.active').innerText());}
  check(width+' down keys reach successive companies',JSON.stringify(active)===JSON.stringify(['虛構公司1','虛構公司2','虛構公司3','虛構公司4']));
  await combo.press('ArrowUp');check(width+' up preserves active index',await page.locator('[data-for-select="v-ent"] .combo-option.active').innerText()==='虛構公司3');
  check(width+' combobox exposes active option',await combo.evaluate(n=>n.getAttribute('role')==='combobox'&&n.getAttribute('aria-expanded')==='true'&&document.getElementById(n.getAttribute('aria-activedescendant')).textContent==='虛構公司3'));
  await combo.press('Enter');check(width+' Enter commits highlighted company',await run("el('v-ent').value")==='F3');
  await combo.fill('虛構公司7');await combo.press('Escape');check(width+' Escape restores saved selection',await combo.inputValue()==='虛構公司3'&&await combo.getAttribute('aria-expanded')==='false');
  await combo.dispatchEvent('compositionstart');await combo.fill('虛構公司7');
  await combo.dispatchEvent('keydown',{key:'Enter',code:'Enter',keyCode:229,isComposing:true,bubbles:true,cancelable:true});
  check(width+' composing Enter does not select',await run("el('v-ent').value")==='F3');
  await combo.dispatchEvent('compositionend',{data:'虛構公司7'});await combo.press('Enter');
  check(width+' completed composition remains selectable',await run("el('v-ent').value")==='F7');
  await combo.fill('不存在');await combo.press('ArrowDown');await combo.press('Escape');
  check(width+' empty options retain saved value',await run("el('v-ent').value")==='F7');
  await run(`(function(){
   REQS=[1200,600].map(function(amount,i){return mapReq({id:'fixture-expense-'+i,no:'UI-'+i,applicant:'匿名主管',applicant_id:'fixture-ceo',entity_id:'F1',department_code:'DAYCARE',type:'payment_request',status:'pending_ceo',amount:amount,description:'日照物資 '+i,request_date:'2026-09-20',data_environment:'test',steps:[{rk:'ceo',uid:'fixture-ceo',a:'pending',status:'pending_ceo',r:'執行長'}]})});
   window.__originalRequests=JSON.stringify(REQS);nav('approvals');S.aT='mine';setApprovalTabVisual('mine');buildApprovals();
  })()`);
  if(width>=600){
  const sort=page.locator('[data-approval-sort="amount"]');await sort.focus();await sort.press('Enter');
  check(width+' keyboard sorts highest amount first',(await page.locator('#appr-list tbody tr').first().innerText()).includes('UI-0'));
  check(width+' sorting restores focus',await sort.evaluate(n=>document.activeElement===n));
  await sort.press('Space');check(width+' Space reverses ordering',(await page.locator('#appr-list tbody tr').first().innerText()).includes('UI-1')&&await page.locator('#appr-list tbody tr').count()===2);
  }else{await page.waitForFunction(()=>document.querySelector('#appr-list table')?.classList.contains('mobile-native-card-table'));check(width+' mobile card list retains both documents',await page.locator('#appr-list tbody tr').count()===2);}
  check(width+' sort preserves documents',await run('JSON.stringify(REQS)===window.__originalRequests'));
  await run(`(function(){
   window.__arItems=[{invoiceId:'ar1',invoiceNo:'AR001',entityId:'F1',departmentCode:'DAYCARE',buyer:'甲客戶',originalAmount:100,recognizedAmount:100,receivedAmount:0,outstandingAmount:100,allowanceAmount:0,status:'unpaid',balanceStatus:'unpaid',invoiceDate:'2026-09-01',rowVersion:1,metadataVersion:0},{invoiceId:'ar2',invoiceNo:'AR002',entityId:'F1',departmentCode:'DAYCARE',buyer:'乙客戶',originalAmount:200,recognizedAmount:200,receivedAmount:0,outstandingAmount:200,allowanceAmount:0,status:'unpaid',balanceStatus:'unpaid',invoiceDate:'2026-09-01',rowVersion:1,metadataVersion:0}];
   hasSupabase=function(){return true};getSb=function(){return{rpc:async function(name,args){window.__rpcCalls.push(name);if(name==='finance_receivables_v1')return{data:{version:1,asOf:args.p_as_of,complete:true,totalCount:2,items:window.__arItems,summary:{outstandingAmount:300,receivedAmount:0,allowanceAmount:0,overdueAmount:0},buckets:[],reconciliation:{bankVisible:false}}};return{data:null,error:{message:'Blocked fixture RPC '+name}}}}};S.recvEntity='F1';nav('recv');
  })()`);
  await page.waitForFunction(()=>document.querySelector('#finance-receivable-workspace')?.textContent.includes('AR002'));
  const query=page.locator('[name="rw-ar-query"]');await query.focus();const queryNode=await query.elementHandle(),reads=await run('window.__rpcCalls.length');await query.fill('甲客戶');
  await page.waitForFunction(()=>document.querySelector('#finance-receivable-workspace .rw-pager')?.textContent.includes('／ 1 張'));
  check(width+' AR input filters without blur',await query.evaluate(n=>document.activeElement===n)&&!(await page.locator('#finance-receivable-workspace').innerText()).includes('AR002'));
  check(width+' AR input keeps original DOM node',await queryNode.evaluate(n=>n.isConnected&&document.activeElement===n));
  await query.fill('');await page.waitForFunction(()=>document.querySelector('#finance-receivable-workspace .rw-pager')?.textContent.includes('／ 2 張'));
  check(width+' clearing restores all rows without blur',await query.evaluate(n=>document.activeElement===n));
  await query.fill('NT$ 200');await page.waitForFunction(()=>document.querySelector('#finance-receivable-workspace .rw-pager')?.textContent.includes('／ 1 張'));
  check(width+' formatted amount input stays exact',!(await page.locator('#finance-receivable-workspace').innerText()).includes('AR001'));
  await query.fill('');await page.waitForFunction(()=>document.querySelector('#finance-receivable-workspace .rw-pager')?.textContent.includes('／ 2 張'));
  await query.dispatchEvent('compositionstart');await query.fill('乙');await query.dispatchEvent('input',{data:'乙',isComposing:true,bubbles:true});await page.waitForTimeout(180);
  check(width+' incomplete AR composition waits',await run('FinanceReportingWorkspace.state.arQuery')===''&&(await page.locator('#finance-receivable-workspace .rw-pager').innerText()).includes('／ 2 張'));
  await run('FinanceReportingWorkspace.renderReceivables()');
  check(width+' background AR repaint preserves composing node',await queryNode.evaluate(n=>n.isConnected&&document.activeElement===n&&n.value==='乙'));
  await query.fill('乙客戶');await query.dispatchEvent('compositionend',{data:'乙客戶'});await page.waitForFunction(()=>document.querySelector('#finance-receivable-workspace .rw-pager')?.textContent.includes('／ 1 張'));
  check(width+' composition commit filters without extra RPCs',!(await page.locator('#finance-receivable-workspace').innerText()).includes('AR001')&&await run('window.__rpcCalls.length')===reads);
  const screen=path.join(out,'ar-search-'+width+'.png');await page.screenshot({path:screen});evidence.screens.push(screen);
  await run(`hasSupabase=function(){return false};quickLogin('employee');nav('newreq');nrT('expense_reimbursement');`);
  await fillPurpose('尚未儲存的用途');await run(`(function(){window.__leaveAttempt=nav('expenses');return true;})()`);
  const leave=page.locator('#m-leave-guard');await leave.waitFor({state:'visible'});
  check(width+' named native leave modal focuses safe action',await leave.evaluate(n=>n.tagName==='DIALOG'&&n.open&&!!document.getElementById(n.getAttribute('aria-labelledby'))&&n.contains(document.activeElement)&&document.activeElement.textContent==='留在本頁'));
  for(let n=0;n<7;n++){await page.keyboard.press('Tab');check(width+' Tab stays inside leave modal '+n,await leave.evaluate(n=>n.contains(document.activeElement)));}
  await page.keyboard.press('Escape');await run('window.__leaveAttempt');
  check(width+' Escape preserves form contents',await run('S.page')==='newreq'&&await page.locator('#nr-desc-purpose').inputValue()==='尚未儲存的用途'&&!await leave.isVisible());
  await run(`markNRClean();nav('invoices');`);await page.locator('#b-reason').fill('未存發票用途');
  await run(`(function(){window.__incomeLeaveAttempt=nav('approvals');return true;})()`);const income=page.locator('#m-income-leave-guard');await income.waitFor({state:'visible'});
  check(width+' income leave modal also focuses inside',await income.evaluate(n=>n.open&&n.contains(document.activeElement)));
  await page.keyboard.press('Escape');await run('window.__incomeLeaveAttempt');
  check(width+' income Escape preserves contents',await run('S.page')==='invoices'&&await page.locator('#b-reason').inputValue()==='未存發票用途');
  await run(`markIncomeDocClean('invoices');quickLogin('ceo');nav('newreq');nrT('expense_reimbursement');`);
  await fillPurpose('慢速暫存');
  await run(`(function(){window.__originalSave=window.nrSaveDraft;window.nrSaveDraft=function(){S.nrSavingDraft=true;return new Promise(function(resolve){window.__finishSave=function(ok){S.nrSavingDraft=false;if(ok)markNRClean();resolve(ok)}})};window.__oldNav=nav('expenses');})()`);
  await leave.waitFor({state:'visible'});await leave.getByRole('button',{name:'是，暫存後離開',exact:true}).click();await run(`nav('reports')`);
  check(width+' new page opens during pending draft transport',await run('S.page')==='reports');
  await run(`(async function(){window.__finishSave(true);await window.__oldNav;})()`);
  check(width+' old draft completion cannot override newer page',await run('S.page')==='reports');
  await run(`nav('newreq');nrT('expense_reimbursement');`);await fillPurpose('身份切換前未存');
  await run(`(function(){window.__oldIdentityNav=nav('expenses');return true;})()`);await leave.waitFor({state:'visible'});await leave.getByRole('button',{name:'是，暫存後離開',exact:true}).click();
  await run(`(async function(){S.user=Object.assign({},S.user,{id:'replacement-user'});var pageBefore=S.page;window.__finishSave(true);await window.__oldIdentityNav;window.__identityPage={before:pageBefore,after:S.page};})()`);
  check(width+' prior identity save cannot navigate',await run('window.__identityPage.before===window.__identityPage.after'));
  await run(`window.nrSaveDraft=window.__originalSave;`);
  check(width+' no page exceptions',errors.length===0);check(width+' no document overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  check(width+' no business writes',await run('window.__writes.length')===0);await context.close();
 }
 fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2));console.log('PASS Finance UI interactions: '+evidence.checks.length+' checks; '+out);
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();server.close();});
