#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const vm=require('node:vm');
const engine=require('../assets/engines/mega-remittance-engine.js');
let passed=0;
function test(name,run){try{run();passed++;}catch(error){error.message=name+': '+error.message;throw error;}}
// All records are synthetic. No employee, payroll or bank-account source data.
function row(overrides){return Object.assign({name:'測試收款人',identityNo:'',bankCode:'0170000',account:'00000000001',amount:12345},overrides);}
function build(mode,rows){return engine.buildWorkbook({mode,rows});}
function issue(mode,changes,code,field){
  const result=build(mode,[row(changes)]);
  assert.equal(result.ok,false);assert.equal(result.workbook,null);
  assert(result.issues.some(x=>x.code===code&&(!field||x.field===field)),JSON.stringify(result.issues));
}
test('payroll exact header, markers and numeric trailer',()=>{
  const out=build('payroll',[row(),row({name:'測試乙',bankCode:'0040000',account:'00000000002',amount:'300'})]);
  assert.equal(out.ok,true);assert.equal(out.workbook.sheetName,'工作表1');
  assert.deepEqual(out.workbook.rows,[['HEADER','收款人姓名','存款人身份證號','轉入銀行代號','轉入帳號','付款金額'],['PAYMENT','測試收款人','','0170000','00000000001',12345],['PAYMENT','測試乙','','0040000','00000000002',300],['TRAILER','PAYMENT總筆數',2,'PAYMENT總金額',12645,null]]);
  assert.deepEqual(out.workbook.types[1],['s','s','s','s','s','n']);
  assert.deepEqual(out.workbook.types[3],['s','s','n','s','n',null]);
  assert.deepEqual(out.workbook.summary,{mode:'payroll',paymentCount:2,totalAmount:12645});
});
test('bulk exact four columns, no payroll marker or trailer',()=>{
  const out=build('bulk',[row()]).workbook;
  assert.deepEqual(out.rows,[['戶名','金額','銀行代號','帳號'],['測試收款人',12345,'0170000','00000000001']]);
  assert.deepEqual(out.types,[['s','s','s','s'],['s','n','s','s']]);
});
test('both formats preserve identifier zeroes',()=>{
  ['bulk','payroll'].forEach(mode=>{
    const out=build(mode,[row()]).workbook;const bankColumn=mode==='payroll'?3:2,accountColumn=mode==='payroll'?4:3;
    assert.equal(out.rows[1][bankColumn],'0170000');assert.equal(out.types[1][bankColumn],'s');
    assert.equal(out.rows[1][accountColumn],'00000000001');assert.equal(out.types[1][accountColumn],'s');
  });
});
test('payroll allows Mega 017 head-office code',()=>assert.equal(build('payroll',[row({bankCode:'017'})]).ok,true));
test('payroll rejects another bank head-office code',()=>issue('payroll',{bankCode:'004'},'bank_code_invalid','bankCode'));
test('payroll rejects 4, 6 and 8 digit bank codes',()=>['0170','017000','01700000'].forEach(bankCode=>issue('payroll',{bankCode},'bank_code_invalid')));
test('bulk does not invent a payroll-only bank code length rule',()=>assert.equal(build('bulk',[row({bankCode:'004'})]).ok,true));
test('numeric bank code is rejected rather than zero-padded',()=>['bulk','payroll'].forEach(mode=>issue(mode,{bankCode:17},'text_type_required','bankCode')));
test('numeric account is rejected rather than guessing lost zeroes',()=>['bulk','payroll'].forEach(mode=>issue(mode,{account:123},'text_type_required','account')));
test('bank codes are not stripped of separators or spaces',()=>[' 017','017-0000','１７０'].forEach(bankCode=>issue('payroll',{bankCode},'bank_code_invalid')));
test('ASCII account formatting is normalized without losing any digit or leading zero',()=>{
  for(const [account,expected] of [['000-01','00001'],[' 00001','00001'],['00001 ','00001'],[' 000-123 45678901 ','00012345678901'],['00 - 001 -- 002','00001002'],['0','0']]){
    assert.equal(engine.normalizeAccount(account),expected);
    for(const mode of ['bulk','payroll']){
      const checked=engine.validate({mode,rows:[row({account})]});assert.equal(checked.ok,true);assert.equal(checked.normalizedRows[0].account,expected);
      const out=build(mode,[row({account})]).workbook,col=mode==='payroll'?4:3;
      assert.equal(out.rows[1][col],expected);assert.equal(out.types[1][col],'s');
    }
  }
});
const malformedAccounts=['-123','123-',' -123 ','123- ','--123','123--','+123','---',' - - ','１２３','123\u2013456','123\u2212456','12/34','12\\34','1e3','1E3','0x12','=123','123.00','1,234','123abc','12\u00a034','12\u200b34','12\u300034',' 12-3\n',' 12-3\r','12\t3','12\n3','12\r3','12\0'+'3','123\u2028','123\u2029','123\u007f'];
test('malformed account helper input is returned unchanged rather than partially repaired',()=>{
  for(const value of [...malformedAccounts,'','   ',null,undefined,123,NaN,{},[],new String('000-123')])assert.equal(engine.normalizeAccount(value),value);
});
test('malformed account blocks both bank formats',()=>{
  for(const account of malformedAccounts)for(const mode of ['bulk','payroll'])issue(mode,{account},'digits_required','account');
});
test('account control characters still fail readText before bank formatting normalization',()=>{
  for(const account of [' 12-3\n',' 12-3\r','12\t3','12\n3','12\r3','12\0'+'3','123\u007f'])for(const mode of ['bulk','payroll'])issue(mode,{account},'text_control_characters','account');
});
test('blank or whitespace-only formatted accounts cannot become payment records',()=>{
  for(const account of ['', '   ', '\t', '\n'])for(const mode of ['bulk','payroll'])issue(mode,{account},'text_required','account');
});
test('empty account and bank code each have precise issues',()=>['bulk','payroll'].forEach(mode=>{issue(mode,{account:''},'text_required','account');issue(mode,{bankCode:null},'text_required','bankCode');}));
test('payroll account 14 digit boundary',()=>assert.equal(build('payroll',[row({account:'00000000000001'})]).ok,true));
test('payroll account 15 digits rejected',()=>issue('payroll',{account:'000000000000001'},'account_too_long','account'));
test('payroll account bound counts digits after formatting normalization',()=>{
  assert.equal(build('payroll',[row({account:' 00-0000 0000-0001 '})]).ok,true);
  issue('payroll',{account:' 000-0000 0000-0001 '},'account_too_long','account');
});
test('raw account text validation cannot be bypassed with removable formatting',()=>{
  for(const mode of ['bulk','payroll'])issue(mode,{account:' '.repeat(32768)+'1'},'text_too_long','account');
});
test('bulk does not invent a payroll-only account limit',()=>assert.equal(build('bulk',[row({account:'000000000000001'})]).ok,true));
test('name or identity required in payroll',()=>issue('payroll',{name:'',identityNo:''},'name_or_identity_required'));
test('identity-only payroll record allowed',()=>assert.equal(build('payroll',[row({name:'',identityNo:'TEST000001'})]).ok,true));
test('name-only payroll record allowed like supplied examples',()=>assert.equal(build('payroll',[row({identityNo:undefined})]).ok,true));
test('bulk name required even when identity exists',()=>issue('bulk',{name:'',identityNo:'TEST000001'},'text_required','name'));
test('identity maximum 10 characters',()=>{assert.equal(build('payroll',[row({identityNo:'TEST000001'})]).ok,true);issue('payroll',{identityNo:'TEST0000001'},'identity_too_long','identityNo');});
test('name maximum Chinese length',()=>{assert.equal(build('payroll',[row({name:'測'.repeat(39)})]).ok,true);issue('payroll',{name:'測'.repeat(40)},'name_too_long','name');});
test('name maximum Latin length',()=>{assert.equal(build('payroll',[row({name:'T'.repeat(78)})]).ok,true);issue('payroll',{name:'T'.repeat(79)},'name_too_long','name');});
test('mixed name length uses two units per Chinese character',()=>{assert.equal(build('payroll',[row({name:'測'.repeat(38)+'AB'})]).ok,true);issue('payroll',{name:'測'.repeat(39)+'A'},'name_too_long','name');});
test('names beginning with formula syntax stay literal typed text',()=>['bulk','payroll'].forEach(mode=>{
  ['=1+1','+SUM(A1:A2)','@TEST','-TEST'].forEach(name=>{const out=build(mode,[row({name})]).workbook,col=mode==='payroll'?1:0;assert.equal(out.rows[1][col],name);assert.equal(out.types[1][col],'s');});
}));
test('control characters rejected in text',()=>['bulk','payroll'].forEach(mode=>issue(mode,{name:'測試\n第二列'},'text_control_characters','name')));
test('whitespace-only name rejected',()=>['bulk','payroll'].forEach(mode=>issue(mode,{name:'   '},'text_required','name')));
test('blank amount rejected without zero fallback',()=>['',null,undefined].forEach(amount=>['bulk','payroll'].forEach(mode=>issue(mode,{amount},'amount_invalid','amount'))));
test('zero and negative amount rejected',()=>[0,'0','000',-1,'-1'].forEach(amount=>['bulk','payroll'].forEach(mode=>issue(mode,{amount},'amount_invalid','amount'))));
test('exponent and malformed amount rejected',()=>['1e3','1E3','NaN','Infinity','1,000','1.0',' 1','1 ','+1','0x10',true,{},[]].forEach(amount=>['bulk','payroll'].forEach(mode=>issue(mode,{amount},'amount_invalid','amount'))));
test('fractional or nonfinite numbers rejected',()=>[1.5,NaN,Infinity,-Infinity].forEach(amount=>['bulk','payroll'].forEach(mode=>issue(mode,{amount},'amount_invalid','amount'))));
test('numeric string amount is normalized to a numeric cell',()=>assert.equal(build('payroll',[row({amount:'000123'})]).workbook.rows[1][5],123));
test('payroll 13 digit maximum accepted',()=>assert.equal(build('payroll',[row({amount:'9999999999999'})]).ok,true));
test('payroll 14 digit amount rejected',()=>[10000000000000,'10000000000000','00000000000001'].forEach(amount=>issue('payroll',{amount},'amount_too_long','amount')));
test('unsafe numeric amount rejected',()=>['bulk','payroll'].forEach(mode=>issue(mode,{amount:Number.MAX_SAFE_INTEGER+1},'amount_invalid','amount')));
test('Excel 15 digit amount boundary',()=>{assert.equal(build('bulk',[row({amount:999999999999999})]).ok,true);issue('bulk',{amount:1000000000000001},'amount_excel_precision');});
test('unsafe aggregate prevents whole workbook',()=>{const out=build('bulk',[row({amount:999999999999999}),row({amount:1})]);assert.equal(out.ok,false);assert.equal(out.workbook,null);assert(out.issues.some(x=>x.code==='total_unsafe'));});
test('payroll trailer cannot exceed Excel precision even if each row is valid',()=>{const out=build('payroll',Array.from({length:101},()=>row({amount:9999999999999})));assert.equal(out.ok,false);assert.equal(out.workbook,null);assert(out.issues.some(x=>x.code==='total_unsafe'));});
test('empty and invalid inputs never produce a workbook',()=>[undefined,null,{},[],{mode:'payroll',rows:[]},{mode:'csv',rows:[row()]},{mode:'bulk',rows:{}}].forEach(input=>{const out=engine.buildWorkbook(input);assert.equal(out.ok,false);assert.equal(out.workbook,null);}));
test('a bad row blocks all records and reports data plus Excel row',()=>{
  const out=build('payroll',[row(),row({account:''}),row()]);assert.equal(out.ok,false);assert.equal(out.workbook,null);
  assert(out.issues.some(x=>x.row===2&&x.excelRow===3&&x.field==='account'));
});
test('null and array records cannot silently disappear',()=>[null,[],undefined].forEach(bad=>{const out=build('payroll',[row(),bad]);assert.equal(out.ok,false);assert(out.issues.some(x=>x.row===2&&x.code==='row_invalid'));}));
test('sparse array slots cannot silently disappear',()=>{const rows=[row()];rows.length=2;const out=build('payroll',rows);assert.equal(out.ok,false);assert(out.issues.some(x=>x.row===2&&x.code==='row_invalid'));});
test('duplicate payment rows are retained, not silently combined',()=>{const out=build('payroll',[row(),row()]);assert.equal(out.workbook.summary.paymentCount,2);assert.equal(out.workbook.summary.totalAmount,24690);});
test('source rows are never mutated',()=>{
  for(const mode of ['bulk','payroll']){
    const input={mode,rows:[row({amount:'0123',account:' 000-123 45678901 '})]},before=JSON.stringify(input);Object.freeze(input.rows[0]);Object.freeze(input.rows);Object.freeze(input);
    assert.equal(engine.buildWorkbook(input).ok,true);assert.equal(JSON.stringify(input),before);
  }
});
test('no unsupported source fields leak into bank file',()=>{
  const out=build('bulk',[row({identityNo:'TEST000001',internalNote:'PRIVATE_NOTE',email:'test@example.invalid'})]);
  assert(!JSON.stringify(out.workbook).includes('TEST000001'));assert(!JSON.stringify(out.workbook).includes('PRIVATE_NOTE'));assert(!JSON.stringify(out.workbook).includes('example.invalid'));
});
test('browser and Node entrypoints produce identical results',()=>{
  const sandbox={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/engines/mega-remittance-engine.js'),'utf8'),sandbox);
  assert.equal(typeof sandbox.window.FinanceMegaRemittance.buildWorkbook,'function');
  assert.equal(JSON.stringify(sandbox.window.FinanceMegaRemittance.buildWorkbook({mode:'payroll',rows:[row()]})),JSON.stringify(build('payroll',[row()])));
});
test('every generated row and type vector has exact column count',()=>['bulk','payroll'].forEach(mode=>{
  const out=build(mode,[row(),row({amount:7})]).workbook,count=mode==='payroll'?6:4;
  assert.equal(out.rows.length,out.types.length);out.rows.forEach((values,index)=>{assert.equal(values.length,count);assert.equal(out.types[index].length,count);values.forEach((value,column)=>{const type=out.types[index][column];if(type==='n')assert.equal(typeof value,'number');if(type==='s')assert.equal(typeof value,'string');if(type===null)assert.equal(value,null);});});
}));
test('invalid data never reaches file serializer',()=>{let calls=0;const out=engine.buildXlsx({mode:'bulk',rows:[row({account:''})]},{write(){calls++;}});assert.equal(out.ok,false);assert.equal(out.bytes,null);assert.equal(calls,0);});
test('missing serializer cannot appear as generated file',()=>{const out=engine.buildXlsx({mode:'bulk',rows:[row()]},null);assert.equal(out.ok,false);assert.equal(out.bytes,null);assert.equal(out.issues[0].code,'xlsx_unavailable');});
test('serializer error does not leak sensitive exception values',()=>{const out=engine.buildXlsx({mode:'bulk',rows:[row()]},{write(){throw new Error('SENSITIVE_TEST_VALUE');}});assert.equal(out.ok,false);assert.equal(out.bytes,null);assert(!JSON.stringify(out).includes('SENSITIVE_TEST_VALUE'));});
test('HTML disguised as XLSX is rejected',()=>{const out=engine.buildXlsx({mode:'bulk',rows:[row()]},{write(){return '<html>not xlsx</html>';}});assert.equal(out.ok,false);assert.equal(out.bytes,null);});
test('serializer uses literal cell types without executable formulas',()=>{let book,options;const out=engine.buildXlsx({mode:'payroll',rows:[row({name:'=1+1'})]},{write(b,o){book=b;options=o;return new Uint8Array([80,75,3,4]);}});assert.equal(out.ok,true);const s=book.Sheets['工作表1'];assert.equal(s.B2.t,'s');assert.equal(s.B2.v,'=1+1');assert.equal(s.B2.f,undefined);assert.equal(s.E2.z,'@');assert.equal(s.F2.t,'n');assert.equal(options.bookType,'xlsx');assert.equal(options.type,'array');});
test('Excel cell text length boundary',()=>{assert.equal(build('bulk',[row({name:'A'.repeat(32767)})]).ok,true);issue('bulk',{name:'A'.repeat(32768)},'text_too_long');});
test('orphan Unicode surrogate rejected without replacement',()=>['\ud800','\udfff'].forEach(name=>issue('bulk',{name},'text_invalid_unicode')));
test('complete Unicode supplementary character preserved',()=>{const out=build('bulk',[row({name:'測試𠮷'})]);assert.equal(out.ok,true);assert.equal(out.workbook.rows[1][0],'測試𠮷');});
test('Excel row limits checked before iterating sparse array',()=>{for(const [mode,length] of [['payroll',1048575],['bulk',1048576]]){const rows=[];rows.length=length;const out=build(mode,rows);assert.equal(out.ok,false);assert.equal(out.issues[0].code,'rows_too_many');}});
// Use the same pinned SheetJS build as the application browser tests. Reopen
// real XLSX bytes to verify identifiers survive Excel serialization as text.
async function readbackTests(){
  const filename=process.env.FINANCE_MEGA_XLSX_PATH||path.join(os.tmpdir(),'finance-mega-xlsx-0.18.5.cjs');
  const expectedSha='c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99';
  const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
  if(!fs.existsSync(filename)){
    if(process.env.FINANCE_MEGA_XLSX_PATH)throw Error('FINANCE_MEGA_XLSX_PATH does not exist');
    const response=await fetch('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',{signal:AbortSignal.timeout(30000)});
    assert.equal(response.ok,true,'pinned XLSX dependency can be loaded');
    const bytes=Buffer.from(await response.arrayBuffer());assert.equal(sha(bytes),expectedSha);
    fs.writeFileSync(filename,bytes,{mode:0o600});
  }
  assert.equal(sha(fs.readFileSync(filename)),expectedSha,'XLSX dependency hash matches application QA');
  const xlsx=require(filename);
  for(const mode of ['bulk','payroll'])test(mode+' real XLSX readback retains all account digits and literal text types',()=>{
    const accounts=mode==='payroll'?[' 000-123 45678901 ','00 0000-0000 0002']:[' 000-123 45678901 ','00000000000000000000000001'];
    const expectedAccounts=mode==='payroll'?['00012345678901','00000000000002']:['00012345678901','00000000000000000000000001'];
    const input={mode,rows:[row({name:'=1+1',account:accounts[0]}),row({name:'測試乙',bankCode:'0040000',account:accounts[1],amount:300})]},before=JSON.stringify(input);
    input.rows.forEach(Object.freeze);Object.freeze(input.rows);Object.freeze(input);
    const out=engine.buildXlsx(input,xlsx);assert.equal(out.ok,true);assert(out.bytes instanceof Uint8Array);
    const book=xlsx.read(out.bytes,{type:'array',cellNF:true,cellText:false});assert.deepEqual(book.SheetNames,['工作表1']);
    const sheet=book.Sheets['工作表1'],accountColumn=mode==='payroll'?'E':'D',bankColumn=mode==='payroll'?'D':'C',nameColumn=mode==='payroll'?'B':'A',amountColumn=mode==='payroll'?'F':'B';
    expectedAccounts.forEach((value,i)=>{const cell=sheet[accountColumn+(i+2)];assert.equal(cell.v,value);assert.equal(cell.t,'s');assert.equal(cell.z,'@');assert.equal(cell.f,undefined);});
    assert.equal(sheet[bankColumn+'2'].v,'0170000');assert.equal(sheet[bankColumn+'2'].t,'s');
    assert.equal(sheet[nameColumn+'2'].v,'=1+1');assert.equal(sheet[nameColumn+'2'].t,'s');assert.equal(sheet[nameColumn+'2'].f,undefined);
    assert.equal(sheet[amountColumn+'2'].v,12345);assert.equal(sheet[amountColumn+'2'].t,'n');assert.equal(sheet[amountColumn+'3'].v,300);
    const values=xlsx.utils.sheet_to_json(sheet,{header:1,raw:true,defval:null});assert.deepEqual(values,engine.buildWorkbook(input).workbook.rows);
    if(mode==='payroll'){assert.equal(sheet.A4.v,'TRAILER');assert.equal(sheet.C4.v,2);assert.equal(sheet.E4.v,12645);assert.equal(sheet.E4.t,'n');assert.equal(sheet.E4.f,undefined);}
    assert.equal(JSON.stringify(input),before);
  });
  test('malformed account never reaches real XLSX serializer or alters source',()=>{
    for(const mode of ['bulk','payroll'])for(const account of [...malformedAccounts,123]){
      const input={mode,rows:[row({account})]},before=JSON.stringify(input);let writes=0;
      Object.freeze(input.rows[0]);Object.freeze(input.rows);Object.freeze(input);
      const out=engine.buildXlsx(input,{write(...args){writes++;return xlsx.write(...args);}});
      assert.equal(out.ok,false);assert.equal(out.bytes,null);assert.equal(writes,0);assert.equal(JSON.stringify(input),before);
    }
  });
  console.log('Mega remittance engine: '+passed+' behavioral checks passed, including real XLSX readback.');
}
readbackTests().catch(error=>{console.error(error);process.exitCode=1;});
