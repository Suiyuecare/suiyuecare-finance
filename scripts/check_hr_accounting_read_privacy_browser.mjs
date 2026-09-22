// Local built-in host renderers; synthetic identity, read denial and stale rows only.
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url),{applyBuildEnvironment}=require('./finance_build_environment.js');
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/Users/seniorlifepr/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const out=process.env.HR_PRIVACY_EVIDENCE_DIR||'/tmp/finance-hr-read-privacy-browser';fs.mkdirSync(out,{recursive:true});
const source=fs.readFileSync(path.join(root,'index.html'),'utf8'),anchor='bootAuthGate();\n\n})();';assert(source.includes(anchor));
const html=applyBuildEnvironment(source,{target:'local',supabaseUrl:'',supabaseAnonKey:''}).replace(anchor,'window.__privacyQA={run:async function(code){return await eval(code)}};\n})();').replace(/<script\b[^>]*src=["']https?:[^>]*><\/script>/gi,'');
const server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(p!==root&&!p.startsWith(root+path.sep)){res.writeHead(403);return res.end();}if(p===root||p===path.join(root,'index.html')){res.setHeader('content-type','text/html;charset=utf-8');return res.end(html);}if(!fs.existsSync(p)||!fs.statSync(p).isFile()){res.writeHead(404);return res.end();}res.setHeader('content-type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(p));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({headless:true}),page=await browser.newPage(),errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
try{
 await page.goto(base);await page.waitForFunction(()=>window.__privacyQA);
 await page.evaluate(()=>window.__privacyQA.run(`S.user={id:'synthetic-accountant',authUserId:'10000000-0000-0000-0000-000000000001',role:'accountant',n:'合成測試'};S.demoLogin=false;S.page='ledger';hasSupabase=function(){return true;};LEDGER=[{id:'synthetic-private',desc:'PRIVATE-CACHED-SALARY'}];VOUCHERS=[{id:'synthetic-voucher',desc:'PRIVATE-CACHED-SALARY'}];S.ledgerInvestorRows=LEDGER.slice();document.getElementById('m-voucher-body').textContent='PRIVATE-CACHED-SALARY';document.getElementById('m-voucher').style.display='flex';rejectFinanceAccountingRead({code:'42501',message:'FINANCE_HR_COMPLETE_REPORT_AUTHORIZATION_REQUIRED'});`));
 assert.equal(await page.locator('#m-voucher').isVisible(),false);assert.equal(await page.locator('#m-voucher-body').textContent(),'');
 await page.addStyleTag({content:'#main-wrap{display:block!important;margin-left:0!important;width:100%!important;min-width:0!important}.sidebar,#sidebar,#login-screen,#auth-loading{display:none!important}'});
 for(const width of [1440,390,320])for(const view of ['ledger','vouchers','compliance']){
  await page.setViewportSize({width,height:950});await page.evaluate(view=>window.__privacyQA.run(`S.page=${JSON.stringify(view)};document.querySelectorAll('[id^="pg-"]').forEach(n=>{n.style.display='none';n.classList.remove('on');});document.getElementById('pg-'+S.page).style.display='block';document.getElementById('pg-'+S.page).classList.add('on');if(S.page==='ledger')renderLedger();else if(S.page==='vouchers')renderVouchers();else buildCompliance();`),view);
  const box=page.locator('#pg-'+view);assert(await box.isVisible());const text=await box.innerText();assert.match(text,/完整帳務資料的授權尚未取得/);assert(!text.includes('PRIVATE-CACHED-SALARY'));
  const overflow=await box.evaluate(node=>node.scrollWidth>node.clientWidth+1);assert.equal(overflow,false,view+' overflow '+width);
  const shot=path.join(out,view+'-'+width+'.png');await page.screenshot({path:shot,fullPage:true});checks.push({view,width,overflow:false,screenshot:shot});
 }
 let dialogs=0;page.on('dialog',async d=>{dialogs++;assert.match(d.message(),/授權尚未取得/);await d.dismiss();});
 await page.evaluate(()=>window.exportVoucherCSV());await page.evaluate(()=>window.exportLedger());await page.evaluate(()=>window.downloadBackupPackage());assert.equal(dialogs,3);assert.deepEqual(errors,[]);
 const result={ok:true,sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),scope:'Synthetic identity/denial/stale data in actual local index DOM, no production data or external calls',checks,blockedExports:dialogs,pageErrors:errors};fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();await new Promise(r=>server.close(r));}
