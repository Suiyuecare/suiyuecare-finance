'use strict';
// Actual reporting workspace + shared search engine, with fictional scoped RPC
// responses only. No production hooks, network access or business writes.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),workspaceSource=fs.readFileSync(path.join(root,'assets/engines/reporting-workspace.js'),'utf8'),searchSource=fs.readFileSync(path.join(root,'assets/engines/document-search.js'),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
async function fixture(items,withHelper=true){
  const box={innerHTML:''},events={},calls=[],context={console,Intl,Map,Set,document:{getElementById:id=>id==='finance-receivable-workspace'?box:null,addEventListener:(name,handler)=>{events[name]=handler;}}};context.window=context;
  if(withHelper)vm.runInNewContext(searchSource,context);
  vm.runInNewContext(workspaceSource,context);
  const runtime={tenant:()=> 'fictional-tenant',environment:()=> 'test',user:()=>({id:'fictional-accountant',authUserId:'fictional-auth'}),role:()=> 'accountant',today:()=> '2026-09-10',state:()=>({page:'recv',recvEntity:'A'}),entities:()=>[{id:'A',full:'測試公司'}],departments:()=>[{c:'CARE',eid:'A',n:'照護部門'}],ledger:()=>[],rpc:async(name,args)=>{calls.push({name,args});assert.equal(name,'finance_receivables_v1');assert.equal(args.p_entity_id,'A');return{data:{complete:true,items,summary:{},reconciliation:{bankVisible:false}}};}};
  context.FinanceReportingWorkspace.install(runtime);await context.FinanceReportingWorkspace.loadReceivables();
  function search(query){events.change({target:{name:'rw-ar-query',value:query}});return Array.from(new Set(Array.from(box.innerHTML.matchAll(/data-invoice="([^"]+)"/g),m=>m[1]))).sort();}
  return{workspace:context.FinanceReportingWorkspace,box,search,calls};
}
const records=[
  {invoiceId:'A',invoiceNo:'INV-A',buyer:'甲客戶',ownerName:'王會計',entityId:'A',departmentCode:'CARE',originalAmount:1250,recognizedAmount:1250,outstandingAmount:249.75,receivedAmount:1000.25,allowanceAmount:0,arAllowanceAmount:0,pendingReceiptAmount:0,refundPayable:0,refundedAmount:0},
  {invoiceId:'B',invoiceNo:'INV-B',buyer:'乙客戶',ownerName:'林會計',entityId:'A',departmentCode:'CARE',originalAmount:7777,outstandingAmount:7777},
  {invoiceId:'C',invoiceNo:'INV-C',buyer:'丙客戶',ownerName:'王會計',entityId:'A',departmentCode:'CARE',originalAmount:12.5,outstandingAmount:12.5},
  {invoiceId:'D',invoiceNo:'INV-D',buyer:'丁客戶',ownerName:'林會計',entityId:'A',departmentCode:'CARE',originalAmount:400,outstandingAmount:-65.75,receivedAmount:465.75},
  {invoiceId:'U',invoiceNo:'UNKNOWN',buyer:'尚未核對',entityId:'A',departmentCode:'CARE',originalAmount:null,status:'paid',rowVersion:987654},
  {invoiceId:'S',invoiceNo:'STRING',buyer:'未知數值格式',entityId:'A',departmentCode:'CARE',originalAmount:'888.88'}
];
let checks=0;function check(name,fn){fn();checks++;console.log('PASS '+name);}
(async()=>{
  const before=clone(records),f=await fixture(records);
  for(const query of ['1250','1,250','NT$1,250','1,250元','1250.00','ＮＴ＄１，２５０'])check('AR matches formatted canonical original amount: '+query,()=>assert.deepEqual(f.search(query),['A']));
  check('AR searches current remaining amount',()=>assert.deepEqual(f.search('249.75'),['A']));
  check('AR searches actual received amount',()=>assert.deepEqual(f.search('1,000.25'),['A']));
  check('Decimal query keeps decimal separator and does not match 1250',()=>assert.deepEqual(f.search('12.50'),['C']));
  check('Negative remaining balance preserves its sign',()=>assert.deepEqual(f.search('-65.75'),['D']));
  check('Text and amount keywords combine across existing authorized fields',()=>assert.deepEqual(f.search('甲客戶 1,250 王會計'),['A']));
  check('All keywords are required for AR text and amount search',()=>assert.deepEqual(f.search('乙客戶 1,250'),[]));
  check('Existing case-insensitive invoice text search remains available',()=>assert.deepEqual(f.search('inv-b'),['B']));
  check('Owner name still filters AR records',()=>assert.deepEqual(f.search('王會計'),['A','C']));
  check('Unknown numeric string is not an amount candidate',()=>assert.deepEqual(f.search('888.88'),[]));
  check('Row versions and workflow status do not become amount candidates',()=>assert.deepEqual(f.search('987654'),[]));
  check('Search change resets pagination and does not expand server scope',()=>{f.workspace.state.arPage=9;f.search('INV-A');assert.equal(f.workspace.state.arPage,0);assert.equal(f.calls.length,1);assert.equal(f.workspace.arItems().length,records.length);});
  check('Label and placeholder explain amount search',()=>{assert.match(f.box.innerHTML,/搜尋客戶／單號／金額/);assert.match(f.box.innerHTML,/placeholder="輸入客戶、單號或金額"/);});
  check('Search never rewrites canonical invoice values',()=>assert.deepEqual(records,before));
  const fields=['originalAmount','recognizedAmount','outstandingAmount','receivedAmount','allowanceAmount','arAllowanceAmount','pendingReceiptAmount','refundPayable','refundedAmount'];
  for(const field of fields){const row={invoiceId:'TARGET',invoiceNo:'TARGET',buyer:'核對金額',entityId:'A',departmentCode:'CARE',[field]:87.65},single=await fixture([row]);check('Known numeric field is searchable: '+field,()=>assert.deepEqual(single.search('87.65'),['TARGET']));}
  const invalid=await fixture([{invoiceId:'UNKNOWN',invoiceNo:'UNKNOWN',buyer:'尚未核對',entityId:'A',originalAmount:null,recognizedAmount:undefined,outstandingAmount:NaN,receivedAmount:Infinity,allowanceAmount:false,arAllowanceAmount:'0',status:'paid'}]);
  check('Missing null invalid or untyped amounts never become searchable zero',()=>assert.deepEqual(invalid.search('0'),[]));
  const zero=await fixture([{invoiceId:'ZERO',invoiceNo:'ZERO',buyer:'已核對零元',entityId:'A',originalAmount:0}]);check('An explicitly known numeric zero remains searchable',()=>assert.deepEqual(zero.search('0'),['ZERO']));
  const negativeText=await fixture([{invoiceId:'NEGATIVE',invoiceNo:'AR-NEGATIVE',buyer:'原始金額 -12.50',entityId:'A',outstandingAmount:-12.5}]);
  check('Positive decimal query cannot bypass sign through a numeric substring in AR text',()=>assert.deepEqual(negativeText.search('12.50'),[]));
  check('Unicode minus still finds the actual negative amount',()=>assert.deepEqual(negativeText.search('−12.50'),['NEGATIVE']));
  const embeddedDecimal=await fixture([{invoiceId:'EMBEDDED',invoiceNo:'AR-EMBEDDED',buyer:'原始金額 NT$112.50',entityId:'A',originalAmount:112.5}]);
  check('Embedded currency amount text cannot bypass exact decimal matching',()=>assert.deepEqual(embeddedDecimal.search('12.50'),[]));
  const fallback=await fixture(records,false);check('Missing shared engine safely preserves existing text-only fallback',()=>{assert.deepEqual(fallback.search('inv-b'),['B']);assert.deepEqual(fallback.search('1,250'),[]);});
  console.log(JSON.stringify({ok:true,checks,productionHooksAdded:0,productionWrites:0}));
})().catch(error=>{console.error(error);process.exitCode=1;});
