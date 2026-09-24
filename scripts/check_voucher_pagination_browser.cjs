'use strict';
// Actual local index/engines. Only local response exposes closure access;
// fictional transport verifies UI failure handling, SQL tested separately.
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict'),{execFile}=require('child_process'),{promisify}=require('util');
const {applyBuildEnvironment}=require('./finance_build_environment');
const run=promisify(execFile),root=path.resolve(__dirname,'..'),out=process.argv[2]||'/tmp/finance-voucher-pagination-20260913',session='voucher-pagination-'+process.pid;
const source=fs.readFileSync(path.join(root,'index.html'),'utf8');
let html=applyBuildEnvironment(source,{target:'local',supabaseUrl:'',supabaseAnonKey:''});
const anchor='bootAuthGate();\n\n})();';assert(html.includes(anchor));html=html.replace(anchor,'window.__approvalNav={run:async function(code){return await eval(code)}};\n'+anchor).replace(/<script\b[^>]*src=["']https?:[^>]*><\/script>/gi,'').replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="connect-src \'self\'; form-action \'none\'">');
const server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(p!==root&&!p.startsWith(root+'/')){res.writeHead(403);return res.end();}if(p===root||p===path.join(root,'index.html')){res.setHeader('content-type','text/html');return res.end(html);}if(!fs.existsSync(p)||!fs.statSync(p).isFile()){res.writeHead(404);return res.end();}res.setHeader('content-type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(p));});
const b=async(...a)=>(await run('agent-browser',['--session',session,...a],{maxBuffer:8e6,timeout:45000})).stdout;
async function scope(code){let v=JSON.parse(await b('eval','--base64',Buffer.from('(async()=>JSON.stringify(await window.__approvalNav.run('+JSON.stringify(code)+')))()').toString('base64')));return typeof v==='string'?JSON.parse(v):v;}
(async()=>{
 fs.mkdirSync(out,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));await b('open','http://127.0.0.1:'+server.address().port);
 await scope(`(function(){
 USERS=[{id:'fictional-reviewer',n:'匿名主管',email:'reviewer@example.invalid',role:'ceo',rL:'執行長',eid:'A',dc:'D1',active:true}];
 ENTS=[{id:'A',s:'示範甲公司',full:'示範甲公司',active:true},{id:'B',s:'示範乙公司',full:'示範乙公司',active:true}];DEPTS=[{c:'D1',n:'示範部門',eid:'A',lv:3,active:true}];
 REQS=[];INVS=[];BILLS=[];VOUCHERS=[];LEDGER=[];ORG_CHART=[];NOTIFS=[];quickLogin('ceo');
 VOUCHERS=Array.from({length:102},function(_,i){return {id:'voucher-'+i,no:'ANON-'+String(i).padStart(3,'0'),date:i===0?'2025/09/01':i%2?'2026/08/01':'2026/09/01',eid:i%2?'B':'A',entS:'示範公司',desc:'離線虛構傳票 '+i,total:i===101?1250.25:i+1,posted:true,creator:'匿名會計',entries:[{t:'dr',ac:'6202',an:'費用',amt:i===101?1250.25:i+1},{t:'cr',ac:'1112',an:'銀行存款',amt:i===101?1250.25:i+1}]};});
 window.__voucherFixture=JSON.stringify(VOUCHERS);el('v-ent').innerHTML='<option value="">全部法人</option><option value="A">示範甲公司</option><option value="B">示範乙公司</option>';return true;
 })()`);
 await b('wait','200');
 const checks=[],screens=[],timings=[];function check(label,ok){assert(ok,label);checks.push(label);console.log('PASS '+label)}
 for(const width of [1440,390]){
  await b('set','viewport',String(width),'1000');
  await scope(`(function(){el('v-month').value='';el('v-ent').value='';el('v-q').value='';S.voucherPage=1;nav('vouchers');return true;})()`);
  let state=await scope(`({page:S.voucherPage,count:document.querySelectorAll('#voucher-list .voucher-card').length,first:document.querySelector('#voucher-list .voucher-card').innerText,pager:document.querySelector('.voucher-pagination').innerText,overflow:document.documentElement.scrollWidth-innerWidth})`);
  check(width+' first page has exactly 50 full cards and honest loaded-data count',state.page===1&&state.count===50&&state.first.includes('ANON-000')&&state.pager.includes('102')&&state.pager.includes('1–50'));
  check(width+' page does not overflow horizontally',state.overflow<=1);
  const heights=await scope(`Array.from(document.querySelectorAll('.voucher-pagination button')).map(b=>b.getBoundingClientRect().height)`);check(width+' all pagination targets are at least 44px',heights.every(h=>h>=44));
  await b('click','.voucher-pagination [data-voucher-page="2"]');
  state=await scope(`({page:S.voucherPage,count:document.querySelectorAll('#voucher-list .voucher-card').length,text:el('voucher-list').innerText})`);
  check(width+' actual page-two click shows rows 51–100',state.page===2&&state.count===50&&state.text.includes('ANON-050')&&state.text.includes('ANON-099')&&!state.text.includes('ANON-000'));
  await b('click','.voucher-pagination [data-voucher-page="3"]');
  state=await scope(`({page:S.voucherPage,count:document.querySelectorAll('#voucher-list .voucher-card').length,text:el('voucher-list').innerText})`);
  check(width+' final page retains both final records',state.page===3&&state.count===2&&state.text.includes('ANON-100')&&state.text.includes('ANON-101'));
  await b('click','#voucher-list .voucher-card:nth-child(2)');
  const detail=await scope(`({display:getComputedStyle(el('m-voucher')).display,text:el('m-voucher-body').innerText})`);
  check(width+' real card action opens full final-page voucher details',detail.display!=='none'&&detail.text.includes('ANON-101')&&detail.text.includes('借貸分錄'));
  await b('click','#m-voucher .btn-s');
  await b('fill','#v-q','NT$1,250.25');
  state=await scope(`({page:S.voucherPage,count:document.querySelectorAll('#voucher-list .voucher-card').length,text:el('voucher-list').innerText})`);
  check(width+' monetary search scans beyond the original first page and resets pagination',state.page===1&&state.count===1&&state.text.includes('ANON-101'));
  await b('fill','#v-q','');
  await scope(`(function(){el('v-ent').value='B';el('v-ent').dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  state=await scope(`({page:S.voucherPage,count:document.querySelectorAll('#voucher-list .voucher-card').length,text:document.querySelector('.voucher-pagination').innerText})`);
  check(width+' entity filter applies before pagination',state.page===1&&state.count===50&&state.text.includes('51'));
  await scope(`(function(){el('v-ent').value='';el('v-ent').dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  const months=await scope(`Array.from(el('v-month').options).map(o=>o.value)`);
  check(width+' month filter uses loaded year/months rather than hardcoded April/May',JSON.stringify(months)===JSON.stringify(['','2026-09','2026-08','2025-09']));
  await scope(`(function(){el('v-month').value='2026-09';el('v-month').dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  state=await scope(`({count:document.querySelectorAll('#voucher-list .voucher-card').length,text:el('voucher-list').innerText,label:el('v-month')._combo.querySelector('.combo-input').value,stats:el('voucher-stats').innerText})`);
  check(width+' September excludes prior-year and August vouchers and synchronizes combo/KPI',state.count===50&&!state.text.includes('ANON-000')&&!state.text.includes('ANON-001')&&state.text.includes('ANON-100')&&state.label==='2026年9月'&&state.stats.includes('50 張'));
  await scope(`(function(){el('v-month').value='';el('v-month').dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  check(width+' navigation/filtering preserves all source rows and entry details',await scope(`JSON.stringify(VOUCHERS)===window.__voucherFixture`));
  const screen=path.join(out,'voucher-page-one-'+width+'.png');await b('screenshot',screen);screens.push(screen);
 }
 await scope(`(function(){var attack='<img src=x onerror="globalThis.__voucherInjected=true">';var v=VOUCHERS[0];VOUCHERS=[Object.assign({},v,{id:"v');globalThis.__voucherInjected=true;//",desc:attack,no:attack,creator:attack,entS:attack,entries:[{t:'dr',ac:attack,an:attack,amt:1}]})];window.__voucherInjected=false;el('v-q').value='';el('v-ent').value='';el('v-month').value='';renderVouchers();return true;})()`);
 await b('wait','100');
 check('voucher list renders hostile stored text literally with no injected DOM or execution',await scope(`!window.__voucherInjected&&!el('voucher-list').querySelector('img')&&el('voucher-list').innerText.includes('<img')`));
 await b('click','#voucher-list .voucher-card');
 await b('wait','100');
 check('voucher action passes quoted IDs safely and detail escapes stored text',await scope(`getComputedStyle(el('m-voucher')).display!=='none'&&!window.__voucherInjected&&!el('m-voucher-body').querySelector('img')&&el('m-voucher-body').innerText.includes('<img')`));
 await b('click','#m-voucher .btn-s');
 await scope(`(function(){VOUCHERS=JSON.parse(window.__voucherFixture);renderVouchers();return true;})()`);
 const bench=await scope(`(function(){var prior=BILLS;BILLS=Array.from({length:2500},function(_,i){return{id:'fictional-'+i,createdAt:'2026-09-13T12:00:00Z',applicantId:'fictional-reviewer',eid:'A',dc:'D1',note:'獨立來源-'+i,steps:[{rk:'ceo',a:'approved'}],status:'completed'};});var started=performance.now();var items=approvalAllItems();var result={operation:'approvalAllItems',anonymousBillGroups:2500,items:items.length,elapsedMs:performance.now()-started};BILLS=prior;return result;})()`);timings.push(bench);check('actual indexed list preserves all 2500 fictional groups',bench.items===2500);
 check('browser has no page errors',(await b('errors')).trim()==='');
 const evidence={scope:'Actual local browser and shipped renderers, fictional data; no formal login, API or writes.',sourceHash:require('node:crypto').createHash('sha256').update(source).digest('hex'),checks,screens,timings};
 fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2));console.log('PASS voucher pagination browser: '+checks.length+' checks; '+out);
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await b('close').catch(()=>{});server.close();});
