'use strict';
// Real application rendering/search/copy controllers in Chromium and WebKit.
// All records and RPC responses are fictional; external network is blocked.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium,webkit}=require('playwright');
const {applyBuildEnvironment}=require('./finance_build_environment');
const root=path.resolve(__dirname,'..');
const output=path.resolve(process.env.FINANCE_SHORT_BATCH_EVIDENCE||'/tmp/finance-short-batch-numbers-20261015');
assert(output!==root&&!output.startsWith(root+path.sep),'Evidence must stay outside the source tree');
const source=fs.readFileSync(path.join(root,'index.html'),'utf8'),anchor='bootAuthGate();\n\n})();';
assert(source.includes(anchor),'Real application boot hook must exist');
const html=applyBuildEnvironment(source,{target:'local',supabaseUrl:'',supabaseAnonKey:''})
  .replace(anchor,'window.__shortBatchQA={run:async function(code){return await eval(code)}};\n'+anchor)
  .replace(/<script\b[^>]*src=["']https?:[^>]*><\/script>/gi,'');
const evidence={ok:false,source_sha256:crypto.createHash('sha256').update(source).digest('hex'),scope:'Actual local DOM and controllers; fictional scoped RPC transport and clipboard boundary. No real Google login, backend or production business writes.',cases:[]};
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+pathname);
  if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  res.setHeader('Content-Security-Policy',"connect-src 'none'; form-action 'none'; img-src 'self' data: blob:; font-src 'self' data:");
  if(file===root||file===path.join(root,'index.html')){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);}
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(file));
});
const setup=`(async function(){
 USERS=[{id:'short-ceo',n:'虛構主管',email:'short@example.invalid',authUserId:'short-auth',role:'ceo',rL:'執行長',eid:'F1',dc:'D1',active:true}];
 ENTS=[{id:'F1',s:'虛構公司',full:'虛構公司股份有限公司',active:true}];
 DEPTS=[{c:'D1',n:'虛構居服課',eid:'F1',entityCodes:['F1'],newFormEntityCodes:['F1'],lv:3,active:true,isPostingUnit:true}];
 REQS=[];INVS=[];BILLS=[];NOTIFS=[];VOUCHERS=[];ORG_CHART=[];quickLogin('ceo');
 await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 var token=currentTenantId().slice(0,8).replace(/-/g,'').toUpperCase();
 window.__shortBill='BILLB-202609-'+token+'-000003';window.__shortInvoice='INVB-202609-'+token+'-000008';
 var common={entity_id:'F1',department_code:'D1',applicant:'虛構職員',applicant_id:'short-ceo',applicant_email:'short@example.invalid',approval_status:'pending_ceo',approval_step:1,row_version:1,steps:[{rk:'ceo',r:'執行長',uid:'short-ceo',a:'',status:'pending_ceo'}],tenant_id:currentTenantId(),data_environment:activeDataEnvironment(),created_at:'2026-09-23T00:00:00Z'};
 BILLS=[2204,4206].map(function(amount,n){return mapBill(Object.assign({},common,{id:'short-bill-'+n,no:'BILL-202609-'+token+'-'+String(n+1).padStart(6,'0'),batch_id:window.__shortBill,batch_count:2,amount:amount,item:'虛構居家服務費',payer_name:'虛構繳費人'+n,due_date:'2026-09-23'}));});
 INVS=[100,200].map(function(total,n){return mapInv(Object.assign({},common,{id:'short-inv-'+n,no:'INV-202609-'+token+'-'+String(n+1).padStart(6,'0'),batch_id:window.__shortInvoice,total:total,buyer:'虛構買受人'+n,description:'虛構課程費',invoice_date:'2026-09-23'}));});
 REQS=[mapReq({id:'short-legacy',no:'LEGACYB-202609-unchanged',type:'payment_request',entity_id:'F1',department_code:'D1',applicant:'虛構職員',applicant_id:'short-ceo',amount:10,description:'舊式識別碼驗收',request_date:'2026-09-23',status:'pending_ceo',step:1,steps:[{rk:'ceo',r:'執行長',uid:'short-ceo',a:'',status:'pending_ceo'}],tenant_id:currentTenantId(),data_environment:activeDataEnvironment()})];
 window.__shortItems=[{kind:'bill',raw:BILLS[0],rows:BILLS},{kind:'inv',raw:INVS[0],rows:INVS},{kind:'req',raw:REQS[0]}];
 window.__shortSourceBefore=JSON.stringify({bills:BILLS,invoices:INVS,requests:REQS});
 window.__shortShow=function(tab,query){closeAppr();S.demoLogin=true;S.page='approvals';S.aT=tab;S.apprQuery=query||'';S.apprPage=1;S.apprSelected={};document.querySelectorAll('.pg').forEach(function(n){n.classList.toggle('on',n.id==='pg-approvals');});setApprovalTabVisual(tab);renderApprList(window.__shortItems);};
 window.__shortShow('p','');return {bill:window.__shortBill,invoice:window.__shortInvoice};
})()`;
const remoteSetup=`(function(){
 closeAppr();S.demoLogin=false;S.user.authUserId='short-auth';S.user.tenantId=currentTenantId();financeWorkspaceIdentityBlocked=false;
 window.__shortRemoteCalls=[];
 window.__shortEntry=function(){return{history_key:'bills:short-bill-0',record_type:'bills',kind:'bill',record_id:'short-bill-0',record_no:'整批 '+window.__shortBill,batch_id:window.__shortBill,batch_scope_key:'bill-batch:'+('a'.repeat(32)),source_count:2,source_ids:['short-bill-0','short-bill-1'],personally_applied:true,personally_acted:false,participation_label:'我申請的',last_participated_at:'2026-09-23T00:00:00Z',summary:{entity_id:'F1',entity_name:'虛構公司',department_code:'D1',department_name:'虛構居服課',applicant:'虛構職員',type_label:'申請繳費單',approval_status:'pending_ceo',amount:6410,description:'虛構居家服務費',request_date:'2026-09-23',source_count:2,has_attachments:false}};};
 getSb=function(){return{rpc:function(name,args){window.__shortRemoteCalls.push({name:name,args:JSON.parse(JSON.stringify(args))});if(name!=='finance_personal_document_summary_v1')return Promise.resolve({data:[],error:null});return Promise.resolve({data:{ok:true,mode:'summary',projection_complete:true,identity:{tenant_id:currentTenantId(),finance_user_id:S.user.id,auth_user_id:S.user.authUserId,data_environment:activeDataEnvironment()},total:1,all_total:1,page:{limit:50,offset:args.p_offset,has_more:false},items:[window.__shortEntry()]}});}};};
 S.page='approvals';S.aT='mine';S.apprQuery='';S.apprPage=1;setApprovalTabVisual('mine');return true;
})()`;
let browser;
async function main(){
 fs.mkdirSync(output,{recursive:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 for(const [engineName,engine] of [['chromium',chromium],['webkit',webkit]])for(const width of [1440,390]){
  browser=await engine.launch({headless:true});const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];
  const record={engine:engineName,width,checks:[],screenshots:[]};evidence.cases.push(record);
  const check=(label,value)=>{assert(value,engineName+' '+width+' '+label);record.checks.push(label);console.log('PASS '+engineName+' '+width+' '+label);};
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>new URL(route.request().url()).origin===url?route.continue():route.abort());
  await page.addInitScript(()=>{window.__shortClipboard=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__shortClipboard.push(value);}}});});
  await page.goto(url,{waitUntil:'load'});const run=code=>page.evaluate(code=>window.__shortBatchQA.run(code),code),ids=await run(setup);
  check('pending list has three rows and the two compact canonical batch labels',await run('el("appr-list").querySelectorAll("tbody tr").length===3&&el("appr-list").innerText.includes("B2609-003")&&el("appr-list").innerText.includes("I2609-008")'));
  check('pending list retains complete grouped amounts and legacy label',await run('el("appr-list").innerText.includes("6,410")&&el("appr-list").innerText.includes("300")&&el("appr-list").innerText.includes("LEGACYB-202609-unchanged")'));
  const copy=page.locator('#appr-list [data-finance-batch-number]').filter({hasText:'B2609-003'}).first();
  check('short number is an accessible button with its complete identity',await copy.evaluate(n=>n.tagName==='BUTTON'&&n.getAttribute('data-finance-batch-number')===n.getAttribute('data-invoice-number')&&!!n.getAttribute('aria-label')));
  await copy.focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>window.__shortClipboard.length===1);
  check('keyboard copy writes the full batch ID without opening or selecting a document',await page.evaluate(id=>window.__shortClipboard[0]===id&&!document.getElementById('m-appr').classList.contains('on')&&document.querySelectorAll('#appr-list .appr-pick:checked').length===0,ids.bill));
  check('copy announces success while retaining the short label',await copy.evaluate(n=>n.textContent.includes('B2609-003')&&n.parentElement.textContent.includes('已複製')));
  await page.evaluate(()=>{window.__shortOriginalClipboard=navigator.clipboard;window.__shortOriginalExecCommand=document.execCommand;window.__shortFallback=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('Fictional clipboard permission denial');}}});document.execCommand=command=>{if(command==='copy'){window.__shortFallback.push(document.activeElement.value);return true;}return false;};});
  await copy.click();
  check('clipboard denial falls back to selecting the complete canonical ID',await page.evaluate(id=>window.__shortFallback.length===1&&window.__shortFallback[0]===id,ids.bill));
  await page.evaluate(()=>{document.execCommand=()=>false;});await copy.click();
  check('total clipboard failure offers the full number as selectable text',await copy.evaluate((n,id)=>n.parentElement.textContent.includes('複製失敗')&&n.parentElement.textContent.includes(id)&&n.textContent.includes('B2609-003'),ids.bill));
  await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:window.__shortOriginalClipboard});document.execCommand=window.__shortOriginalExecCommand;});
  for(const [query,label] of [['B2609-003','B2609-003'],[ids.bill,'B2609-003'],['I2609-008','I2609-008'],[ids.invoice,'I2609-008'],['LEGACYB-202609-unchanged','LEGACYB-202609-unchanged']]){
   await run('window.__shortShow("p",'+JSON.stringify(query)+');true');
   check('local full/short search '+query+' finds exactly its original group',await run('el("appr-list").querySelectorAll("tbody tr").length===1&&el("appr-list").innerText.includes('+JSON.stringify(label)+')'));
  }
  await run('window.__shortShow("p","B2609-999");true');check('unmatched short search does not return another group',await page.locator('#appr-list tbody tr').count()===0);
  await run('window.__shortShow("cashier","");true');check('cashier rendering uses the same two compact batch labels',await run('el("appr-list").innerText.includes("B2609-003")&&el("appr-list").innerText.includes("I2609-008")'));
  await run('window.__shortShow("p","");true');
  for(const [kind,expression,canonical,label] of [['bill','showBillApprD(BILLS[0])',ids.bill,'B2609-003'],['invoice','showInvApprD(INVS[0],window.__shortItems[1])',ids.invoice,'I2609-008']]){
   await run(expression+';true');await page.locator('#m-appr').waitFor({state:'visible'});
   check(kind+' detail shows compact title plus readable complete ID',await page.locator('#appr-inner').evaluate((n,{canonical,label})=>n.innerText.includes(label)&&n.innerText.includes(canonical),{canonical,label}));
   check(kind+' detail keeps both original child records',await run(kind==='bill'?'billGroupRows(BILLS[0]).length===2':'invoiceGroupRows(INVS[0]).length===2'));
   await run('closeAppr();true');
  }
  check('format edge cases preserve legacy IDs, TEST boundary, and sequence over 999',await run(`financeBatchNumberLabel('BILLB-202609-00000000-001234')==='B2609-1234'&&financeBatchNumberLabel('TEST-INVB-202609-00000000-000008')==='TEST-I2609-008'&&financeBatchNumberLabel('batch_1720000000000')==='batch_1720000000000'&&financeBatchNumberLabel('BILL-202609-00000000-000003')==='BILL-202609-00000000-000003'&&financeBatchNumberLabel('BILLB-202613-00000000-000003')==='BILLB-202613-00000000-000003'`));
  check('display and copy leave canonical group functions and all business records unchanged',await run('billGroupNo(BILLS[0])===window.__shortBill&&invoiceGroupNo(INVS[0])===window.__shortInvoice&&JSON.stringify({bills:BILLS,invoices:INVS,requests:REQS})===window.__shortSourceBefore'));
  for(const [kind,query] of [['invoice','I2609-008'],['invoice',ids.invoice],['bill','B2609-003'],['bill',ids.bill]]){
   await run('incomeManagementSearchState()['+JSON.stringify(kind)+']='+JSON.stringify(query)+';'+(kind==='invoice'?'renderInvoiceManagementList()':'S.bF="all";renderBillList()')+';true');
   check(kind+' management search '+query+' retains both children',await run(kind==='invoice'?'el("invoice-manage-list").innerText.includes("虛構買受人0")&&el("invoice-manage-list").innerText.includes("虛構買受人1")&&el("invoice-manage-list").innerText.includes("I2609-008")':'el("bill-list").querySelectorAll(".bill-card").length===2&&el("bill-list").innerText.includes("虛構繳費人0")&&el("bill-list").innerText.includes("虛構繳費人1")'));
  }
  await run(remoteSetup);
  for(const [query,expected] of [['B2609-003',ids.bill],['I2609-008',ids.invoice],[ids.bill,ids.bill],['TEST-B2609-003','TEST-'+ids.bill],['B2609-1234',ids.bill.replace('000003','001234')],['虛構 6,410','虛構 6,410']]){
   await run('(async function(){S.apprQuery='+JSON.stringify(query)+';await loadApprovalHistoryPage({force:true,query:S.apprQuery});return true;})()');
   const state=await run('({call:window.__shortRemoteCalls.filter(x=>x.name==="finance_personal_document_summary_v1").slice(-1)[0],query:APPROVAL_HISTORY_RUNTIME.query,input:el("appr-q").value,status:APPROVAL_HISTORY_RUNTIME.status,env:activeDataEnvironment()})');
   check('server-paged search translates '+query+' without changing input/identity/environment',state.status==='ready'&&state.call.args.p_search===expected&&state.query===query&&state.input===query&&state.call.args.p_data_environment===state.env&&state.call.args.p_scope==='mine'&&state.call.args.p_offset===0);
  }
  await run('(async function(){S.apprQuery="B2609-003";await loadApprovalHistoryPage({force:true,query:S.apprQuery});return true;})()');
  check('personal history shows one compact batch with two children and its total',await run('el("appr-list").querySelectorAll("[data-history-key]").length===1&&el("appr-list").innerText.includes("B2609-003")&&el("appr-list").innerText.includes("整批 2 張")&&el("appr-list").innerText.includes("6,410")'));
  for(const mode of ['history','pending']){
   if(mode==='pending')await run('window.__shortShow("p","");true');
   check(mode+' at '+width+' has no page-wide horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   check(mode+' short labels fit their controls without clipping',await page.locator('#appr-list [data-finance-batch-number]').evaluateAll(nodes=>nodes.length>0&&nodes.every(n=>n.scrollWidth<=n.clientWidth+1)));
   await page.locator('#appr-list').scrollIntoViewIfNeeded();const screenshot=engineName+'-'+width+'-'+mode+'.png';await page.screenshot({path:path.join(output,screenshot),fullPage:false});record.screenshots.push(screenshot);
  }
  check('no uncaught browser errors',errors.length===0);await browser.close();browser=null;
 }
 evidence.ok=true;fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));console.log('SHORT_BATCH_BROWSER_PASS '+output);
}
main().catch(error=>{fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:error.stack,evidence},null,2));console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
