#!/usr/bin/env node
'use strict';
// Isolated acceptance: actual HTML -> HTTP -> PostgreSQL RPC -> JSON -> DOM.
// Fictional identities and documents. This is NOT Google OAuth/production proof.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const { PGlite } = require('@electric-sql/pglite');
const { createRequire } = require('node:module');
const { applyBuildEnvironment } = require('./finance_build_environment');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.env.FINANCE_SEARCH_EVIDENCE || '/tmp/finance-search-summary-acceptance-20260915');
assert(output !== root && !output.startsWith(root + path.sep));
const tenant = '00000000-0000-0000-0000-000000000001';
const authId = '00000000-0000-0000-0000-000000000011';
const evidence = { scope: 'Isolated local HTTP and actual PostgreSQL, fictional identity; NOT real Google login or production latency', checks: [], samples: [], screenshots: [] };
const check = (name, condition) => { assert(condition, name); evidence.checks.push(name); console.log('PASS ' + name); };
const summaryRpc = 'finance_approval_history_summary_v1';
const detailRpc = 'finance_approval_history_detail_v1';
let db, browser, server, nativePool, nativeAdmin, nativeDatabase;
const requests = [];
let fault = '', delayMs = 0;
const expected = [];
const unique = xs => [...new Set(xs)];
const actors = Array.from({length:10},(_,n)=>({id:'FICT-CONCURRENT-'+n,authId:'00000000-0000-0000-0000-'+String(100+n).padStart(12,'0'),email:'parallel'+n+'@example.invalid'}));
let queryQueue = Promise.resolve();

