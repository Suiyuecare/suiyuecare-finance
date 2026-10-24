#!/usr/bin/env node
'use strict';
// 2026-10-24 audit hardening: inline handler escaping and exports, CDN integrity,
// response headers, and the OCR Edge Function identity gate. Fictional data only;
// no Supabase, OpenAI or network access.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const esbuild=require('esbuild');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const source=read('index.html');
const engines=fs.readdirSync(path.join(root,'assets/engines')).filter(name=>name.endsWith('.js')).map(name=>read('assets/engines/'+name)).join('\n');
let checks=0;
const check=(label,fn)=>Promise.resolve().then(fn).then(()=>{checks++;console.log('PASS '+label);});
function declaration(name){
  let start=source.indexOf('function '+name+'(');assert.ok(start>=0,name);
  if(source.slice(start-6,start)==='async ')start-=6;
  let depth=0;
  for(let i=source.indexOf('{',start);i<source.length;i++){
    if(source[i]==='{')depth++;else if(source[i]==='}'&&--depth===0)return source.slice(start,i+1);
  }
  throw new Error('unterminated '+name);
}
const handlerAttributes=[...source.matchAll(/\bon[a-z]+="([^"]*)"/g)].map(match=>match[1]);
const decodeAttribute=value=>value.replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');

