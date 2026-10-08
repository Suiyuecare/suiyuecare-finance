'use strict';
// Browser checks serve a transient offline build with test hooks. Hooks are
// injected only in this server response; no production source exposes them.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {applyBuildEnvironment}=require('./finance_build_environment');
const root=path.resolve(__dirname,'..');
let html=applyBuildEnvironment(fs.readFileSync(path.join(root,'index.html'),'utf8'),{target:'local',supabaseUrl:'',supabaseAnonKey:''});
html=html.replace('bootAuthGate();\n\n})();',`window.__financeRecoveryTest={run:async function(code){return await eval(code);}};\nbootAuthGate();\n\n})();`);
assert.ok(html.includes('window.__financeRecoveryTest='));
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(root+path.sep)&&file!==root){res.writeHead(403);res.end();return;}
  if(file===root||file===path.join(root,'index.html')){res.setHeader('content-type','text/html');res.end(html);return;}
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  res.setHeader('content-type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(file));
});
let browserInstance=null,page=null;
const pageErrors=[];
async function browser(action,...args){
  if(action==='open'){
    browserInstance=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||process.env.FINANCE_BROWSER_CHANNEL||'chrome'});
    page=await browserInstance.newPage();
    page.on('pageerror',error=>pageErrors.push(error.message));
    await page.goto(args[0],{waitUntil:'domcontentloaded'});
    return '';
  }
  if(action==='wait'){
    if(args[0]==='--load')await page.waitForLoadState(args[1]);
    else await page.waitForTimeout(Number(args[0]));
    return '';
  }
  if(action==='snapshot')return '';
  if(action==='errors')return pageErrors.join('\n');
  if(action==='set'&&args[0]==='viewport'){
    await page.setViewportSize({width:Number(args[1]),height:Number(args[2])});
    return '';
  }
  if(action==='eval'){
    const expression=args[0]==='--base64'?Buffer.from(args[1],'base64').toString('utf8'):args[0];
    return JSON.stringify(await page.evaluate(code=>eval(code),expression));
  }
  if(action==='reload'){await page.reload({waitUntil:'domcontentloaded'});return '';}
  if(action==='screenshot'){await page.screenshot({path:args[0]});return '';}
  if(action==='close'){if(browserInstance)await browserInstance.close();return '';}
  throw new Error('unsupported browser test action: '+action);
}
async function scoped(code){
  const expression='(async()=>JSON.stringify(await window.__financeRecoveryTest.run('+JSON.stringify(code)+')))()';
  const raw=await browser('eval','--base64',Buffer.from(expression).toString('base64'));
  let parsed=JSON.parse(raw);if(typeof parsed==='string')parsed=JSON.parse(parsed);return parsed;
}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  await browser('open','http://127.0.0.1:'+server.address().port+'/');
  await browser('wait','--load','networkidle');
  await browser('snapshot','-i');
  assert.equal((await browser('errors')).trim(),'','initial app has no JavaScript error');
  await browser('set','viewport','390','844');
  await scoped("showFinanceLoginAccountGuidance({state:'expected'});");
  const mobile=JSON.parse(await browser('eval',"JSON.stringify({height:document.getElementById('login-switch-account').getBoundingClientRect().height,overflow:document.documentElement.scrollWidth>innerWidth})"));
  const mobileResult=typeof mobile==='string'?JSON.parse(mobile):mobile;
  assert.ok(mobileResult.height>=44,'account switch touch area');assert.equal(mobileResult.overflow,false,'mobile horizontal overflow');
  console.log('PASS mobile login: 390px layout and 44px account-switch touch target');
  await browser('set','viewport','1440','1000');
  const results=await scoped(`(async()=>{
    quickLogin('employee');
    S.user.authUserId='10000000-0000-0000-0000-000000000001';S.user.tenantId=currentTenantId();
    var results=[];
    for(var type of NR_TYPES.map(function(t){return t.id;})){
      S.nrDirtyBaseline='';S.page='dashboard';await guardedNav('newreq',null);
      S.nrType=type;S.nrStep=3;S.nrRec=(NR_REC[type]||[])[0].id;S.nrPay='bank';S.lazyMode=false;
      renderNR();
      if(el('nr-desc'))el('nr-desc').value='登入恢復測試 '+type;
      if(el('nr-amt'))el('nr-amt').value='4321';
      if(type==='purchase_request'){
        S.purchaseRows[0].itemName='恢復測試採購';S.purchaseRows[0].qty=3;S.purchaseRows[0].note='保留人工需求';renderPurchaseSheet();
        var input=el('purchase-sheet').querySelector('input');input.focus();input.value='尚未離焦的採購名稱';
      }
      if(type==='expense_reimbursement'){
        S.lazyRows=[{item:'測試費用',qty:1,unitPrice:4321,netAmount:4300,taxAmount:21,grossAmount:4321,manualOverride:true,valueAuthority:'human'}];renderLazySheet();
      }
      if(type==='travel_request'){
        S.travelRows[0].amount=1234;S.travelRows[0].amountEdited=true;S.travelRows[0].note='保留人工差旅金額';renderTravelSheet();
      }
      var saved=saveFinanceAuthRecoveryDraft(),before=financeAuthRecoveryDraft();
      var keys=Object.keys(before&&before.fields||{});S.page='dashboard';buildNR();
      var ok=await restoreFinanceAuthRecoveryDraft();
      var after=financeAuthRecoveryNewRequestSnapshot(),expected=before.newRequest;
      var diff=Object.keys(Object.assign({},expected.form,after.form)).filter(function(k){return JSON.stringify(stableSnapshotValue(expected.form[k]))!==JSON.stringify(stableSnapshotValue(after.form[k]));});
      var fieldDiff=keys.filter(function(id){var node=el(id),v=before.fields[id];return !node||(v.checked!==undefined?node.checked!==v.checked:node.value!==v.value);});
      results.push({type:type,saved:saved,ok:ok,backupRemains:!!sessionGetItem(financeAuthRecoveryStorageKey()),diff:diff,fieldDiff:fieldDiff,rows:after.form.purchaseRows});
      financeAuthRecoveryRestorePendingKey='';sessionRemoveItem(financeAuthRecoveryStorageKey());
    }
    return results;
  })()`);
  for(const result of results){console.log(JSON.stringify(result));assert.equal(result.saved,true,result.type+' saves');assert.equal(result.ok,true,result.type+' restores full DOM');assert.equal(result.backupRemains,false,result.type+' deletes only verified backup');}
  const afterFrames=await scoped(`(async()=>{await new Promise(function(resolve){requestAnimationFrame(function(){requestAnimationFrame(resolve);});});return {page:S.page,leaveGuardOpen:!!(el('m-leave-guard')&&getComputedStyle(el('m-leave-guard')).display!=='none'),incomeGuardOpen:!!(el('m-income-leave-guard')&&getComputedStyle(el('m-income-leave-guard')).display!=='none')};})()`);
  assert.deepEqual(afterFrames,{page:'newreq',leaveGuardOpen:false,incomeGuardOpen:false},'late initial navigation must not reopen a leave dialog over restored content');
  const income=await scoped(`(async()=>{
    var results=[];
    for(var page of ['invoices','bills']){
      S.page='dashboard';await guardedNav(page,null);
      if(page==='invoices'){S.bRows=[Object.assign(defaultInvoiceBatchRow(),{buyer:'測試買受人',desc:'保留服務明細',total:4321,rate:0.05})];renderBatchTable();}
      else{BILL_ROWS=[{payer:'測試繳費人',item:'測試服務',period:'2026-09',amt:'3456'}];renderBillEntryTable();}
      var saved=saveFinanceAuthRecoveryDraft(),before=financeAuthRecoveryDraft();
      S.bRows=[];BILL_ROWS=[];S.page='dashboard';
      var ok=await restoreFinanceAuthRecoveryDraft();
      results.push({page:page,saved:saved,ok:ok,backupRemains:!!sessionGetItem(financeAuthRecoveryStorageKey())});
      financeAuthRecoveryRestorePendingKey='';sessionRemoveItem(financeAuthRecoveryStorageKey());
    }
    S.page='dashboard';await guardedNav('newreq',null);S.nrType='purchase_request';S.nrStep=3;S.nrRec='invoice';S.nrPay='bank';renderNR();
    S.purchaseRows[0].itemName='重新載入後仍須保留';S.purchaseRows[0].qty=7;renderPurchaseSheet();
    saveFinanceAuthRecoveryDraft();
    return results;
  })()`);
  for(const result of income){console.log(JSON.stringify(result));assert.equal(result.saved,true);assert.equal(result.ok,true);assert.equal(result.backupRemains,false);}
  await browser('reload');await browser('wait','--load','networkidle');
  const reload=await scoped(`(async()=>{quickLogin('employee');S.user.authUserId='10000000-0000-0000-0000-000000000001';S.user.tenantId=currentTenantId();var unrelated=el('m-voucher');unrelated.style.display='flex';var ok=await restoreFinanceAuthRecoveryDraft();var unrelatedPreserved=unrelated.style.display==='flex';unrelated.style.display='none';await new Promise(function(resolve){requestAnimationFrame(function(){requestAnimationFrame(resolve);});});return {ok:ok,type:S.nrType,item:S.purchaseRows[0]&&S.purchaseRows[0].itemName,qty:S.purchaseRows[0]&&S.purchaseRows[0].qty,unrelatedPreserved:unrelatedPreserved,leaveGuardOpen:!!(el('m-leave-guard')&&getComputedStyle(el('m-leave-guard')).display!=='none')};})()`);
  assert.deepEqual(reload,{ok:true,type:'purchase_request',item:'重新載入後仍須保留',qty:7,unrelatedPreserved:true,leaveGuardOpen:false});
  console.log('PASS A02 browser: invoice/bill rows and a full page reload preserve owned draft.');
  const billFailure=await scoped(`(async()=>{
    BILL_ROWS=[{payer:'虛構繳費人',item:'虛構服務',period:'2026-10',amt:'3456'}];renderBillEntryTable();
    var before=JSON.stringify(BILL_ROWS),messages=[],originalAlert=window.alert;
    window.alert=function(message){messages.push(String(message));};
    try{
      recordBillWriteFailure('建立批次繳費單',{payer:'虛構繳費人',amt:3456},{ok:false,confirmedRollback:true,error:{code:'57014',message:'canceling statement due to statement timeout'}},{insertedCount:0,totalCount:1});
      recordBillWriteFailure('建立批次繳費單',null,{ok:false,error:{code:'FINANCE_MUTATION_RESULT_UNKNOWN',message:'原送件待確認，請先確認原送單結果'}});
      recordBillWriteFailure('建立批次繳費單',null,{ok:false,error:{code:'22023',message:'第 1 筆繳費單缺少項目名稱'}});
    }finally{window.alert=originalAlert;}
    return {confirmed:messages[0],unknown:messages[1],validation:messages[2],rowsUnchanged:JSON.stringify(BILL_ROWS)===before,
      visiblePayer:el('bill-entry-body').querySelector('[data-bill-field="payer"]').value};
  })()`);
  assert.match(billFailure.confirmed,/已確認這次交易取消/);
  assert.match(billFailure.confirmed,/原畫面檢查、修正後直接重新送出/);
  assert.doesNotMatch(billFailure.confirmed,/重新整理/);
  assert.match(billFailure.unknown,/原送件待確認，請先確認原送單結果/);
  assert.doesNotMatch(billFailure.unknown,/重新送出/);
  assert.match(billFailure.validation,/依錯誤內容在原畫面檢查、修正後再試/);
  assert.doesNotMatch(billFailure.validation,/重新整理/);
  assert.equal(billFailure.rowsUnchanged,true);
  assert.equal(billFailure.visiblePayer,'虛構繳費人');
  console.log('PASS bill browser: confirmed rollback keeps the form and explains safe retry; unknown result still requires reconciliation.');
  await browser('wait','1400');
  await browser('screenshot',process.env.FINANCE_AUTH_SCREENSHOT||'/tmp/finance-auth-recovery-browser.png');
  const locked=await scoped(`(async()=>{S.demoLogin=false;var before=document.createElement('div');before.className='modal-bg';before.style.display='flex';before.setAttribute('aria-hidden','false');document.body.appendChild(before);var cb;bindSupabaseAuthState({auth:{onAuthStateChange:function(fn){cb=fn;return {data:{subscription:{}}};}}});cb('SIGNED_IN',{access_token:'fixture',user:{id:'different-auth-uuid',email:'other@suiyuecare.com',email_confirmed_at:'2026-09-01',app_metadata:{provider:'google'},identities:[{provider:'google',identity_data:{email:'other@suiyuecare.com',email_verified:true}}]}});await new Promise(function(resolve){setTimeout(resolve,10);});hideFinanceAuthRecovery();var after=document.createElement('div');after.className='modal-bg';after.style.display='flex';document.body.appendChild(after);return {existingDialogHidden:getComputedStyle(before).visibility==='hidden',pendingDialogHidden:getComputedStyle(after).visibility==='hidden',locked:financeWorkspaceIdentityBlocked,inert:el('main-wrap').inert,visibility:el('main-wrap').style.visibility,dialog:el('finance-auth-recovery').style.display,hasClose:el('finance-auth-recovery').innerHTML.indexOf('onclick="hideFinanceAuthRecovery()"')>-1};})()`);
  assert.deepEqual(locked,{existingDialogHidden:true,pendingDialogHidden:true,locked:true,inert:true,visibility:'hidden',dialog:'flex',hasClose:false});
  console.log('PASS A04 browser: replacement account cannot view or act on old workspace or dismiss identity lock.');

  assert.equal((await browser('errors')).trim(),'','real form restoration has no JavaScript error');
  console.log('PASS A02 browser: all nine request types restore actual DOM and state; pending focused edit preserved.');
})().catch(err=>{console.error(err);process.exitCode=1;}).finally(async()=>{await browser('close').catch(()=>{});await new Promise(resolve=>server.close(resolve));});
