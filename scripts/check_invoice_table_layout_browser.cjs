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
 {id:'fixture-item-1',no:'FX00000001',date:'2026-09-01',file:'虛構發票甲.pdf',item:'租金收入第007期',applicantItemNote:'第一梯次課程專用',qty:1,unitName:'期',unitPrice:1050,netAmount:1000,taxAmount:50,grossAmount:1050,total:1050,taxMode:'gross_inclusive'},
 {id:'fixture-item-2',no:'FX00000001',date:'2026-09-01',file:'虛構發票甲.pdf',item:'服務費甲',applicantItemNote:'第二梯次需分別核對',qty:2,unitName:'次',unitPrice:105,netAmount:200,taxAmount:10,grossAmount:210,total:210,taxMode:'gross_inclusive'},
 {id:'fixture-item-3',no:'FX00000002',date:'2026-09-02',file:'虛構發票乙.pdf',item:'印表紙乙',applicantItemNote:'核銷給教學部門',qty:3,unitName:'包',unitPrice:105,netAmount:300,taxAmount:15,grossAmount:315,total:315,taxMode:'gross_inclusive'},
 {id:'fixture-item-4',no:'FX00000002',date:'2026-09-02',file:'虛構發票乙.pdf',item:'服務費乙',applicantItemNote:'逐項備註不得影響會計科目；此筆為長篇核銷說明，須確認單一品項的備註在手機窄螢幕仍完整換行且不遮住金額與借貸方科目。',qty:1,unitName:'次',unitPrice:420,netAmount:400,taxAmount:20,grossAmount:420,total:420,taxMode:'gross_inclusive'}
];
const setup=`(async()=>{
 window.__fixtureCalls=[];getSb=function(){throw Error('No backend in table fixture');};window.fetch=function(url){window.__fixtureCalls.push(String(url));throw Error('No network in table fixture');};
 USERS=[{id:'owner',n:'虛構員工',email:'owner@example.invalid',authUserId:'auth-owner',role:'employee',rL:'組員',eid:'F1',dc:'D1',active:true},{id:'ceo',n:'虛構覆核人',email:'review@example.invalid',authUserId:'auth-ceo',role:'ceo',rL:'執行長',eid:'F1',dc:'D1',active:true}];
 ENTS=[{id:'F1',n:'虛構公司',s:'虛構公司',active:true}];DEPTS=[{c:'D1',n:'虛構部門',eid:'F1',entityCodes:['F1'],newFormEntityCodes:['F1'],lv:4,active:true,isPostingUnit:true}];
 REQS=[];INVS=[];BILLS=[];VOUCHERS=[];NOTIFS=[];ORG_CHART=[];MEMBERSHIP_ORG_RUNTIME={available:false,graph:null};
 S.demoLogin=true;setDataEnvironment(DATA_ENV_TEST);await doEnter(USERS[1]);
 window.__tableRows=${JSON.stringify(rows)};
 window.__tableUseUnifiedPosted=${!before};
 window.__tableRequest={id:'request-fixture',no:'FIXTURE-001',app:'虛構員工',applicantId:'owner',eid:'F1',dc:'D1',type:'expense_reimbursement',tL:'費用報銷',status:'pending_ceo',step:1,ver:1,amt:1995,total:1995,dr:'6205',cr:'1112',steps:[{rk:'applicant_submit',uid:'owner',a:'approved'},{rk:'ceo',uid:'ceo',r:'執行長',a:'',status:'pending_ceo'}],formPayload:{lazyRows:__tableRows,accountingLines:__tableRows.map(function(row,i){return{id:'line_'+(i+1),sourceItemId:row.id,description:row.item,netAmount:row.netAmount,taxAmount:row.taxAmount,grossAmount:row.grossAmount,debitAccount:'6205',debitAccountName:'辦公用品',creditAccount:'1112',creditAccountName:'銀行存款',departmentCode:'D1'}})}};
 REQS=[__tableRequest];
 INVS=[0,1].map(function(i){return{id:'invoice-'+i,no:'OUT0000000'+(i+1),date:'2026-09-0'+(i+1),buyer:'虛構買受人'+(i+1),identifierType:'二聯式',desc:'虛構收入品項'+(i+1),qty:i+1,amt:1000*(i+1),tax:50*(i+1),total:1050*(i+1),rate:.05,batchId:'fixture-batch',eid:'F1',dc:'D1',applicantId:'owner',status:'pending_ceo',approvalStatus:'pending_ceo',rowVersion:1,ver:1,updatedAt:'2026-09-01T00:00:00Z',step:1,steps:[{rk:'applicant_submit',uid:'owner',a:'approved'},{rk:'ceo',uid:'ceo',r:'執行長',a:'',status:'pending_ceo'}],revenueAccountCode:'4101',revenueAccountName:'服務收入'};});
 window.__tableShow=function(mode){
  closeAppr();el('appr-inner').innerHTML='';
  document.querySelectorAll('.pg').forEach(function(n){n.classList.remove('on');});el('pg-detail').classList.add('on');S.page='detail';el('detail-hd').textContent='發票與會計明細 · 虛構資料';el('detail-act').innerHTML='';el('detail-body').style.gridTemplateColumns='minmax(0,1fr)';
  if(mode==='expense')el('detail-body').innerHTML=expenseInvoiceAccountingReviewHtml(__tableRequest,true,'逐項會計覆核','detail-acct');
  if(mode==='approval'||mode==='invoice-approval'){el('pg-detail').classList.remove('on');el('pg-approvals').classList.add('on');S.page='approvals';if(mode==='approval')showApprD(__tableRequest);else showInvApprD(INVS[0]);}
  if(mode==='invoice')el('detail-body').innerHTML=invoiceReviewDetailHtml(INVS[0],{editable:true});
  if(mode==='posted'){
   S.demoLogin=false;var posted=Object.assign({},__tableRequest,{id:'posted-fixture',status:'completed',ledgerPostedAt:'2026-09-10T00:00:00Z',voucherId:'fixture-voucher',formPayload:Object.assign({},__tableRequest.formPayload,{ledgerPostedAt:'2026-09-10T00:00:00Z'})});REQS.push(posted);POSTED_ACCOUNTING_VIEWS.set(posted,{status:'ready',key:postedAccountingViewKey(posted),lines:__tableRequest.formPayload.accountingLines,voucher:{no:'FIXTURE-VOUCHER',entries:[{ac:'6205',an:'辦公用品',dept:'D1',t:'dr',amt:1900},{ac:'1144',an:'進項稅額',dept:'D1',t:'dr',amt:95},{ac:'1112',an:'銀行存款',dept:'D1',t:'cr',amt:1995}]}});var postedHtml=__tableUseUnifiedPosted?expenseInvoiceAccountingReviewHtml(posted,false,'','posted-acct'):accountingLinesHtml(posted,true,'','posted-acct');S.demoLogin=true;el('detail-body').innerHTML=postedHtml;
  }
  if(mode==='entry'){el('pg-detail').classList.remove('on');el('pg-newreq').classList.add('on');S.page='newreq';S.nrType='expense_reimbursement';S.nrRec='invoice';S.nrStep=3;S.lazyRows=JSON.parse(JSON.stringify(__tableRows));renderNR();renderLazySheet();document.querySelectorAll('#nr-content details.efux-section').forEach(function(n){n.open=true;});}
  enhanceMobileTables(document);return true;
 };__tableShow('expense');return{canEditAmounts:canEditAccountingLineAmounts(__tableRequest),canEditSubjects:canEditAccountingLineSubjects(__tableRequest),invoiceEdit:canEditInvoiceAccountingDetails(INVS[0]),invoiceActionCount:invoiceBatchActionRows(INVS[0]).length};
})()`;
let browser;
async function assertGroupedReview(review,mode,width){
 assert.equal(await review.count(),1,mode+' '+width+' has one combined review card');
 assert.equal(await review.locator('.invoice-review-table,.finance-invoice-items-table').count(),0,mode+' '+width+' does not duplicate the old invoice tables');
 const groups=review.locator('.invoice-accounting-group');
 assert.equal(await groups.count(),2,mode+' '+width+' has two invoice groups');
 assert.equal(await review.locator('.invoice-accounting-item').count(),rows.length,mode+' '+width+' renders each source item once');
 const expected=[
  {no:'FX00000001',date:'2026-09-01',items:rows.slice(0,2),subtotal:'1,260'},
  {no:'FX00000002',date:'2026-09-02',items:rows.slice(2),subtotal:'735'}
 ];
 const styles=[];
 for(let i=0;i<expected.length;i++){
  const group=groups.nth(i),want=expected[i];
  assert.equal(await group.getAttribute('data-invoice-number'),want.no,mode+' '+width+' invoice number grouping '+i);
  assert.equal(await group.getAttribute('data-invoice-date'),want.date,mode+' '+width+' invoice date grouping '+i);
  const visibleText=await group.innerText();
  assert(visibleText.includes(want.no)&&new RegExp(want.date.replace(/-/g,'[-/]')).test(visibleText),mode+' '+width+' exposes invoice number and date in the header '+i);
  assert(visibleText.includes(want.subtotal),mode+' '+width+' shows the correct invoice subtotal '+i);
  const items=group.locator('.invoice-accounting-item');
  assert.equal(await items.count(),want.items.length,mode+' '+width+' item count '+i);
  for(let j=0;j<want.items.length;j++){
   const item=items.nth(j),source=want.items[j],text=await item.innerText();
   assert(text.includes(source.item),mode+' '+width+' preserves the source item '+source.item);
   assert.equal(await item.getAttribute('data-source-item-id'),source.id,mode+' '+width+' keeps the stable item association '+source.item);
   const inputAmounts=await item.locator('input[type="number"]').evaluateAll(nodes=>nodes.map(node=>Number(node.value)));
   assert(text.includes(source.grossAmount.toLocaleString('en-US'))||inputAmounts.includes(source.grossAmount),mode+' '+width+' shows gross amount for '+source.item);
   assert.equal(await item.locator('select').count(),2,mode+' '+width+' keeps debit and credit controls beside '+source.item);
   const note=item.locator('.invoice-accounting-note');
   assert.equal(await note.count(),1,mode+' '+width+' exposes a dedicated applicant note for '+source.item);
   assert(await note.isVisible()&&(await note.innerText()).includes(source.applicantItemNote),mode+' '+width+' displays the original applicant note for '+source.item);
   const noteSize=await note.evaluate(node=>({width:node.clientWidth,scrollWidth:node.scrollWidth,height:node.clientHeight,scrollHeight:node.scrollHeight}));
   assert(noteSize.scrollWidth<=noteSize.width+1&&noteSize.scrollHeight<=noteSize.height+2,mode+' '+width+' applicant note is not visually clipped '+JSON.stringify(noteSize));
   const geometry=await item.evaluate(node=>{const item=node.getBoundingClientRect(),group=node.closest('.invoice-accounting-group').getBoundingClientRect();return{itemLeft:item.left,itemRight:item.right,groupLeft:group.left,groupRight:group.right};});
   assert(geometry.itemLeft>=geometry.groupLeft-1&&geometry.itemRight<=geometry.groupRight+1,mode+' '+width+' item stays inside its invoice block '+source.item);
   const overlappingCells=await item.evaluate(node=>{const boxes=[...node.querySelectorAll(':scope > .invoice-accounting-cell')].map(cell=>cell.getBoundingClientRect());return boxes.some((a,i)=>boxes.slice(i+1).some(b=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top))>1));});
   assert(!overlappingCells,mode+' '+width+' item cells do not overlap '+source.item);
  }
  styles.push(await group.evaluate(node=>({background:getComputedStyle(node).backgroundColor,border:getComputedStyle(node).borderLeftColor})));
 }
 assert(styles.every(style=>style.background!=='rgba(0, 0, 0, 0)'),mode+' '+width+' groups have a continuous background');
 assert(styles[0].background!==styles[1].background||styles[0].border!==styles[1].border,mode+' '+width+' adjoining invoices are visually distinguishable');
 if(width<=390){
  const controls=await review.locator('.invoice-accounting-item input,.invoice-accounting-item select,.invoice-accounting-item button').evaluateAll(nodes=>nodes.filter(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden').map(node=>({name:node.tagName,id:node.id,height:node.getBoundingClientRect().height})));
  assert(controls.every(control=>control.height>=43.9),mode+' '+width+' grouped item controls have 44px touch height '+JSON.stringify(controls));
 }
}
(async()=>{fs.mkdirSync(out,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 if(serve){console.log(JSON.stringify({url,setup}));return;}
 const {chromium}=require('playwright');browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.route('**/*',route=>{const u=new URL(route.request().url());return u.origin===url?route.continue():route.abort();});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.waitForFunction(()=>window.__tableFixture);const scope=code=>page.evaluate(code=>__tableFixture.run(code),code);
 const permissions=await scope(setup);console.log({permissions});assert(permissions.canEditSubjects&&permissions.invoiceEdit&&permissions.invoiceActionCount===2);
 const evidence=[];
 for(const mode of ['expense','invoice','posted','entry','approval','invoice-approval'])for(const width of (!before&&(mode==='expense'||mode==='approval')?[1440,1024,390,320]:[1440,390])){
  await page.setViewportSize({width,height:1000});await scope(`__tableShow('${mode}')`);
  const unified=!before&&(mode==='expense'||mode==='approval'||mode==='posted');
  if(mode==='expense'||mode==='approval'||unified&&mode==='posted'){
   const area=mode==='approval'?'#appr-inner':'#detail-body';
   if(!before){
    const review=page.locator(area+' .expense-accounting-review');
    if(mode==='posted'){
     assert.equal(await review.count(),1,'posted review uses the unified card');
     assert.equal(await review.locator('.invoice-accounting-group').count(),2,'posted review keeps invoice groups');
     assert.equal(await review.locator('.invoice-accounting-item').count(),rows.length,'posted review keeps every source item');
     assert.equal(await review.locator('input,select').count(),0,'posted review is read-only');
     assert.equal(await review.locator('.invoice-accounting-voucher').count(),1,'posted review retains the formal voucher');
     assert((await review.innerText()).includes('已核對'),'posted review marks verified detail');
    }else await assertGroupedReview(review,mode,width);
    await review.evaluate(n=>n.scrollIntoView({block:'start',inline:'nearest'}));
    await page.screenshot({path:path.join(out,phase+'-'+mode+'-'+width+'-grouped.png')});
   }
   else await scope(`Array.from(document.querySelectorAll('${area} tr[id]')).forEach(function(n){n.style.display='table-row';});`);
  }else if(before&&(mode==='invoice'||mode==='invoice-approval'))await scope(`Array.from(document.querySelectorAll('#detail-body tr[id],#appr-inner tr[id]')).forEach(function(n){n.style.display='table-row';});`);
  await page.waitForTimeout(180);
  const result=await page.evaluate(mode=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,tables:[...document.querySelectorAll(mode.includes('approval')?'#appr-inner table':'.pg.on table')].filter(t=>t.getClientRects().length).map(t=>({class:t.className,display:getComputedStyle(t).display,headDisplay:t.tHead?getComputedStyle(t.tHead).display:null,headers:t.tHead?[...t.tHead.rows[0].cells].map(c=>c.textContent.trim()):[],rows:[...t.tBodies].flatMap(b=>[...b.rows]).map(r=>[...r.cells].map(c=>({text:c.innerText.trim(),label:c.dataset.label||null,before:getComputedStyle(c,'::before').content,display:getComputedStyle(c).display}))),scrollParent:t.parentElement.className,parentClient:t.parentElement.clientWidth,parentScroll:t.parentElement.scrollWidth,scrollHint:t.parentElement.previousElementSibling&&t.parentElement.previousElementSibling.classList.contains('finance-table-scroll-hint')?{hidden:t.parentElement.previousElementSibling.hidden,text:t.parentElement.previousElementSibling.textContent}:null,controls:[...t.querySelectorAll('input,select,button')].map(n=>({id:n.id,handler:n.getAttribute('onchange')||n.getAttribute('oninput'),height:n.getBoundingClientRect().height,hidden:n.classList.contains('combo-native-select')}))})),postedCards:document.querySelectorAll('.posted-accounting-mobile-line').length}),mode);
  if(!before){
   assert(result.documentWidth<=width+1,mode+' '+width+' full page overflow '+JSON.stringify(result));
   if(!unified){
    assert(result.tables.length>0,mode+' '+width+' no visible table');
    for(const table of result.tables){assert(table.scrollHint,mode+' scoped overflow hint');assert.equal(table.scrollHint.hidden,table.parentScroll<=table.parentClient+1,mode+' hint only for overflowing table');assert(table.scrollHint.text.includes('左右滑動查看完整欄位'));assert.equal(table.display,'table',mode);assert.equal(table.headDisplay,'table-header-group',mode);assert(!/mobile-(?:native-)?card-table/.test(table.class),mode);for(const row of table.rows)for(const cell of row){assert.equal(cell.label,null,mode);assert.equal(cell.display,'table-cell',mode);assert(['none','normal'].includes(cell.before),mode+' label pseudo element');}}
    if(width===390)for(const table of result.tables)assert.deepEqual(table.controls.filter(control=>!control.hidden&&control.height>0&&control.height<43.9),[],mode+' touch targets');
   }
   assert.equal(result.postedCards,0);
  }
  const tableSelector=mode.includes('approval')?'#appr-inner table':'.pg.on table';
  if(unified){
   const groupSelector=mode==='approval'?'#appr-inner .invoice-accounting-group':'#detail-body .invoice-accounting-group';
   await page.locator(groupSelector).first().evaluate(node=>node.scrollIntoView({block:'start',inline:'nearest'}));
  }else await page.locator(tableSelector).first().evaluate(t=>{var p=t.parentElement,h=p.previousElementSibling,target=h&&h.classList.contains('finance-table-scroll-hint')&&!h.hidden?h:p;target.scrollIntoView({block:'start',inline:'nearest'});var viewport=t.closest('#appr-inner')||document.querySelector('.content');if(viewport)viewport.scrollTop=Math.max(0,viewport.scrollTop-110);window.scrollBy(0,-110);});
  await page.screenshot({path:path.join(out,phase+'-'+mode+'-'+width+'.png')});
  if(unified&&mode==='expense'&&width<=390){
   await page.locator('#detail-body .invoice-accounting-item').last().scrollIntoViewIfNeeded();
   await page.screenshot({path:path.join(out,phase+'-'+mode+'-'+width+'-long-note.png')});
  }
  if(!before&&!unified&&width===390){
   const parent=page.locator(tableSelector).first().locator('..');
   await parent.evaluate(n=>{n.tabIndex=0;n.scrollLeft=0;n.focus({preventScroll:true});});await page.keyboard.press('ArrowRight');await page.waitForTimeout(220);
   assert((await parent.evaluate(n=>n.scrollLeft))>0,mode+' native keyboard horizontal scroll '+JSON.stringify(await parent.evaluate(n=>({class:n.className,scroll:n.scrollLeft,width:n.clientWidth,total:n.scrollWidth,overflow:getComputedStyle(n).overflowX,focus:document.activeElement.outerHTML.slice(0,200),connected:n.isConnected}))));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,mode+' table scroll cannot move page');
   await parent.evaluate(n=>{n.scrollLeft=n.scrollWidth;});await page.screenshot({path:path.join(out,phase+'-'+mode+'-'+width+'-right.png')});await parent.evaluate(n=>{n.scrollLeft=0;});
   result.keyboardScroll=true;
  }
  evidence.push({mode,...result});
 }
 if(!before){
  await scope(`(function(){
   S.demoLogin=false;
   var r=Object.assign({},__tableRequest,{id:'posted-unverified-fixture',status:'completed',ledgerPostedAt:'2026-09-10T00:00:00Z',voucherId:'fixture-voucher',formPayload:Object.assign({},__tableRequest.formPayload,{ledgerPostedAt:'2026-09-10T00:00:00Z'})});
   POSTED_ACCOUNTING_VIEWS.set(r,{status:'ready',key:postedAccountingViewKey(r),lines:null,voucher:{no:'FIXTURE-VOUCHER',entries:[{ac:'6205',an:'辦公用品',dept:'D1',t:'dr',amt:1900},{ac:'1144',an:'進項稅額',dept:'D1',t:'dr',amt:95},{ac:'1112',an:'銀行存款',dept:'D1',t:'cr',amt:1995}]}});
   var html=expenseInvoiceAccountingReviewHtml(r,false,'','posted-unverified-acct');S.demoLogin=true;el('detail-body').innerHTML=html;
  })()`);
  const unverified=page.locator('#detail-body .expense-accounting-review');
  assert.equal(await unverified.locator('.invoice-accounting-posted-warning[role="alert"]').count(),1,'missing posted lines trigger an explicit warning');
  assert.equal(await unverified.locator('.invoice-accounting-item').count(),rows.length,'unverified posted lines do not hide source items');
  assert.equal(await unverified.locator('.invoice-accounting-voucher-unverified').count(),1,'unverified posted lines still show the formal voucher');
  assert.equal(await unverified.locator('input,select').count(),0,'unverified posted view remains read-only');
 }
 await scope(`openDetail(__tableRequest.id)`);
 assert.equal(await page.locator('#detail-body .expense-accounting-review').count(),1,'real expense detail uses the unified review card');
 assert.equal(await page.locator('#detail-body .invoice-accounting-group').count(),2,'real expense detail shows both invoice groups');
 assert.equal(await page.locator('#detail-body .invoice-accounting-item').count(),rows.length,'real expense detail shows each item once');
 assert.equal(await page.locator('#detail-acct-line-dr-0').count(),1,'real expense detail keeps the accounting input prefix');
 const noInvoice=await scope(`(function(){var copy=Object.assign({},__tableRequest,{formPayload:Object.assign({},__tableRequest.formPayload,{lazyRows:[]})});return expenseInvoiceAccountingReviewHtml(copy,true,'逐項會計覆核','no-invoice-acct');})()`);
 assert(noInvoice.includes('data-accounting-prefix="no-invoice-acct"')&&!noInvoice.includes('invoice-accounting-group'),'accounting-only requests keep their review without a false invoice group');
 await page.setViewportSize({width:1440,height:1000});await scope(`__tableShow('expense')`);await page.waitForTimeout(100);
 const beforeData=await scope(`JSON.stringify(__tableRequest.formPayload.lazyRows)`);
 await page.locator('#detail-acct-net-0').fill('1100');await page.locator('#detail-acct-net-0').dispatchEvent('input');await page.locator('#detail-acct-tax-0').fill('55');await page.locator('#detail-acct-tax-0').dispatchEvent('input');
 await page.locator('#detail-acct-dr-0').selectOption('6201');
 await page.setViewportSize({width:390,height:844});
 assert.equal(await page.locator('#detail-acct-net-0').inputValue(),'1100','responsive layout preserves unsubmitted accounting amount');
 assert.equal(await page.locator('#detail-acct-dr-0').inputValue(),'6201','responsive layout preserves unsubmitted account selection');
 await page.setViewportSize({width:1440,height:1000});
 const edit=await scope(`(function(){var lines=collectAccountingLinesFromDom(__tableRequest,'detail-acct');return{line:lines[0],count:lines.length,amount:__tableRequest.amt,raw:JSON.stringify(__tableRequest.formPayload.lazyRows),calls:__fixtureCalls};})()`);
 assert.equal(edit.line.netAmount,1100);assert.equal(edit.line.taxAmount,55);assert.equal(edit.line.grossAmount,1155);assert.equal(edit.line.debitAccount,'6201');assert.equal(edit.line.manualOverride,true);assert.equal(edit.line.valueAuthority,'human');assert.equal(edit.count,4);assert.equal(edit.amount,2100);assert.equal(edit.raw,beforeData);assert.deepEqual(edit.calls,[]);
 await scope(`__tableShow('invoice')`);await page.waitForTimeout(100);await scope(`Array.from(document.querySelectorAll('#detail-body tr[id]')).forEach(function(n){n.style.display='table-row';});`);
 await page.locator('#inv-line-desc-1').fill('人工覆核第二張');await page.locator('#inv-line-qty-1').fill('3');await page.locator('#inv-line-total-1').fill('3150');
 const editedInvoice=await scope(`(function(){return{count:collectInvoiceApprovalLineEdits(INVS[0]),rows:INVS};})()`);assert.equal(editedInvoice.count,1);assert.equal(editedInvoice.rows[0].total,1050);assert.equal(editedInvoice.rows[1].desc,'人工覆核第二張');assert.equal(editedInvoice.rows[1].qty,3);assert.equal(editedInvoice.rows[1].total,3150);assert.equal(editedInvoice.rows[1].tax,150);
 await scope(`S.user=USERS[0];__tableShow('invoice')`);assert.equal(await page.locator('#detail-body input').count(),0,'Employee does not gain invoice controls');
 await scope(`__tableShow('expense')`);assert.equal(await page.locator('#detail-body select').count(),0,'Employee does not gain accounting controls');
 if(!before){
  await page.setViewportSize({width:390,height:844});
  await scope(`(function(){
   var largeRows=Array.from({length:28},function(_,i){var template=__tableRows[i%__tableRows.length],n=i<2?1:i;
    return Object.assign({},template,{id:'large-item-'+i,no:'LOAD-'+String(n).padStart(6,'0'),date:'2026-09-01',file:'load-source-'+n+'.pdf',item:'虛構品項 '+(i+1)});
   });
   var large=Object.assign({},__tableRequest,{id:'large-review-fixture',no:'LOAD-ONLY',formPayload:{lazyRows:largeRows,accountingLines:largeRows.map(function(row,i){return{id:'large-line-'+i,sourceItemId:row.id,description:row.item,netAmount:row.netAmount,taxAmount:row.taxAmount,grossAmount:row.grossAmount,debitAccount:'6205',debitAccountName:'辦公用品',creditAccount:'1112',creditAccountName:'銀行存款',departmentCode:'D1'};})}});
   el('detail-body').innerHTML=expenseInvoiceAccountingReviewHtml(large,false,'虛構大筆數覆核','large-acct');
  })()`);
  assert.equal(await page.locator('#detail-body .invoice-accounting-group').count(),27,'28 items with one shared invoice form 27 groups');
  assert.equal(await page.locator('#detail-body .invoice-accounting-item').count(),28,'large review keeps all 28 items visible');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'390px large review does not overflow the page');
  await page.setViewportSize({width:320,height:844});
  await scope(`__tableShow('entry')`);
  const actualEntryNote=page.locator('#pg-newreq #lazy-item-note-0');
  await actualEntryNote.evaluate(node=>{node.closest('details.efux-section').open=true;});
  assert(await actualEntryNote.isVisible(),'320px applicant item note is visible after opening its form section');
  await actualEntryNote.focus();
  const actualEntryFocus=await actualEntryNote.evaluate(node=>{var input=node.getBoundingClientRect(),scroll=node.closest('.lazy-sheet-scroll').getBoundingClientRect();return{inputLeft:input.left,inputRight:input.right,inputWidth:input.width,scrollLeft:scroll.left,scrollRight:scroll.right,pageWidth:document.documentElement.scrollWidth,viewport:innerWidth,focused:document.activeElement===node};});
  assert(actualEntryFocus.focused&&actualEntryFocus.inputWidth>=200&&actualEntryFocus.inputLeft>=actualEntryFocus.scrollLeft-1&&actualEntryFocus.inputRight<=actualEntryFocus.scrollRight+1&&actualEntryFocus.pageWidth<=actualEntryFocus.viewport+1,'320px focused item note is fully readable within its scroller '+JSON.stringify(actualEntryFocus));
  await page.screenshot({path:path.join(out,phase+'-entry-320-note-focused.png')});
  await scope(`__tableShow('expense')`);
  await scope(`(function(){
   var original=document.getElementById('lazy-sheet');if(original)original.id='lazy-sheet-original-fixture';
   var host=document.createElement('div');host.id='lazy-note-test-host';host.style.cssText='position:fixed;z-index:99999;left:10px;top:10px;width:calc(100vw - 20px);max-height:calc(100vh - 20px);overflow:auto;box-sizing:border-box;padding:8px;background:white;border:1px solid #efd2af';
   host.innerHTML='<div id="lazy-sheet"></div>';document.body.appendChild(host);
   window.__lazyNoteFixture={original:original,host:host,rows:S.lazyRows,review:S.lazyImportReview,revision:S.nrRevisionRid};
   S.nrRevisionRid='';S.lazyImportReview=null;
   S.lazyRows=[{id:'note-fixture-1',no:'TEST-001',date:'2026-09-01',item:'第一筆虛構品項',applicantItemNote:'原始說明',qty:1,unitPrice:105,netAmount:100,taxAmount:5,grossAmount:105,total:105,file:'虛構甲.pdf'},
    {id:'note-fixture-2',no:'TEST-002',date:'2026-09-02',item:'第二筆虛構品項',applicantItemNote:'第二筆保持原狀',qty:1,unitPrice:210,netAmount:200,taxAmount:10,grossAmount:210,total:210,file:'虛構乙.pdf'}];
   renderLazySheet();return true;
  })()`);
  await page.setViewportSize({width:390,height:844});
  const firstNote=page.locator('#lazy-note-test-host #lazy-item-note-0'),secondNote=page.locator('#lazy-note-test-host #lazy-item-note-1');
  assert.equal(await firstNote.count(),1,'first item has a dedicated note textarea');
  assert.equal(await secondNote.count(),1,'second item has a dedicated note textarea');
  await firstNote.fill('更新的單品項說明：供日後逐項核對');
  const editedNotes=await scope(`S.lazyRows.map(function(row){return row.applicantItemNote;})`);
  assert.deepEqual(editedNotes,['更新的單品項說明：供日後逐項核對','第二筆保持原狀'],'editing one item does not overwrite another item note');
  await scope(`renderLazySheet()`);
  assert.equal(await firstNote.inputValue(),editedNotes[0],'rerender retains the edited item note');
  assert.equal(await secondNote.inputValue(),editedNotes[1],'rerender retains the other item note');
  for(const width of [390,320]){
   await page.setViewportSize({width,height:844});
   const bounds=await page.locator('#lazy-note-test-host').evaluate(node=>{var box=node.getBoundingClientRect(),scroll=node.querySelector('.lazy-sheet-scroll');return{left:box.left,right:box.right,viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,noteHeights:[...node.querySelectorAll('textarea[id^="lazy-item-note-"]')].map(input=>input.getBoundingClientRect().height),tableClient:scroll.clientWidth,tableScroll:scroll.scrollWidth};});
   assert(bounds.left>=0&&bounds.right<=width+1&&bounds.documentWidth<=width+1,'item-note editor '+width+'px stays inside the phone page '+JSON.stringify(bounds));
   assert(bounds.noteHeights.length===2&&bounds.noteHeights.every(height=>height>=43.9),'item-note editor '+width+'px has 44px touch height '+JSON.stringify(bounds));
   assert(bounds.tableScroll>bounds.tableClient,'item-note editor '+width+'px confines the wide sheet to its own scroller');
   await page.screenshot({path:path.join(out,phase+'-lazy-item-note-'+width+'.png')});
  }
  await scope(`(function(){var fixture=window.__lazyNoteFixture;fixture.host.remove();if(fixture.original)fixture.original.id='lazy-sheet';S.lazyRows=fixture.rows;S.lazyImportReview=fixture.review;S.nrRevisionRid=fixture.revision;delete window.__lazyNoteFixture;})()`);
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,phase+'-evidence.json'),JSON.stringify({phase,permissions,fixtures:rows,evidence,manualReview:{net:edit.line.netAmount,tax:edit.line.taxAmount,gross:edit.line.grossAmount,debit:edit.line.debitAccount,amount:edit.amount,human:true,rawUnchanged:true,invoiceEditedOnlySecond:true,employeeReadOnly:true},errors,noBusinessCalls:true},null,2));console.log('PASS '+phase+' tables desktop/mobile, canonical values and real manual edit collectors: '+out);
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();if(!serve)server.close();});