(async()=>{
  await check('no inline handler splices a raw value into a single-quoted JavaScript string',()=>{
    const raw=handlerAttributes.filter(body=>/\\''\+/.test(body));
    assert.deepEqual(raw,[],'use financeInlineJsString for every interpolated handler argument');
  });

  await check('financeInlineJsString keeps a hostile record id as one inert string argument',()=>{
    const c={};vm.createContext(c);
    vm.runInContext(declaration('escAttr')+'\n'+declaration('financeInlineJsString'),c);
    for(const hostile of ["x');alert(1);//","x\\');alert(1);//",'x");alert(1);//','</div><img src=x onerror=alert(1)>',"a'b\"c&d"]){
      const html='<button onclick="openDetail('+c.financeInlineJsString(hostile)+')">';
      const body=decodeAttribute(/onclick="([^"]*)"/.exec(html)[1]);
      const seen=[];let alerted=false;
      vm.runInNewContext(body,{openDetail:value=>seen.push(value),alert:()=>{alerted=true;}});
      assert.deepEqual(seen,[hostile]);assert.equal(alerted,false);
    }
  });

  await check('a planted draft type or attachment name renders as inert text in both draft views',()=>{
    assert.ok(!/[^(]'\+requestTypeLabel\(/.test(source),'requestTypeLabel output must be escaped before entering HTML');
    const box={innerHTML:''};
    const hostile={id:"d');alert(1)//",type:'<img src=x onerror=alert(1)>',title:'',amount:0,files:[{name:'x.<IMG SRC=X ONERROR=&#97;lert(1)>'}],updatedAt:'2026-10-24T00:00:00Z'};
    const c={DRAFTS:[hostile],NR_TYPES:[{id:'payment_request',n:'付款申請'}],el:id=>id==='draft-list'?box:null,
      loadDrafts(){},updateDraftCounters(){},draftLoadStatusHtml:()=>'',fmt:String,Date,isFinite,String};
    vm.createContext(c);
    vm.runInContext([declaration('escAttr'),declaration('financeInlineJsString'),declaration('requestTypeLabel'),declaration('draftTime'),declaration('renderDrafts')].join('\n'),c);
    c.renderDrafts();
    assert.ok(!/<img/i.test(box.innerHTML),'draft list must not contain a live element from draft data');
    assert.ok(box.innerHTML.includes('&lt;img src=x onerror=alert(1)&gt;'));
    const detail=source.slice(source.indexOf('暫存表單詳情')-2000,source.indexOf('暫存表單詳情')+2000);
    assert.ok(detail.includes("escAttr(String(f.name||f.n||'檔案').split('.').pop().toUpperCase())"),'draft detail escapes attachment extensions');
  });

  await check('every function named by an inline handler is reachable from window',()=>{
    const exported=new Set([...(source+'\n'+engines).matchAll(/(?:window|global)\.([A-Za-z_$][\w$]*)\s*=/g)].map(match=>match[1]));
    const allowed=new Set(['event','this','if','return','Number','String','document','window','setTimeout','clearTimeout','alert','confirm','history','location','Math','JSON','Array','Object','Promise','console','void','typeof','new','navigator','parseInt','parseFloat','encodeURIComponent','isNaN']);
    const missing=new Set();
    for(const body of handlerAttributes){
      for(const call of body.matchAll(/(?:^|[;{}(]\s*|&&\s*|\|\|\s*|\?\s*|:\s*)(?:await\s+)?([A-Za-z_$][\w$]*)\s*\(/g)){
        if(!allowed.has(call[1])&&!exported.has(call[1]))missing.add(call[1]);
      }
    }
    assert.deepEqual([...missing],[],'inline handlers run in global scope; export the IIFE function on window');
    for(const name of ['openApprovalTab','initDeptSel','renderReceiptViewer','receiptViewerMediaLoaded','refreshRemoteData','renderRecvDetail','refreshOrgBulkBatches','refreshApprovalOrgAdminRuntime','refreshMembershipOrgUnitEditorCode','applyLazySummary'])
      assert.ok(source.includes('\nwindow.'+name+'='+name+';'),name);
  });

  await check('optional CDN document libraries load only with npm-tarball integrity and CORS',async()=>{
    const appended=[];
    const c={window:{},Promise,setTimeout:(fn)=>0,clearTimeout:()=>{},Error,
      document:{createElement:()=>({dataset:{},remove(){}}),head:{appendChild:node=>{appended.push(node);
        if(node.dataset.financeDocumentLibrary==='xlsx')c.window.XLSX={read(){},utils:{}};else c.window.PDFLib={PDFDocument:{}};node.onload();}}}};
    vm.createContext(c);
    vm.runInContext('var FINANCE_DOCUMENT_LIBRARY_READS={};var window=this.window;\n'+declaration('ensureFinanceDocumentLibrary'),c);
    await c.ensureFinanceDocumentLibrary('xlsx');await c.ensureFinanceDocumentLibrary('pdf');
    assert.deepEqual(appended.map(node=>[node.src,node.integrity,node.crossOrigin]),[
      ['https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js','sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw','anonymous'],
      ['https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js','sha384-weMABwrltA6jWR8DDe9Jp5blk+tZQh7ugpCsF3JwSA53WZM9/14PjS5LAJNHNjAI','anonymous']]);
  });

  await check('every response carries anti-framing, nosniff, referrer and permissions headers',()=>{
    const all=JSON.parse(read('vercel.json')).headers.find(rule=>rule.source==='/(.*)');
    const map=Object.fromEntries(all.headers.map(header=>[header.key,header.value]));
    assert.equal(map['X-Content-Type-Options'],'nosniff');
    assert.equal(map['X-Frame-Options'],'SAMEORIGIN');
    assert.match(map['Content-Security-Policy'],/frame-ancestors 'self'/);
    assert.match(map['Content-Security-Policy'],/object-src 'none'/);
    assert.equal(map['Referrer-Policy'],'strict-origin-when-cross-origin');
    assert.match(map['Permissions-Policy'],/camera=\(\)/);
  });

  await check('OCR requests carry the signed-in session token, never the anon key as bearer',async()=>{
    assert.equal((source.match(/OPENAI_INVOICE_OCR_ENDPOINT,\{/g)||[]).length,(source.match(/headers:await invoiceOcrRequestHeaders\(\)/g)||[]).length);
    assert.ok(!/'Authorization':'Bearer '\+SUPABASE_ANON_KEY/.test(source));
    const c={SUPABASE_ANON_KEY:'anon-public',session:null,withOperationTimeout:promise=>promise,Error};
    c.getSb=()=>({auth:{getSession:async()=>c.session}});
    vm.createContext(c);vm.runInContext(declaration('invoiceOcrRequestHeaders'),c);
    c.session={data:{session:{access_token:'staff-jwt'}},error:null};
    assert.deepEqual(JSON.parse(JSON.stringify(await c.invoiceOcrRequestHeaders())),{'Content-Type':'application/json',Authorization:'Bearer staff-jwt',apikey:'anon-public'});
    for(const session of [{data:{session:null},error:null},{data:{session:{access_token:'x'}},error:{message:'expired'}}]){
      c.session=session;await assert.rejects(()=>c.invoiceOcrRequestHeaders(),/重新登入/);
    }
  });

  const edgeSource=read('supabase/functions/parse-invoice-openai/index.ts');
  const compiled=esbuild.transformSync(edgeSource,{loader:'ts',format:'cjs'}).code;
  function edge({origins}={}){
    let handler;const calls=[];
    const env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_ANON_KEY:'anon-public',OPENAI_API_KEY:'sk-fixture'};
    if(origins)env.FINANCE_OCR_ALLOWED_ORIGINS=origins;
    const state={modelText:JSON.stringify({invoice_number:'AB12345678'})};
    const fetch=async(url,init={})=>{
      calls.push(url);
      if(url.endsWith('/rest/v1/rpc/current_finance_user_id')){
        const token=String(init.headers.Authorization||'').replace(/^Bearer /,'');
        return new Response(JSON.stringify(token==='staff-jwt'?'u_staff':null),{status:200});
      }
      if(url==='https://api.openai.com/v1/responses')return new Response(JSON.stringify({output_text:state.modelText}),{status:200});
      throw new Error('unexpected fetch '+url);
    };
    vm.runInNewContext(compiled,{Deno:{env:{get:key=>env[key]},serve:fn=>{handler=fn;}},fetch,Response,Request,JSON,Number,String,Error,Record:undefined,console,module:{exports:{}},exports:{}});
    return {call:req=>handler(req),calls,state};
  }
  const post=(token,body,headers={})=>new Request('https://fixture.supabase.co/functions/v1/parse-invoice-openai',{method:'POST',
    headers:{'content-type':'application/json',origin:'https://finance.suiyuecare.com',...(token?{authorization:'Bearer '+token}:{}),...headers},body:JSON.stringify(body)});
  const image={fileName:'receipt.png',mime:'image/png',dataUrl:'data:image/png;base64,AAAA'};

  await check('OCR Edge Function rejects anonymous, anon-key and missing-token callers before OpenAI',async()=>{
    for(const token of [null,'anon-public','forged']){
      const fn=edge();const res=await fn.call(post(token,image));
      assert.equal(res.status,401);assert.ok(!fn.calls.includes('https://api.openai.com/v1/responses'));
    }
  });

  await check('OCR Edge Function serves a verified staff session from the production origin only',async()=>{
    const fn=edge();const res=await fn.call(post('staff-jwt',image));
    assert.equal(res.status,200);assert.equal((await res.json()).invoice.invoice_number,'AB12345678');
    assert.equal(res.headers.get('access-control-allow-origin'),'https://finance.suiyuecare.com');
    const foreign=await edge().call(post('staff-jwt',image,{origin:'https://evil.example'}));
    assert.equal(foreign.headers.get('access-control-allow-origin'),null);
    const preflight=await edge().call(new Request('https://fixture.supabase.co/functions/v1/parse-invoice-openai',{method:'OPTIONS',headers:{origin:'https://evil.example'}}));
    assert.equal(preflight.headers.get('access-control-allow-origin'),null);
    const configured=await edge({origins:'https://finance.suiyuecare.com,http://localhost:4173'}).call(post('staff-jwt',image,{origin:'http://localhost:4173'}));
    assert.equal(configured.headers.get('access-control-allow-origin'),'http://localhost:4173');
  });

  await check('OCR Edge Function refuses non-data URLs and oversized payloads before OpenAI',async()=>{
    for(const body of [{...image,dataUrl:'https://example.com/a.png'},{...image,dataUrl:''},{fileName:'x'}]){
      const fn=edge();assert.equal((await fn.call(post('staff-jwt',body))).status,400);
      assert.ok(!fn.calls.includes('https://api.openai.com/v1/responses'));
    }
    const fn=edge();
    const big=await fn.call(post('staff-jwt',image,{'content-length':String(80_000_000)}));
    assert.equal(big.status,413);assert.ok(!fn.calls.includes('https://api.openai.com/v1/responses'));
  });

  await check('OCR Edge Function never echoes raw model text that may contain IDs or bank numbers',async()=>{
    const fn=edge();fn.state.modelText='身分證 A123456789 帳號 0123456789 not json';
    const res=await fn.call(post('staff-jwt',image));const text=await res.text();
    assert.equal(res.status,502);assert.ok(!text.includes('A123456789'));assert.ok(!text.includes('0123456789'));
  });

  console.log(`Security hardening 2026-10-24: ${checks} checks passed.`);
})().catch(error=>{console.error(error);process.exit(1);});
