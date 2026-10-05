'use strict';
// Actual Finance renderers and procurement receipt handler, with fictional
// local actors and a mocked database commit. No OAuth or external requests.
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {applyBuildEnvironment}=require('./finance_build_environment');

const root=path.resolve(__dirname,'..');
const output=path.resolve(process.env.PROCUREMENT_CLOSEOUT_EVIDENCE||'/tmp/finance-procurement-closeout-browser');
assert(output!==root&&!output.startsWith(root+path.sep),'evidence must stay outside the source tree');
const original=fs.readFileSync(path.join(root,'index.html'),'utf8');
const sourceSha256=crypto.createHash('sha256').update(original).digest('hex');
const anchor='bootAuthGate();\n\n})();';
assert(original.includes(anchor),'local-only closure injection point');
let html=applyBuildEnvironment(original,{target:'local',supabaseUrl:'',supabaseAnonKey:''});
html=html.replace(anchor,'window.__procurementQA={run:async function(code){return await eval(code)}};\n'+anchor)
  .replace(/<script\b[^>]*src=["']https?:[^>]*><\/script>/gi,'');
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  if(file===root||file===path.join(root,'index.html')){res.setHeader('content-type','text/html; charset=utf-8');res.end(html);return;}
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.setHeader('content-type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');
  res.end(fs.readFileSync(file));
});
const report={scope:'Local Finance source HTML; fictional general affairs, accountant and employee; mocked database commit; all external requests blocked.',sourceSha256,checks:[],screens:[],blockedRequests:[]};
function check(label,condition){assert.ok(condition,label);report.checks.push(label);console.log('PASS '+label);}
let browser;

