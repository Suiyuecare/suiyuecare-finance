'use strict';
// Real local UI + fictional permitted records; remote requests are blocked.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const {applyBuildEnvironment}=require('./finance_build_environment');
const root=path.resolve(__dirname,'..');let browser,page;const errors=[];
const output=process.env.APPROVAL_SELECTION_EVIDENCE||'/tmp/finance-approval-search-selection-20260927';
const anchor='bootAuthGate();\n\n})();';
let html=applyBuildEnvironment(fs.readFileSync(path.join(root,'index.html'),'utf8'),{target:'local',supabaseUrl:'',supabaseAnonKey:''});
assert(html.includes(anchor));
html=html.replace(anchor,'window.__selectionTest={run:async function(code){return await eval(code);}};\n'+anchor)
  .replace(/<script\b[^>]*src=["']https?:[^>]*><\/script>/gi,'')
  .replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="connect-src \'self\'; form-action \'none\'">');
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  if(file===root||file===path.join(root,'index.html')){res.setHeader('content-type','text/html');return res.end(html);}
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
  res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(file));
});
// Use the project's locked Playwright runtime so the same real-DOM test runs
// locally and in CI without a global browser CLI installation.
async function b(command,...args){
 if(command==='open'){await page.goto(args[0]);return;}
 if(command==='snapshot')return;
 if(command==='set'){await page.setViewportSize({width:Number(args[1]),height:Number(args[2])});return;}
 if(command==='check'){await page.locator(args[0]).check();return;}
 if(command==='click'){await page.locator(args[0]).first().click();return;}
 if(command==='fill'){await page.locator(args[0]).fill(args[1]);return;}
 if(command==='screenshot'){await page.screenshot({path:args[0],fullPage:true});return;}
 if(command==='errors')return errors.join('\n');
}
async function scope(code){return page.evaluate(code=>window.__selectionTest.run(code),code);}
async function waitForSearchResults(){
  await page.waitForFunction(()=>{
    const hint=document.getElementById('appr-list-hint');
    return hint&&hint.textContent.startsWith('搜尋後');
  });
}
// Keep the real rendering and permission functions for these geometry cases.
// The data is fictional and the app's explicit local demo environment is used;
// no production identity, RPC, or approval action is supplied or bypassed.
const layoutSetup=`(async function(){
 USERS=[{id:'layout-ceo',n:'虛構主管',email:'layout@example.invalid',role:'ceo',rL:'執行長',eid:'F1',dc:'D1',active:true}];
 ENTS=[{id:'F1',s:'虛構公司',full:'虛構公司股份有限公司',active:true}];
 DEPTS=[{c:'D1',n:'虛構居服課',eid:'F1',lv:3,active:true}];
 REQS=[];INVS=[];BILLS=[];NOTIFS=[];VOUCHERS=[];ORG_CHART=[];quickLogin('ceo');
 await new Promise(resolve=>requestAnimationFrame(resolve));
 var common={entity_id:'F1',department_code:'D1',applicant:'虛構職員',applicant_id:'layout-staff',approval_status:'pending_ceo',approval_step:1,row_version:1,steps:[{rk:'ceo',r:'執行長',uid:'layout-ceo',a:''}],tenant_id:currentTenantId(),data_environment:activeDataEnvironment(),created_at:'2026-09-23T00:00:00Z'};
 BILLS=Array.from({length:12},function(_,i){return mapBill(Object.assign({},common,{id:'layout-bill-'+i,no:'BILL-202609-00000000-'+String(i).padStart(6,'0'),batch_id:'BILLB-202609-00000000-000003',amount:i===0?4494:3360,item:'日間照顧服務費',payer_name:'虛構繳費人'+i,due_date:'2026-09-23'}));});
 INVS=Array.from({length:12},function(_,i){return mapInv(Object.assign({},common,{id:'layout-inv-'+i,no:'INV-202609-00000000-'+String(i).padStart(6,'0'),batch_id:'INVB-202609-00000000-000008',total:i===0?4494:3360,buyer:'虛構買受人'+i,description:'日間照顧服務費',invoice_date:'2026-09-01'}));});
 REQS=[mapReq({id:'layout-cashier',no:'20261014001',type:'petty_cash_request',entity_id:'F1',department_code:'D1',applicant:'虛構職員',applicant_id:'layout-staff',amount:4548,description:'虛構課程用品及行政採購費用，供欄位可讀性驗收',request_date:'2026-10-01',expected_pay_date:'2026-10-10',status:'pending_cashier',step:1,ver:1,steps:[{rk:'cashier',r:'出納',uid:'layout-ceo',a:''}],tenant_id:currentTenantId(),data_environment:activeDataEnvironment()})];
 REQS.push(mapReq({id:'layout-long-identifier',no:'LEGACYB-202610-'+('abcdef0123456789'.repeat(8)),type:'payment_request',entity_id:'F1',department_code:'D1',applicant:'虛構職員',applicant_id:'layout-staff',amount:19000,description:'長識別碼單據不應改變其他列的欄位寬度',request_date:'2026-10-01',status:'pending_ceo',step:1,ver:1,steps:[{rk:'ceo',r:'執行長',uid:'layout-ceo',a:''}],tenant_id:currentTenantId(),data_environment:activeDataEnvironment()}));
 S.page='approvals';document.querySelectorAll('.pg').forEach(function(n){n.classList.toggle('on',n.id==='pg-approvals');});
 window.__layoutSourceBefore=JSON.stringify({bills:BILLS,invoices:INVS,requests:REQS});
 window.__renderLayoutTab=function(tab){
  S.aT=tab;S.apprQuery='';S.apprPage=1;S.apprSelected={};setApprovalTabVisual(tab);
  if(tab==='h'){
   renderApprovalHistorySummaries({status:'ready',updatedAt:'2026-10-14T00:00:00Z',total:1,allTotal:1,page:1,query:'',identity:'layout-history',items:[{kind:'req',raw:REQS[0],recordNo:REQS[0].no,historyKey:'req:layout-cashier',historyTrusted:true,historyPersonallyActed:true,historyParticipationLabel:'本人已處理',historyLastParticipatedAt:'2026-10-13T00:00:00Z',summary:{amount:4548,type_label:'零用金申請',department_name:'虛構居服課',department_code:'D1',applicant:'虛構職員',description:'虛構課程用品及行政採購費用，供欄位可讀性驗收',entity_name:'虛構公司',request_date:'2026-10-01',source_count:1,has_attachments:false}}]});
  }else renderApprList(tab==='cashier'?[{kind:'req',raw:REQS[0]}]:[{kind:'bill',raw:BILLS[0],rows:BILLS},{kind:'inv',raw:INVS[0],rows:INVS},{kind:'req',raw:REQS[1]}]);
 };
 window.__renderLayoutTab('p');return true;
})()`;
async function approvalLayoutEvidence(){
 return page.evaluate(()=>{
  const table=document.querySelector('#appr-list table'),scroll=table.parentElement;
  const rect=n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height});
  return {width:innerWidth,pageOverflow:document.documentElement.scrollWidth>innerWidth+1,table:{...rect(table),layout:getComputedStyle(table).tableLayout},scroll:{clientWidth:scroll.clientWidth,scrollWidth:scroll.scrollWidth,overflow:getComputedStyle(scroll).overflowX},rows:[...table.querySelectorAll('tbody tr')].map(row=>{
   const form=row.querySelector('.appr-col-formNo'),purpose=row.querySelector('.appr-col-purpose'),amount=row.querySelector('.appr-col-amount');
   const range=document.createRange();range.selectNodeContents(amount);
   const boxes=[...range.getClientRects()].filter(r=>r.width>0&&r.height>0),lines=new Set(boxes.map(r=>Math.round(r.top)));
   const amountRect=amount.getBoundingClientRect(),textInside=boxes.every(r=>r.left>=amountRect.left-1&&r.right<=amountRect.right+1);
   return {height:rect(row).height,mobileCard:row.hasAttribute('data-mobile-record-card'),display:getComputedStyle(row).display,formWidth:rect(form).width,formText:form.innerText,purposeWidth:rect(purpose).width,amount:amount.innerText,amountWidth:rect(amount).width,amountLines:lines.size,amountTextInside:textInside};
  })};
 });
}
async function checkApprovalLayouts(){
 const evidence=[];
 for(const [engineName,engine] of [['chromium',chromium],['webkit',webkit]]){
  browser=await engine.launch({headless:true});page=await browser.newPage({viewport:{width:1920,height:1000}});page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await scope(layoutSetup);
  for(const width of [1920,1440,1024,390]){
   await page.setViewportSize({width,height:1000});
   for(const tab of ['p','cashier','h']){
    await scope('window.__renderLayoutTab('+JSON.stringify(tab)+');true');
    await page.waitForTimeout(80);
    const state=await approvalLayoutEvidence(),label=engineName+' '+width+' '+tab;evidence.push({engine:engineName,tab,...state});
    // Write observations before assertions so an unfixed baseline is inspectable.
    fs.writeFileSync(path.join(output,'layout-evidence.json'),JSON.stringify(evidence,null,2));
    await page.locator('#appr-list').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,'layout-'+engineName+'-'+width+'-'+tab+'.png'),fullPage:false});
    assert.equal(state.pageOverflow,false,label+' keeps overflow inside its table');
    assert.equal(state.rows.length,tab==='p'?3:1,label+' preserves grouped row count');
    if(width>=761){
     assert.equal(state.table.layout,'fixed',label+' uses stable column geometry');
     for(const row of state.rows){
      assert(row.formWidth<=state.table.width*.35,label+' form number cannot dominate the table');
      assert(row.purposeWidth>=240,label+' purpose remains readable');
      assert.equal(row.amountLines,1,label+' amount stays on one line');
      assert(row.amountTextInside,label+' amount is not clipped');
     }
     if(state.scroll.scrollWidth>state.scroll.clientWidth+1){
      assert(['auto','scroll'].includes(state.scroll.overflow),label+' narrow desktop exposes a table scrollbar');
      const moved=await page.evaluate(()=>{const s=document.querySelector('#appr-list table').parentElement;s.scrollLeft=s.scrollWidth;const n=s.scrollLeft;s.scrollLeft=0;return n;});
      assert(moved>0,label+' rightmost columns can be reached');
     }
    }else if(tab!=='h'){
     assert(state.rows.every(row=>row.mobileCard&&row.display!=='table-row'),label+' uses existing phone cards');
    }
    if(tab==='p'){
     const batches=state.rows.filter(row=>row.formText.includes('整批 12 張'));
     assert.equal(batches.length,2,label+' shows both complete batches');
     assert(batches.every(row=>row.amount==='NT$41,454'),label+' retains each full batch total');
     await page.locator('#appr-list .appr-pick').first().check();
     assert.equal(await scope('selectedApprovalItems().length'),1,label+' selection still works with real local guards');
     await page.locator('#appr-list .appr-pick').first().uncheck();
     assert.equal(await scope('selectedApprovalItems().length'),0,label+' selection clears');
    }
   }
  }
  assert.equal(await scope('JSON.stringify({bills:BILLS,invoices:INVS,requests:REQS})===window.__layoutSourceBefore'),true,engineName+' rendering does not mutate business data');
  await browser.close();browser=null;
 }
 return evidence;
}
(async()=>{
  fs.mkdirSync(output,{recursive:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const chrome=process.env.CHROME_PATH||(fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':null);
  browser=await chromium.launch({headless:true,...(process.env.FINANCE_BROWSER_CHANNEL==='chromium'?{}:chrome?{executablePath:chrome}:{})});page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
  await b('open','http://127.0.0.1:'+server.address().port);await b('snapshot','-i');
  await scope([
    "USERS=[{id:'fixture-ceo',n:'匿名測試主管',email:'ceo@example.invalid',role:'ceo',rL:'執行長',eid:'E1',dc:'D1',active:true}];",
    "ENTS=[{id:'E1',s:'測試公司',full:'測試公司',active:true}];DEPTS=[{c:'D1',n:'測試部門',eid:'E1',lv:3,active:true}];",
    "REQS=[];INVS=[];BILLS=[];NOTIFS=[];VOUCHERS=[];ORG_CHART=[];quickLogin('ceo');",
    "REQS=Array.from({length:51},function(_,index){return mapReq({id:'fixture-'+(index+1),no:'REQ-'+String(index+1).padStart(3,'0'),entity_id:'E1',department_code:'D1',type:'payment_request',amount:100+index,applicant_id:'fixture-ceo',applicant:'匿名測試主管',description:index===0?'A&B <原件> \"報支\"':'測試支出 '+(index+1),request_date:'2026-09-27',status:'pending_ceo',step:1,steps:[{r:'執行長',rk:'ceo',uid:'fixture-ceo',a:'',status:'pending_ceo'}],data_environment:activeDataEnvironment(),tenant_id:currentTenantId()});});",
    "INVS=[{id:'batch-one',no:'INV-001',buyer:'客戶甲',desc:'代表單摘要',total:700},{id:'batch-two',no:'INV-002',buyer:'客戶乙',desc:'後續單獨有描述 A&B',total:550},{id:'batch-hidden',no:'INV-HIDDEN',buyer:'不屬於此清單客戶',desc:'禁止搜尋的兄弟單',total:99999}].map(function(row){return Object.assign(row,{eid:'E1',dc:'D1',batchId:'fixture-batch',applicant:'匿名測試主管',applicantId:'fixture-ceo',date:'2026/09/27',approvalStatus:'pending_ceo',approvalStep:1,steps:[{r:'執行長',rk:'ceo',uid:'fixture-ceo',a:''}],rowVersion:1,dataEnv:activeDataEnvironment(),tenantId:currentTenantId()});});",
    "window.__fixtureItems=REQS.map(function(raw){return{kind:'req',raw:raw};});",
    "approvalAllItems=function(){return window.__fixtureItems;};approvalPendingCandidateItems=function(items){return items;};approvalActionableItems=function(items){return items;};approvalItemActionRows=function(item){return item.rows||[item.raw];};",
    "S.apprSortByTab={p:{field:'formNo',dir:'asc'},cashier:{field:'formNo',dir:'asc'}};",
    "nav('approvals');S.aT='p';S.apprQuery='';S.apprPage=1;buildApprovals();true"
  ].join('\n'));
  const evidence=[];
  for(const width of [1440,390]){
    await b('set','viewport',String(width),'1000');
    await scope("S.aT='p';S.apprQuery='';S.apprPage=1;resetApprovalPageSelection();window.__fixtureItems=REQS.map(function(raw){return {kind:'req',raw:raw};});buildApprovals();true");
    await b('snapshot','-i');
    await b('check','[data-appr-key="req:fixture-1"] .appr-pick');
    assert.equal(await scope("el('appr-bulk-count').textContent"),'已選 1 筆');
    await b('click','#appr-list button[onclick="apprPage(2)"]');await b('snapshot','-i');
    assert.equal(await scope("el('appr-bulk-count').textContent"),'已選 0 筆');
    await b('check','[data-appr-key="req:fixture-51"] .appr-pick');
    assert.deepEqual(await scope("selectedApprovalItems().map(function(item){return item.raw.id;})"),['fixture-51']);
    assert.equal(await scope("el('appr-bulk-count').textContent"),'已選 1 筆');
    await b('fill','#appr-q','A&B');await b('snapshot','-i');
    assert.equal(await scope("el('appr-bulk-count').textContent"),'已選 0 筆');
    await waitForSearchResults();
    assert.deepEqual(await scope("Array.from(document.querySelectorAll('#appr-list tbody tr')).map(function(row){return row.dataset.apprKey;})"),['req:fixture-1']);
    assert.equal(await scope("document.querySelector('#appr-list .summary-cell').querySelector('img')===null"),true);
    await b('screenshot',path.join(output,'raw-search-'+width+'.png'));
    // Personal tabs use a scoped server search; exercise this local batch filter on the actionable tab.
    await scope("window.__fixtureItems=[{kind:'inv',raw:INVS[0],rows:INVS.slice(0,2)}];S.aT='p';S.apprQuery='';S.apprPage=1;buildApprovals();true");
    for(const query of ['後續單獨有描述','客戶乙','INV-002','A&B','550.00']){
      await b('fill','#appr-q',query);
      await waitForSearchResults();
      assert.equal(await scope("document.querySelectorAll('#appr-list tbody tr').length"),1,query);
    }
    await b('fill','#appr-q','不屬於此清單客戶');
    await waitForSearchResults();
    assert.equal(await scope("document.querySelectorAll('#appr-list tbody tr').length"),0,'Only the explicit permitted members are indexed');
    const size=await scope('({width:innerWidth,scrollWidth:document.documentElement.scrollWidth})');assert(size.scrollWidth<=width,JSON.stringify(size));
    evidence.push({width,pageSelection:true,searchClearsSelection:true,rawCharacters:true,escapedDisplay:true,laterBatchFields:true,hiddenSiblingExcluded:true,noOverflow:true});
  }
  assert.equal((await b('errors')).trim(),'');
  await browser.close();browser=null;
  const layoutEvidence=await checkApprovalLayouts();
  assert.deepEqual(errors,[],'geometry and interactions have no uncaught browser errors');
  fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify({ok:true,evidence,layoutEvidence,scope:'Actual local DOM with fictional permitted rows. External requests blocked; no real OAuth or production mutations.'},null,2));
  console.log(JSON.stringify({ok:true,evidence,output}));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
