'use strict';
// Actual local application and browser controls with fictional data only.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {chromium,webkit}=require('playwright');
const {applyBuildEnvironment}=require('./finance_build_environment');

const root=path.resolve(__dirname,'..');
const anchor='bootAuthGate();\n\n})();';
let html=applyBuildEnvironment(fs.readFileSync(path.join(root,'index.html'),'utf8'),{
  target:'local',supabaseUrl:'',supabaseAnonKey:''
});
assert(html.includes(anchor));
html=html.replace(anchor,'window.__accountingPrecision={run:function(code){return eval(code);}};\n'+anchor)
  .replace(/<script\b[^>]*src=["']https?:[^>]*><\/script>/gi,'');
const server=http.createServer((request,response)=>{
  const file=path.resolve(root,'.'+new URL(request.url,'http://localhost').pathname);
  if(file!==root&&!file.startsWith(root+path.sep)){response.writeHead(403);response.end();return;}
  if(file===root||file===path.join(root,'index.html')){
    response.setHeader('content-type','text/html');response.end(html);return;
  }
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404);response.end();return;}
  response.setHeader('content-type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/plain':'application/octet-stream');
  response.end(fs.readFileSync(file));
});
const browsers=process.env.FINANCE_BROWSER_CHANNEL==='chromium'
  ?[['Chromium',chromium,{headless:true}]]
  :[['Chrome',chromium,{headless:true,channel:'chrome'}],['WebKit',webkit,{headless:true}]];

(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  for(const [label,engine,launchOptions] of browsers){
    const browser=await engine.launch(launchOptions);
    try{
      const context=await browser.newContext({viewport:{width:1280,height:900}});
      await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
      const page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      page.on('dialog',dialog=>dialog.dismiss());
      await page.goto(origin);
      await page.waitForFunction(()=>window.__accountingPrecision);
      const scope=code=>page.evaluate(code=>window.__accountingPrecision.run(code),code);
      await scope(`(function(){
        canEditAccountingLineAmounts=function(){return true;};
        canEditAccountingLineSubjects=function(){return true;};
        window.__precisionRequest={id:'fictional-precision',no:'TEST-ONLY',eid:'E1',dc:'A1000',type:'payment_request',
          status:'pending_accountant',amt:123.459,total:123.459,formPayload:{accountingLines:[{
            id:'line_1',source:'detail',description:'虛構測試明細',netAmount:123.456,taxAmount:0.003,grossAmount:123.459,
            debitAccount:'6205',creditAccountName:'文具用品',creditAccount:'1112',creditAccountName:'銀行存款',
            manualOverride:true,valueAuthority:'human',manualFields:['netAmount','taxAmount','grossAmount'],
            manualOverrideHistory:[{at:'2026-10-01T00:00:00.000Z'}]
          }]}};
        var host=document.createElement('div');host.id='precision-test-host';document.body.appendChild(host);
        host.innerHTML=accountingLinesHtml(__precisionRequest,true,'虛構會計覆核','precision');
      })()`);
      const net=page.locator('#precision-net-0'),tax=page.locator('#precision-tax-0'),gross=page.locator('#precision-gross-0');
      assert.equal(await net.inputValue(),'123.456',label+' initially shows reviewed net');
      assert.equal(await tax.inputValue(),'0.003',label+' initially shows reviewed tax');
      assert.equal(await gross.inputValue(),'123.459',label+' initially shows reviewed gross');
      assert.equal(await net.getAttribute('step'),'any');
      assert.equal(await net.evaluate(input=>input.validity.stepMismatch),false);
      await net.fill('123.457');
      assert.equal(await gross.inputValue(),'123.46',label+' decimal addition');
      await gross.fill('123.459');
      assert.equal(await net.inputValue(),'123.456',label+' decimal subtraction');
      const reviewed=await scope(`(function(){
        var line=collectAccountingLinesFromDom(__precisionRequest,'precision')[0];
        return {net:line.netAmount,tax:line.taxAmount,gross:line.grossAmount,
          history:line.manualOverrideHistory.length,authority:line.valueAuthority};
      })()`);
      assert.deepEqual(reviewed,{net:123.456,tax:0.003,gross:123.459,history:1,authority:'human'});
      const unknown=await scope(`(async function(){
        S.apprSelected={'fixture-request':true};
        S.apprItemMap={'fixture-request':{kind:'req',raw:__precisionRequest}};
        canActRequest=function(){return true;};
        activeStep=function(){return {rk:'ceo'};};
        shouldCollectAccountingLines=function(){return false;};
        expenseActiveStepTransaction=async function(){return {available:true,ok:false,unknown:true,error:new Error('fixture lost response')};};
        recordApprovalWriteFailure=function(){throw new Error('unknown outcome must not be recorded as definitive failure');};
        approvalClearBulkExpectedSteps=function(){throw new Error('unknown outcome must retain selection');};
        window.__bulkUnknownAlerts=[];window.alert=function(message){window.__bulkUnknownAlerts.push(String(message));};
        var result=await bulkRunSelected('approve');
        return {result:result,selected:!!S.apprSelected['fixture-request'],alerts:window.__bulkUnknownAlerts};
      })()`);
      assert.equal(unknown.result,false);
      assert.equal(unknown.selected,true);
      assert(unknown.alerts.some(message=>message.includes('結果尚待確認')&&!message.includes('整批未寫入')));
      assert.deepEqual(errors,[],label+' page errors');
      console.log('PASS '+label+' reviewed accounting precision and unknown bulk result remain truthful');
      await context.close();
    }finally{await browser.close();}
  }
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>new Promise(resolve=>server.close(resolve)));