(async()=>{
  fs.mkdirSync(output,{recursive:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,...(process.env.FINANCE_BROWSER_CHANNEL==='chromium'?{}:{channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'})});
  for(const width of [1440,390]){
    const context=await browser.newContext({viewport:{width,height:width===390?844:1000}});
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin===origin||url.protocol==='blob:'||url.protocol==='data:')return route.continue();
      report.blockedRequests.push(url.origin);return route.abort();
    });
    const page=await context.newPage(),errors=[],dialogs=[];
    page.setDefaultTimeout(10000);
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.dismiss();});
    await page.goto(origin);
    await page.waitForFunction(()=>window.__procurementQA);
    const run=code=>page.evaluate(code=>window.__procurementQA.run(code),code);
    const capture=async(label,selector,hasText)=>{
      const target=hasText?page.locator(selector).filter({hasText}):page.locator(selector);
      await target.first().scrollIntoViewIfNeeded();
      const dimensions=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
      check(width+' '+label+' has no horizontal overflow',dimensions.document<=dimensions.viewport+1);
      const file=path.join(output,label+'-'+width+'.png');
      await page.screenshot({path:file,fullPage:true});report.screens.push(file);
    };

    await run(`(function(){
      window.__qaNetwork=[];window.__qaWrites=[];window.__qaUploads=[];window.__qaBuilds=0;
      window.fetch=function(input){window.__qaNetwork.push(String(input));return Promise.reject(new Error('Offline fixture blocks fetch'));};
      getSb=function(){throw new Error('Offline fixture blocks Supabase')};
      USERS=[
        {id:'fixture-ga',n:'虛構總務',email:'ga@example.invalid',role:'general_affairs',rL:'總務',eid:'F1',dc:'D1',active:true},
        {id:'fixture-accountant',n:'虛構會計',email:'accountant@example.invalid',role:'accountant',rL:'會計',eid:'F1',dc:'D1',active:true},
        {id:'fixture-employee',n:'虛構員工',email:'employee@example.invalid',role:'employee',rL:'組員',eid:'F1',dc:'D1',active:true}
      ];
      ENTS=[{id:'F1',n:'虛構照護公司',s:'虛構照護公司',active:true}];
      DEPTS=[{c:'D1',n:'虛構行政部門',eid:'F1',entityCodes:['F1'],active:true,lv:2,isPostingUnit:true}];
      ORG_CHART=[];REQS=[];INVS=[];BILLS=[];VOUCHERS=[];NOTIFS=[];
      quickLogin('general_affairs');
      buildAll=function(){window.__qaBuilds++;};
      dbUpdate=async function(table,id,patch){window.__qaWrites.push({table,id,patch:cloneSettingValue(patch)});return{ok:true};};
      uploadAttachmentsToSupabase=async function(){window.__qaUploads.push('attempted');throw new Error('No upload required in existing-PDF case');};
      window.__ownPdf={n:'既有採購發票.pdf',t:'pdf',mime:'application/pdf',bucket:'finance-attachments',path:'fixture/own/prior-invoice.pdf',data_environment:'test'};
      window.__foreignPdf={n:'別人上傳的附件.pdf',t:'pdf',mime:'application/pdf',bucket:'finance-attachments',path:'fixture/other/foreign-invoice.pdf',data_environment:'test'};
      window.__makeProcRecord=function(id,finishedReceipt){
        var approved=function(rk,uid,n,status,files){return{rk,uid,n,a:'approved',status,files:files||[],actionLog:[{action:'簽核通過',byId:uid,by:n,at:'2026-10-01T00:00:00Z'}]};};
        var steps=[
          approved('applicant_submit','fixture-employee','虛構員工','pending_applicant'),
          approved('procurement_payment','fixture-ga','虛構總務','pending_procurement',[window.__ownPdf]),
          approved('direct_supervisor','fixture-employee','虛構主管','pending_section_chief'),
          approved('dept_manager','fixture-employee','虛構主任','pending_dept_manager'),
          approved('accountant','fixture-accountant','虛構會計','pending_accountant'),
          approved('ceo','fixture-employee','虛構執行長','pending_ceo'),
          approved('cashier','fixture-employee','虛構出納','pending_cashier',[window.__foreignPdf]),
          approved('applicant_confirm','fixture-employee','虛構員工','pending_applicant_confirm')
        ];
        // The historic assignee changed; the completed actionLog identifies
        // the actual uploader/signer whose prior PDF may be reused.
        steps[1].uid='fixture-former-ga';steps[1].n='虛構前任總務';
        steps.push(finishedReceipt?approved('procurement_receipt','fixture-ga','虛構總務','pending_procurement'):{rk:'procurement_receipt',uid:'fixture-ga',n:'虛構總務',a:'',status:'pending_procurement',files:[]});
        steps.push({rk:'accountant_final',uid:'fixture-accountant',n:'虛構會計',a:'',status:'pending_voucher',files:[]});
        return mapReq({id,no:'LOCAL-PROC-'+id,type:'purchase_request',type_label:'採購申請',entity_id:'F1',department_code:'D1',applicant:'虛構員工',applicant_id:'fixture-employee',amount:1200,estimated_amount:1200,actual_amount:null,description:'虛構用品採購',status:finishedReceipt?'pending_voucher':'pending_procurement',step:finishedReceipt?10:9,ver:1,form_payload:{purchaseEstimate:{procurementAmount:1200,stage:'procurement_estimate'}},files:[window.__ownPdf,window.__foreignPdf],actual_files:[],steps,tenant_id:currentTenantId(),data_environment:'test'});
      };
      REQS=[window.__makeProcRecord('receipt',false),window.__makeProcRecord('missing',true)];
      openDetail('receipt');
    })()`);
    check(width+' general affairs can act on receipt',await run("canActRequest(REQS[0])")===true);
    check(width+' estimate does not prefill actual amount',(await page.locator('#detail-proc-actual-amt').inputValue())==='');
    const detailEvidence=page.locator('#detail-proc-reuse-files input[type="checkbox"]');
    check(width+' detail offers only own previously approved PDF',await detailEvidence.count()===1&&(await page.locator('#detail-proc-reuse-files').innerText()).includes('既有採購發票.pdf')&&!(await page.locator('#detail-proc-reuse-files').innerText()).includes('別人上傳'));
    check(width+' detail evidence starts unselected',!(await detailEvidence.first().isChecked()));
    await capture('procurement-receipt-detail','#detail-proc-actual-amt');

    await run("showApprD(REQS[0])");
    const modalEvidence=page.locator('#proc-reuse-files input[type="checkbox"]');
    check(width+' approval modal uses same own PDF',await modalEvidence.count()===1&&(await page.locator('#proc-reuse-files').innerText()).includes('既有採購發票.pdf'));
    check(width+' approval modal amount also starts blank',(await page.locator('#proc-actual-amt').inputValue())==='');
    check(width+' approval modal evidence starts unselected',!(await modalEvidence.first().isChecked()));
    await capture('procurement-receipt-modal','#proc-actual-amt');
    await run("closeAppr();quickLogin('employee');openDetail('receipt')");
    check(width+' unrelated employee has no receipt submission',await page.locator('#detail-act button').filter({hasText:'提交憑據與實際支出'}).count()===0);
    await run("showApprD(REQS[0])");
    check(width+' unrelated employee has no evidence chooser or modal submission',await page.locator('#proc-reuse-files').count()===0&&await page.locator('#appr-inner button').filter({hasText:'提交憑據發票與實際支出'}).count()===0);
    await run("closeAppr();quickLogin('general_affairs');openDetail('receipt')");

    const surface=width===1440?'detail':'modal';
    if(surface==='modal')await run("showApprD(REQS[0])");
    const amount=page.locator(surface==='detail'?'#detail-proc-actual-amt':'#proc-actual-amt');
    const checkbox=page.locator(surface==='detail'?'#detail-proc-reuse-files input[type="checkbox"]':'#proc-reuse-files input[type="checkbox"]');
    const submit=page.locator(surface==='detail'?'#detail-act button':'#appr-inner button').filter({hasText:surface==='detail'?'提交憑據與實際支出':'提交憑據發票與實際支出'});
    await amount.fill('945.50');
    await submit.click();
    check(width+' unselected existing PDF cannot be submitted',await run('window.__qaWrites.length')===0&&dialogs.some(text=>text.includes('請勾選沿用既有發票憑據')));
    await checkbox.check();
    await submit.click();
    await page.waitForFunction(()=>window.__qaWrites.length===1);
    const committed=await run(`(function(){var w=window.__qaWrites[0],r=REQS.find(x=>x.id==='receipt');return{table:w.table,id:w.id,amount:w.patch.actual_amount,status:w.patch.status,step:w.patch.step,fileCount:w.patch.actual_files.length,paths:w.patch.actual_files.map(x=>x.path),payloadAmount:w.patch.form_payload.purchaseActual.actualAmount,receiptFileCount:w.patch.form_payload.procurementReceiptInfo.fileCount,recordStatus:r.status,recordActual:r.actualAmt,uploads:window.__qaUploads.length,network:window.__qaNetwork.length};})()`);
    check(width+' actual handler commits selected prior PDF and new actual amount',committed.table==='expense_requests'&&committed.id==='receipt'&&committed.amount===945.5&&committed.payloadAmount===945.5&&committed.fileCount===1&&committed.paths[0]==='fixture/own/prior-invoice.pdf'&&committed.receiptFileCount===1);
    check(width+' successful receipt advances to pending voucher',committed.status==='pending_voucher'&&committed.recordStatus==='pending_voucher'&&committed.recordActual===945.5);
    check(width+' selected prior PDF needs no upload or external request',committed.uploads===0&&committed.network===0);
    report[width+'pxCommit']=committed;
    await page.waitForFunction(()=>!document.getElementById('action-feedback')?.classList.contains('show'),null,{timeout:3000});
    await run("closeAppr();quickLogin('accountant');openDetail('missing')");
    check(width+' accountant can act on missing-amount final step',await run("canActRequest(REQS.find(x=>x.id==='missing'))")===true);
    const detailText=await page.locator('#detail-act').innerText();
    check(width+' final detail explains recovery',detailText.includes('請先補齊採購結算資料')&&detailText.includes('總務填寫最終實際金額')&&detailText.includes('沿用既有憑據'));
    check(width+' final detail offers return without unusable posting',await page.locator('#detail-act button').filter({hasText:'退回上一關'}).count()===1&&await page.locator('#detail-act button').filter({hasText:'確認憑據 · 自動切傳票'}).count()===0);
    await capture('procurement-final-recovery-detail','#detail-act [role="status"]');
    await run("showApprD(REQS.find(x=>x.id==='missing'))");
    const modalText=await page.locator('#appr-inner').innerText();
    check(width+' final modal explains recovery',modalText.includes('請先補齊採購結算資料')&&modalText.includes('總務填寫最終實際金額')&&modalText.includes('沿用既有憑據'));
    check(width+' final modal offers return without unusable posting',await page.locator('#appr-inner button').filter({hasText:'退回上一關'}).count()===1&&await page.locator('#appr-inner button').filter({hasText:'確認憑據 · 自動切傳票'}).count()===0);
    await capture('procurement-final-recovery-modal','#appr-inner [role="status"]','請先補齊採購結算資料');
    check(width+' no page exceptions',errors.length===0);
    report[width+'pxDialogs']=dialogs;
    await context.close();
  }
  fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(report,null,2));
  console.log('PASS procurement closeout browser: '+report.checks.length+' checks; '+output);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
});