async function seed() {
  const { createSummarySearchFixture } = require('./check_approval_history_summary.cjs');
  if(process.env.FINANCE_NATIVE_PG_CONFIG){
    const configPath=path.resolve(process.env.FINANCE_NATIVE_PG_CONFIG),config=JSON.parse(fs.readFileSync(configPath,'utf8'));
    assert(['127.0.0.1','localhost','::1'].includes(config.host),'Native acceptance database must be local and disposable');
    const {Client,Pool}=createRequire(path.join(path.dirname(configPath),'package.json'))('pg');
    nativeAdmin=new Client(config);await nativeAdmin.connect();nativeDatabase='finance_browser_'+process.pid;
    await nativeAdmin.query('create database '+nativeDatabase);
    const client=new Client({...config,database:nativeDatabase});await client.connect();
    // Roles are cluster-wide; other isolated databases may already own these
    // standard fixture roles. Tables and all business data remain per-database.
    db={query:(...args)=>client.query(...args),exec:sql=>client.query(sql.replace(/create role (anon|authenticated|service_role);/g,(_,role)=>'do $$begin create role '+role+';exception when duplicate_object then null;end$$;')),close:()=>client.end()};
    nativePool=new Pool({...config,database:nativeDatabase,max:12});
    evidence.scope='Isolated local HTTP and real PostgreSQL connections, fictional identity; NOT real Google login or production latency';
  }else db = new PGlite();
  await createSummarySearchFixture(db, { install: false });
  await db.query('insert into public.finance_department_units(tenant_id,code,name) values($1,\'DAYCARE\',\'萬華日間照顧課\'),($1,\'ADMIN\',\'行政課\')', [tenant]);
  // Deliberately large attachment bytes must never travel with list summaries.
  await db.exec(`
    insert into public.expense_requests(id,no,tenant_id,data_environment,entity_id,department_code,applicant,type,status,amount,description,request_date,files,form_payload)
    select 'REQ-'||lpad(n::text,5,'0'),'20260915'||lpad(n::text,3,'0'),'${tenant}','test','F1','ADMIN','林星河','payment_request','completed',2000+n,'行政文具第'||n||'期','2026-09-15',
      jsonb_build_array(jsonb_build_object('name','附件.pdf','content',repeat('x',40000))), '{}'::jsonb
    from generate_series(1,640) n;
    insert into public.invoices(id,no,tenant_id,data_environment,entity_id,entity_name,department_code,applicant,status,approval_status,amount,tax,total,batch_id,buyer,description,invoice_date,receipt_files)
    select 'INV-'||lpad(n::text,3,'0')||'-'||part,'I20260915'||lpad(n::text,3,'0')||part,'${tenant}','test','F1','星河照護','DAYCARE','許晴川','completed','completed',1000+n,0,1000+n,'BATCH-'||lpad(n::text,3,'0'),'星光日照',
      '日照九月'||case when n%3=0 then '自費' else '服務' end||'第'||n||'期','2026-09-15',jsonb_build_array(jsonb_build_object('name','明細.pdf','content',repeat('x',20000)))
    from generate_series(1,97) n cross join lateral generate_series(1,case when n>=93 then 103 else 2 end) part;
    insert into public.approval_step_actor_snapshots(tenant_id,data_environment,record_type,record_id,record_no,step_index,resolved_user_id,acted_by_user_id,acted_by_name,acted_at_text,updated_at)
    select tenant_id,data_environment,'expense_requests',id,no,0,'FICT-USER','FICT-USER','測試會計','2026-09-15T00:00:00Z','2026-09-15T00:00:00Z'::timestamptz from public.expense_requests
    union all
    select tenant_id,data_environment,'invoices',id,no,0,'FICT-USER','FICT-USER','測試會計','2026-09-15T01:00:00Z','2026-09-15T01:00:00Z'::timestamptz from public.invoices where id like '%-1';
  `);
  for (let n = 1; n <= 640; n++) expected.push({ key: 'expense_requests:REQ-' + String(n).padStart(5, '0'), number: '20260915' + String(n).padStart(3, '0'), purpose: '行政文具第' + n + '期', department: '行政課', applicant: '林星河', amounts: [2000+n], amount: 2000+n });
  for (let n = 1; n <= 97; n++) expected.push({ key: 'invoices:BATCH-' + String(n).padStart(3, '0'), number: 'I20260915' + String(n).padStart(3, '0'), purpose: '日照九月' + (n%3===0 ? '自費' : '服務') + '第' + n + '期', department: '萬華日間照顧課', applicant: '許晴川', amounts: [1000+n, (n>=93?103:2)*(1000+n)], amount: (n>=93?103:2)*(1000+n) });
  const migration = fs.readdirSync(path.join(root, 'supabase/migrations')).find(n => n.endsWith('_finance_approval_history_summary_v1.sql'));
  assert(migration, 'summary migration must exist');
  const started = performance.now();
  const migrationSql=fs.readFileSync(path.join(root, 'supabase/migrations', migration), 'utf8');
  evidence.migrationSha256=crypto.createHash('sha256').update(migrationSql).digest('hex');
  await db.exec(migrationSql);
  evidence.backfillMs = performance.now() - started;
  evidence.dataset = { groups: 737, sourceRows: 1339, invoiceBatchMembers: '92 batches of 2; 5 batches of 103', expenseAttachmentBytes: 40000, invoiceAttachmentBytes: 20000 };
  const before = performance.now();
  const oldPayload = (await db.query('select public.finance_approval_participant_history_for_current_user(50,0,\'日照\',\'test\') payload')).rows[0].payload;
  evidence.localOldRpc = { ms:performance.now()-before,bytes:Buffer.byteLength(JSON.stringify(oldPayload)),total:oldPayload.total,scope:'One isolated PostgreSQL sample; not production or browser latency' };
  for(const actor of actors){
    await db.query('insert into public.finance_users(id,tenant_id,auth_user_id,email,active) values($1,$2,$3,$4,true)',[actor.id,tenant,actor.authId,actor.email]);
    await db.query('insert into public.tenant_members(tenant_id,finance_user_id,auth_user_id,active) values($1,$2,$3,true)',[tenant,actor.id,actor.authId]);
    await db.query(`insert into public.approval_step_actor_snapshots(tenant_id,data_environment,record_type,record_id,record_no,step_index,resolved_user_id,acted_by_user_id,acted_by_name,acted_at_text,updated_at)
      select tenant_id,data_environment,record_type,record_id,record_no,1,$1,$1,'隔離多人測試','2026-09-15T01:00:00Z','2026-09-15T01:00:00Z' from public.approval_step_actor_snapshots where resolved_user_id='FICT-USER'`,[actor.id]);
  }
  // Fixture identity provider only. No real OAuth tokens or employee identities.
  await db.exec(`create or replace function public.finance_verified_google_email(uuid) returns text language sql stable as $$select email from public.finance_users where auth_user_id=$1 and active limit 1$$`);
}

