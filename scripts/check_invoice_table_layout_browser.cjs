'use strict';
// Actual local HTML/engines and fictional records only. --before uses the saved
// pre-change source overlay; this script never authenticates or calls a backend.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {applyBuildEnvironment}=require('./finance_build_environment');
const root=path.resolve(__dirname,'..'),before=process.argv.includes('--before'),serve=process.argv.includes('--serve');
const overlay=before?'/tmp/finance-table-baseline-20260913':root;
const out=process.env.FINANCE_TABLE_EVIDENCE||'/tmp/finance-table-layout-20260913';
const phase=before?'before':'after';
if(before)for(const name of ['index.html','assets/engines/mobile-ux-engine.js','assets/styles/finance-core.css','assets/styles/mobile-operations.css'])assert(fs.existsSync(path.join(overlay,name)),'Before requires the original source overlay: '+name);
const read=name=>fs.readFileSync(fs.existsSync(path.join(overlay,name))?path.join(overlay,name):path.join(root,name));
const anchor='bootAuthGate();\n\n})();';
let html=applyBuildEnvironment(read('index.html').toString(),{target:'local',supabaseUrl:'',supabaseAnonKey:''});
assert(html.includes(anchor));
html=html.replace(anchor,'window.__tableFixture={run:async function(code){return await eval(code)}};\n'+anchor).replace(/<script\b[^>]*src=["']https?:[^>]*><\/script>/gi,'');
const server=http.createServer((req,res)=>{const p=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,'.'+p);if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}res.setHeader('Content-Security-Policy',"connect-src 'none'; form-action 'none'; img-src 'self' data: blob:; font-src 'self' data:");if(p==='/'||p==='/index.html'){res.setHeader('content-type','text/html');return res.end(html);}if(!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('content-type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'application/octet-stream');res.end(read(p.slice(1)));});
const rows=[
 {no:'FX00000001',date:'2026-09-01',file:'虛構發票甲.pdf',item:'租金收入第007期',qty:1,unitName:'期',unitPrice:1050,netAmount:1000,taxAmount:50,grossAmount:1050,total:1050,taxMode:'gross_inclusive'},
 {no:'FX00000001',date:'2026-09-01',file:'虛構發票甲.pdf',item:'服務費甲',qty:2,unitName:'次',unitPrice:105,netAmount:200,taxAmount:10,grossAmount:210,total:210,taxMode:'gross_inclusive'},
 {no:'FX00000002',date:'2026-09-02',file:'虛構發票乙.pdf',item:'印表紙乙',qty:3,unitName:'包',unitPrice:105,netAmount:300,taxAmount:15,grossAmount:315,total:315,taxMode:'gross_inclusive'},
 {no:'FX00000002',date:'2026-09-02',file:'虛構發票乙.pdf',item:'服務費乙',qty:1,unitName:'次',unitPrice:420,netAmount:400,taxAmount:20,grossAmount:420,total:420,taxMode:'gross_inclusive'}
];
const setup=`(async()=>{
 window.__fixtureCalls=[];getSb=function(){throw Error('No backend in table fixture');};window.fetch=function(url){window.__fixtureCalls.push(String(url));throw Error('No network in table fixture');};
 USERS=[{id:'owner',n:'虛構員工',email:'owner@example.invalid',authUserId:'auth-owner',role:'employee',rL:'組員',eid:'F1',dc:'D1',active:true},{id:'ceo',n:'虛構覆核人',email:'review@example.invalid',authUserId:'auth-ceo',role:'ceo',rL:'執行長',eid:'F1',dc:'D1',active:true}];
 ENTS=[{id:'F1',n:'虛構公司',s:'虛構公司',active:true}];DEPTS=[{c:'D1',n:'虛構部門',eid:'F1',entityCodes:['F1'],newFormEntityCodes:['F1'],lv:4,active:true,isPostingUnit:true}];
 REQS=[];INVS=[];BILLS=[];VOUCHERS=[];NOTIFS=[];ORG_CHART=[];MEMBERSHIP_ORG_RUNTIME={available:false,graph:null};
 S.demoLogin=true;setDataEnvironment(DATA_ENV_TEST);await doEnter(USERS[1]);
 window.__tableRows=${JSON.stringify(rows)};
 window.__tableRequest={id:'request-fixture',no:'FIXTURE-001',app:'虛構員工',applicantId:'owner',eid:'F1',dc:'D1',type:'expense_reimbursement',tL:'費用報銷',status:'pending_ceo',step:1,ver:1,amt:1995,total:1995,dr:'6205',cr:'1112',steps:[{rk:'applicant_submit',uid:'owner',a:'approved'},{rk:'ceo',uid:'ceo',r:'執行長',a:'',status:'pending_ceo'}],formPayload:{lazyRows:__tableRows,accountingLines:__tableRows.map(function(row,i){return{id:'line_'+(i+1),description:row.item,netAmount:row.netAmount,taxAmount:row.taxAmount,grossAmount:row.grossAmount,debitAccount:'6205',debitAccountName:'辦公用品',creditAccount:'1112',creditAccountName:'銀行存款',departmentCode:'D1'}})}};
 REQS=[__tableRequest];
 INVS=[0,1].map(function(i){return{id:'invoice-'+i,no:'OUT0000000'+(i+1),date:'2026-09-0'+(i+1),buyer:'虛構買受人'+(i+1),identifierType:'二聯式',desc:'虛構收入品項'+(i+1),qty:i+1,amt:1000*(i+1),tax:50*(i+1),total:1050*(i+1),rate:.05,batchId:'fixture-batch',eid:'F1',dc:'D1',applicantId:'owner',status:'pending_ceo',approvalStatus:'pending_ceo',rowVersion:1,ver:1,updatedAt:'2026-09-01T00:00:00Z',step:1,steps:[{rk:'applicant_submit',uid:'owner',a:'approved'},{rk:'ceo',uid:'ceo',r:'執行長',a:'',status:'pending_ceo'}],revenueAccountCode:'4101',revenueAccountName:'服務收入'};});
 window.__tableShow=function(mode){
  closeAppr();el('appr-inner').innerHTML='';
  document.querySelectorAll('.pg').forEach(function(n){n.classList.remove('on');});el('pg-detail').classList.add('on');S.page='detail';el('detail-hd').textContent='發票與會計明細 · 虛構資料';el('detail-act').innerHTML='';el('detail-body').style.gridTemplateColumns='minmax(0,1fr)';
  if(mode==='expense')el('detail-body').innerHTML=expenseInvoiceReviewHtml(__tableRequest)+accountingLinesHtml(__tableRequest,true,'逐項會計覆核','detail-acct');
  if(mode==='approval'||mode==='invoice-approval'){el('pg-detail').classList.remove('on');el('pg-approvals').classList.add('on');S.page='approvals';if(mode==='approval')showApprD(__tableRequest);else showInvApprD(INVS[0]);}
  if(mode==='invoice')el('detail-body').innerHTML=invoiceReviewDetailHtml(INVS[0],{editable:true});
  if(mode==='posted'){
   S.demoLogin=false;var posted=Object.assign({},__tableRequest,{id:'posted-fixture',status:'completed',ledgerPostedAt:'2026-09-10T00:00:00Z',voucherId:'fixture-voucher',formPayload:Object.assign({},__tableRequest.formPayload,{ledgerPostedAt:'2026-09-10T00:00:00Z'})});REQS.push(posted);POSTED_ACCOUNTING_VIEWS.set(posted,{status:'ready',key:postedAccountingViewKey(posted),lines:__tableRequest.formPayload.accountingLines,voucher:{no:'FIXTURE-VOUCHER',entries:[{ac:'6205',an:'辦公用品',dept:'D1',t:'dr',amt:1900},{ac:'1144',an:'進項稅額',dept:'D1',t:'dr',amt:95},{ac:'1112',an:'銀行存款',dept:'D1',t:'cr',amt:1995}]}});el('detail-body').innerHTML=accountingLinesHtml(posted,true,'','posted-acct');S.demoLogin=true;
  }
  if(mode==='entry'){el('pg-detail').classList.remove('on');el('pg-newreq').classList.add('on');S.page='newreq';S.nrType='expense_reimbursement';S.nrRec='invoice';S.nrStep=3;S.lazyRows=JSON.parse(JSON.stringify(__tableRows));renderNR();renderLazySheet();document.querySelectorAll('#nr-content details.efux-section').forEach(function(n){n.open=true;});}
  enhanceMobileTables(document);return true;
 };__tableShow('expense');return{canEditAmounts:canEditAccountingLineAmounts(__tableRequest),canEditSubjects:canEditAccountingLineSubjects(__tableRequest),invoiceEdit:canEditInvoiceAccountingDetails(INVS[0]),invoiceActionCount:invoiceBatchActionRows(INVS[0]).length};
})()`;
let browser;
(async()=>{fs.mkdirSync(out,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 if(serve){console.log(JSON.stringify({url,setup}));return;}
 const {chromium}=require('playwright');browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.route('**/*',route=>{const u=new URL(route.request().url());return u.origin===url?route.continue():route.abort();});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.waitForFunction(()=>window.__tableFixture);const scope=code=>page.evaluate(code=>__tableFixture.run(code),code);
 const permissions=await scope(setup);console.log({permissions});assert(permissions.canEditSubjects&&permissions.invoiceEdit&&permissions.invoiceActionCount===2);
 const evidence=[];
 for(const mode of ['expense','invoice','posted','entry','approval','invoice-approval'])for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await scope(`__tableShow('${mode}')`);
  if(mode==='expense'||mode==='approval'){
   const area=mode==='approval'?'#appr-inner':'#detail-body';
   if(!before){for(const button of await page.locator(area+' .finance-invoice-expand').all()){await button.click();assert.equal(await button.getAttribute('aria-expanded'),'true');}}
   else await scope(`Array.from(document.querySelectorAll('${area} tr[id]')).forEach(function(n){n.style.display='table-row';});`);
  }else if(before&&(mode==='invoice'||mode==='invoice-approval'))await scope(`Array.from(document.querySelectorAll('#detail-body tr[id],#appr-inner tr[id]')).forEach(function(n){n.style.display='table-row';});`);
  await page.waitForTimeout(180);
  const result=await page.evaluate(mode=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,tables:[...document.querySelectorAll(mode.includes('approval')?'#appr-inner table':'.pg.on table')].filter(t=>t.getClientRects().length).map(t=>({class:t.className,display:getComputedStyle(t).display,headDisplay:t.tHead?getComputedStyle(t.tHead).display:null,headers:t.tHead?[...t.tHead.rows[0].cells].map(c=>c.textContent.trim()):[],rows:[...t.tBodies].flatMap(b=>[...b.rows]).map(r=>[...r.cells].map(c=>({text:c.innerText.trim(),label:c.dataset.label||null,before:getComputedStyle(c,'::before').content,display:getComputedStyle(c).display}))),scrollParent:t.parentElement.className,parentClient:t.parentElement.clientWidth,parentScroll:t.parentElement.scrollWidth,scrollHint:t.parentElement.previousElementSibling&&t.parentElement.previousElementSibling.classList.contains('finance-table-scroll-hint')?{hidden:t.parentElement.previousElementSibling.hidden,text:t.parentElement.previousElementSibling.textContent}:null,controls:[...t.querySelectorAll('input,select,button')].map(n=>({id:n.id,handler:n.getAttribute('onchange')||n.getAttribute('oninput'),height:n.getBoundingClientRect().height,hidden:n.classList.contains('combo-native-select')}))})),postedCards:document.querySelectorAll('.posted-accounting-mobile-line').length}),mode);
  if(!before){assert(result.documentWidth<=width+1,mode+' full page overflow '+JSON.stringify(result));assert(result.tables.length>0,mode+' '+width+' no visible table');for(const table of result.tables){assert(table.scrollHint,mode+' scoped overflow hint');assert.equal(table.scrollHint.hidden,table.parentScroll<=table.parentClient+1,mode+' hint only for overflowing table');assert(table.scrollHint.text.includes('左右滑動查看完整欄位'));assert.equal(table.display,'table',mode);assert.equal(table.headDisplay,'table-header-group',mode);assert(!/mobile-(?:native-)?card-table/.test(table.class),mode);for(const row of table.rows)for(const cell of row){assert.equal(cell.label,null,mode);assert.equal(cell.display,'table-cell',mode);assert(['none','normal'].includes(cell.before),mode+' label pseudo element');}}assert.equal(result.postedCards,0);
   if(width===390)for(const table of result.tables)assert.deepEqual(table.controls.filter(control=>!control.hidden&&control.height>0&&control.height<43.9),[],mode+' touch targets');
   if(mode==='expense'||mode==='approval'){
    const summary=result.tables.find(t=>t.class.includes('invoice-review-table'));
    assert.deepEqual(summary.headers,['發票序號','發票日期','發票號碼 / 來源','發票含稅總金額']);
    const invoices=summary.rows.filter(row=>row.length===4);assert.equal(invoices.length,2);
    assert.equal(invoices[0][1].text,'2026-09-01');assert.equal(invoices[1][1].text,'2026-09-02');
    assert(invoices[0][2].text.includes('虛構發票甲.pdf'));assert(invoices[1][2].text.includes('虛構發票乙.pdf'));
    assert.equal(invoices[0][3].text,'NT$1,260');assert.equal(invoices[1][3].text,'NT$735');
    const details=result.tables.filter(t=>t.class.includes('finance-invoice-items-table'));assert.equal(details.length,2);
    assert.deepEqual(details.map(t=>t.rows.map(row=>row.slice(4).map(c=>c.text))),[[['NT$1,000','NT$50','NT$1,050'],['NT$200','NT$10','NT$210']],[['NT$300','NT$15','NT$315'],['NT$400','NT$20','NT$420']]]);
    assert(details[0].headers[1]==='品項明細'&&details[0].rows[0][1].text==='租金收入第007期');
   }
  }
  const tableSelector=mode.includes('approval')?'#appr-inner table':'.pg.on table';
  await page.locator(tableSelector).first().evaluate(t=>{var p=t.parentElement,h=p.previousElementSibling,target=h&&h.classList.contains('finance-table-scroll-hint')&&!h.hidden?h:p;target.scrollIntoView({block:'start',inline:'nearest'});var viewport=t.closest('#appr-inner')||document.querySelector('.content');if(viewport)viewport.scrollTop=Math.max(0,viewport.scrollTop-110);window.scrollBy(0,-110);});
  await page.screenshot({path:path.join(out,phase+'-'+mode+'-'+width+'.png')});
  if(!before&&width===390){
   const parent=page.locator(tableSelector).first().locator('..');
   await parent.evaluate(n=>{n.tabIndex=0;n.scrollLeft=0;n.focus({preventScroll:true});});await page.keyboard.press('ArrowRight');await page.waitForTimeout(220);
   assert((await parent.evaluate(n=>n.scrollLeft))>0,mode+' native keyboard horizontal scroll '+JSON.stringify(await parent.evaluate(n=>({class:n.className,scroll:n.scrollLeft,width:n.clientWidth,total:n.scrollWidth,overflow:getComputedStyle(n).overflowX,focus:document.activeElement.outerHTML.slice(0,200),connected:n.isConnected}))));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,mode+' table scroll cannot move page');
   await parent.evaluate(n=>{n.scrollLeft=n.scrollWidth;});await page.screenshot({path:path.join(out,phase+'-'+mode+'-'+width+'-right.png')});await parent.evaluate(n=>{n.scrollLeft=0;});
   result.keyboardScroll=true;
  }
  evidence.push({mode,...result});
 }
 await page.setViewportSize({width:1440,height:1000});await scope(`__tableShow('expense')`);await page.waitForTimeout(100);
 const beforeData=await scope(`JSON.stringify(__tableRequest.formPayload.lazyRows)`);
 await page.locator('#detail-acct-net-0').fill('1100');await page.locator('#detail-acct-net-0').dispatchEvent('input');await page.locator('#detail-acct-tax-0').fill('55');await page.locator('#detail-acct-tax-0').dispatchEvent('input');
 await page.locator('#detail-acct-dr-0').selectOption('6201');
 const edit=await scope(`(function(){var lines=collectAccountingLinesFromDom(__tableRequest,'detail-acct');return{line:lines[0],count:lines.length,amount:__tableRequest.amt,raw:JSON.stringify(__tableRequest.formPayload.lazyRows),calls:__fixtureCalls};})()`);
 assert.equal(edit.line.netAmount,1100);assert.equal(edit.line.taxAmount,55);assert.equal(edit.line.grossAmount,1155);assert.equal(edit.line.debitAccount,'6201');assert.equal(edit.line.manualOverride,true);assert.equal(edit.line.valueAuthority,'human');assert.equal(edit.count,4);assert.equal(edit.amount,2100);assert.equal(edit.raw,beforeData);assert.deepEqual(edit.calls,[]);
 await scope(`__tableShow('invoice')`);await page.waitForTimeout(100);await scope(`Array.from(document.querySelectorAll('#detail-body tr[id]')).forEach(function(n){n.style.display='table-row';});`);
 await page.locator('#inv-line-desc-1').fill('人工覆核第二張');await page.locator('#inv-line-qty-1').fill('3');await page.locator('#inv-line-total-1').fill('3150');
 const editedInvoice=await scope(`(function(){return{count:collectInvoiceApprovalLineEdits(INVS[0]),rows:INVS};})()`);assert.equal(editedInvoice.count,1);assert.equal(editedInvoice.rows[0].total,1050);assert.equal(editedInvoice.rows[1].desc,'人工覆核第二張');assert.equal(editedInvoice.rows[1].qty,3);assert.equal(editedInvoice.rows[1].total,3150);assert.equal(editedInvoice.rows[1].tax,150);
 await scope(`S.user=USERS[0];__tableShow('invoice')`);assert.equal(await page.locator('#detail-body input').count(),0,'Employee does not gain invoice controls');
 await scope(`__tableShow('expense')`);assert.equal(await page.locator('#detail-body select').count(),0,'Employee does not gain accounting controls');
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,phase+'-evidence.json'),JSON.stringify({phase,permissions,fixtures:rows,evidence,manualReview:{net:edit.line.netAmount,tax:edit.line.taxAmount,gross:edit.line.grossAmount,debit:edit.line.debitAccount,amount:edit.amount,human:true,rawUnchanged:true,invoiceEditedOnlySecond:true,employeeReadOnly:true},errors,noBusinessCalls:true},null,2));console.log('PASS '+phase+' tables desktop/mobile, canonical values and real manual edit collectors: '+out);
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();if(!serve)server.close();});
