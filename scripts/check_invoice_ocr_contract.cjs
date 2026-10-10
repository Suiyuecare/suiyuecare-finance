'use strict';
// Exact shipped helpers and async callers, with the checked-in Edge schema.
// All transport/file boundaries are fictional; no OpenAI, Storage or DB writes.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'index.html'),'utf8');
const edge=fs.readFileSync(path.join(root,'supabase/functions/parse-invoice-openai/index.ts'),'utf8');
function declaration(name,window=false){let start=source.indexOf(window?'window.'+name+'=':'function '+name+'(');assert.ok(start>=0,name);if(!window&&source.slice(start-6,start)==='async ')start-=6;for(let i=source.indexOf('{',start);i<source.length;i++){if(source[i]!=='}')continue;const code=source.slice(start,i+1)+(window?';':'');try{new vm.Script(code);return code;}catch{}}throw Error(name);}
const schema=vm.runInNewContext(edge.slice(edge.indexOf('  const invoiceSchema ='),edge.indexOf('  const hrLaborSchema ='))+'\ninvoiceSchema');
let count=0;function check(label,fn){fn();count++;console.log('PASS '+label);}const plain=x=>JSON.parse(JSON.stringify(x));
function payload(net=210,tax=0,total=210,items=[]){const data=Object.fromEntries(Object.entries(schema.properties).map(([key,def])=>[key,def.type==='string'?'':def.type==='number'?0:[]]));Object.assign(data,{buyer_name:'虛構買受人',description:'九月服務合計',amount_excluding_tax:net,tax_amount:tax,total_amount:total,items,confidence:1,currency:'TWD'});return data;}
function item(name,gross){return Object.fromEntries(Object.entries(schema.properties.items.items.properties).map(([key,def])=>[key,key==='item_name'?name:key==='total_amount'?gross:key==='quantity'?1:def.type==='string'?'次':gross]));}
function fixture(){const dom=Object.fromEntries(['inv-no','inv-buyer','inv-taxid','inv-identifier-type','inv-date','inv-amt','inv-tax','inv-total','inv-desc','inv-item-type','batch-pw','batch-prog','batch-pl','batch-fn','batch-dz'].map(id=>[id,{value:'original',textContent:'',style:{},classList:{add(){}}}]));
 const c={console,Number,Math,Array,JSON,String,Error,Promise,el:id=>dom[id],num:x=>Number(x||0),fmt:x=>String(x),invoiceItemTypeFromText:()=> 'other_income',invoiceIdentifierType:x=>x,invoiceBatchOverflowMessage:()=>'',INVOICE_BATCH_MAX_ITEMS:1000,statementDataIdentity:()=> 'fictional-account-scope',updInvPrev(){},S:{bRows:[{buyer:'',amt:'',total:'',tax:''}],bUploadFiles:[],bUploadPendingFiles:[],bUploadFile:null,invOcrFile:{name:'fictional.pdf',type:'application/pdf'}},productModuleEnabled:()=>true,OPENAI_INVOICE_OCR_ENDPOINT:'https://example.invalid/ocr',SUPABASE_ANON_KEY:'fictional',fileToAttachment:async()=>({n:'fictional.pdf',mime:'application/pdf',url:'data:application/pdf;base64,UEZERklDVFVSRQ=='}),setInvOcrStatus:(text)=>{c.status=text;},ocrErrorMessage:e=>e.message,syncBatchRowsFromDom:()=>{},renderBatchTable:()=>{c.renderCount++;},defaultInvoiceBatchRow:()=>({}),renderCount:0,fetch:async()=>({ok:true,json:async()=>({invoice:c.response})}),alert:x=>{throw Error('Unexpected alert '+x);}};c.window=c;vm.createContext(c);
 vm.runInContext('var BATCH_INVOICE_READ_GENERATION=0;',c);
 for(const name of ['invoiceOcrReviewError','invoiceOcrNumber','invoiceOcrAmountParts','invoiceNumberValue','invoiceRateValue','invoiceAmountsFromTotal','applyInvoiceOcr','invoiceOcrDataToBatchRows','batchInvoiceReadCurrent','batchInvoiceSourceFiles','setBatchInvoiceUploadFiles','setBatchInvoiceUploadFile','importBatchCsv'])vm.runInContext(declaration(name),c);
 for(const name of ['calcInvTax','analyzeSingleInvoiceFile','analyzeBatchInvoiceUpload'])vm.runInContext(declaration(name,true),c);return {c,dom};}
