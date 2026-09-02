#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');

const root=path.resolve(__dirname,'..');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const migration=fs.readFileSync(
  path.join(root,'supabase/migrations/20260902054834_preserve_human_accounting_authority_v1.sql'),
  'utf8'
);

let passed=0;
function check(label,condition){
  if(!condition)throw new Error('FAIL: '+label);
  passed++;
  process.stdout.write('PASS: '+label+'\n');
}
function functionSource(name){
  const marker='function '+name+'(';
  const start=index.indexOf(marker);
  if(start<0)throw new Error('Missing function '+name);
  const open=index.indexOf('{',start);
  let depth=0;
  for(let i=open;i<index.length;i++){
    if(index[i]==='{')depth++;
    else if(index[i]==='}'&&--depth===0)return index.slice(start,i+1);
  }
  throw new Error('Unclosed function '+name);
}

const runtime=new Function(
  'num','cloneSettingValue','S','accountByCode','acctName',
  'controlledCreditAccountForRequest','accountingLaborFeeDetected',
  'expenseDebitAccounts','accountingLineIsSystemFee',
  [
    functionSource('accountingManualActorSnapshot'),
    functionSource('accountingManualFieldNames'),
    functionSource('accountingLineManualFields'),
    functionSource('accountingLineFieldIsHuman'),
    functionSource('accountingComparableValue'),
    functionSource('accountingChangedFields'),
    functionSource('preserveAccountingManualAuthority'),
    functionSource('markAccountingManualAuthority'),
    functionSource('accountingLineCreditAccount'),
    functionSource('invalidateAccountingLines'),
    functionSource('normalizeAccountingLine'),
    'return {accountingLineFieldIsHuman,markAccountingManualAuthority,invalidateAccountingLines,normalizeAccountingLine};'
  ].join('\n')
)(
  value=>Number(value||0),
  value=>JSON.parse(JSON.stringify(value)),
  {user:{id:'u_admin',n:'人工覆核者',email:'admin@suiyuecare.com',role:'admin_director'}},
  code=>({
    '1112':{c:'1112',n:'銀行存款'},
    '2110':{c:'2110',n:'應付帳款'},
    '6221':{c:'6221',n:'勞務費'},
    '6205':{c:'6205',n:'文具用品'}
  }[String(code)]||null),
  code=>String(code),
  ()=>({c:'1112',n:'銀行存款'}),
  line=>String(line&&line.debitAccount||'')==='6221',
  ()=>[{c:'6205',n:'文具用品'}],
  ()=>false
);

const aiLabor=runtime.normalizeAccountingLine({
  id:'line_1',grossAmount:4600,netAmount:4381,taxAmount:219,
  debitAccount:'6221',creditAccount:'1112'
},{type:'payment_request',dc:'A1000'},0);
check('AI labor suggestion still defaults to zero input tax',
  aiLabor.grossAmount===4600&&aiLabor.netAmount===4600&&aiLabor.taxAmount===0);

const manualLabor=runtime.normalizeAccountingLine({
  id:'line_1',grossAmount:4600,netAmount:4381,taxAmount:219,
  debitAccount:'6221',creditAccount:'2110',manualOverride:true,
  valueAuthority:'human',
  manualFields:['netAmount','taxAmount','grossAmount','debitAccount','creditAccount'],
  manualOverrideHistory:[{at:'2026-09-02T00:00:00.000Z'}]
},{type:'payment_request',dc:'A1000'},0);
check('human labor amounts override the no-tax AI default',
  manualLabor.grossAmount===4600&&manualLabor.netAmount===4381&&manualLabor.taxAmount===219);
check('human debit and credit accounts survive normalization',
  manualLabor.debitAccount==='6221'&&manualLabor.creditAccount==='2110');
check('human authority metadata survives normalization',
  runtime.accountingLineFieldIsHuman(manualLabor,'taxAmount')
  &&runtime.accountingLineFieldIsHuman(manualLabor,'creditAccount'));

