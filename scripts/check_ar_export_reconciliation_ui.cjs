#!/usr/bin/env node
'use strict';
// Real shipped UI, browser event handlers and shared search. In-memory DOM and
// XLSX writer capture the exact export matrix; no product hooks or networking.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');let checks=0;
function check(label,condition){assert.ok(condition,label);checks++;console.log('PASS '+label);}
const clone=x=>JSON.parse(JSON.stringify(x));
async function fixture(items,reconciliation={reconciliationVisible:true,ledgerNet:0,mappedLedgerNet:0,unmappedDebitAmount:0,unmappedCreditAmount:0,unmappedEntryCount:0,scopeDifference:0,needsReview:false}){
 const box={innerHTML:''},events={},books=[],calls=[],ctx={console,Intl,Map,Set,document:{getElementById:id=>id==='finance-receivable-workspace'?box:null,addEventListener:(name,fn)=>events[name]=fn},XLSX:{utils:{book_new:()=>({}),aoa_to_sheet:rows=>clone(rows),book_append_sheet:(book,sheet,name)=>{book.rows=sheet;book.name=name;}},writeFile:(book,name)=>books.push({...book,filename:name})}};ctx.window=ctx;
 for(const file of ['document-search.js','reporting-workspace.js'])vm.runInNewContext(read('assets/engines/'+file),ctx);
 const current={recvEntity:'FICT-CO',page:'recv'};ctx.FinanceReportingWorkspace.install({tenant:()=> 'FICT',environment:()=> 'test',user:()=>({id:'FICT-ACCOUNTANT',authUserId:'FICT-UUID'}),role:()=> 'accountant',today:()=> '2026-09-11',state:()=>current,entities:()=>[{id:'FICT-CO',full:'虛構公司'}],departments:()=>[{c:'D',n:'虛構部門',eid:'FICT-CO'}],ledger:()=>[],rpc:async(name,args)=>{calls.push({name,args:clone(args)});return{data:{complete:true,asOf:args.p_as_of,items:items.filter(r=>args.p_department_code===null||r.departmentCode===args.p_department_code),summary:{},reconciliation:{bankVisible:false,...reconciliation}}};}});
 const api=ctx.FinanceReportingWorkspace;await api.loadReceivables();api.renderReceivables();
 function change(name,value){events.change({target:{name,value}});}
 async function action(action,more={}){const node={dataset:{rwAction:action,...more},closest:()=>null};events.click({target:{closest:selector=>selector==='[data-rw-action]'?node:null}});await new Promise(resolve=>setImmediate(resolve));}
 function visible(){return [...new Set([...box.innerHTML.matchAll(/data-invoice="([^"]+)"/g)].map(m=>m[1]))];}
 return{api,box,books,calls,change,action,visible};
}
function item(id,opts={}){return{invoiceId:id,invoiceNo:id,buyer:'虛構甲客戶',entityId:'FICT-CO',departmentCode:'D',invoiceDate:'2026-08-01',originalAmount:100,allowanceAmount:0,receivedAmount:0,outstandingAmount:100,pendingReceiptAmount:0,dueDate:'2026-08-30',agingBucket:'d1',overdueDays:12,...opts};}
(async()=>{
 const original=[item('FICT-A'),item('FICT-B',{buyer:'虛構乙客戶',receivedAmount:100,outstandingAmount:0,agingBucket:'settled'})],before=clone(original);let f=await fixture(original);
 f.change('rw-ar-query','甲客戶');await f.action('export-receivables');check('customer filter matches visible rows and actual export matrix',f.visible().join()==='FICT-A'&&f.books[0].rows.slice(5).map(r=>r[3]).join()==='FICT-A');
 f.change('rw-ar-query','');await f.action('ar-bucket',{bucket:'open'});await f.action('export-receivables');check('open bucket excludes settled invoices from export',f.books.at(-1).rows.slice(5).map(r=>r[3]).join()==='FICT-A');
 check('worksheet carries company department cutoff query bucket and count',JSON.stringify(f.books.at(-1).rows.slice(0,5)).includes('虛構公司')&&JSON.stringify(f.books.at(-1).rows.slice(0,5)).includes('全部授權部門')&&f.books.at(-1).rows[1][5]==='2026-09-11'&&f.books.at(-1).rows[2][1]==='無'&&f.books.at(-1).rows[2][3]==='未結清'&&f.books.at(-1).rows[2][5]===1);
 f.change('rw-ar-query','不存在');await f.action('export-receivables');check('no matches exports zero rows with explicit zero count',f.books.at(-1).rows.length===5&&f.books.at(-1).rows[2][5]===0);
 check('filter and export never change canonical monetary values',JSON.stringify(original)===JSON.stringify(before));
 f=await fixture(Array.from({length:31},(_,i)=>item('FICT-'+String(i+1).padStart(2,'0'),{originalAmount:1250.5,outstandingAmount:1250.5})).concat(item('SETTLED',{outstandingAmount:0,agingBucket:'settled'})));
 f.change('rw-ar-query','甲客戶 1,250.50');await f.action('ar-bucket',{bucket:'open'});check('normal pagination still limits visible rows to 25',f.visible().length===25);await f.action('export-receivables');const first=f.books.at(-1);check('export includes all 31 matching rows across pages and preserves decimals',first.rows.length===36&&first.rows.slice(5).every(r=>r[4]===1250.5&&r[7]===1250.5));
 await f.action('ar-page',{delta:'1'});check('second page shows six remaining matches',f.visible().length===6);await f.action('export-receivables');check('changing pages never changes export scope',JSON.stringify(first.rows)===JSON.stringify(f.books.at(-1).rows));
 check('filename states company department date bucket query and result count',['虛構公司','全部授權部門','2026-09-11','未結清','31筆','查詢-甲客戶 1,250.50'].every(s=>first.filename.includes(s)));
 f.change('rw-ar-department','D');await new Promise(resolve=>setImmediate(resolve));await f.api.loadReceivables();f.api.renderReceivables();await f.action('export-receivables');check('exact selected department is sent to server and recorded in workbook',f.calls.at(-1).args.p_department_code==='D'&&f.books.at(-1).rows[1][3]==='虛構部門'&&f.books.at(-1).filename.includes('虛構部門'));
 f=await fixture([],{reconciliationVisible:true,ledgerNet:0,mappedLedgerNet:0,unmappedDebitAmount:70,unmappedCreditAmount:70,unmappedEntryCount:2,scopeDifference:0,needsReview:true});check('zero-net debit and credit differences produce visible warning with both amounts',f.box.innerHTML.includes('有待核對差異')&&f.box.innerHTML.includes('有 2 筆未對應')&&f.box.innerHTML.includes('借餘 70、貸餘 70')&&f.box.innerHTML.includes('<details class="rw-details" open>'));
 f=await fixture([],{reconciliationVisible:false,ledgerNet:null,unmappedDebitAmount:null,unmappedCreditAmount:null,needsReview:null});check('scope not verified remains pending and cannot claim zero difference',f.box.innerHTML.includes('總帳勾稽待核對')&&!f.box.innerHTML.includes('未對應分錄為 0'));
 f=await fixture([]);check('fully verified zero is explicitly distinguished from pending',f.box.innerHTML.includes('未對應分錄為 0')&&!f.box.innerHTML.includes('總帳勾稽待核對'));
 console.log('AR UI export/reconciliation: '+checks+' checks passed. No network or production writes.');
})().catch(e=>{console.error(e);process.exitCode=1;});
