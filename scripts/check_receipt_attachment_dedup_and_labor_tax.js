const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=process.env.FINANCE_TEST_ROOT
  ?path.resolve(process.env.FINANCE_TEST_ROOT)
  :path.resolve(__dirname,'..');
const builtRoot=process.env.FINANCE_BUILT_ROOT
  ?path.resolve(process.env.FINANCE_BUILT_ROOT)
  :path.join(root,'www');
const registrySource=fs.readFileSync(path.join(root,'assets/engines/finance-v4-engine-registry.js'),'utf8');
const attachmentSource=fs.readFileSync(path.join(root,'assets/engines/attachment-engine.js'),'utf8');
const indexSource=fs.readFileSync(path.join(root,'index.html'),'utf8');
const builtIndexSource=fs.readFileSync(path.join(builtRoot,'index.html'),'utf8');
const builtAttachmentSource=fs.readFileSync(path.join(builtRoot,'assets/engines/attachment-engine.js'),'utf8');
const context={window:{},console};
context.window.window=context.window;
vm.runInNewContext(registrySource,context);
vm.runInNewContext(attachmentSource,context);
const engine=context.window.FinanceAttachmentEngine;

let passed=0;
function check(label,condition){
  if(!condition)throw new Error('FAIL: '+label);
  passed++;
  process.stdout.write('PASS: '+label+'\n');
}

const samePath=Array.from({length:21},()=>({n:'1782715683739_1.png',bucket:'finance-attachments',path:'invoices/production/receipt/1782715683739_1.png'}));
check('21 batch rows sharing one storage object render as one attachment',engine.uniqueFiles(samePath).length===1);
check('different storage paths remain separate uploads',engine.uniqueFiles([
  {n:'proof.png',path:'receipts/one/proof.png'},
  {n:'proof.png',path:'receipts/two/proof.png'}
]).length===2);
check('the same attachment id is deduplicated without a storage path',engine.uniqueFiles([
  {id:'att-1',n:'proof.png'},
  {id:'att-1',n:'proof.png'}
]).length===1);
check('unkeyed files are not incorrectly merged by filename alone',engine.uniqueFiles([
  {n:'proof.png',size:100},
  {n:'proof.png',size:100}
]).length===2);

function functionSource(name){
  const marker='function '+name+'(';
  const start=indexSource.indexOf(marker);
  if(start<0)throw new Error('Missing function '+name);
  const open=indexSource.indexOf('{',start);
  let depth=0;
  for(let i=open;i<indexSource.length;i++){
    if(indexSource[i]==='{')depth++;
    else if(indexSource[i]==='}'&&--depth===0)return indexSource.slice(start,i+1);
  }
  throw new Error('Unclosed function '+name);
}
const laborRuntime=new Function('num','BUSINESS_TAX_RATE',[
  functionSource('accountingLaborFeeDetected'),
  functionSource('lazyHasValue'),
  functionSource('normalizeLazyTaxMode'),
  functionSource('lazyTaxMode'),
  functionSource('lazyAmountParts'),
  'return {accountingLaborFeeDetected,lazyTaxMode,lazyAmountParts};'
].join('\n'))(value=>Number(value||0),0.05);
const laborParts=laborRuntime.lazyAmountParts({grossAmount:4600,netAmount:4381,taxAmount:219,taxMode:'gross_inclusive',accountingSubjectSuggestion:'勞務費'});
check('actual labor amount runtime keeps 4600 as expense and zeroes 219 tax',laborParts.gross===4600&&laborParts.net===4600&&laborParts.tax===0&&laborParts.mode==='exempt');
const regularParts=laborRuntime.lazyAmountParts({grossAmount:4600,netAmount:4381,taxAmount:219,taxMode:'gross_inclusive',accountingSubjectSuggestion:'文具用品'});
check('non-labor invoice tax remains unchanged',regularParts.gross===4600&&regularParts.net===4381&&regularParts.tax===219);

check('receipt summary count uses the unique grouped attachment list',/receiptFiles=receiptFilesForInvoiceRows\(groupRows\),proof=receiptFiles\.length/.test(indexSource));
check('receivable detail uses the unique grouped attachment list',/var receiptFiles=receiptFilesForInvoiceRows\(rows\);/.test(indexSource));
check('receipt write avoids appending the same physical file twice',/nextFiles:uniqueAttachments\(\(row\.receiptFiles\|\|\[\]\)\.concat\(files\)\)/.test(indexSource));

check('labor-fee OCR rows are forced to exempt mode',/if\(laborFee\)\{[\s\S]{0,180}tax=0;[\s\S]{0,100}taxMode='exempt';/.test(indexSource));
check('6221 is an explicit labor-fee detection signal',/if\(code==='6221'\)return true;/.test(indexSource));
check('historical labor-fee accounting lines are normalized to zero input tax',/\|\|laborFee\)\{tax=0;net=gross;\}/.test(indexSource));
check('saving a reviewed labor-fee line keeps tax at zero',/var tax=\(r&&r\.type==='hr_expense_request'\)\|\|laborFee\?0:/.test(indexSource));
check('built frontend includes unique receipt attachment handling',builtIndexSource.includes('receiptFilesForInvoiceRows')&&builtAttachmentSource.includes('function uniqueFiles'));
check('built frontend includes the labor fee no-tax guard',builtIndexSource.includes("if(code==='6221')return true")&&builtIndexSource.includes("taxMode='exempt'"));

process.stdout.write('OK: '+passed+' receipt attachment and labor tax checks passed\n');
