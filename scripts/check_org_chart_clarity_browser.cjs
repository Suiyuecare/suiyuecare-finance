#!/usr/bin/env node
'use strict';

// Real Finance page and assets, fictional personnel, blocked external network.
// --baseline-ref captures a prior UI from Git without changing the checkout.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {chromium,webkit}=require('playwright');
const {applyBuildEnvironment}=require('./finance_build_environment');
const fixture=require('./fixtures/org_chart_clarity.cjs')();
const root=path.resolve(__dirname,'..');
const args=process.argv.slice(2);
const option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const baselineRef=option('--baseline-ref','');
const phase=baselineRef?'before':'after';
const output=path.resolve(option('--output',`/tmp/finance-org-chart-clarity-${phase}-${Date.now()}`));
assert(output!==root&&!output.startsWith(root+path.sep),'evidence must stay outside checkout');
const readSource=relative=>baselineRef
  ?execFileSync('git',['show',`${baselineRef}:${relative}`],{cwd:root,encoding:'utf8',maxBuffer:20e6})
  :fs.readFileSync(path.join(root,relative),'utf8');
const readBinary=relative=>baselineRef
  ?execFileSync('git',['show',`${baselineRef}:${relative}`],{cwd:root,maxBuffer:20e6})
  :fs.readFileSync(path.join(root,relative));