// Oracle uses declared business fixture fields, never the implementation search
// helper or the old RPC. Per-query expected IDs are persisted with actual IDs.
const cases = [
  { query: '日照', expected: () => expected.filter(x => x.key.startsWith('invoices:')) },
  { query: '自費', expected: () => expected.filter(x => x.purpose.includes('自費')) },
  { query: '萬華', expected: () => expected.filter(x => x.department.includes('萬華')) },
  { query: '林星河', expected: () => expected.filter(x => x.applicant==='林星河') },
  { query: '20260915001', expected: () => expected.filter(x => x.number.includes('20260915001')) },
  { query: 'NT$ 2,002', expected: () => expected.filter(x => x.amounts.includes(2002)) },
  { query: '日照 自費', expected: () => expected.filter(x => x.purpose.includes('日照') && x.purpose.includes('自費')) },
  { query: '完全沒有此筆資料', expected: () => [] }
];

async function startServer() {
  let html = applyBuildEnvironment(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), { target: 'local', supabaseUrl: '', supabaseAnonKey: '' });
  evidence.sourceSha256 = crypto.createHash('sha256').update(html).digest('hex');
  const anchor = 'bootAuthGate();\n\n})();';
  assert(html.includes(anchor));
  html = html.replace(anchor, 'window.__acceptance={run:async function(code){return await eval(code)},read:function(code){return eval(code)}};\n' + anchor)
    .replace(/<script\b[^>]*src=["']https?:[^>]*><\/script>/gi, '')
    .replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="connect-src \'self\'; form-action \'none\'; img-src \'self\' data: blob:">');
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/rpc/')) {
      const name = url.pathname.slice(5);
      if (![summaryRpc, detailRpc].includes(name)) { res.writeHead(404); return res.end(); }
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const args = JSON.parse(Buffer.concat(chunks).toString());
      const measurement = { name, query: args.p_search, start: performance.now(), fault };
      requests.push(measurement);
      try {
        if (fault === 'timeout') { res.writeHead(504, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { code: '57014', message: 'controlled isolated timeout' } })); }
        if (delayMs) await new Promise(r => setTimeout(r, delayMs));
        const started = performance.now();
        const sql = name===summaryRpc ? `select public.${name}($1,$2,$3,$4) payload` : `select public.${name}($1,$2) payload`;
        const values = name===summaryRpc ? [args.p_limit,args.p_offset,args.p_search,args.p_data_environment] : [args.p_history_key,args.p_data_environment];
        const actor = actors.find(a=>a.id===req.headers['x-fixture-actor']) || {id:'FICT-USER',authId,email:'fiction@example.invalid'};
        const executeQuery=async()=>{
          const connection=nativePool?await nativePool.connect():db;
          await connection.query('begin');
          try {
            await connection.query("select set_config('fixture.uid',$1,true),set_config('fixture.email',$2,true)",[actor.authId,actor.email]);
            return (await connection.query(sql,values)).rows[0].payload;
          } finally { await connection.query('rollback');if(nativePool)connection.release(); }
        };
        const query=nativePool?executeQuery():queryQueue.then(executeQuery);
        if(!nativePool)queryQueue=query.catch(()=>{});
        const payload = await query;
        measurement.responseMeta={total:payload.total,allTotal:payload.all_total,groups:payload.items&&payload.items.length};
        measurement.databaseMs = performance.now()-started;
        const body = JSON.stringify({ data: payload });
        measurement.bytes = Buffer.byteLength(body);
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'server-timing': 'db;dur=' + measurement.databaseMs.toFixed(2) });
        res.end(body);
      } catch (error) {
        measurement.error = { code: error.code, message: error.message };
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: measurement.error }));
      }
      measurement.totalMs = performance.now()-measurement.start;
      return;
    }
    const filename = path.resolve(root, '.' + url.pathname);
    if (filename!==root && !filename.startsWith(root+path.sep)) { res.writeHead(403); return res.end(); }
    if (filename===root || filename===path.join(root, 'index.html')) { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(html); }
    if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) { res.writeHead(404); return res.end(); }
    res.setHeader('content-type', filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'application/octet-stream');
    res.end(fs.readFileSync(filename));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return 'http://127.0.0.1:' + server.address().port;
}

