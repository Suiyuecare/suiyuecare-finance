#!/usr/bin/env node
'use strict';
// Consolidate independently executed tests; never infer production acceptance
// from local fixtures or manufacture evidence for external employee accounts.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const inputs={
  native:'/tmp/finance-invoice-batch-bulk-20261014/evidence.json',
  http:'/tmp/finance-income-rpc-http-20261014/evidence.json',
  browser:'/tmp/finance-income-recovery-storage-browser/evidence.json'
};
const evidence=Object.fromEntries(Object.entries(inputs).map(([key,file])=>[key,JSON.parse(fs.readFileSync(file,'utf8'))]));
assert.equal(evidence.native.ok,true,'native capacity evidence must pass');
assert.equal(evidence.native.engine,'native PostgreSQL','PGlite cannot substitute for native capacity');
assert.equal(evidence.native.sources.migrationSHA256,hash(path.join(root,'supabase/migrations/20261014123427_finance_invoice_batch_bulk_insert_v2.sql')),'native evidence must use exact migration');
assert.equal(evidence.native.sources.catalogSHA256,hash(path.join(root,'scripts/fixtures/finance_invoice_batch_live_catalog_20261014.json')),'native evidence must use exact catalog');
for(const count of [1,33,95,190,500])assert(evidence.native.measurements.filter(row=>row.stage==='capacity'&&row.count===count).length>=3,'native capacity needs three trials at '+count);
assert.equal(evidence.http.ok,true,'real HTTP evidence must pass');
assert.equal(evidence.http.sources.migrationSHA256,evidence.native.sources.migrationSHA256,'HTTP and native evidence must use the same migration');
assert.equal(evidence.http.sources.catalogSHA256,evidence.native.sources.catalogSHA256,'HTTP and native evidence must use the same live catalog');
assert.equal(evidence.http.sources.scopeSHA256,hash(path.join(root,'scripts/fixtures/finance_income_http_scope_20261014.json')),'HTTP must use exact authority and RLS fixture');
for(const count of [1,95,190,500])assert(evidence.http.measurements.some(row=>row.count===count&&row.elapsedMs<10000),'HTTP transaction ceiling at '+count);
assert.equal(evidence.native.productionEndToEndProven,false);
assert.equal(evidence.http.productionEndToEndProven,false);
assert.equal(evidence.browser.ok,true,'browser storage evidence must pass');
assert.equal(evidence.browser.sources.indexSHA256,hash(path.join(root,'index.html')),'browser must test exact current application');
assert.equal(evidence.browser.sources.recoveryStoreSHA256,hash(path.join(root,'assets/engines/income-recovery-store.js')),'browser must test exact recovery store');
for(const browser of ['chromium','webkit'])assert(evidence.browser.cases.some(row=>row.browser===browser&&row.checks.length>=20),'browser storage cases required for '+browser);
const sourceCommit=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
assert(/^[a-f0-9]{40}$/.test(sourceCommit));
const manifest={
  contract:'finance-submission-acceptance-v1',createdAt:new Date().toISOString(),sourceCommit,
  sourceTreeClean:cp.execFileSync('git',['status','--porcelain','--untracked-files=normal'],{cwd:root,encoding:'utf8'}).trim()==='',
  tests:{
    native:{status:'passed',checks:evidence.native.checks.length,engine:evidence.native.engine,measurements:evidence.native.measurements},
    http:{status:'passed',checks:evidence.http.checks.length,transport:evidence.http.transport,measurements:evidence.http.measurements},
    browser:{status:'passed',checks:evidence.browser.cases.reduce((n,row)=>n+row.checks.length,0),engines:evidence.browser.cases.map(row=>row.browser),scope:evidence.browser.scope}
  },
  evidence:Object.fromEntries(Object.entries(inputs).map(([key,file])=>[key,{file,sha256:hash(file)}])),
  outstandingEvidence:{
    productionDeployment:{status:'blocked_until_protected_promotion',reason:'Requires separately verified live alias, manifest and database postflight.'},
    employeeGoogleAccounts:{status:'not_proven',reason:'Signed fictional JWTs do not establish every employee Google login.'},
    productionStorageNetwork:{status:'not_proven',reason:'Isolated upload/HTTP fixtures do not establish external provider availability.'},
    everyDevice:{status:'not_proven',reason:'Chromium/WebKit automation does not establish every real phone or operating system.'}
  }
};
const output='/tmp/finance-submission-acceptance-20261014';fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('PASS exact submission acceptance evidence manifest: '+output+'/manifest.json');