const reviewed=runtime.markAccountingManualAuthority(
  {grossAmount:915,netAmount:886,taxAmount:29,debitAccount:'6205',creditAccount:'1112'},
  {grossAmount:915,netAmount:900,taxAmount:15,debitAccount:'6221',creditAccount:'2110'},
  'approval_detail_review'
);
check('manual review records all changed amount and subject fields',
  ['netAmount','taxAmount','debitAccount','creditAccount'].every(field=>reviewed.manualFields.includes(field)));
check('manual review records actor, timestamp, source and before/after history',
  reviewed.manualOverrideBy.email==='admin@suiyuecare.com'
  &&reviewed.manualOverrideAt
  &&reviewed.manualOverrideSource==='approval_detail_review'
  &&reviewed.manualOverrideHistory.length===1
  &&reviewed.manualOverrideHistory[0].changes.taxAmount.before===29
  &&reviewed.manualOverrideHistory[0].changes.taxAmount.after===15);

const returnedRecord={formPayload:{accountingLines:[manualLabor]}};
runtime.invalidateAccountingLines(returnedRecord,'退回上一關');
check('workflow return retains human-authoritative accounting lines',
  returnedRecord.formPayload.accountingLines.length===1
  &&returnedRecord.formPayload.accountingLinesPreservedForReview===true
  &&returnedRecord.formPayload.accountingLinesNeedReview===true);
const newEvidenceRecord={formPayload:{accountingLines:[manualLabor]}};
runtime.invalidateAccountingLines(newEvidenceRecord,'新憑據取代舊覆核依據',true);
check('new procurement evidence may rebuild while the audit trail keeps the prior version',
  !Object.prototype.hasOwnProperty.call(newEvidenceRecord.formPayload,'accountingLines')
  &&newEvidenceRecord.formPayload.accountingLinesPreservedForReview===false);
const aiOnlyRecord={formPayload:{accountingLines:[aiLabor]}};
runtime.invalidateAccountingLines(aiOnlyRecord,'AI 內容可重新計算');
check('workflow return may rebuild an AI-only accounting suggestion',
  !Object.prototype.hasOwnProperty.call(aiOnlyRecord.formPayload,'accountingLines')
  &&aiOnlyRecord.formPayload.accountingLinesPreservedForReview===false);

check('submission flushes a still-focused manual amount before reading total',
  /finalizeLazyAccountingDrafts\(\);\s*var amt=parseFloat/.test(index));
check('editing a detail amount no longer rebuilds the entire input table',
  /applyLazyEditValue\(i,k,v,true,false\)/.test(index)
  &&/syncLazyAmountDraftDom\(i,r\)/.test(index));
check('manual new-request account selection is saved with the formal payload',
  /accountingManualDefaults:accountingResolution\.manualDefaults\|\|null/.test(index));
check('approval review updates formal request amount from human gross total',
  /r\.amt=principalGrossTotal;\s*r\.total=principalGrossTotal;/.test(index));
check('account selection no longer zeroes human labor tax in the browser',
  /不得再次覆寫人工輸入的未稅、營業稅或含稅金額/.test(index));
check('human amount lines are excluded from automatic posting rescaling',
  /var factor=!hasHumanAmounts&&target&&current/.test(index));

check('database has a before-update human authority guard',
  /trg_zz_finance_preserve_human_accounting_authority/.test(migration)
  &&/finance_merge_human_accounting_lines/.test(migration));
check('database requires a fresh human audit entry before changed human fields can replace prior values',
  /v_new_history_length > v_old_history_length/.test(migration));
check('database atomically synchronizes normalized accounting lines',
  /trg_zz_finance_sync_request_accounting_lines/.test(migration)
  &&/on conflict \(request_id, line_index\) do update/.test(migration));
check('database records a dedicated manual accounting audit snapshot',
  /HUMAN_ACCOUNTING_SYNC/.test(migration)
  &&/insert into public\.module_audit_logs/.test(migration));

process.stdout.write('OK: '+passed+' human accounting authority checks passed\n');