const setup = `(function(){
  USERS=[{id:'FICT-USER',n:'測試會計',email:'fiction@example.invalid',role:'accountant',rL:'會計',eid:'F1',dc:'DAYCARE',active:true},{id:'FICT-EMPLOYEE',n:'林星河',email:'employee@example.invalid',role:'employee',rL:'組員',eid:'F1',dc:'ADMIN',active:true}];
  ENTS=[{id:'F1',s:'星河照護',full:'星河照護股份有限公司',active:true}];
  DEPTS=[{c:'DAYCARE',n:'萬華日間照顧課',eid:'F1',entityCodes:['F1'],active:true},{c:'ADMIN',n:'行政課',eid:'F1',entityCodes:['F1'],active:true}];
  REQS=[];INVS=[];BILLS=[];NOTIFS=[];VOUCHERS=[];LEDGER=[];ORG_CHART=[];
  quickLogin('accountant'); S.user.authUserId='${authId}'; S.user.tenantId='${tenant}';
  approvalFastShouldHoldSkeleton=function(){return false};
  getSb=function(){return {rpc:function(name,args){var signal;return {abortSignal:function(s){signal=s;return this},then:function(resolve,reject){return fetch('/rpc/'+name,{method:'POST',headers:{'content-type':'application/json','x-fixture-actor':S.user.id},body:JSON.stringify(args),signal:signal}).then(function(r){return r.json()}).then(resolve,reject)}}}}};
  S.demoLogin=false;S.apprQuery='';openApprovalTab('p');return true;
})()`;
const scope = (page, code) => page.evaluate(code => window.__acceptance.run(code), code);
async function ready(page, query) {
  await page.waitForFunction(query => window.__acceptance.read('APPROVAL_HISTORY_RUNTIME.status')==='ready'&&window.__acceptance.read('APPROVAL_HISTORY_RUNTIME.query')===query, query, {timeout:10000});
  await page.evaluate(() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
}
async function runQuery(page, query) {
  await page.locator('#appr-q').fill(query);
  // Timestamp the browser input event (not the automation round trip).
  await ready(page, query);
  return scope(page, `({ms:performance.now()-window.__lastSearchInput,query:APPROVAL_HISTORY_RUNTIME.query,total:APPROVAL_HISTORY_RUNTIME.total,allTotal:APPROVAL_HISTORY_RUNTIME.allTotal,keys:APPROVAL_HISTORY_RUNTIME.items.map(x=>x.historyKey),cache:[REQS.length,BILLS.length,INVS.length],text:el('appr-list').innerText})`);
}

async function main() {
  fs.mkdirSync(output, { recursive:true });
  await seed();
  const url = await startServer();
  browser = await chromium.launch({headless:true});
  for (const width of [1440,390]) {
    const context = await browser.newContext({viewport:{width,height:width===390?844:1000},recordVideo:{dir:path.join(output,'video-'+width)}});
    const page = await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(url);
    await scope(page, setup);
    await page.evaluate(()=>document.addEventListener('input',e=>{if(e.target.id==='appr-q')window.__lastSearchInput=performance.now()},true));
    const before = requests.length;
    await page.waitForTimeout(350);
    check(width+' pending tab starts no history RPC', requests.length===before);
    await scope(page,"openApprovalTab('h');true");
    await ready(page,'');
    const initial = await scope(page,'({total:APPROVAL_HISTORY_RUNTIME.total,keys:APPROVAL_HISTORY_RUNTIME.items.map(x=>x.historyKey),cache:[REQS.length,BILLS.length,INVS.length]})');
    check(width+' initial summary has all 737 groups and 50 rows',initial.total===737&&initial.keys.length===50);
    check(width+' summary never populates full document caches',initial.cache.every(n=>n===0));
    for (const test of cases) {
      const result = await runQuery(page,test.query), expectedKeys=test.expected().map(x=>x.key).sort();
      const keys=[...result.keys];
      for(let p=2;p<=Math.ceil(result.total/50);p++){
        await scope(page,'window.apprPage('+p+');true');await ready(page,test.query);
        keys.push(...await scope(page,'APPROVAL_HISTORY_RUNTIME.items.map(x=>x.historyKey)'));
      }
      assert.deepEqual(keys.sort(),expectedKeys,'independent IDs '+test.query);
      check(width+' correct all-page results: '+test.query,result.total===expectedKeys.length&&unique(keys).length===keys.length);
      evidence.samples.push({width,kind:'first-query',query:test.query,ms:result.ms,expectedKeys,actualKeys:keys,total:result.total});
    }
    // Alternate queries so each iteration executes SQL, rather than reusing UI state.
    for(let n=0;n<30;n++)for(const query of ['日照','自費']){
      const result=await runQuery(page,query);
      evidence.samples.push({width,kind:'warm',query,ms:result.ms,total:result.total});
    }
    await runQuery(page,'日照');
    check(width+' list has no page overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    const screen=path.join(output,'history-search-'+width+'.png');await page.screenshot({path:screen,fullPage:true});evidence.screenshots.push(screen);
    const beforeDetail=requests.filter(r=>r.name===detailRpc).length;
    check(width+' no full details fetched during list searches',beforeDetail===(width===1440?0:1));
    // An unrelated cached row with the same batch must not pollute this detail.
    await scope(page,`INVS.push(mapInv({id:'GHOST',no:'GHOST-NUMBER',tenant_id:'${tenant}',data_environment:'test',batch_id:'BATCH-097',amount:999,total:999}));true`);
    await scope(page,'window.apprPage(2);true');await ready(page,'日照');
    await page.locator('[data-history-open="invoices:BATCH-097"]').click();
    await page.waitForFunction(()=>window.__acceptance.read("APPROVAL_HISTORY_DETAIL_RUNTIME.status==='ready'"),null,{timeout:15000});
    const detail=await scope(page,"({rows:invoiceGroupRows(INVS.find(x=>x.id==='INV-097-1')).map(x=>x.id),hasAttachment:INVS.some(x=>x.id==='INV-097-1'&&x.receiptFiles&&x.receiptFiles.length)})");
    check(width+' actual click retrieves exactly 103 batch members and excludes stale cached row',detail.rows.length===103&&!detail.rows.includes('GHOST'));
    check(width+' detail RPC invoked only on actual open',requests.filter(r=>r.name===detailRpc).length===beforeDetail+1);
    await scope(page,'closeAppr();true');
    fault='timeout';await page.locator('#appr-q').fill('暫時失敗測試');
    await page.waitForFunction(()=>window.__acceptance.read('APPROVAL_HISTORY_RUNTIME.status')==='error');
    check(width+' HTTP timeout shown as retry, never zero-result success',await scope(page,"el('appr-list').innerText.includes('重新載入')&&APPROVAL_HISTORY_RUNTIME.status==='error'"));
    fault='';await page.locator('#appr-list button').filter({hasText:'重新載入'}).first().click();await ready(page,'暫時失敗測試');
    check(width+' retry actually executes HTTP and recovers',await scope(page,"APPROVAL_HISTORY_RUNTIME.status==='ready'&&APPROVAL_HISTORY_RUNTIME.total===0"));
    delayMs=500;
    await page.locator('#appr-q').fill('自費');await page.waitForTimeout(300);
    await page.locator('#appr-q').fill('日照');await ready(page,'日照');
    check(width+' slow superseded response cannot replace final query',await scope(page,"APPROVAL_HISTORY_RUNTIME.query==='日照'&&APPROVAL_HISTORY_RUNTIME.total===97"));delayMs=0;
    check(width+' no browser exceptions',errors.length===0);
    await context.close();
  }
  for(const width of [1440,390])for(let n=0;n<15;n++){
    const context=await browser.newContext({viewport:{width,height:width===390?844:1000}}),page=await context.newPage();
    await page.goto(url);await scope(page,setup);
    await scope(page,"S.apprQuery='日照';window.__lastSearchInput=performance.now();openApprovalTab('h');true");
    await ready(page,'日照');
    const result=await scope(page,'({ms:performance.now()-window.__lastSearchInput,total:APPROVAL_HISTORY_RUNTIME.total})');
    assert.equal(result.total,97);
    evidence.samples.push({width,kind:'cold-history-context',query:'日照',ms:result.ms,total:result.total});
    await context.close();
  }
  const concurrent=await Promise.all(actors.map(async(actor,n)=>{
    const context=await browser.newContext({viewport:{width:n%2?390:1440,height:1000}}),page=await context.newPage();
    await page.goto(url);await scope(page,setup);
    await scope(page,`S.user.id=${JSON.stringify(actor.id)};S.user.authUserId=${JSON.stringify(actor.authId)};S.user.email=${JSON.stringify(actor.email)};true`);
    await page.evaluate(()=>document.addEventListener('input',e=>{if(e.target.id==='appr-q')window.__lastSearchInput=performance.now()},true));
    return {context,page,actor};
  }));
  await Promise.all(concurrent.map(async({page})=>{await scope(page,"openApprovalTab('h');true");await ready(page,'')}));
  for(let n=0;n<20;n++){
    await Promise.all(concurrent.map(async({page,actor},i)=>{
      const query=n%2?'自費':'日照',result=await runQuery(page,query);
      assert.equal(result.total,query==='日照'?97:32);
      evidence.samples.push({kind:'concurrent-fictional-sessions',actor:actor.id,width:i%2?390:1440,query,ms:result.ms,total:result.total});
    }));
  }
  await Promise.all(concurrent.map(x=>x.context.close()));
  check('10 isolated fixture identities, 20 simultaneous rounds retain correct scope and totals',true);
  const measured=evidence.samples.map(x=>x.ms).sort((a,b)=>a-b);
  evidence.timing={count:measured.length,p50:measured[Math.floor(measured.length*.5)],p95:measured[Math.ceil(measured.length*.95)-1],max:measured.at(-1),conditions:'Local Chromium, loopback HTTP, '+(nativePool?'native PostgreSQL, independent database connections':'PGlite, serialized database connection')+'; excludes Google login and public network'};
  evidence.requests=requests;
  check('all measured input-to-visible samples <= 3000ms',evidence.timing.max<=3000);
  check('95% of input-to-visible samples <= 1500ms',evidence.timing.p95<=1500);
  check('50-group summary payloads <= 200KB',requests.filter(r=>r.name===summaryRpc&&!r.error&&!r.fault).every(r=>r.bytes<=200000));
  console.log(JSON.stringify(evidence.timing));
}
main().catch(error=>{evidence.failure={message:error.message,stack:error.stack};console.error(error);process.exitCode=1}).finally(async()=>{
  evidence.requests=requests;
  fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));
  if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));if(nativePool)await nativePool.end();if(db)await db.close();
  if(nativeAdmin){if(nativeDatabase)await nativeAdmin.query('drop database '+nativeDatabase);await nativeAdmin.end();}
});