const source=readSource('index.html');
const sourceSha256=crypto.createHash('sha256').update(source).digest('hex');
const anchor='bootAuthGate();\n\n})();';
assert(source.includes(anchor),'known application closure anchor');
let html=applyBuildEnvironment(source,{target:'local',supabaseUrl:'',supabaseAnonKey:''})
  .replace(anchor,'window.__orgClarityQA={run:async function(code){return await eval(code)}};\n'+anchor)
  .replace(/<!-- DEMO_LOGIN_START -->[\s\S]*?<!-- DEMO_LOGIN_END -->/g,'')
  .replace(/<script\b[^>]*src=["']https?:[^>]*><\/script>/gi,'')
  .replace('<head>',`<head><meta http-equiv="Content-Security-Policy" content="connect-src 'self'; form-action 'none'">`);
const server=http.createServer((request,response)=>{
  const pathname=new URL(request.url,'http://localhost').pathname;
  const file=path.resolve(root,'.'+pathname);
  if(file!==root&&!file.startsWith(root+path.sep)){response.writeHead(403);return response.end();}
  const relative=file===root?'index.html':path.relative(root,file);
  if(relative==='index.html'){
    response.setHeader('content-type','text/html; charset=utf-8');return response.end(html);
  }
  try{
    const textAsset=/\.(?:js|css|svg|html)$/.test(file),body=textAsset?readSource(relative):readBinary(relative);
    response.setHeader('content-type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.png')?'image/png':file.endsWith('.webp')?'image/webp':file.endsWith('.jpg')||file.endsWith('.jpeg')?'image/jpeg':'application/octet-stream');
    return response.end(body);
  }catch(error){response.writeHead(404);return response.end();}
});
const checks=[],screenshots=[],errors=[];
function check(name,actual,expected=true){assert.deepEqual(actual,expected,name);checks.push(name);}
async function snapshot(page){return page.evaluate(()=>window.__orgClarityQA.run('JSON.stringify({rows:ORG_CHART,persisted:ORG_CHART_PERSISTED,revision:ORG_CHART_REVISION,dirty:ORG_CHART_DIRTY})'));}
async function setup(page){
  await page.evaluate(f=>window.__orgClarityQA.run(`(function(f){
    USERS=f.users;ENTS=f.entities;DEPTS=f.departments;
    REQS=[];INVS=[];BILLS=[];DRAFTS=[];NOTIFS=[];VOUCHERS=[];LEDGER=[];
    S.demoLogin=true;S.user=USERS[0];doEnter(S.user);
    MEMBERSHIP_ORG_RUNTIME={loading:false,available:false,error:'',graph:null};
    ORG_CHART=structuredClone(f.rows);ORG_CHART_PERSISTED=structuredClone(f.rows);
    ORG_CHART_REVISION=f.revision;ORG_CHART_DIRTY=false;ORG_CHART_CONFLICT=false;
    window.__orgRpcCalls=[];window.__orgAlerts=[];
    window.alert=function(message){window.__orgAlerts.push(String(message));};
    getSb=function(){return{rpc:async function(name,args){window.__orgRpcCalls.push({name:name,args:args});return{error:{message:'fictional transport blocks '+name}};}};};
    nav('orgchart',el('nav-orgchart'));buildOrgChart();
    window.__orgReady=true;
    return true;
  })(window.__orgFixture)`),fixture);
}
async function run(page,code){return page.evaluate(code=>window.__orgClarityQA.run(code),code);}
async function settle(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function capture(page,engine,width,name){
  const file=path.join(output,`${phase}-${engine}-${width}${name?'-'+name:''}.png`);
  await page.screenshot({path:file,fullPage:false,animations:'disabled'});screenshots.push(file);
}
async function visualState(page){return page.evaluate(()=>{
  const visible=node=>!!node&&node.checkVisibility({checkVisibilityCSS:true});
  const dimensions=selector=>{const node=document.querySelector(selector),rect=node&&node.getBoundingClientRect();return rect?{width:rect.width,height:rect.height}:null;};
  const buttons=[...document.querySelectorAll('#pg-orgchart .org-mode-switch button,#org-explorer button,#org-chart-person-detail button')]
    .filter(visible).map(node=>({label:node.getAttribute('aria-label')||node.textContent.trim(),height:node.getBoundingClientRect().height,width:node.getBoundingClientRect().width,minHeight:getComputedStyle(node).minHeight,computedHeight:getComputedStyle(node).height}));
  const row=document.querySelector('#org-chart-results .org-outline-row'),filters=document.querySelector('.org-explorer-filters');
  return {documentWidth:document.documentElement.scrollWidth,viewport:innerWidth,
    filterColumns:filters&&getComputedStyle(filters).gridTemplateColumns,
    rowBackground:row&&getComputedStyle(row).backgroundColor,rowBorder:row&&getComputedStyle(row).borderTopWidth,
    row:dimensions('#org-chart-results .org-outline-row'),buttons,
    chartPane:visible(document.querySelector('#org-explorer')),peoplePane:visible(document.querySelector('#org-legacy-people'))};
});}
async function fontAndNavigationState(page){return page.evaluate(()=>{
  // The same canonical dashboard classes from the user's preferred panel,
  // measured in the real page stylesheet without changing application state.
  const sample=document.createElement('div');sample.className='dash-action-row';
  sample.style.cssText='position:absolute;visibility:hidden;pointer-events:none';
  sample.innerHTML='<div><strong>虛構系統健檢</strong><span>虛構說明</span></div>';
  document.querySelector('#pg-dashboard').appendChild(sample);
  const css=node=>{const s=getComputedStyle(node);return{family:s.fontFamily,weight:s.fontWeight,size:parseFloat(s.fontSize),spacing:s.letterSpacing,color:s.color,rendering:s.textRendering};};
  const nav=document.querySelector('.ni.on'),row=document.querySelector('.org-outline-row');
  const result={name:css(document.querySelector('.org-outline-name')),body:css(document.querySelector('.org-outline-title')),
    dashboardName:css(sample.querySelector('strong')),dashboardBody:css(sample.querySelector('span')),
    nav:{background:getComputedStyle(nav).backgroundColor,color:getComputedStyle(nav).color},
    rowBorder:{width:getComputedStyle(row).borderLeftWidth,style:getComputedStyle(row).borderLeftStyle}};
  sample.remove();return result;
});}
async function graphGeometryState(page){return page.evaluate(()=>{
  const stage=document.querySelector('#org-chart-view'),canvas=stage.querySelector('.org-tree-canvas'),rect=canvas.getBoundingClientRect();
  const cards=[...stage.querySelectorAll('.org-chart-card[data-org-person-id]')].map(node=>({id:node.dataset.orgPersonId,rect:node.getBoundingClientRect(),textOverflow:[...node.querySelectorAll('span')].some(part=>part.scrollWidth>part.clientWidth+1),parts:[...node.querySelectorAll('span')].map(part=>part.getBoundingClientRect())}));
  const paths=[...stage.querySelectorAll('.org-chart-connector[data-from][data-to]')];
  const invalidCards=cards.filter(card=>card.rect.left<rect.left-1||card.rect.top<rect.top-1||card.rect.right>rect.right+1||card.rect.bottom>rect.bottom+1).map(card=>card.id);
  const invalidContent=cards.filter(card=>card.textOverflow||card.parts.some(part=>part.left<card.rect.left-.5||part.right>card.rect.right+.5||part.top<card.rect.top-.5||part.bottom>card.rect.bottom+.5)).map(card=>card.id);
  if(invalidContent.length)window.__orgContentFailure=cards.filter(card=>invalidContent.includes(card.id)).map(card=>({id:card.id,rect:card.rect.toJSON(),parts:card.parts.map(rect=>rect.toJSON()),html:stage.querySelector('[data-org-person-id=\"'+card.id+'\"]').outerHTML}));
  const invalidEdges=[];
  paths.forEach(path=>{
    const matrix=path.getScreenCTM(),total=path.getTotalLength();
    const point=distance=>{const p=path.getPointAtLength(distance);return new DOMPoint(p.x,p.y).matrixTransform(matrix);};
    const a=cards.find(card=>card.id===path.dataset.from),b=cards.find(card=>card.id===path.dataset.to);
    if(!a||!b){invalidEdges.push({from:path.dataset.from,to:path.dataset.to,reason:'missing endpoint'});return;}
    const borderDistance=(p,r)=>Math.min(Math.hypot(p.x-Math.max(r.left,Math.min(r.right,p.x)),p.y-r.top),Math.hypot(p.x-Math.max(r.left,Math.min(r.right,p.x)),p.y-r.bottom),Math.hypot(p.x-r.left,p.y-Math.max(r.top,Math.min(r.bottom,p.y))),Math.hypot(p.x-r.right,p.y-Math.max(r.top,Math.min(r.bottom,p.y))));
    if(borderDistance(point(0),a.rect)>2||borderDistance(point(total),b.rect)>2)invalidEdges.push({from:a.id,to:b.id,reason:'detached endpoint'});
    for(let step=0;step<=60;step++){
      const p=point(total*step/60);
      if(p.x<rect.left-1||p.x>rect.right+1||p.y<rect.top-1||p.y>rect.bottom+1){invalidEdges.push({from:a.id,to:b.id,reason:'outside canvas'});break;}
      const cover=cards.find(card=>card.id!==a.id&&card.id!==b.id&&p.x>card.rect.left+2&&p.x<card.rect.right-2&&p.y>card.rect.top+2&&p.y<card.rect.bottom-2);
      if(cover){invalidEdges.push({from:a.id,to:b.id,reason:'crosses card',card:cover.id});break;}
    }
  });
  return{invalidCards,invalidContent,invalidEdges,canvasWidth:rect.width,canvasHeight:rect.height,stageWidth:stage.clientWidth,stageHeight:stage.clientHeight,
    buttons:[...document.querySelectorAll('.org-graph-toolbar button')].filter(node=>node.checkVisibility()).map(node=>({id:node.id,width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height}))};
});}
async function cardState(page){return page.evaluate(()=>({
  count:document.querySelectorAll('#org-chart-view .org-chart-card[data-org-person-id]').length,
  pairs:[...document.querySelectorAll('#org-chart-view .org-chart-card[data-org-person-id]')].map(card=>[card.dataset.orgPersonId,card.dataset.orgSupervisorId||'']),
  connectors:[...document.querySelectorAll('#org-chart-view .org-chart-connector[data-from][data-to]')].map(edge=>[edge.dataset.from,edge.dataset.to]),
  documentWidth:document.documentElement.scrollWidth,viewport:innerWidth,
  chartWidth:document.querySelector('#org-chart-view')?.clientWidth||0,
  chartScrollWidth:document.querySelector('#org-chart-view')?.scrollWidth||0
}));}
async function receiveDownload(page,selector){
  const waiting=page.waitForEvent('download');await page.locator(selector).click();
  const download=await waiting;
  assert.equal(await download.failure(),null,'download should complete');
  const stream=await download.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);
  return{filename:download.suggestedFilename(),body:Buffer.concat(chunks)};
}
async function svgState(page,text){return page.evaluate(svg=>{
  const doc=new DOMParser().parseFromString(svg,'image/svg+xml'),root=doc.documentElement;
  let bounds=null;
  if(!doc.querySelector('parsererror,script,foreignObject')){
    const holder=document.createElement('div');holder.style.cssText='position:fixed;left:-20000px;top:0;visibility:hidden;pointer-events:none';
    const rendered=document.importNode(root,true);holder.appendChild(rendered);document.body.appendChild(holder);
    const box=rendered.getBBox();bounds={x:box.x,y:box.y,width:box.width,height:box.height};holder.remove();
  }
  return{bounds,error:!!doc.querySelector('parsererror'),scripts:doc.querySelectorAll('script,foreignObject').length,
    ids:[...doc.querySelectorAll('[data-org-person-id],[data-person-id]')].map(node=>node.getAttribute('data-org-person-id')||node.getAttribute('data-person-id')),
    edges:[...doc.querySelectorAll('[data-from][data-to]')].map(node=>[node.getAttribute('data-from'),node.getAttribute('data-to')]),
    text:root.textContent,viewBox:(root.getAttribute('viewBox')||'').split(/\s+/).map(Number),
    width:parseFloat(root.getAttribute('width')),height:parseFloat(root.getAttribute('height')),
    links:[...doc.querySelectorAll('[href],[src]')].map(node=>node.getAttribute('href')||node.getAttribute('src'))};
},text);}
async function compactGraphChecks(page,engine,width,original){
  const label=`${engine} ${width} compact graph`;
  for(const id of ['org-graph-fit','org-graph-zoom-out','org-graph-zoom-in','org-graph-reset','org-graph-download-png','org-graph-download-svg']){
    check(label+' '+id+' visible',await page.locator('#'+id).isVisible());
    check(label+' '+id+' touch target',await page.locator('#'+id).evaluate(node=>node.getBoundingClientRect().height>=44));
  }
  check(label+' current filters remain usable',await page.locator('#org-chart-query').isVisible());
  let geometry=await graphGeometryState(page);
  check(label+' all card borders inside graph bounds',geometry.invalidCards,[]);
  if(geometry.invalidContent.length)console.error('Card content overflow',JSON.stringify(await page.evaluate(()=>window.__orgContentFailure)));
  check(label+' long names and titles stay inside their cards',geometry.invalidContent,[]);
  check(label+' connectors meet cards without clipping or crossing other cards',geometry.invalidEdges,[]);
  await page.locator('#org-graph-reset').click();await settle(page);
  const fullSize=await graphGeometryState(page);
  await page.locator('#org-graph-zoom-out').click();await settle(page);
  geometry=await graphGeometryState(page);
  check(label+' zoom out reduces graph',geometry.canvasWidth<fullSize.canvasWidth);
  check(label+' zoom preserves connector attachment',geometry.invalidEdges,[]);
  await page.locator('#org-graph-zoom-in').click();await settle(page);
  check(label+' zoom in enlarges graph',(await graphGeometryState(page)).canvasWidth>geometry.canvasWidth);
  await page.locator('#org-graph-fit').click();await settle(page);
  geometry=await graphGeometryState(page);
  check(label+' fit makes the complete graph visible in its stage',geometry.canvasWidth<=geometry.stageWidth+2&&geometry.canvasHeight<=geometry.stageHeight+2);
  check(label+' fit keeps card borders inside graph',geometry.invalidCards,[]);
  check(label+' zoom preserves card text boundaries',geometry.invalidContent,[]);
  check(label+' fit keeps connectors exact',geometry.invalidEdges,[]);
  if(width===1440||width===375)await capture(page,engine,width,'fit-graph');
  const svgDownload=await receiveDownload(page,'#org-graph-download-svg');
  check(label+' svg download extension',svgDownload.filename.endsWith('.svg'));
  const svg=await svgState(page,svgDownload.body.toString('utf8'));
  check(label+' valid standalone SVG',svg.error,false);
  check(label+' SVG keeps all text and borders inside viewBox',svg.bounds&&svg.bounds.x>=-1&&svg.bounds.y>=-1&&svg.bounds.x+svg.bounds.width<=svg.width+1&&svg.bounds.y+svg.bounds.height<=svg.height+1);
  check(label+' SVG contains every active person',svg.ids.length,fixture.expected.activeCount);
  check(label+' SVG contains actual cross-company edge',svg.edges.some(edge=>edge[0]==='mgr-care'&&edge[1]==='cross-company-staff'));
  check(label+' SVG contains no cycle edges',svg.edges.some(edge=>fixture.expected.cycle.includes(edge[0])&&fixture.expected.cycle.includes(edge[1])),false);
  check(label+' SVG avoids scripts and foreign objects',svg.scripts,0);
  check(label+' SVG escapes literal label punctuation',svg.text.includes('虛構 <&\" 員'));
  check(label+' SVG contains no serialized event handlers',/\son[a-z]+\s*=/i.test(svgDownload.body.toString('utf8')),false);
  check(label+' SVG never includes login email',svg.text.includes('@suiyuecare.com'),false);
  check(label+' SVG never includes contact email',svg.text.includes('@example.invalid'),false);
  check(label+' SVG needs no external resources',svg.links.filter(link=>link&&!link.startsWith('#')),[]);
  const naturalSize=await run(page,'(function(){var layout=orgGraphLayout();return {width:layout.width,height:layout.height};})()');
  check(label+' SVG exports complete natural width despite viewport zoom',svg.width,naturalSize.width);
  check(label+' SVG exports full natural height plus header',svg.height>naturalSize.height);
  if(width===1440)fs.writeFileSync(path.join(output,`export-${engine}-all.svg`),svgDownload.body);
  const pngDownload=await receiveDownload(page,'#org-graph-download-png');
  check(label+' PNG download extension',pngDownload.filename.endsWith('.png'));
  check(label+' PNG binary signature',pngDownload.body.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  const pngWidth=pngDownload.body.readUInt32BE(16),pngHeight=pngDownload.body.readUInt32BE(20);
  check(label+' PNG exports full natural graph width',pngWidth>=naturalSize.width);
  check(label+' PNG exports full natural graph height',pngHeight>=svg.height);
  check(label+' PNG contains full graph aspect ratio',Math.abs(pngWidth/pngHeight-svg.width/svg.height)<.01);
  if(width===1440)fs.writeFileSync(path.join(output,`export-${engine}-all.png`),pngDownload.body);
  if(width===1440){
    await page.evaluate(()=>{window.__orgNativeToBlob=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(callback){callback(null);};});
    let fallback;
    try{fallback=await receiveDownload(page,'#org-graph-download-png');}
    finally{await page.evaluate(()=>{HTMLCanvasElement.prototype.toBlob=window.__orgNativeToBlob;delete window.__orgNativeToBlob;});}
    const fallbackSvg=await svgState(page,fallback.body.toString('utf8'));
    check(label+' unavailable PNG still downloads complete vector chart',fallbackSvg.ids.length,fixture.expected.activeCount);
    check(label+' PNG fallback has honest SVG extension',fallback.filename.endsWith('.svg'));
    check(label+' PNG fallback restores usable download button',await page.locator('#org-graph-download-png').isEnabled());
    check(label+' PNG fallback explains actual format',await page.locator('#org-graph-export-status').evaluate(node=>node.textContent.includes('SVG')&&node.textContent.includes('PNG')));
  }

  await page.locator('#org-chart-company').selectOption('E2');
  await page.locator('#org-chart-department').selectOption('X2');
  await page.locator('#org-chart-query').fill('虛構跨法人支援員');await settle(page);
  const scoped=await cardState(page);
  check(label+' filtered graph keeps selected person and ancestors',scoped.pairs.map(pair=>pair[0]).sort(),['ceo-a','cross-company-staff','mgr-care']);
  const scopedDownload=await receiveDownload(page,'#org-graph-download-svg');
  const scopedSvg=await svgState(page,scopedDownload.body.toString('utf8'));
  check(label+' download follows current filters',scopedSvg.ids.sort(),['ceo-a','cross-company-staff','mgr-care']);
  if(width===1440)fs.writeFileSync(path.join(output,`export-${engine}-filtered.svg`),scopedDownload.body);
  if(scopedSvg.bounds.x+scopedSvg.bounds.width>scopedSvg.width+1)console.error('Filtered SVG bounds',JSON.stringify({width:scopedSvg.width,height:scopedSvg.height,bounds:scopedSvg.bounds}));
  check(label+' narrow filtered SVG header and cards stay in bounds',scopedSvg.bounds&&scopedSvg.bounds.x>=-1&&scopedSvg.bounds.x+scopedSvg.bounds.width<=scopedSvg.width+1&&scopedSvg.bounds.y+scopedSvg.bounds.height<=scopedSvg.height+1);
  check(label+' filtered export labels context ancestors',scopedSvg.text.includes('上層主管'));
  check(label+' filtered export retains actual cross-company parent',scopedSvg.edges.some(edge=>edge[0]==='mgr-care'&&edge[1]==='cross-company-staff'));
  if(width===1440){fs.writeFileSync(path.join(output,`export-${engine}-filtered.svg`),scopedDownload.body);await capture(page,engine,width,'filtered-graph');}
  await page.locator('#org-chart-query').fill('');
  await page.locator('#org-chart-company').selectOption('');await page.locator('#org-chart-department').selectOption('');await settle(page);
  check(label+' reset filters restores all people',(await cardState(page)).count,fixture.expected.activeCount);
  check(label+' zoom and download never modify organization state',await snapshot(page),original);
}
async function afterChecks(page,engine,width){
  const label=`${engine} ${width}`;
  const explorer=page.locator('#org-explorer');
  check(label+' explorer visible',await explorer.isVisible());
  for(const selector of ['#org-chart-query','#org-chart-company','#org-chart-department','#org-chart-results','#org-chart-person-detail','#org-chart-result-count','#org-chart-mode-outline','#org-chart-mode-full']){
    check(label+' '+selector+' exists',await page.locator(selector).count(),1);
  }
  for(const selector of ['#org-chart-company','#org-chart-department'])check(label+' native '+selector,await page.locator(selector).evaluate(node=>node.tagName),'SELECT');
  const initialVisual=await visualState(page);
  check(label+' no initial body horizontal overflow',initialVisual.documentWidth<=width+1);
  check(label+' outlined rows have visual grouping',!!initialVisual.row&&initialVisual.row.height>=64&&initialVisual.rowBorder!=='0px'&&initialVisual.rowBackground!=='rgba(0, 0, 0, 0)');
  check(label+' visible explorer controls are at least 44px high',initialVisual.buttons.filter(button=>button.height<44),[]);
  check(label+' chart pane active',initialVisual.chartPane,true);
  if(width<=430)check(label+' settings pane inactive on chart tab',initialVisual.peoplePane,false);
  await page.locator('#org-chart-results').evaluate(node=>node.scrollIntoView({block:'start'}));await settle(page);
  await capture(page,engine,width,'outline');
  const original=await snapshot(page);
  const typography=await fontAndNavigationState(page);
  check(label+' selected navigation restores brand orange',typography.nav.background,'rgb(234, 136, 12)');
  check(label+' selected navigation uses white text',typography.nav.color,'rgb(255, 255, 255)');
  check(label+' outline name shares dashboard font family',typography.name.family,typography.dashboardName.family);
  check(label+' outline description shares dashboard font family',typography.body.family,typography.dashboardBody.family);
  check(label+' outline name uses restrained weight',typography.name.weight,'700');
  check(label+' outline body uses normal weight',typography.body.weight,'400');
  check(label+' outline retains complete left border',typography.rowBorder.style,'solid');
  check(label+' outline has visible left border',parseFloat(typography.rowBorder.width)>=1);

  const selected=page.locator('[data-org-select="cross-company-staff"]');
  const query=page.locator('#org-chart-query');
  await query.fill('虛構跨法人支援員');await settle(page);
  check(label+' matching cross-company row',await selected.count(),1);
  const cross=page.locator('.org-outline-row[data-org-person-id="cross-company-staff"]');
  check(label+' canonical cross-company parent',await cross.getAttribute('data-org-supervisor-id'),'mgr-care');
  check(label+' parent shown only as context',await page.locator('.org-outline-row.org-outline-context[data-org-person-id="mgr-care"]').count()>0);
  check(label+' query keeps focus',await query.evaluate(node=>document.activeElement===node));
  check(label+' query does not mutate rows',await snapshot(page),original);
  await selected.click();
  const detail=page.locator('#org-chart-person-detail');
  check(label+' detail names the actual supervisor',(await detail.innerText()).includes('虛構照護主管'));
  check(label+' detail names selected person',(await detail.innerText()).includes('虛構跨法人支援員'));
  await capture(page,engine,width,'detail');
  const parentSelect=page.locator('#org-chart-person-detail [data-org-detail-select="mgr-care"]');
  check(label+' selected detail links to actual supervisor',await parentSelect.count(),1);
  await parentSelect.click();
  check(label+' supervisor link selects real parent',(await detail.innerText()).includes('虛構照護主管'));
  check(label+' supervisor link does not mutate rows',await snapshot(page),original);
  await query.fill('虛構跨法人支援員');await settle(page);
  const contextSelect=page.locator('.org-outline-context[data-org-person-id="mgr-care"] [data-org-select="mgr-care"]');
  check(label+' ancestor context is selectable',await contextSelect.count(),1);
  await contextSelect.click();
  check(label+' ancestor context opens actual person detail',(await detail.locator('h3').innerText()),'虛構照護主管');
  check(label+' ancestor selection keeps query',await query.inputValue(),'虛構跨法人支援員');
  await query.fill('');
  await page.locator('#org-chart-company').selectOption('E2');
  await page.locator('#org-chart-department').selectOption('X2');
  await settle(page);
  check(label+' filtered cross-company person retains parent',await page.locator('.org-outline-row[data-org-person-id="cross-company-staff"]').getAttribute('data-org-supervisor-id'),'mgr-care');
  check(label+' filters do not mutate rows',await snapshot(page),original);
  await page.locator('#org-chart-company').selectOption('');
  await page.locator('#org-chart-department').selectOption('');
  const toggle=page.locator('[data-org-toggle="mgr-care"]');
  check(label+' disclosure exists',await toggle.count()>0);
  const was=await toggle.getAttribute('aria-expanded');await toggle.click();
  check(label+' disclosure updates aria-expanded',(await toggle.getAttribute('aria-expanded'))!==was);
  check(label+' disclosure does not mutate rows',await snapshot(page),original);
  await query.fill('虛構跨法人支援員');await settle(page);
  const filterToggle=page.locator('[data-org-toggle="mgr-care"]');
  check(label+' filtered branch initially expanded',await filterToggle.getAttribute('aria-expanded'),'true');
  await filterToggle.click();
  check(label+' filtered branch can collapse',await page.locator('[data-org-toggle="mgr-care"]').getAttribute('aria-expanded'),'false');
  check(label+' filtered collapse hides only nested row',await page.locator('[data-org-select="cross-company-staff"]').count(),0);
  await page.locator('[data-org-toggle="mgr-care"]').click();
  check(label+' filtered branch can reopen',await page.locator('[data-org-select="cross-company-staff"]').count(),1);
  check(label+' filtered disclosure leaves rows unchanged',await snapshot(page),original);
  for(const [id,warning] of [['orphan','缺直屬主管'],['inactive-report','主管已停用'],['cycle-a','主管循環']]){
    await query.fill(fixture.users.find(user=>user.id===id).n);
    await settle(page);
    check(label+' '+id+' remains discoverable',await page.locator(`[data-org-select="${id}"]`).count()>0);
    await page.locator(`[data-org-select="${id}"]`).click();
    check(label+' '+id+' warning visible',(await detail.innerText()).includes(warning));
  }
  check(label+' anomaly browsing does not mutate rows',await snapshot(page),original);
  await query.fill('');
  for(const [person,supervisor] of [['cycle-a','cycle-b'],['cycle-b','cycle-a']]){
    const row=page.locator(`.org-outline-row[data-org-person-id="${person}"]`);
    check(label+' cycle row retains actual configured supervisor '+person,await row.getAttribute('data-org-supervisor-id'),supervisor);
    check(label+' cycle row stands outside the other cycle branch '+person,await row.evaluate((node,other)=>!node.closest('li').querySelector(`.org-outline-row[data-org-person-id="${other}"]`),supervisor));
    check(label+' cycle row visibly flagged '+person,(await row.locator('xpath=..').innerText()).includes('主管關係待確認'));
  }
  check(label+' cycle model retains true assignment',await run(page,"ORG_EXPLORER_MODEL.actualParent.get('cycle-a')"),'cycle-b');
  await query.fill('虛構深層成員');await settle(page);
  check(label+' deep search reveals nested person',await page.locator('[data-org-select="deep-person"]').count(),1);
  await page.locator('[data-org-select="deep-person"]').click();
  await query.fill('');await settle(page);
  check(label+' clear keeps selected deep row rendered',await page.locator('[data-org-select="deep-person"]').count(),1);
  if(width<=430)await page.locator('#org-chart-person-detail .org-detail-back').click();
  else await run(page,'window.orgExplorerBack()');
  check(label+' back focuses selected deep row',await page.evaluate(()=>document.activeElement?.dataset?.orgSelect||''),'deep-person');
  check(label+' deep search and clear never mutate rows',await snapshot(page),original);
  await run(page,"window.orgExplorerSelect('ceo-a')");
  await page.locator('#org-chart-mode-full').click();await settle(page);
  check(label+' full graph visible',await page.locator('#org-chart-view').isVisible());
  await page.locator('#org-chart-view').evaluate(node=>node.scrollIntoView({block:'start'}));await settle(page);
  await capture(page,engine,width,'full');
  const cards=await cardState(page);
  check(label+' one card per active person',cards.count,fixture.expected.activeCount);
  check(label+' cross-company edge remains exact',cards.pairs.some(pair=>pair[0]==='cross-company-staff'&&pair[1]==='mgr-care'));
  check(label+' cross-company connector remains exact',cards.connectors.some(pair=>pair[0]==='mgr-care'&&pair[1]==='cross-company-staff'));
  check(label+' full graph breaks cycle display links',cards.pairs.filter(pair=>fixture.expected.cycle.includes(pair[0])).every(pair=>pair[1]===''));
  check(label+' full graph has no cycle connector',cards.connectors.some(pair=>fixture.expected.cycle.includes(pair[0])&&fixture.expected.cycle.includes(pair[1])),false);
  check(label+' document has no horizontal overflow',cards.documentWidth<=width+1);
  check(label+' graph scrolls inside its stage',cards.chartScrollWidth>=cards.chartWidth);
  check(label+' mode changes do not mutate rows',await snapshot(page),original);
  await compactGraphChecks(page,engine,width,original);
  await page.locator('#org-chart-mode-outline').click();await settle(page);
  if(width<=430){
    const tabs=page.locator('[data-mobile-org-tabs]');
    check(label+' mobile chart tab visible',await tabs.isVisible());
    await page.locator('[data-mobile-org-tab="people"]').click();
    check(label+' people tab selected',await page.locator('[data-mobile-org-tab="people"]').getAttribute('aria-selected'),'true');
    check(label+' people pane visible',await page.locator('#org-legacy-people').isVisible());
    check(label+' explorer hidden on people tab',await page.locator('#org-explorer').isVisible(),false);
    await page.locator('[data-mobile-org-tab="chart"]').click();
    check(label+' chart tab restored',await page.locator('[data-mobile-org-tab="chart"]').getAttribute('aria-selected'),'true');
    check(label+' explorer visible on chart tab',await page.locator('#org-explorer').isVisible(),true);
    check(label+' settings pane hidden on chart tab',await page.locator('#org-legacy-people').isVisible(),false);
  }
  await run(page,"window.orgExplorerSelect('staff-02')");
  check(label+' duplicate-name selected by ID',await run(page,'ORG_EXPLORER_STATE.selected'),'staff-02');
  await page.locator('#org-chart-person-detail .org-detail-edit').click();
  const editTarget=page.locator('#org-editor .org-editor-row[data-supervisor-id="staff-02"]');
  check(label+' duplicate-name edit opens settings pane',await page.locator('#org-legacy-people').isVisible(),true);
  check(label+' duplicate-name edit exposes exact row',await editTarget.isVisible(),true);
  check(label+' duplicate-name edit expands exact row',await editTarget.getAttribute('aria-expanded'),'true');
  check(label+' duplicate-name edit does not expand namesake',(await page.locator('#org-editor .org-editor-row[data-supervisor-id="staff-01"]').getAttribute('aria-expanded'))==='true',false);
  check(label+' duplicate-name edit keeps row data intact',await snapshot(page),original);
  await run(page,"window.mobileOrgTab('chart')");
  await run(page,"S.user=USERS.find(function(user){return user.id==='staff-01'});buildOrgChart();");
  await run(page,"window.orgExplorerSelect('staff-01')");
  check(label+' readonly supervisor selects disabled',await page.locator('#org-editor .org-supervisor:not([disabled])').count(),0);
  check(label+' readonly detail has no edit action',await page.locator('#org-chart-person-detail .org-detail-edit').count(),0);
  check(label+' readonly detail retains contact email',(await page.locator('#org-chart-person-detail').innerText()).includes('fictional-staff-01@example.invalid'));
  check(label+' readonly contact hides login',(await page.locator('#pg-orgchart').innerText()).includes('fictional-staff-01@suiyuecare.com'),false);
  await page.locator('#org-chart-mode-full').click();await settle(page);
  check(label+' readonly full graph also hides login',(await page.locator('#org-chart-view').innerText()).includes('@suiyuecare.com'),false);
  const readOnlyExport=await receiveDownload(page,'#org-graph-download-svg');
  const readOnlySvg=await svgState(page,readOnlyExport.body.toString('utf8'));
  check(label+' readonly export has no login or contact emails',/@(?:suiyuecare\.com|example\.invalid)/.test(readOnlySvg.text),false);
  check(label+' readonly download contains all visible people',readOnlySvg.ids.length,fixture.expected.activeCount);
  await run(page,'saveOrgChart()');
  check(label+' no write RPCs',await run(page,"window.__orgRpcCalls.filter(function(call){return /save|publish|upsert|update|delete|import|submit|execute/i.test(call.name)}).length"),0);
  check(label+' readonly never mutates rows',await snapshot(page),original);
}
let browser;
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  for(const [engine,launcher] of [['chrome',chromium],['webkit',webkit]].filter(([name])=>option('--engine',name)===name)){
    browser=await launcher.launch(engine==='chrome'?{headless:true,channel:process.env.FINANCE_BROWSER_CHANNEL||'chrome'}:{headless:true});
    for(const width of [1440,900,390,375].filter(value=>Number(option('--width',value))===value)){
      const context=await browser.newContext({viewport:{width,height:width<600?844:1000}});
      await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
      const page=await context.newPage();page.setDefaultTimeout(12000);
      page.on('pageerror',error=>errors.push(`${engine} ${width}: ${error.message}`));
      page.on('dialog',dialog=>dialog.dismiss());
      await page.goto(origin,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>!!window.__orgClarityQA);
      await page.evaluate(f=>{window.__orgFixture=f;},fixture);
      await setup(page);await page.waitForFunction(()=>window.__orgReady===true);await settle(page);
      const initial=await cardState(page);
      if(baselineRef){
        if(await page.locator('#org-explorer').count()){
          await capture(page,engine,width,'initial');
          await page.locator('#org-chart-results').evaluate(node=>node.scrollIntoView({block:'start'}));await settle(page);
          await capture(page,engine,width,'outline');
          await page.locator('#org-chart-mode-full').click();await settle(page);
          await page.locator('#org-chart-view').evaluate(node=>node.scrollIntoView({block:'start'}));await settle(page);
          Object.assign(initial,await cardState(page));
        }
        check(`${engine} ${width} baseline cards cover all active people`,initial.count,fixture.expected.activeCount);
        check(`${engine} ${width} baseline cross-company supervisor`,initial.pairs.some(pair=>pair[0]==='cross-company-staff'&&pair[1]==='mgr-care'));
      }else{
        check(`${engine} ${width} outline starts without rendering the huge full graph`,initial.count,0);
        check(`${engine} ${width} outline starts visible`,await page.locator('#org-explorer').isVisible());
      }
      await capture(page,engine,width,'');
      if(!baselineRef)await afterChecks(page,engine,width);
      check(`${engine} ${width} no page errors`,errors.filter(error=>error.startsWith(`${engine} ${width}:`)),[]);
      await context.close();
    }
    await browser.close();browser=null;
  }
  const report={phase,baselineRef:baselineRef||null,sourceSha256,fixtureSha256:crypto.createHash('sha256').update(JSON.stringify(fixture)).digest('hex'),
    people:fixture.users.length,activePeople:fixture.expected.activeCount,checks:checks.length,screenshots,errors,
    scope:'Actual local Finance page and assets, fictional personnel, no production identity or network'};
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(`PASS ${phase} org chart clarity: ${checks.length} checks; ${output}`);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