(async()=>{const {c,dom}=fixture();
 check('fixture is exact real Edge schema with item_name and no invented tax_rate',()=>{assert.equal(schema.properties.tax_rate,undefined);assert.ok(schema.properties.items.items.properties.item_name);assert.deepEqual(Object.keys(payload()).sort(),Array.from(schema.required).sort());});
 check('zero-tax batch preserves two source item names and all three amount totals',()=>{const rows=c.invoiceOcrDataToBatchRows({invoice:payload(210,0,210,[item('服務甲',100),item('服務乙',110)])});assert.deepEqual(plain(rows.map(r=>[r.desc,r.amt,r.tax,r.total,r.rate])),[['服務甲',100,0,100,0],['服務乙',110,0,110,0]]);});
 check('5% batch preserves document and row net/tax/gross',()=>{const rows=c.invoiceOcrDataToBatchRows({invoice:payload(300,15,315,[item('甲',105),item('乙',210)])});assert.deepEqual(plain(rows.map(r=>[r.amt,r.tax,r.total,r.rate])),[[100,5,105,.05],[200,10,210,.05]]);});
 for(const rate of [0,'0','0%'])check('explicit zero rate remains zero '+rate,()=>assert.equal(c.invoiceOcrDataToBatchRows({...payload(),tax_rate:rate})[0].tax,0));
 for(const rate of [.05,5,'5%'])check('explicit five percent agrees with source '+rate,()=>assert.equal(c.invoiceOcrAmountParts({...payload(200,10,210),tax_rate:rate}).tax,10));
 check('missing net derives only from explicit total and tax',()=>assert.deepEqual(plain(c.invoiceOcrAmountParts({tax_amount:0,total_amount:210})),{amount:210,tax:0,total:210,rate:0}));
 check('missing tax derives from explicit net and gross',()=>assert.equal(c.invoiceOcrAmountParts({amount_excluding_tax:200,total_amount:210}).tax,10));
 check('missing gross derives from explicit net and tax',()=>assert.equal(c.invoiceOcrAmountParts({amount_excluding_tax:200,tax_amount:10}).total,210));
 check('explicit rate allows a total-only source without defaulting unknown tax',()=>assert.equal(c.invoiceOcrAmountParts({total_amount:210,tax_rate:0}).amount,210));
 check('blank/null aliases are missing but primary zero is retained',()=>assert.equal(c.invoiceOcrAmountParts({amount_excluding_tax:0,subtotal:null,tax_amount:'',total_amount:0}).total,0));
 check('valid grouped numeric strings keep original amounts',()=>assert.equal(c.invoiceOcrAmountParts({amount_excluding_tax:'1,234',tax_amount:'0',total_amount:'1,234'}).total,1234));
 check('single source cents preserved when the actual form can represent them',()=>{c.applyInvoiceOcr(payload(100.5,5,105.5));assert.equal(Number(dom['inv-total'].value),105.5);});
 check('single zero replaces old input rather than resurrecting prior amount',()=>{c.applyInvoiceOcr(payload(0,0,0));assert.equal(Number(dom['inv-amt'].value),0);assert.equal(Number(dom['inv-total'].value),0);});
 check('single total plus explicit zero tax remains 210',()=>{c.applyInvoiceOcr({buyer_name:'新買受人',total_amount:210,tax_amount:0});assert.equal(Number(dom['inv-total'].value),210);assert.equal(dom['inv-tax'].value,'0');});
 const bad=[{}, {total_amount:210}, {amount_excluding_tax:0,tax_amount:0,total_amount:210}, {...payload(),tax_rate:5}, {...payload(),subtotal:200}, {...payload(),tax_amount:null,amount_excluding_tax:null}, {...payload(),total_amount:-1}, {...payload(),tax_amount:'not a number'}, {...payload(),tax_amount:true}, {...payload(),total_amount:Infinity}, {...payload(200,20,220),tax_rate:10}, {...payload(200,9,210)}, {...payload(),tax_rate:'NaN'}, {...payload(),total_amount:'2,10'}, {amount_excluding_tax:Number.MAX_SAFE_INTEGER,tax_amount:Math.round(Number.MAX_SAFE_INTEGER*.05)}];
 bad.forEach((input,i)=>check('ambiguous/invalid source '+i+' never partly changes any input',()=>{const before=plain(dom);assert.throws(()=>c.applyInvoiceOcr(input),e=>e.code==='INVOICE_OCR_REVIEW_REQUIRED'&&/人工核對/.test(e.message));assert.deepEqual(plain(dom),before);}));
 check('inconsistent item total rejects the complete result',()=>assert.throws(()=>c.invoiceOcrDataToBatchRows(payload(210,0,210,[item('甲',100)])),/合計/));
 check('document tax rounding cannot silently change after a two-row split',()=>assert.throws(()=>c.invoiceOcrDataToBatchRows(payload(19,1,20,[item('甲',10),item('乙',10)])),e=>e.code==='INVOICE_OCR_REVIEW_REQUIRED'&&/稅額/.test(e.message)));
 check('nonrepresentable batch decimal rejects rather than rounding source',()=>assert.throws(()=>c.invoiceOcrDataToBatchRows(payload(100.5,5,105.5)),/原樣/));
 c.setBatchInvoiceUploadFile({name:'first.pdf',type:'application/pdf'});
 c.response=payload(210,0,210,[item('甲',100),item('乙',110)]);await c.analyzeBatchInvoiceUpload();check('actual async batch caller appends valid schema rows once and drops blank default',()=>{assert.equal(c.renderCount,1);assert.deepEqual(plain(c.S.bRows.map(r=>r.desc)),['甲','乙']);assert.match(dom['batch-pl'].textContent,/已累加 2 列/);assert.equal(c.batchInvoiceSourceFiles().length,1);});
 const previous=plain(c.S.bRows);c.setBatchInvoiceUploadFile({name:'invalid.pdf',type:'application/pdf'});c.response=payload(0,0,210);await c.analyzeBatchInvoiceUpload();check('failed OCR keeps prior rows and both source files for correction',()=>{assert.deepEqual(plain(c.S.bRows),previous);assert.equal(c.renderCount,1);assert.equal(c.batchInvoiceSourceFiles().length,2);assert.equal(c.S.bUploadPendingFiles.length,1);assert.match(dom['batch-pl'].textContent,/人工核對/);});
 const oldInputs=plain(dom);await c.analyzeSingleInvoiceFile();check('actual async single caller does not claim completion after rejection',()=>{assert.deepEqual(plain(dom),oldInputs);assert.match(c.status,/人工核對/);assert.doesNotMatch(c.status,/已回填/);});
 c.response=payload(200,10,210);await c.analyzeSingleInvoiceFile();check('actual async single caller preserves 5% control',()=>{assert.equal(Number(dom['inv-amt'].value),200);assert.equal(Number(dom['inv-total'].value),210);assert.equal(dom['inv-tax'].value,'5');assert.match(c.status,/已回填/);});
 function deferred(){let resolve;const promise=new Promise(done=>{resolve=done});return{promise,resolve};}
 const csvRow=buyer=>({buyer,identifierType:'電子發票',taxid:'',desc:'同一開立原因',total:210,amount:210,rate:0});
 const {c:multi,dom:multiDom}=fixture(),csvA={name:'same.csv',type:'text/csv',size:80},csvB={name:'same.csv',type:'text/csv',size:80};
 multi.invoiceTableRowToData=row=>row;multi.readInvoiceTableFile=async file=>[csvRow(file===csvA?'第一份':'第二份')];
 multi.setBatchInvoiceUploadFiles([csvA,csvB]);await multi.analyzeBatchInvoiceUpload();
 check('two same-name CSV files append into one application without duplicate blank row',()=>{assert.deepEqual(plain(multi.S.bRows.map(row=>row.buyer)),['第一份','第二份']);assert.equal(multi.renderCount,1);assert.equal(multi.S.bUploadFiles.length,2);assert.equal(multi.S.bUploadPendingFiles.length,0);assert.match(multiDom['batch-pl'].textContent,/本張申請共 2 列、2 個原始檔/);});
 const csvC={name:'third.csv',type:'text/csv'},csvBad={name:'bad.csv',type:'text/csv'};
 multi.readInvoiceTableFile=async file=>{if(file===csvBad)throw Error('fictional broken sheet');return[csvRow(file===csvC?'第三份':'第四份')];};
 multi.setBatchInvoiceUploadFiles([csvC,csvBad]);const beforeFailed=plain(multi.S.bRows);await multi.analyzeBatchInvoiceUpload();
 check('second file failure rolls back both newly staged CSV rows and retains all source files',()=>{assert.deepEqual(plain(multi.S.bRows),beforeFailed);assert.equal(multi.S.bUploadFiles.length,4);assert.equal(multi.S.bUploadPendingFiles.length,2);assert.equal(multi.renderCount,1);assert.match(multiDom['batch-pl'].textContent,/這次沒有新增任何列/);});
 multi.readInvoiceTableFile=async file=>[csvRow(file===csvC?'第三份':'第四份')];await multi.analyzeBatchInvoiceUpload();
 check('retry after correction appends staged rows once to the original application',()=>{assert.deepEqual(plain(multi.S.bRows.map(row=>row.buyer)),['第一份','第二份','第三份','第四份']);assert.equal(multi.S.bUploadPendingFiles.length,0);assert.equal(multi.renderCount,2);});
 const incompleteCsv={name:'incomplete.csv',type:'text/csv'},beforeIncomplete=plain(multi.S.bRows);
 multi.readInvoiceTableFile=async()=>[csvRow('完整列'),{...csvRow(''),desc:'缺買受人但仍有金額'}];
 multi.setBatchInvoiceUploadFile(incompleteCsv);await multi.analyzeBatchInvoiceUpload();
 check('incomplete populated CSV row rejects whole file instead of silently dropping one invoice',()=>{assert.deepEqual(plain(multi.S.bRows),beforeIncomplete);assert.equal(multi.S.bUploadPendingFiles.length,1);assert.equal(multi.renderCount,2);assert.match(multiDom['batch-pl'].textContent,/第 2 列/);});
 const {c:race}=fixture(),oldOcr=deferred(),oldPdf={name:'old.pdf',type:'application/pdf'},newPdf={name:'new.pdf',type:'application/pdf'};
 let oldOcrCalls=0;race.fetch=(_url,options)=>{const name=JSON.parse(options.body).fileName;if(name==='old.pdf'&&++oldOcrCalls===1)return oldOcr.promise;return Promise.resolve({ok:true,json:async()=>({invoice:payload(210,0,210,[item(name,210)])})});};
 race.setBatchInvoiceUploadFile(oldPdf);const oldOcrRun=race.analyzeBatchInvoiceUpload();await new Promise(setImmediate);
 race.setBatchInvoiceUploadFile(newPdf);await race.analyzeBatchInvoiceUpload();
 oldOcr.resolve({ok:true,json:async()=>({invoice:payload(210,0,210,[item('過期辨識',210)])})});await oldOcrRun;
 check('late OCR cannot overwrite newer two-file staged result',()=>assert.deepEqual(plain(race.S.bRows.map(row=>row.desc)),['old.pdf','new.pdf']));
 const {c:retry}=fixture(),sameFile={name:'same.pdf',type:'application/pdf'},oldSame=deferred();let sameCalls=0;
 retry.fetch=()=>++sameCalls===1?oldSame.promise:Promise.resolve({ok:true,json:async()=>({invoice:payload(210,0,210,[item('第二次辨識',210)])})});
 retry.setBatchInvoiceUploadFile(sameFile);const firstSame=retry.analyzeBatchInvoiceUpload();await new Promise(setImmediate);
 await retry.analyzeBatchInvoiceUpload();oldSame.resolve({ok:true,json:async()=>({invoice:payload(210,0,210,[item('第一次辨識',210)])})});await firstSame;
 check('first OCR attempt cannot append after a newer retry of the same file',()=>assert.deepEqual(plain(retry.S.bRows.map(row=>row.desc)),['第二次辨識']));
 const {c:identity}=fixture(),oldIdentity=deferred();identity.fetch=()=>oldIdentity.promise;identity.setBatchInvoiceUploadFile(sameFile);
 const identityRun=identity.analyzeBatchInvoiceUpload();await new Promise(setImmediate);identity.statementDataIdentity=()=> 'different-account-scope';
 oldIdentity.resolve({ok:true,json:async()=>({invoice:payload(210,0,210,[item('舊帳號辨識',210)])})});await identityRun;
 check('late OCR from previous login cannot append rows into another account',()=>assert.equal(identity.S.bRows.filter(row=>row.buyer).length,0));
 console.log('Invoice OCR contract: '+count+' checks PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
