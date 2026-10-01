#!/usr/bin/env node
'use strict';
// Visual and accessibility check for the real shared upload status component.
// It loads local source only and never calls Storage or an authenticated API.
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {applyBuildEnvironment}=require('./finance_build_environment');
const root=path.resolve(__dirname,'..');
const anchor='bootAuthGate();\n\n})();';
let html=applyBuildEnvironment(fs.readFileSync(path.join(root,'index.html'),'utf8'),{target:'local',supabaseUrl:'',supabaseAnonKey:''});
assert.ok(html.includes(anchor));
html=html.replace(anchor,'window.__uploadFeedbackTest=function(total){return attachmentUploadFeedback(total);};\n'+anchor)
  .replace(/<script\b[^>]*src=["']https?:[^>]*><\/script>/gi,'');
const server=http.createServer((request,response)=>{
  const file=path.resolve(root,'.'+new URL(request.url,'http://localhost').pathname);
  if(file!==root&&!file.startsWith(root+path.sep)){response.writeHead(403);return response.end();}
  if(file===root||file===path.join(root,'index.html')){response.setHeader('content-type','text/html');return response.end(html);}
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404);return response.end();}
  response.setHeader('content-type',file.endsWith('.css')?'text/css':'application/javascript');
  response.end(fs.readFileSync(file));
});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const page=await context.newPage();
  await page.goto(origin+'/');
  await page.waitForFunction(()=>typeof window.__uploadFeedbackTest==='function');
  await page.evaluate(()=>{window.__batchFeedback=window.__uploadFeedbackTest(3);window.__batchFeedback.update(1,'虛構收據.pdf');});
  const panel=page.locator('#attachment-upload-feedback');
  await panel.waitFor({state:'visible'});
  assert.equal(await panel.getAttribute('role'),'status');
  assert.match(await panel.innerText(),/正在保存附件 1 \/ 3/);
  assert.match(await panel.innerText(),/虛構收據.pdf/);
  const geometry=await panel.evaluate(element=>({width:element.getBoundingClientRect().width,right:element.getBoundingClientRect().right,viewport:innerWidth,close:element.querySelector('button').getBoundingClientRect().width}));
  assert.ok(geometry.width<=geometry.viewport&&geometry.right<=geometry.viewport&&geometry.close>=44,'status fits mobile and close is touch sized');
  await page.evaluate(()=>window.__batchFeedback.finish('虛構收據.pdf 保存失敗，請重試。'));
  assert.equal(await panel.getAttribute('role'),'alert');
  assert.match(await panel.innerText(),/虛構收據.pdf 保存失敗/);
  await panel.getByRole('button',{name:'關閉附件上傳狀態'}).click();
  assert.equal(await panel.isVisible(),false,'the error may be dismissed');
  await page.evaluate(()=>{window.__batchFeedback=window.__uploadFeedbackTest(1);});
  await panel.waitFor({state:'visible'});
  assert.equal(await panel.getAttribute('role'),'status','next batch is no longer an error alert');
  await page.evaluate(()=>window.__batchFeedback.finish());
  assert.match(await panel.innerText(),/附件已保存 1 \/ 1/);
  await page.evaluate(()=>document.body.setAttribute('data-finance-identity-blocked','true'));
  await page.waitForFunction(()=>document.getElementById('attachment-upload-feedback').hidden);
  await page.evaluate(()=>document.body.removeAttribute('data-finance-identity-blocked'));
  assert.equal(await panel.isVisible(),false,'account switch clears prior file names from the shared status');
  console.log('Attachment upload feedback browser: 11 checks passed (local UI, no Storage writes).');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
