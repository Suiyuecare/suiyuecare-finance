'use strict';
// Exercise the shipped download and CSV callers. Python's independent strict
// CSV parser verifies byte-level quoting rather than accepting our serializer.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),search=require('../assets/engines/document-search.js');
function fn(name,windowFn=false){const start=html.indexOf(windowFn?'window.'+name+'=function(':'function '+name+'(');assert(start>=0,name);return html.slice(start,html.indexOf(windowFn?'\n};':'\n}',start)+(windowFn?3:2));}
let checks=0;function check(name,callback){callback();checks++;console.log('PASS '+name);}
function parse(csv){const result=spawnSync('python3',['-c','import csv,io,json,sys; print(json.dumps(list(csv.reader(io.StringIO(sys.stdin.read().lstrip("\\ufeff"), newline=""),strict=True)),ensure_ascii=False))'],{input:csv,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);}
const controls={'v-ent':{value:'A'},'v-month':{value:'2026-09'},'v-q':{value:'冷凍庫'}},downloads=[];
const c={window:{FinanceDocumentSearch:search},S:{lazyRows:[]},VOUCHERS:[],el:id=>controls[id],Date,console,todayIso:()=> '2026-09-22',lazyTaxMode:()=> 'exempt',lazyNetAmount:r=>r.total,lazyTaxAmount:()=>0,lazyRowTotal:r=>r.total,requireFinanceAccountingRead:()=>true,dlCSV:(csv,name)=>downloads.push({csv,name})};vm.createContext(c);
vm.runInContext(['csvCell','csvNumericValue','lazyCsvAttachment','voucherMonthKey','voucherFilteredRows','voucherListPage','refreshVoucherMonths','financeDocumentMatchesQuery'].map(n=>fn(n)).join('\n')+'\n'+fn('exportVoucherCSV',true),c);
check('employee expense export neutralizes formula text but preserves numeric values and identifiers',()=>{
 const inputs=['=1+1','+SUM(1,1)','-SUM(1,1)','@SUM(1,1)',' \t=1+1','\ufeff=1+1','\tordinary','\rordinary','\nordinary'];
 c.S.lazyRows=inputs.map(item=>({no:'0000123',buyerTaxId:'00123456',date:'2026-09-22',item,qty:'-2',unitPrice:'-3.5',total:-7,file:'invoice "A,B"\nsecond.pdf'}));
 const attachment=c.lazyCsvAttachment(),csv=decodeURIComponent(attachment.url.split(',').slice(1).join(',')),rows=parse(csv);
 assert.equal(rows.length,inputs.length+1);rows.slice(1).forEach((row,i)=>{assert.equal(row.length,13);assert.equal(row[4],"'"+inputs[i]);assert.equal(row[0],'0000123');assert.equal(row[2],'00123456');assert.equal(row[5],'-2');assert.equal(row[7],'-3.5');assert.equal(row[9],'-7');assert.equal(row[12],'invoice "A,B"\nsecond.pdf');});
 if(process.env.FINANCE_EXPORT_EVIDENCE_DIR){fs.mkdirSync(process.env.FINANCE_EXPORT_EVIDENCE_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.FINANCE_EXPORT_EVIDENCE_DIR,'expense-formula-neutralized.csv'),csv);}
});
check('voucher export includes all filtered pages with exact Unicode/quote/newline round trip',()=>{
 c.VOUCHERS=Array.from({length:104},(_,i)=>({id:'v'+i,no:'V-'+i,date:'2026/09/22',eid:'A',entS:'法人 "A,B"',desc:'修理 "冰箱,冷凍庫"\n費用 '+i,total:100.25,entries:[{ac:'06201',an:'費用 "A,B"',t:'dr',amt:'100.25'},{ac:'1112',an:'銀行',t:'cr',amt:100.25}]}));
 c.VOUCHERS.push({...c.VOUCHERS[0],id:'other-entity',eid:'B',no:'DO-NOT-EXPORT-ENTITY'}, {...c.VOUCHERS[0],id:'other-month',date:'2026-08-22',no:'DO-NOT-EXPORT-MONTH'}, {...c.VOUCHERS[0],id:'other-year',date:'2025-09-22',no:'DO-NOT-EXPORT-YEAR'}, {...c.VOUCHERS[0],id:'other-query',desc:'辦公文具',no:'DO-NOT-EXPORT-QUERY'});
 c.window.exportVoucherCSV();const {csv,name}=downloads.at(-1),rows=parse(csv);
 assert.equal(rows.length,209);assert(!csv.includes('DO-NOT-EXPORT'));assert(name.includes('A_2026-09_冷凍庫'));
 assert.deepEqual(rows[1],['V-0','2026/09/22','法人 "A,B"','修理 "冰箱,冷凍庫"\n費用 0','06201','費用 "A,B"','100.25','0']);
 assert.deepEqual(rows.at(-1).slice(0,2),['V-103','2026/09/22']);
 const ids=[];for(let page=1;page<=3;page++)ids.push(...c.voucherListPage(c.VOUCHERS,{month:'2026-09',entity:'A',query:'冷凍庫',page}).rows.map(v=>v.no));
 assert.deepEqual(ids,rows.slice(1).filter((_,i)=>i%2===0).map(r=>r[0]));
});
check('amount search, empty match, accounting privacy and CSV formula guard apply to the actual exporter',()=>{
 controls['v-q'].value='100.25';c.window.exportVoucherCSV();assert.equal(parse(downloads.at(-1).csv).length,211);
 controls['v-q'].value='no-results';c.window.exportVoucherCSV();assert.equal(parse(downloads.at(-1).csv).length,1);
 controls['v-q'].value='';c.VOUCHERS=[{no:'=1+1',date:'2026-09-22',eid:'A',entS:'+test',desc:'@test',entries:[{ac:'-test',an:'=1+1',t:'dr',amt:-2}]}];c.window.exportVoucherCSV();assert.deepEqual(parse(downloads.at(-1).csv)[1],["'=1+1",'2026-09-22',"'+test","'@test","'-test","'=1+1",'-2','0']);
 c.requireFinanceAccountingRead=()=>false;const n=downloads.length;c.window.exportVoucherCSV();assert.equal(downloads.length,n);
});
check('voucher month options cover real years/months and retain a selected empty-result month',()=>{
 controls['v-month']={value:'2026-07',innerHTML:''};c.VOUCHERS=[{date:'2026-09-01'},{date:'2026/08/01'},{date:'2025/09/01'},{date:'not-a-date'}];c.refreshVoucherMonths();
 const markup=controls['v-month'].innerHTML;for(const month of ['2026-09','2026-08','2026-07','2025-09'])assert(markup.includes('value="'+month+'"'));assert(!markup.includes('value="05"'));assert.equal(controls['v-month'].value,'2026-07');
});
console.log('OK: '+checks+' export integrity scenarios; synthetic records, no live writes');
