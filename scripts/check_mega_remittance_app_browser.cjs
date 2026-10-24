'use strict';
// Actual application routes/renderers + local fictional RPC fixtures. No Google
// account is used and no production request, approval or payment is executed.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(process.env.FINANCE_MEGA_ROOT||path.resolve(__dirname,'..'));
const output=path.resolve(process.env.FINANCE_MEGA_APP_EVIDENCE||'/tmp/finance-mega-app-evidence');
const {applyBuildEnvironment}=require(path.join(root,'scripts/finance_build_environment'));
const playwright=require(require.resolve('playwright',{paths:[root,__dirname]}));
const original=fs.readFileSync(path.join(root,'index.html'),'utf8');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const XLSX_SHA='c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99';
const XLSX_URL='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
const anchor='bootAuthGate();\n\n})();';
assert.ok(original.includes(anchor),'local QA hook anchor exists');
let html=applyBuildEnvironment(original,{target:'local',supabaseUrl:'',supabaseAnonKey:''}).replace(anchor,'window.__megaAppQA={run:async function(code){return await eval(code);}};\n'+anchor).replace(/<script\b[^>]*src=["']https?:[^>]*><\/script>/gi,'').replace('</head>','<script src="/__qa/xlsx.js"></script></head>');
let xlsxBytes,XLSX,server,checks=0;const results=[];
function ok(value,label){assert.ok(value,label);checks++;console.log('ok '+checks+' - '+label);}
function equal(actual,expected,label){assert.deepEqual(actual,expected,label);checks++;console.log('ok '+checks+' - '+label);}
async function xlsxDependency(){
  const filename=process.env.FINANCE_MEGA_XLSX_PATH||path.join(os.tmpdir(),'finance-mega-xlsx-0.18.5.cjs');
  if(!fs.existsSync(filename)){
    if(process.env.FINANCE_MEGA_XLSX_PATH)throw Error('FINANCE_MEGA_XLSX_PATH does not exist');
    const response=await fetch(XLSX_URL,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Pinned XLSX test dependency download failed');
    const bytes=Buffer.from(await response.arrayBuffer());assert.equal(sha(bytes),XLSX_SHA,'downloaded XLSX matches fixed dependency hash');fs.writeFileSync(filename,bytes,{mode:0o600});
  }
  xlsxBytes=fs.readFileSync(filename);assert.equal(sha(xlsxBytes),XLSX_SHA,'XLSX test dependency matches fixed hash');XLSX=require(filename);
}
function rawRequest(kind='bulk'){
  const request={id:'qa-mega-'+kind,no:'QA-MEGA-'+kind.toUpperCase(),type:'payment_request',entity_id:'QA-F1',department_code:'QA-D1',applicant:'虛構申請人',applicant_id:'qa-employee',applicant_email:'qa.employee@example.invalid',amount:1200,estimated_amount:1200,description:'虛構兆豐匯款整合驗收',status:'pending_cashier',step:3,ver:1,request_date:'2026-10-18',created_at:'2026-10-18T01:00:00Z',expected_pay_date:'2026-10-20',bank_type:'mega',bank_name:'017 兆豐銀行',bank_no:'000000001234',bank_fee_amount:0,fee_bearer:'己方支出',payee:'虛構收款戶名甲',debit_account:'6299',debit_account_name:'其他費用',credit_account:'1112',credit_account_name:'銀行存款',files:[],actual_files:[],form_payload:{paymentType:'bank',_submissionPayloadSha256V3:'a'.repeat(64)},steps:[{rk:'applicant_submit',uid:'qa-employee',n:'虛構申請人',a:'approved',t:'2026-10-18T00:00:00Z'},{rk:'ceo',uid:'qa-ceo',n:'虛構主管',a:'approved',t:'2026-10-18T00:01:00Z'},{rk:'cashier',uid:'qa-cashier',n:'虛構出納',a:''}],data_environment:'test'};
  if(kind==='payroll'){
    request.type='hr_expense_request';request.amount=request.estimated_amount=3500;request.form_payload.hrItem='salary_50';
    request.form_payload.hrInfo={item:{id:'salary_50'},paymentTotal:3500,total:3500,rows:[{name:'虛構薪轉甲',identityNo:'A000000000',bankCode:'017',account:'000000001234',amount:1200},{name:'虛構薪轉乙',identityNo:'B000000000',bankCode:'0040001',account:'000000005678',amount:2300}]};
  }
  if(kind==='refund'){
    request.type='refund_request';request.amount=request.estimated_amount=1800;request.form_payload.refundInfo={rows:[{accountName:'虛構退費甲',accountNo:'000000001234',bankCode:'0170000',refundAmount:1200,method:'銀行轉帳'},{accountName:'虛構現金乙',refundAmount:600,method:'現金'}]};
  }
  return request;
}
const fixtureSetup=`(async function(){
  window.__qaReads=[];window.__qaWrites=[];window.__qaNetwork=[];window.__qaSupplements=[];window.__qaSnapshot=null;window.__qaDenied=false;window.__qaRpcCode='';window.__qaPurpose='payment';window.__qaReason='';
  window.fetch=function(input){window.__qaNetwork.push(String(input));return Promise.reject(new Error('Fixture does not access production'));};
  USERS=[
    {id:'qa-employee',authUserId:'qa-auth-employee',init:'虛',n:'虛構申請人',email:'qa.employee@example.invalid',role:'employee',rL:'一般組員',eid:'QA-F1',dc:'QA-D1',active:true},
    {id:'qa-ceo',authUserId:'qa-auth-ceo',init:'虛',n:'虛構主管',email:'qa.ceo@example.invalid',role:'ceo',rL:'執行長',eid:'QA-F1',dc:'QA-D1',active:true},
    {id:'qa-cashier',authUserId:'qa-auth-cashier',init:'虛',n:'虛構出納',email:'qa.cashier@example.invalid',role:'cashier',rL:'出納',eid:'QA-F1',dc:'QA-D1',active:true}
  ];
  ENTS=[{id:'QA-F1',n:'虛構付款公司',s:'虛構付款公司',active:true}];DEPTS=[{c:'QA-D1',n:'虛構部門',eid:'QA-F1',lv:4,active:true}];
  ORG_CHART=[];REQS=[];INVS=[];BILLS=[];VOUCHERS=[];NOTIFS=[];BANK_TRANSFER_FEES={'QA-F1':15};
  // Hold only the real workspace's initial navigation frame. Delivering it
  // after form entry makes a slow-browser initialization race deterministic.
  window.__qaHeldWorkspaceNavigation=[];
  var workspaceRaf=window.requestAnimationFrame;
  window.requestAnimationFrame=function(callback){
    if(callback.name==='openTarget')return workspaceRaf(function(){window.__qaHeldWorkspaceNavigation.push(callback);});
    return workspaceRaf(callback);
  };
  try{quickLogin('employee');}finally{window.requestAnimationFrame=workspaceRaf;}
  S.demoLogin=false;CURRENT_PERMISSION_SNAPSHOT={loaded:false,authUserId:'qa-auth-employee',membershipUserId:'qa-employee',primaryRoleCode:'',roleCodes:[],permissions:[],error:''};
  financeUsersDirectoryAuthUserId='qa-auth-employee';financeUsersDirectoryReadyAt='2026-10-18T00:00:00Z';
  setFinanceWorkspaceIdentityBlocked(false);hasSupabase=function(){return true;};
  var mock={rpc:async function(name,args){
    if(name==='finance_remittance_export_snapshot_v1'){
      window.__qaReads.push({name:name,id:args.p_request_id,environment:args.p_data_environment});
      if(window.__qaDenied)return {data:null,error:{code:'42501'}};
      if(window.__qaRpcCode)return {data:null,error:{code:window.__qaRpcCode}};
      if(['waiting','unavailable'].includes(window.__qaPurpose))return {data:{ok:true,requestId:window.__qaSnapshot.id,stage:window.__qaSnapshot.status,exportPurpose:window.__qaPurpose,reason:window.__qaReason,sourceVersion:window.__qaSnapshot.ver,sourceDigest:'opaque-qa-digest-'+window.__qaSnapshot.ver,submittedAt:window.__qaSnapshot.created_at,submissionSource:'server_created_at',historyCutoff:'2026-09-30T16:00:00Z'},error:null};
      return {data:{ok:true,exportPurpose:window.__qaPurpose,reasonCode:window.__qaReason,submittedAt:window.__qaSnapshot.created_at,submissionSource:'server_created_at',historyCutoff:'2026-09-30T16:00:00Z',paidAt:window.__qaSnapshot.cash_posted_at||'',sourceBasis:window.__qaPurpose==='historical'?'current_saved_reconstruction':'approved_payment',request:structuredClone(window.__qaSnapshot),sourceVersion:window.__qaSnapshot.ver,sourceDigest:'opaque-qa-digest-'+window.__qaSnapshot.ver,supplements:structuredClone(window.__qaSupplements),canSupplement:true},error:null};
    }
    if(name==='finance_remittance_export_supplement_save_v1'){
      window.__qaWrites.push({name:name,rows:structuredClone(args.p_rows),digest:args.p_expected_digest});
      if(args.p_expected_digest!=='opaque-qa-digest-'+window.__qaSnapshot.ver)return {data:null,error:{code:'40001'}};
      window.__qaSupplements=structuredClone(args.p_rows);window.__qaSnapshot.ver++;return {data:{ok:true},error:null};
    }
    if(/act_|approve|submit|confirm|finaliz|insert|update|delete|upsert|post_|pay_|disburs|withdraw|save_/i.test(name)){window.__qaWrites.push({name:name});throw Error('Unexpected financial mutation');}
    return {data:[],error:null};
  },from:function(table){
    var query={then:function(resolve,reject){return Promise.resolve({data:[],error:null,count:0}).then(resolve,reject);}};
    ['select','eq','neq','is','in','or','order','limit','range','maybeSingle','single','gte','lte','lt','gt','contains','not','match'].forEach(function(method){query[method]=function(){return query;};});
    ['insert','update','upsert','delete'].forEach(function(method){query[method]=function(){window.__qaWrites.push({table:table,method:method});throw Error('Unexpected database mutation');};});return query;
  }};
  getSb=function(){return mock;};
})()`;

async function browserCase(engine,width,origin){
  const browser=await playwright[engine].launch({headless:true});
  let page,downloadInteraction=null;const errors=[],dialogs=[];
  try{
    const context=await browser.newContext({viewport:{width,height:width<600?844:1000},acceptDownloads:true});
    await context.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===origin||url.protocol==='blob:'||url.protocol==='data:'?route.continue():route.abort();});
    page=await context.newPage();page.setDefaultTimeout(15000);
    page.on('pageerror',error=>errors.push(error.message));page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.dismiss();});
    await page.goto(origin);await page.waitForFunction(()=>window.__megaAppQA&&window.XLSX);
    const scope=code=>page.evaluate(value=>window.__megaAppQA.run(value),code);
    await scope(fixtureSetup);
    await page.waitForFunction(()=>window.__qaHeldWorkspaceNavigation.length===1);
    // These fixtures contain invented identities/accounts only. Keep a bounded
    // event trail so a platform-specific failure explains what the real DOM did.
    await page.evaluate(()=>{
      window.__qaMegaEvents=[];
      for(const type of ['focusin','focusout','input','change','pointerdown','pointerup','click','submit','invalid'])document.addEventListener(type,event=>{
        const target=event.target;if(!(target instanceof Element)||!target.closest('.finance-mega-remittance'))return;
        window.__qaMegaEvents.push({type,tag:target.tagName,id:target.id,name:target.getAttribute('name'),action:target.getAttribute('data-mega-action'),value:target instanceof HTMLInputElement?target.value:null,prevented:event.defaultPrevented,time:Math.round(performance.now())});
        if(window.__qaMegaEvents.length>50)window.__qaMegaEvents.shift();
      },true);
    });
    const importLabel=engine+'/'+width+'/bank-code-import';
    const importRows=async rows=>scope(`(async function(){
      var book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(${JSON.stringify(rows)}),'工作表1');
      var file=new File([XLSX.write(book,{type:'array',bookType:'xlsx'})],'fictional-codes.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      try{var values=hrNormalizeTransferRows(hrRowsFromTableRows(await readSpreadsheetRows(file),file.name));return {rows:values,issues:values.map(hrTransferBankCodes)};}catch(error){return {error:error.message};}
    })()`);

    ok(await scope('canAccessPage("newreq")'),importLabel+' fixture role may enter the normal application form');
    await scope(`(async function(){
      closeAppr();closeModal('m-detail');clearFinanceMegaRemittance();
      await nav('newreq',null);
    })()`);
    await page.locator('#nr-content button[onclick=\'nrT("hr_expense_request")\']').click();
    equal(await scope('({type:S.nrType,item:S.hrItem,payment:S.nrPay,privacy:S.hrPrivacyMode})'),{type:'hr_expense_request',item:'salary_50',payment:'bank',privacy:true},importLabel+' visible request-type control opens the permitted salary import form');
    const imported=await scope(`(async function(){
      var source=[['序位','銀行別','銀行代號','分行名稱','銀行帳號','金額','備註'],['1','臺灣銀行','0040123','虛構分行','000000001234',1200,'虛構資料']];
      var book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(source),'工作表1');
      var file=new File([XLSX.write(book,{type:'array',bookType:'xlsx'})],'fictional-transfer.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      var parsed=await readSpreadsheetRows(file);S.hrRows=hrNormalizeTransferRows(hrRowsFromTableRows(parsed,file.name));
      renderNR();document.querySelectorAll('#nr-content details').forEach(function(node){node.open=true;});renderHrExpenseSheet();
      return {rows:structuredClone(S.hrRows),repeated:hrNormalizeTransferRows(S.hrRows),sheetColumns:hrSheetCols(S.hrRows)};
    })()`);
    ok(await scope('hasUnsavedNewReqChanges()'),importLabel+' imported form is dirty before the delayed initial navigation arrives');
    await page.evaluate(()=>window.__qaHeldWorkspaceNavigation.shift()(performance.now()));
    equal(await scope('S.page'),'newreq',importLabel+' stale login navigation cannot replace the form entered through real navigation');
    equal(await page.locator('#m-leave-guard[open]').count(),0,importLabel+' delayed login frame cannot open an unrelated leave confirmation');
    equal(await scope('structuredClone(S.hrRows)'),imported.rows,importLabel+' delayed login frame preserves all imported form rows');
    equal(imported.rows[0]['銀行代號'],'004',importLabel+' real XLSX importer retains canonical 3 digit bank');
    equal(imported.rows[0]['分行代號'],'0123',importLabel+' real XLSX importer preserves leading-zero branch separately');
    equal(imported.rows[0]['銀行帳號'],'000000001234',importLabel+' bank-code processing leaves account unchanged');
    equal(imported.rows[0]['金額'],1200,importLabel+' bank-code processing leaves principal unchanged');
    equal(imported.rows[0]['姓名'],'',importLabel+' privacy import keeps payee name blank');
    equal(imported.repeated,imported.rows,importLabel+' repeated normalization is lossless and stable');
    equal(imported.sheetColumns.length,7,importLabel+' existing transfer table remains seven columns');
    for(const layout of [
      [['1','臺灣銀行','0040123','虛構分行','000000001234',1200,'虛構備註']],
      [['虛構公司','虛構代碼','虛構部門','臺灣銀行','虛構分行','0040123','0123','000000001234',1200]]
    ]){
      const legacy=await importRows(layout);equal(legacy.rows[0]['銀行代號'],'004',importLabel+' existing headerless '+layout[0].length+'-column import retains bank');
      equal(legacy.rows[0]['分行代號'],'0123',importLabel+' existing headerless '+layout[0].length+'-column import retains full branch');
      equal(legacy.rows[0]['銀行帳號'],'000000001234',importLabel+' existing headerless '+layout[0].length+'-column import leaves account unchanged');
      equal(legacy.rows[0]['金額'],1200,importLabel+' existing headerless '+layout[0].length+'-column import leaves amount unchanged');
      equal(legacy.rows[0]['姓名'],'',importLabel+' existing headerless '+layout[0].length+'-column import keeps privacy');
    }
    const duplicateBank=await importRows([['銀行代碼','銀行代號','銀行帳號','金額'],['0040123','0040222','000000001234',1200]]);
    equal(duplicateBank.rows[0]['銀行代號'],'0040222',importLabel+' real XLSX keeps explicitly provided canonical bank code');
    equal(duplicateBank.rows[0]['銀行代碼'],'0040123',importLabel+' real XLSX retains conflicting alias instead of overwriting canonical');
    ok(Boolean(duplicateBank.issues[0].error),importLabel+' true bank-code column conflict blocks validation');
    const duplicateBranch=await importRows([['銀行代號','分行代碼','分行代號','銀行帳號','金額'],['004','0123','0222','000000001234',1200]]);
    equal(duplicateBranch.rows[0]['分行代號'],'0222',importLabel+' real XLSX retains canonical conflicting branch');
    equal(duplicateBranch.rows[0]['分行代碼'],'0123',importLabel+' real XLSX retains original conflicting branch alias');
    ok(Boolean(duplicateBranch.issues[0].error),importLabel+' true branch-code column conflict blocks validation');
    const blankCanonical=await importRows([['銀行代碼','銀行代號','銀行帳號','金額'],['0040123','','000000001234',1200]]);
    equal(blankCanonical.rows[0]['銀行代號'],'004',importLabel+' blank canonical field accepts a single explicit alias');
    equal(blankCanonical.rows[0]['分行代號'],'0123',importLabel+' single explicit alias retains branch when canonical was blank');
    const identicalHeader=await importRows([['銀行代號','銀行代號','銀行帳號','金額'],['0040123','0040222','000000001234',1200]]);
    ok(Boolean(identicalHeader.error&&identicalHeader.error.includes('重複欄名')),importLabel+' duplicate bank headers with differing values cannot lose either value silently');
    const blankDuplicate=await importRows([['銀行代碼','銀行代號','銀行代號','銀行帳號','金額'],['0040123','0040222','','000000001234',1200]]);
    equal(blankDuplicate.rows[0]['銀行代號'],'0040222',importLabel+' later blank duplicate cannot erase a conflicting canonical bank code');
    equal(blankDuplicate.rows[0]['銀行代碼'],'0040123',importLabel+' earlier bank alias survives a blank duplicate canonical column');
    ok(Boolean(blankDuplicate.issues[0].error),importLabel+' conflict survives trailing blank duplicate headers');
    for(const header of ['BankCode','BANK CODE','銀行 代碼']){
      const caseAlias=await importRows([['銀行代號',header,'銀行帳號','金額'],['0040123','0040222','000000001234',1200]]);
      ok(Boolean(caseAlias.error||(caseAlias.issues&&caseAlias.issues[0].error)),importLabel+' recognized header variant cannot hide a second bank code '+header);
    }
    const blankBranchDuplicate=await importRows([['銀行代號','分行代碼','分行代號','分行代號','銀行帳號','金額'],['004','0123','0222','','000000001234',1200]]);
    equal(blankBranchDuplicate.rows[0]['分行代號'],'0222',importLabel+' later blank branch duplicate cannot erase the conflicting supplied branch');
    ok(Boolean(blankBranchDuplicate.issues[0].error),importLabel+' branch conflict survives a trailing blank duplicate');

    const zeroCanonical=await importRows([['銀行代碼','銀行代號','銀行帳號','金額'],['0040123',0,'000000001234',1200]]);
    equal(zeroCanonical.rows[0]['銀行代號'],'0',importLabel+' real XLSX zero code is preserved as supplied instead of becoming blank');
    ok(Boolean(zeroCanonical.issues[0].error),importLabel+' zero canonical bank code is rejected instead of replaced');

    await page.getByLabel('第 1 列銀行代號',{exact:true}).waitFor();
    equal(await page.getByLabel('第 1 列分行代號',{exact:true}).inputValue(),'0123',importLabel+' preserved branch can be inspected and corrected');
    equal(await page.locator('#hr-expense-sheet [data-hr-col="姓名"]').count(),0,importLabel+' private name is not exposed in transfer table');
    const importGeometry=await page.locator('#hr-expense-sheet .hr-sheet-scroll').evaluate(element=>{const rect=element.getBoundingClientRect();return {left:rect.left,right:rect.right,viewport:innerWidth};});
    ok(importGeometry.left>=-1&&importGeometry.right<=width+1,importLabel+' dense transfer table remains inside its scroll container');
    await page.getByLabel('第 1 列分行代號',{exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,engine+'-'+width+'-bank-code-import.png')});
    equal(await scope("window.__qaWrites.filter(function(write){return write.table!=='compliance_audit_logs'||write.method!=='insert';})"),[],importLabel+' opening the form only attempts its existing compliance audit, never a payment write');
    await page.getByLabel('第 1 列銀行代號',{exact:true}).fill('0040222');await page.getByLabel('第 1 列銀行代號',{exact:true}).press('Tab');
    await page.locator('#hr-bank-code-0-error').waitFor();
    ok((await page.locator('#hr-bank-code-0-error').innerText()).includes('末 4 碼'),importLabel+' conflicting full code and branch get an actionable visible error');
    equal(await page.getByLabel('第 1 列銀行代號',{exact:true}).inputValue(),'0040222',importLabel+' conflict retains supplied full code');
    equal(await page.getByLabel('第 1 列分行代號',{exact:true}).inputValue(),'0123',importLabel+' conflict retains supplied separate branch');
    ok((await scope('collectHrExpenseInfo().missing')).some(message=>message.includes('末 4 碼')),importLabel+' actual form collector blocks conflicting submission');
    await page.locator('#hr-bank-code-0-error').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,engine+'-'+width+'-bank-code-conflict.png')});
    const conflicted=await scope('structuredClone(S.hrRows)');
    await page.getByLabel('第 1 列分行代號',{exact:true}).fill('0222');await page.getByLabel('第 1 列分行代號',{exact:true}).press('Tab');
    equal(await page.locator('#hr-bank-code-0-error').count(),0,importLabel+' explicitly correcting branch clears conflict');
    equal(await scope('S.hrRows[0]["銀行代號"]'),'004',importLabel+' corrected row restores canonical bank code');
    equal(await scope('S.hrRows[0]["分行代號"]'),'0222',importLabel+' corrected row retains confirmed branch');
    await scope('S.hrRows[0].bank_code="0040222";renderHrExpenseSheet();');
    await page.getByLabel('第 1 列分行代號',{exact:true}).fill('0333');await page.getByLabel('第 1 列分行代號',{exact:true}).press('Tab');
    equal(await page.locator('#hr-bank-code-0-error').count(),0,importLabel+' confirmed branch edits clear only previously equivalent hidden bank aliases');
    equal(await scope('S.hrRows[0]["分行代號"]'),'0333',importLabel+' confirmed new branch remains editable after alias import');
    await scope('S.hrRows[0].bank_code="0070999";renderHrExpenseSheet();');
    await page.getByLabel('第 1 列分行代號',{exact:true}).fill('0444');await page.getByLabel('第 1 列分行代號',{exact:true}).press('Tab');
    ok(Boolean(await scope('hrTransferBankCodes(S.hrRows[0]).error')),importLabel+' editing a branch cannot hide preexisting conflicting bank identities');
    equal(await scope('S.hrRows[0].bank_code'),'0070999',importLabel+' genuinely conflicting bank alias remains available for correction');
    await page.getByLabel('第 1 列銀行代號',{exact:true}).fill('007');await page.getByLabel('第 1 列銀行代號',{exact:true}).press('Tab');
    equal(await scope('S.hrRows[0]["分行代號"]'),'',importLabel+' switching banks discards the previous bank branch');
    await scope('S.hrRows[0]["銀行代號"]="invalid";S.hrRows[0]["分行代號"]="0999";renderHrExpenseSheet();');
    await page.getByLabel('第 1 列銀行代號',{exact:true}).fill('004');await page.getByLabel('第 1 列銀行代號',{exact:true}).press('Tab');
    equal(await scope('S.hrRows[0]["分行代號"]'),'',importLabel+' correcting an invalid bank never reuses its ambiguous old branch');
    for(const value of ['銀行代號：0040123','(0040123)','004','0040123']){
      const normalized=await scope('hrNormalizeTransferBankRow({銀行代號:'+JSON.stringify(value)+',銀行帳號:"000000001234",金額:1200},0)');
      equal(normalized['銀行代號'],'004',importLabel+' explicit code preserves canonical bank '+JSON.stringify(value));
      equal(normalized['分行代號'],value==='004'?'':'0123',importLabel+' explicit code preserves full branch '+JSON.stringify(value));
    }
    for(const value of [40123,'004012','00401234','0040123\n','0040123\r','004 0123','004-0123','004/0123','銀行代號：0040123 0070999']){
      ok(Boolean(await scope('hrTransferBankCodes({銀行代號:'+JSON.stringify(value)+'}).error')),importLabel+' ambiguous or malformed bank code is not guessed '+JSON.stringify(value));
    }
    // Finish editing the imported form before entering approval. A native leave
    // dialog is top-layer UI; bypassing navigation can strand it over the modal.
    ok(await scope('hasUnsavedNewReqChanges()'),importLabel+' edited import remains protected by the real unsaved-form guard');
    await page.locator('#pg-newreq button[onclick="newReqBack()"]').click();
    const leaveDialog=page.locator('#m-leave-guard');
    await leaveDialog.waitFor({state:'visible'});
    ok(await leaveDialog.evaluate(dialog=>dialog.open),importLabel+' real back button opens the native leave confirmation');
    await leaveDialog.getByRole('button',{name:'不暫存，直接離開',exact:true}).click();
    await leaveDialog.waitFor({state:'hidden'});
    await page.waitForFunction(()=>window.__megaAppQA.run('S.nrStep===1&&S.nrType===null&&S.hrRows.length===0'));
    equal(await scope('hasUnsavedNewReqChanges()'),false,importLabel+' explicit discard resets the form through the normal application flow');
    if(width<600)await page.locator('[data-mobile-bottom-nav] [data-mobile-primary-action="dashboard"]').click();
    else await page.locator('#sidebar button[onclick="nav(\'dashboard\',this)"]').click();
    await page.waitForFunction(()=>document.querySelector('#pg-dashboard')?.classList.contains('on'));
    equal(await leaveDialog.evaluate(dialog=>({open:dialog.open,visible:getComputedStyle(dialog).display!=='none',resolverPending:typeof window.__leaveGuardResolve==='function'})),{open:false,visible:false,resolverPending:false},importLabel+' navigation completes with no leave dialog or unresolved confirmation');
    // The import is an employee action; bank export is a separate cashier
    // fixture after the employee has left the form through the real UI.
    await scope(`(function(){S.user=USERS.find(function(user){return user.role==='cashier';});CURRENT_PERMISSION_SNAPSHOT={loaded:false,authUserId:'qa-auth-cashier',membershipUserId:'qa-cashier',primaryRoleCode:'',roleCodes:[],permissions:[],error:''};financeUsersDirectoryAuthUserId='qa-auth-cashier';applyRolePermissions();window.__qaWrites=[];})()`);
    const validRequest=rawRequest('payroll');validRequest.amount=validRequest.estimated_amount=1200;
    validRequest.form_payload.hrInfo={item:{id:'salary_50'},paymentTotal:1200,total:1200,rows:imported.rows};
    await scope(`(function(){window.__qaSnapshot=${JSON.stringify(validRequest)};window.__qaSnapshot.tenant_id=currentTenantId();window.__qaSupplements=[{rowKey:'hr:1',name:'虛構私有戶名'}];window.__qaPurpose='payment';window.__qaReason='';REQS=[mapReq(structuredClone(window.__qaSnapshot))];showApprD(REQS[0]);})()`);
    let importPanel=page.locator('#appr-inner .finance-mega-remittance');
    await importPanel.locator('[data-mega-action="download"]').waitFor();
    const importBefore=await scope('JSON.stringify(window.__qaSnapshot)');
    const importDownloadButton=importPanel.getByRole('button',{name:'下載 Excel',exact:true});
    await importDownloadButton.scrollIntoViewIfNeeded();
    ok(await importDownloadButton.evaluate(button=>{const rect=button.getBoundingClientRect(),hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);return !!hit&&(hit===button||button.contains(hit));}),importLabel+' approval download is reachable without a top-layer pointer blocker');
    equal(await page.locator('#m-leave-guard[open]').count(),0,importLabel+' approval opens only after unsaved-form confirmation has closed');
    downloadInteraction={scenario:importLabel,click:'pending',download:'pending'};
    // Observe both promises immediately: an actionability failure must reach the
    // diagnostic catch instead of leaving the download timeout unhandled.
    const [importDownload]=await Promise.all([
      page.waitForEvent('download').then(download=>{downloadInteraction.download='received';return download;},error=>{downloadInteraction.download='failed';throw error;}),
      importPanel.getByRole('button',{name:'下載 Excel',exact:true}).click().then(()=>{downloadInteraction.click='resolved';},error=>{downloadInteraction.click='failed';downloadInteraction.clickError=error.message;throw error;})
    ]);
    const importBook=XLSX.read(fs.readFileSync(await importDownload.path()),{type:'buffer',cellText:false}),importSheet=importBook.Sheets[importBook.SheetNames[0]];
    equal(importSheet.D2.v,'0040123',importLabel+' actual downloaded salary Excel reassembles all seven code digits');
    equal(importSheet.D2.t,'s',importLabel+' salary bank branch remains an Excel text cell');
    equal(importSheet.E2.v,'000000001234',importLabel+' actual salary download preserves leading-zero account');
    equal(importSheet.F2.v,1200,importLabel+' actual salary download keeps principal unchanged');
    equal(await scope('JSON.stringify(window.__qaSnapshot)'),importBefore,importLabel+' download never rewrites approved source');
    equal(await scope('window.__qaWrites.length'),0,importLabel+' import preview and bank export cause no financial mutation');
    await scope('closeAppr();');
    validRequest.form_payload.hrInfo.rows=conflicted;
    await scope(`(function(){window.__qaSnapshot=${JSON.stringify(validRequest)};window.__qaSnapshot.tenant_id=currentTenantId();REQS=[mapReq(structuredClone(window.__qaSnapshot))];showApprD(REQS[0]);})()`);
    await page.waitForFunction(()=>document.querySelector('#appr-inner .finance-mega-remittance')?.dataset.megaState==='missing');
    equal(await page.locator('#appr-inner [data-mega-action="download"]').count(),0,importLabel+' raw conflicting source has no downloadable file without relying on a client marker');
    await scope('closeAppr();');
    await scope('window.__qaSupplements=[];window.__qaWrites=[];');
    results.push({engine,width,kind:'bank-code-import',view:'actual-XLSX-form-and-approval',geometry:importGeometry,filename:importDownload.suggestedFilename()});
    for(const kind of ['bulk','payroll','refund'])for(const view of ['detail','approval']){
      const label=engine+'/'+width+'/'+kind+'/'+view,data=rawRequest(kind);
      await scope(`(function(){closeAppr();clearFinanceMegaRemittance();window.__qaDenied=false;window.__qaSupplements=[];window.__qaSnapshot=${JSON.stringify(data)};window.__qaSnapshot.tenant_id=currentTenantId();REQS=[mapReq(structuredClone(window.__qaSnapshot))];})()`);
      const before=await scope('JSON.stringify(REQS[0])');
      await scope(view==='detail'?'openDetail(REQS[0].id);':'showApprD(REQS[0]);');
      const host=view==='detail'?'#detail-body':'#appr-inner',panel=page.locator(host+' .finance-mega-remittance');
      await panel.locator('[data-mega-action="download"]').waitFor();
      ok(await panel.isVisible(),label+' real renderer automatically mounts a ready bank file');
      const state=await scope('FINANCE_MEGA_REMITTANCE_VIEWS['+JSON.stringify(view)+'].getState()');
      equal(state.totalAmount,kind==='payroll'?3500:1200,label+' amount uses resolved bank principal');
      equal(state.paymentCount,kind==='payroll'?2:1,label+' row count preserves approved source items');
      equal(await scope('S.demoLogin'),false,label+' runs the production-style identity path, not demo export');
      await panel.scrollIntoViewIfNeeded();
      const geometry=await panel.evaluate(element=>{const box=element.getBoundingClientRect();return {left:box.left,right:box.right,scroll:element.scrollWidth,client:element.clientWidth,viewport:innerWidth};});
      ok(geometry.left>=-1&&geometry.right<=width+1&&geometry.scroll<=geometry.client+1,label+' panel fits viewport without clipping');
      const readBefore=await scope('window.__qaReads.length');
      const downloadEvent=page.waitForEvent('download');await panel.getByRole('button',{name:'下載 Excel',exact:true}).click();const download=await downloadEvent;
      const downloadPath=await download.path();const book=XLSX.read(fs.readFileSync(downloadPath),{type:'buffer',cellText:false});
      equal(await scope('window.__qaReads.length'),readBefore+1,label+' actual download performs a fresh authorized RPC');
      equal(book.SheetNames,['工作表1'],label+' XLSX has exactly the required worksheet');
      const sheet=book.Sheets[book.SheetNames[0]],rows=XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:null});
      if(kind==='payroll'){
        equal(rows[0],['HEADER','收款人姓名','存款人身份證號','轉入銀行代號','轉入帳號','付款金額'],label+' salary header matches provided format');
        equal(rows[3].slice(0,5),['TRAILER','PAYMENT總筆數',2,'PAYMENT總金額',3500],label+' salary trailer matches count and principal');
        equal(sheet.E2.v,'000000001234',label+' salary leading-zero account is preserved');equal(sheet.E2.t,'s',label+' salary account remains an Excel text cell');
      }else{
        equal(rows[0],['戶名','金額','銀行代號','帳號'],label+' bulk header matches provided format');
        equal(rows.length,2,label+' cash rows and metadata do not become extra bank payment rows');
        equal(sheet.D2.v,'000000001234',label+' bulk leading-zero account is preserved');equal(sheet.D2.t,'s',label+' bulk account remains an Excel text cell');
      }
      equal(await scope('JSON.stringify(REQS[0])'),before,label+' preparation and download do not mutate approved request');
      equal(await scope('window.__qaWrites.length'),0,label+' no approval, payment or database mutation occurs');
      if(kind==='payroll')await page.screenshot({path:path.join(output,[engine,width,kind,view].join('-')+'.png')});
      if(view==='approval'){await scope('closeAppr();');equal(await scope('!!FINANCE_MEGA_REMITTANCE_VIEWS.approval'),false,label+' closing approval modal clears private file');}
      else{await scope("nav('dashboard',null);");equal(await scope('!!FINANCE_MEGA_REMITTANCE_VIEWS.detail'),false,label+' leaving detail clears private file');}
      results.push({engine,width,kind,view,geometry,filename:download.suggestedFilename()});
    }
    for(const kind of ['bulk','payroll','refund'])for(const view of ['detail','approval']){
      const label=engine+'/'+width+'/historical-'+kind+'/'+view,data=rawRequest(kind);
      data.status='completed';data.request_date='2026-09-01';data.cash_posted_at='2026-10-18T03:00:00Z';data.form_payload.cashAmount=data.amount+data.bank_fee_amount;
      data.steps[2].a='approved';data.steps[2].t=data.cash_posted_at;data.ledger_posted_at='2026-10-18T04:00:00Z';data.posting_locked_at=data.ledger_posted_at;data.voucher_id='qa-paid-voucher';
      await scope(`(function(){closeAppr();clearFinanceMegaRemittance();window.__qaDenied=false;window.__qaPurpose='historical';window.__qaReason='';window.__qaSupplements=[];window.__qaSnapshot=${JSON.stringify(data)};window.__qaSnapshot.tenant_id=currentTenantId();REQS=[mapReq(structuredClone(window.__qaSnapshot))];})()`);
      const before=await scope('JSON.stringify(REQS[0])');
      await scope(view==='detail'?'openDetail(REQS[0].id);':'showApprD(REQS[0]);');
      const host=view==='detail'?'#detail-body':'#appr-inner',panel=page.locator(host+' .finance-mega-remittance');
      await page.waitForFunction(selector=>document.querySelector(selector)?.dataset.megaState==='ready',host+' .finance-mega-remittance');
      const historyButton=panel.getByRole('button',{name:'下載歷史 Excel',exact:true}),ack=panel.getByRole('checkbox',{name:'已知為已付款歷史檔，不會再次送銀行匯款'});
      ok(await historyButton.isDisabled(),label+' actual history download is disabled until explicit acknowledgement');
      ok((await panel.innerText()).includes('並非當時實際送銀行的原始檔'),label+' does not misrepresent reconstruction as an original bank file');
      ok(!(await panel.innerText()).includes('銀行系統檢核及執行匯款'),label+' does not invite another payment');
      const oldReads=await scope('window.__qaReads.length');await scope('FINANCE_MEGA_REMITTANCE_VIEWS['+JSON.stringify(view)+'].download()');
      equal(await scope('window.__qaReads.length'),oldReads,label+' direct API invocation cannot skip acknowledgement');
      await panel.scrollIntoViewIfNeeded();
      const geometry=await panel.evaluate(element=>{const box=element.getBoundingClientRect();return {left:box.left,right:box.right,scroll:element.scrollWidth,client:element.clientWidth};});
      ok(geometry.left>=-1&&geometry.right<=width+1&&geometry.scroll<=geometry.client+1,label+' warning and consent fit desktop and narrow viewport');
      await ack.check();const event=page.waitForEvent('download');await historyButton.click();const downloaded=await event;
      equal(await scope('window.__qaReads.length'),oldReads+1,label+' history download rechecks server authority');
      ok(downloaded.suggestedFilename().startsWith('已付款_歷史補檔_勿重複匯款_兆豐_'),label+' saved filename clearly prevents confusion with payable file');
      const book=XLSX.read(fs.readFileSync(await downloaded.path()),{type:'buffer'}),sheet=book.Sheets['工作表1'];
      equal(book.SheetNames,['工作表1'],label+' historical file retains required bank worksheet only');
      equal(kind==='payroll'?sheet.E2.v:sheet.D2.v,'000000001234',label+' historical account text remains intact');
      equal(kind==='payroll'?sheet.F2.v:sheet.B2.v,1200,label+' historical principal excludes cash rows and fees');
      equal(await scope('JSON.stringify(REQS[0])'),before,label+' historical read and download never update payment or approval');
      equal(await scope('window.__qaWrites.length'),0,label+' historical download performs no write');
      if(kind==='payroll')await page.screenshot({path:path.join(output,[engine,width,'historical',view].join('-')+'.png')});
      if(kind==='bulk'&&view==='approval'){
        await scope('window.__qaSnapshot.ver++;');await historyButton.click();await page.waitForFunction(()=>document.querySelector('#appr-inner .mega-body')?.getAttribute('aria-busy')==='false');
        await page.waitForFunction(()=>document.querySelector('#appr-inner [data-mega-state="ready"]'));
        ok(!await ack.isChecked()&&await historyButton.isDisabled(),label+' changed historical source requires fresh acknowledgement');
        await ack.check();await scope('window.__qaDenied=true;');await historyButton.click();await page.waitForFunction(()=>document.querySelector('#appr-inner [data-mega-state="denied"]'));
        equal(await panel.locator('[data-mega-action="download"]').count(),0,label+' revoked historical authority removes download');
        ok(!(await panel.innerText()).includes('NT$'),label+' revoked historical authority clears old amount');
        await scope('window.__qaDenied=false;');
      }
      if(view==='approval'){await scope('closeAppr();');equal(await scope('!!FINANCE_MEGA_REMITTANCE_VIEWS.approval'),false,label+' close removes historical bytes and consent');}
      else{await scope("nav('dashboard',null);");equal(await scope('!!FINANCE_MEGA_REMITTANCE_VIEWS.detail'),false,label+' navigation removes historical bytes and consent');}
      results.push({engine,width,kind:'historical-'+kind,view,geometry,filename:downloaded.suggestedFilename()});
    }
    for(const kind of ['bulk','payroll','refund'])for(const purpose of ['payment','historical']){
      const label=engine+'/'+width+'/formatted-'+kind+'/'+purpose,data=rawRequest(kind),formatted='0000-0000 1234';
      if(kind==='payroll')data.form_payload.hrInfo.rows[0].account=formatted;
      else if(kind==='refund')data.form_payload.refundInfo.rows[0].accountNo=formatted;
      else data.bank_no=formatted;
      if(purpose==='historical'){data.status='completed';data.cash_posted_at='2026-10-18T03:00:00Z';data.form_payload.cashAmount=data.amount;data.steps[2].a='approved';data.steps[2].t=data.cash_posted_at;}
      await scope(`(function(){closeAppr();clearFinanceMegaRemittance();window.__qaPurpose=${JSON.stringify(purpose)};window.__qaReason='';window.__qaSnapshot=${JSON.stringify(data)};window.__qaSnapshot.tenant_id=currentTenantId();window.__qaSupplements=[];REQS=[mapReq(structuredClone(window.__qaSnapshot))];window.__qaFormattingBefore=JSON.stringify({source:window.__qaSnapshot,mapped:REQS[0]});showApprD(REQS[0]);})()`);
      await page.waitForFunction(()=>document.querySelector('#appr-inner [data-mega-state="ready"]'));
      const panel=page.locator('#appr-inner .finance-mega-remittance'),before=await scope('window.__qaFormattingBefore');
      if(purpose==='historical')await panel.getByRole('checkbox',{name:'已知為已付款歷史檔，不會再次送銀行匯款'}).check();
      const readBefore=await scope('window.__qaReads.length'),event=page.waitForEvent('download');await panel.getByRole('button',{name:purpose==='historical'?'下載歷史 Excel':'下載 Excel',exact:true}).click();const download=await event;
      const book=XLSX.read(fs.readFileSync(await download.path()),{type:'buffer'}),sheet=book.Sheets['工作表1'],accountCell=kind==='payroll'?sheet.E2:sheet.D2;
      equal(accountCell.v,'000000001234',label+' real XLSX strips only account separators and keeps leading zeroes');
      equal(accountCell.t,'s',label+' normalized account remains an Excel text cell');
      equal(kind==='payroll'?sheet.F2.v:sheet.B2.v,1200,label+' account normalization does not change payment principal');
      equal(await scope('window.__qaReads.length'),readBefore+1,label+' download still performs a fresh authoritative read');
      equal(await scope('JSON.stringify({source:window.__qaSnapshot,mapped:REQS[0]})'),before,label+' saved source, version and mapped request remain unchanged');
      equal(await scope('window.__qaWrites.length'),0,label+' compatible formatting never writes the source or records a payment');
      if(purpose==='historical')ok(download.suggestedFilename().startsWith('已付款_歷史補檔_勿重複匯款_'),label+' normalized history retains its do-not-pay-again filename');
      results.push({engine,width,kind:'formatted-'+kind,view:'approval',purpose,filename:download.suggestedFilename()});
    }
    for(const scenario of ['waiting','cancelled','historical-mismatch','before-cutoff']){
      const data=rawRequest();
      if(scenario==='waiting'){data.status='pending_ceo';data.steps[1].a='';}
      else{data.status=scenario==='cancelled'?'cancelled':'completed';data.cash_posted_at='2026-10-18T03:00:00Z';data.steps[2].a='approved';data.steps[2].t=data.cash_posted_at;data.form_payload.cashAmount=scenario==='historical-mismatch'?999:1200;}
      if(scenario==='before-cutoff')data.created_at='2026-09-30T15:59:59Z';
      const purpose=scenario==='waiting'?'waiting':scenario==='cancelled'?'unavailable':'historical';
      await scope(`(function(){closeAppr();clearFinanceMegaRemittance();window.__qaPurpose=${JSON.stringify(purpose)};window.__qaReason=${JSON.stringify(scenario==='cancelled'?'cancelled_or_rejected':'awaiting_cashier')};window.__qaSnapshot=${JSON.stringify(data)};REQS=[mapReq(window.__qaSnapshot)];openDetail(REQS[0].id);})()`);
      const panel=page.locator('#detail-body .finance-mega-remittance');
      if(scenario==='before-cutoff')equal(await panel.count(),0,engine+'/'+width+' pre-cutoff completed request does not expose historical entry');
      else{
        const expected=scenario==='waiting'?'waiting':scenario==='cancelled'?'unavailable':'missing';await page.waitForFunction(wanted=>document.querySelector('#detail-body .finance-mega-remittance')?.dataset.megaState===wanted,expected);
        equal(await panel.locator('[data-mega-action="download"]').count(),0,engine+'/'+width+'/'+scenario+' cannot produce a usable download');
      }
      equal(await scope('window.__qaWrites.length'),0,engine+'/'+width+'/'+scenario+' leaves financial workflow untouched');
    }
    await scope("window.__qaPurpose='payment';window.__qaReason='';");
    const olderPayment=rawRequest();olderPayment.created_at='2026-09-01T00:00:00Z';
    await scope(`(function(){closeAppr();clearFinanceMegaRemittance();window.__qaSnapshot=${JSON.stringify(olderPayment)};REQS=[mapReq(window.__qaSnapshot)];openDetail(REQS[0].id);})()`);
    await page.waitForFunction(()=>document.querySelector('#detail-body [data-mega-state="ready"]'));
    equal(await page.locator('#detail-body [data-mega-action="download"]').count(),1,engine+'/'+width+' existing pending-cashier requests before cutoff remain payable');
    // Hold only the modal's next initial-focus callback. Deliver it explicitly
    // after real keyboard input, without a timing-dependent sleep or retry.
    await page.evaluate(()=>{
      window.__qaHeldModalFocus=[];
      window.__qaHoldNextModalFocus=function(){
        const raf=window.requestAnimationFrame;
        window.requestAnimationFrame=function(callback){
          window.requestAnimationFrame=raf;
          return raf(()=>window.__qaHeldModalFocus.push(callback));
        };
      };
      window.__qaHoldNextModalFocus();
    });
    const missing=rawRequest('payroll');missing.form_payload.hrInfo.rows[0].name='';missing.form_payload.hrInfo.rows[0].identityNo='';missing.form_payload.hrInfo.rows[0].bankCode='';missing.form_payload.hrInfo.rows[0].account='0000-0000 1234';
    await scope(`(function(){closeAppr();clearFinanceMegaRemittance();window.__qaSnapshot=${JSON.stringify(missing)};window.__qaSnapshot.tenant_id=currentTenantId();window.__qaSupplements=[];REQS=[mapReq(structuredClone(window.__qaSnapshot))];showApprD(REQS[0]);})()`);
    await page.waitForFunction(()=>document.querySelector('#appr-inner [data-mega-state="missing"]'));
    await page.waitForFunction(()=>window.__qaHeldModalFocus.length===1);
    await scope('closeAppr();window.__qaHoldNextModalFocus();showApprD(REQS[0]);');
    await page.waitForFunction(()=>document.querySelector('#appr-inner [data-mega-state="missing"]')&&window.__qaHeldModalFocus.length===2);
    await page.evaluate(()=>{document.activeElement.blur();window.__qaHeldModalFocus[0](performance.now());});
    equal(await page.evaluate(()=>document.activeElement===document.body),true,engine+'/'+width+' a closed modal focus callback cannot focus the reopened modal');
    const missingPanel=page.locator('#appr-inner .finance-mega-remittance'),principalBefore=await scope('JSON.stringify({amount:window.__qaSnapshot.amount,rows:window.__qaSnapshot.form_payload.hrInfo.rows})');
    equal(await missingPanel.locator('input').count(),2,engine+'/'+width+' actual approval editor exposes only required name and branch-code supplements');
    ok((await missingPanel.innerText()).includes('核定收款帳號：0000-0000 1234'),engine+'/'+width+' missing bank details display the original authorized formatted account for comparison');
    const payeeInput=missingPanel.getByLabel('收款戶名',{exact:true}),bankInput=missingPanel.getByLabel('銀行代號',{exact:true});
    await payeeInput.focus();await page.keyboard.insertText('虛構');
    await page.evaluate(()=>window.__qaHeldModalFocus[1](performance.now()));
    ok(await payeeInput.evaluate(input=>document.activeElement===input),engine+'/'+width+' delayed modal initial focus preserves the active payee field');
    await page.keyboard.insertText('薪轉補充戶名');
    equal(await payeeInput.inputValue(),'虛構薪轉補充戶名',engine+'/'+width+' real keyboard input survives delayed modal initialization');
    await bankInput.fill('0170000');
    equal(await bankInput.inputValue(),'0170000',engine+'/'+width+' branch code remains in its intended field');
    await missingPanel.getByRole('button',{name:'儲存並重新產製',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#appr-inner [data-mega-state="ready"]'));
    equal(await scope('window.__qaWrites.map(function(x){return x.name;})'),['finance_remittance_export_supplement_save_v1'],engine+'/'+width+' supplement uses only the dedicated CAS metadata RPC');
    equal(await scope('JSON.stringify({amount:window.__qaSnapshot.amount,rows:window.__qaSnapshot.form_payload.hrInfo.rows})'),principalBefore,engine+'/'+width+' supplement does not change approved source accounts, amounts or rows');
    equal(await scope('Object.keys(window.__qaWrites[0].rows[0]).sort()'),['bankCode','name','rowKey'],engine+'/'+width+' submitted supplement contains no editable payment account or amount');
    equal(await scope('window.__qaWrites[0].digest'),'opaque-qa-digest-1',engine+'/'+width+' account display formatting does not alter the authoritative CAS digest');
    const supplementEvent=page.waitForEvent('download');await missingPanel.getByRole('button',{name:'下載 Excel',exact:true}).click();const supplementDownload=await supplementEvent;
    const supplementBook=XLSX.read(fs.readFileSync(await supplementDownload.path()),{type:'buffer'}),supplementSheet=supplementBook.Sheets['工作表1'];
    equal(supplementSheet.B2.v,'虛構薪轉補充戶名',engine+'/'+width+' real downloaded workbook applies the authorized payee supplement');
    equal(supplementSheet.D2.v,'0170000',engine+'/'+width+' real downloaded workbook applies the authorized full bank code');
    equal(supplementSheet.E2.v,'000000001234',engine+'/'+width+' supplemented workbook preserves approved account unchanged');
    equal(supplementSheet.F2.v,1200,engine+'/'+width+' supplemented workbook preserves approved amount unchanged');
    await scope('closeAppr();');
    for(const scenario of ['before-cashier','employee','demo','missing-auth']){
      await scope(`(function(){closeAppr();clearFinanceMegaRemittance();S.user=USERS.find(function(u){return u.role==='cashier';});S.demoLogin=false;var raw=${JSON.stringify(rawRequest())};if(${JSON.stringify(scenario)}==='before-cashier'){raw.created_at='2026-09-01T00:00:00Z';raw.status='pending';raw.steps[1].a='';raw.steps[1].t='';}if(${JSON.stringify(scenario)}==='employee')S.user=USERS[0];if(${JSON.stringify(scenario)}==='demo')S.demoLogin=true;if(${JSON.stringify(scenario)}==='missing-auth')S.user=Object.assign({},S.user,{authUserId:''});window.__qaSnapshot=raw;REQS=[mapReq(raw)];openDetail(REQS[0].id);})()`);
      equal(await page.locator('#detail-body .finance-mega-remittance').count(),0,engine+'/'+width+'/'+scenario+' has no bank file entry');
    }
    await scope(`(function(){S.user=USERS.find(function(u){return u.role==='cashier';});S.demoLogin=false;window.__qaSnapshot=${JSON.stringify(rawRequest())};REQS=[mapReq(window.__qaSnapshot)];window.__qaDenied=true;showApprD(REQS[0]);})()`);
    await page.waitForFunction(()=>document.querySelector('#appr-inner [data-mega-state="denied"]'));
    equal(await page.locator('#appr-inner [data-mega-action="download"]').count(),0,engine+'/'+width+' RPC 403 denies all download actions');
    await scope('closeAppr();window.__qaDenied=false;window.__qaRpcCode="55000";showApprD(REQS[0]);');
    await page.waitForFunction(()=>document.querySelector('#appr-inner [data-mega-state="unavailable"]'));
    equal(await page.locator('#appr-inner [data-mega-action="download"]').count(),0,engine+'/'+width+' concurrent stage change removes download without presenting a generic network failure');
    await scope('window.__qaRpcCode="";');
    await scope('setFinanceWorkspaceIdentityBlocked(true);');equal(await scope('Object.keys(FINANCE_MEGA_REMITTANCE_VIEWS).length'),0,engine+'/'+width+' identity lock clears all private contexts');
    equal(await scope('window.__qaNetwork'),[],engine+'/'+width+' no real API network request');equal(errors,[],engine+'/'+width+' no uncaught app errors');equal(dialogs,[],engine+'/'+width+' no unexpected browser dialogs');
    await context.close();
  }catch(error){
    if(page&&!page.isClosed()){
      let diagnostic;
      try{diagnostic=await page.evaluate(async()=>{
        const elementInfo=element=>element?{tag:element.tagName,id:element.id,className:element.className,action:element.getAttribute('data-mega-action')}:null;
        const geometry=element=>{
          const rect=element.getBoundingClientRect(),style=getComputedStyle(element);
          const x=rect.left+rect.width/2,y=rect.top+rect.height/2;
          const hit=x>=0&&x<innerWidth&&y>=0&&y<innerHeight?document.elementFromPoint(x,y):null;
          const scrollAncestors=[];
          for(let ancestor=element.parentElement;ancestor;ancestor=ancestor.parentElement){
            const ancestorStyle=getComputedStyle(ancestor);
            if(ancestor.scrollHeight>ancestor.clientHeight||ancestor.scrollWidth>ancestor.clientWidth)scrollAncestors.push({element:elementInfo(ancestor),scrollTop:ancestor.scrollTop,scrollLeft:ancestor.scrollLeft,clientHeight:ancestor.clientHeight,scrollHeight:ancestor.scrollHeight,overflowX:ancestorStyle.overflowX,overflowY:ancestorStyle.overflowY});
          }
          return {rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},display:style.display,visibility:style.visibility,pointerEvents:style.pointerEvents,inertAncestor:elementInfo(element.closest('[inert]')),centerHit:elementInfo(hit),centerHitsSelf:!!hit&&(hit===element||element.contains(hit)),scrollAncestors};
        };
        let controllers;
        try{controllers=await window.__megaAppQA.run('Object.fromEntries(Object.entries(FINANCE_MEGA_REMITTANCE_VIEWS).map(function(entry){return [entry[0],entry[1].getState()];}))');}catch(controllerError){controllers={captureError:controllerError.message};}
        return {
          panels:Array.from(document.querySelectorAll('.finance-mega-remittance')).map(panel=>({host:panel.closest('#appr-inner')?'approval':'detail',state:panel.dataset.megaState,busy:panel.querySelector('.mega-body')?.getAttribute('aria-busy'),text:panel.innerText,inputs:Array.from(panel.querySelectorAll('input')).map(input=>({name:input.name,value:input.value,invalid:input.getAttribute('aria-invalid'),formClass:input.form?.className})),buttons:Array.from(panel.querySelectorAll('button')).map(button=>({text:button.textContent,type:button.type,disabled:button.disabled,formClass:button.form?.className,geometry:geometry(button)}))})),
          controllers,viewport:{width:innerWidth,height:innerHeight,scrollX,scrollY},activeElement:elementInfo(document.activeElement),modal:{display:document.querySelector('#m-appr')?.style.display,hidden:document.querySelector('#m-appr')?.getAttribute('aria-hidden')},events:window.__qaMegaEvents||[],writes:window.__qaWrites||[],reads:(window.__qaReads||[]).slice(-6),fixture:window.__qaSnapshot?{id:window.__qaSnapshot.id,status:window.__qaSnapshot.status,version:window.__qaSnapshot.ver,purpose:window.__qaPurpose,supplements:window.__qaSupplements}:null
        };
      });}catch(captureError){diagnostic={captureError:captureError.message};}
      const details={engine,width,error:error.message,stack:error.stack,checks,errors,dialogs,downloadInteraction,diagnostic};
      fs.writeFileSync(path.join(output,engine+'-'+width+'-failure.json'),JSON.stringify(details,null,2));
      console.error('MEGA_APP_FAILURE_DIAGNOSTIC '+JSON.stringify(details));
      await page.screenshot({path:path.join(output,engine+'-'+width+'-failure.png')}).catch(()=>{});
    }
    throw error;
  }finally{await browser.close();}
}
(async()=>{
  fs.mkdirSync(output,{recursive:true});await xlsxDependency();
  server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/__qa/xlsx.js'){res.setHeader('Content-Type','text/javascript');res.end(xlsxBytes);return;}if(pathname==='/'||pathname==='/index.html'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(file));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  for(const engine of ['chromium','webkit'])for(const width of [1440,390])await browserCase(engine,width,origin);
  equal(sha(fs.readFileSync(path.join(root,'index.html'))),sha(original),'integration test does not alter index.html');
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({status:'pass',checks,cases:results.length,sourceSha256:sha(original),xlsxSha256:XLSX_SHA,scope:'Actual local app renderers and downloads with fictional RPC snapshots only; no production authentication, writes or payments.',results},null,2));
  console.log(JSON.stringify({status:'pass',checks,cases:results.length,output}));
})().catch(error=>{fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:error.message,stack:error.stack,checks,results},null,2));console.error(error);process.exitCode=1;}).finally(async()=>{if(server&&server.listening)await new Promise(resolve=>server.close(resolve));});
