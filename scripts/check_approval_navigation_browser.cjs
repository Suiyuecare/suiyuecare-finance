'use strict';
// Actual local index/engines. Only local response exposes closure access;
// fictional transport verifies UI failure handling, SQL tested separately.
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict'),{execFile}=require('child_process'),{promisify}=require('util');
const {applyBuildEnvironment}=require('./finance_build_environment');
const run=promisify(execFile),root=path.resolve(__dirname,'..'),out=process.env.APPROVAL_NAV_EVIDENCE||'/tmp/finance-approval-navigation-20260913',session='approval-navigation-'+process.pid;
const baseline=process.env.APPROVAL_NAV_BASELINE==='1',source=baseline?require('child_process').execFileSync('git',['show','8881a09456001758ac63213eba070c11b849954f:index.html'],{cwd:root,encoding:'utf8',maxBuffer:8e6}):fs.readFileSync(path.join(root,'index.html'),'utf8');
let html=applyBuildEnvironment(source,{target:'local',supabaseUrl:'',supabaseAnonKey:''});
const anchor='bootAuthGate();\n\n})();';assert(html.includes(anchor));html=html.replace(anchor,'window.__approvalNav={run:async function(code){return await eval(code)}};\n'+anchor).replace(/<script\b[^>]*src=["']https?:[^>]*><\/script>/gi,'').replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="connect-src \'self\'; form-action \'none\'">');
const server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(p!==root&&!p.startsWith(root+'/')){res.writeHead(403);return res.end();}if(p===root||p===path.join(root,'index.html')){res.setHeader('content-type','text/html');return res.end(html);}if(!fs.existsSync(p)||!fs.statSync(p).isFile()){res.writeHead(404);return res.end();}res.setHeader('content-type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(p));});
const b=async(...a)=>(await run('agent-browser',['--session',session,...a],{maxBuffer:8e6,timeout:45000})).stdout;
async function scope(code){let v=JSON.parse(await b('eval','--base64',Buffer.from('(async()=>JSON.stringify(await window.__approvalNav.run('+JSON.stringify(code)+')))()').toString('base64')));return typeof v==='string'?JSON.parse(v):v;}
(async()=>{
 fs.mkdirSync(out,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));await b('open','http://127.0.0.1:'+server.address().port);
 await scope(`(function(){
 USERS=[{id:'reviewer',n:'匿名主管',email:'reviewer@example.invalid',authUserId:'fixture-auth',role:'ceo',rL:'執行長',eid:'E1',dc:'D1',active:true}];
 ENTS=[{id:'E1',s:'示範公司',full:'示範公司',active:true}];DEPTS=[{c:'D1',n:'行政部門',eid:'E1',lv:3,active:true}];
 REQS=[];INVS=[];BILLS=[];NOTIFS=[];VOUCHERS=[];ORG_CHART=[];quickLogin('ceo');
 window.__navRow=mapReq({id:'navigation-history',no:'UX-HISTORY-001',applicant_id:'reviewer',applicant:'匿名主管',entity_id:'E1',department_code:'D1',type:'payment_request',amount:1250,description:'交通費報支',data_environment:activeDataEnvironment(),tenant_id:currentTenantId(),status:'completed',step:2,ver:1,request_date:'2026-09-12',steps:[{rk:'applicant_submit',uid:'reviewer',a:'approved',at:'2026-09-12T00:00:00Z'},{rk:'ceo',uid:'reviewer',r:'執行長',a:'approved',n:'匿名主管',at:'2026-09-12T01:00:00Z'}]});
 REQS=[window.__navRow];S.aT='h';S.apprQuery='';S.apprPage=1;
 var h=approvalHistoryRuntimeForCurrentUser();h.status='ready';h.identity=typeof approvalHistoryIdentity==='function'?approvalHistoryIdentity():approvalFastBootstrapIdentity();h.total=1;h.allTotal=1;h.page=1;h.query='';h.updatedAt='2026-09-12T02:00:00Z';h.items=[{kind:'req',raw:window.__navRow,historyTrusted:true,historyKey:'req:navigation-history',historyPersonallyActed:true,historyParticipationLabel:'本人已處理',historyLastParticipatedAt:'2026-09-12T01:00:00Z',historyParticipantSteps:window.__navRow.steps}];
 nav('approvals',null);S.aT='h';setApprovalTabVisual('h');buildApprovals();window.__navOriginal=JSON.stringify(REQS);return true;
 })()`);
 const evidence=[];
 for(const width of [1440,390]){
  await b('set','viewport',String(width),'1000');await b('wait','100');
  const state=await scope(`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,historyText:el('appr-list').innerText,tabLabels:Array.from(document.querySelectorAll('.approval-tabs-scroll .tb')).map(function(b){return b.innerText}),groups:Array.from(document.querySelectorAll('.approval-nav-label')).map(function(n){return n.textContent}),targets:Array.from(document.querySelectorAll('.approval-tabs-scroll .tb')).map(function(b){var r=b.getBoundingClientRect();return {height:r.height,left:r.left,right:r.right,selected:b.getAttribute('aria-selected'),tab:b.dataset.approvalTab};})})`);
  assert.match(state.historyText,/UX-HISTORY-001/);assert.match(state.historyText,/本人已處理/);assert.equal(state.scrollWidth,width);
  if(!baseline){
   assert.deepEqual(state.groups,['待辦','申請','查詢']);assert.equal(state.targets.length,6);assert.equal(state.targets.filter(t=>t.selected==='true').length,1);assert.equal(state.targets.find(t=>t.selected==='true').tab,'h');
   assert(state.targets.every(t=>t.height>=44&&t.left>=0&&t.right<=width+1));
   assert.deepEqual(state.targets.map(t=>t.tab),['p','cashier','mine','drafts','h','rejected']);
   const description=await scope(`(function(){var d=el('approval-tab-description');return {width:d.clientWidth,scrollWidth:d.scrollWidth,height:d.clientHeight,scrollHeight:d.scrollHeight,whiteSpace:getComputedStyle(d).whiteSpace};})()`);
   assert.equal(description.whiteSpace,'normal');assert(description.scrollWidth<=description.width+1);assert(description.scrollHeight<=description.height+1);
   const colors=await scope(`(function(){var s=getComputedStyle(document.querySelector('[data-approval-tab][aria-selected="true"]'));return [s.color,s.backgroundColor];})()`);
   const luminance=color=>color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
   const levels=colors.map(luminance).sort((a,b)=>b-a);assert((levels[0]+.05)/(levels[1]+.05)>=4.5,'Active tab text contrast');
  }
  await b('screenshot',path.join(out,(baseline?'before':'after')+'-'+width+'.png'));evidence.push(state);
 }
 if(!baseline){
  for(const tab of ['p','cashier','mine','drafts','h','rejected']){
   await b('click','[data-approval-tab="'+tab+'"]');
   const state=await scope(`({tab:S.aT,active:document.querySelector('[data-approval-tab][aria-selected="true"]').dataset.approvalTab,label:el('appr-list').getAttribute('aria-labelledby'),description:el('approval-tab-description').textContent,count:document.querySelectorAll('[data-approval-tab][aria-selected="true"]').length})`);
   assert.equal(state.tab,tab);assert.equal(state.active,tab);assert.equal(state.label,'approval-tab-'+tab);assert.equal(state.count,1);assert(state.description.length>10);
  }
  await b('click','[data-approval-tab="p"]');await b('press','ArrowRight');assert.equal(await scope('S.aT'),'cashier');
  await b('press','End');assert.equal(await scope('S.aT'),'rejected');await b('press','Home');assert.equal(await scope('S.aT'),'p');
  await b('press','ArrowLeft');assert.equal(await scope('S.aT'),'rejected');
  assert.equal(await scope('JSON.stringify(REQS)===window.__navOriginal'),true,'Navigation cannot mutate source');
  await scope("(function(){S.aT='h';S.apprQuery='';S.apprPage=1;setApprovalTabVisual('h');buildApprovals();return true;})()");
 }
 assert.equal((await b('errors')).trim(),'');
 fs.writeFileSync(path.join(out,(baseline?'before':'after')+'-evidence.json'),JSON.stringify({ok:true,baseline,evidence,scope:'Actual local DOM with fictional identity and history; no production login or writes.'},null,2));console.log('PASS approval task navigation '+(baseline?'before':'after')+': '+out);
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await b('close').catch(()=>{});server.close();});
