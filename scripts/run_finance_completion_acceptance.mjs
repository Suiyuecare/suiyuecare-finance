#!/usr/bin/env node
// Reproducible local acceptance. Synthetic execution never certifies employee UAT.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const output=path.resolve(process.env.FINANCE_ACCEPTANCE_OUTPUT||path.join(os.tmpdir(),'finance-completion-acceptance-'+new Date().toISOString().replace(/[:.]/g,'-')));
if(output===root||output.startsWith(root+path.sep))throw new Error('Acceptance output must remain outside the source checkout');
fs.mkdirSync(output,{recursive:true});
const sha=()=>execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
function sourceProof(){
  const status=execFileSync('git',['status','--porcelain','--untracked-files=all'],{cwd:root,encoding:'utf8'});
  if(status.trim())throw new Error('Acceptance requires a clean committed source checkout; concurrent edits cannot certify the candidate');
  const files=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean).sort();
  const digest=crypto.createHash('sha256');
  for(const file of files){digest.update(file+'\0');digest.update(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest());}
  return {candidate:sha(),trackedFileCount:files.length,trackedSourceSha256:digest.digest('hex')};
}
const evidence={candidate:sha(),startedAt:new Date().toISOString(),scope:'Local application, isolated synthetic roles, actual SQL and browser engines; no production writes or employee Google login',runs:[],pending:['Formal full-trigger capacity under fixed network and data conditions','Company-owned iOS and Android device acceptance','Target-module session revocation and receipt evidence','Formal database and storage restore rehearsal','Cross-role internal trial for at least 7 working days'],automatedPassed:false,fullAcceptancePassed:false};
const save=()=>fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');
save();
async function execute(name,bin,args,extraEnv={}){
  const log=path.join(output,String(evidence.runs.length+1).padStart(2,'0')+'-'+name.replace(/[^a-z0-9_-]/gi,'_')+'.log');
  const fd=fs.openSync(log,'w'),started=Date.now();
  console.log('RUN '+name+' (evidence: '+log+')');
  let code,signal,timer,timedOut=false;
  try{
    const child=spawn(bin,args,{cwd:root,env:{...process.env,FINANCE_BUILD_TARGET:'preview',FINANCE_BROWSER_CHANNEL:'chromium',...extraEnv},stdio:['ignore',fd,fd]});
    timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');},20*60*1000);
    const result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(exitCode,exitSignal)=>resolve({exitCode,exitSignal}));});
    clearTimeout(timer);code=result.exitCode;signal=result.exitSignal;
  }finally{clearTimeout(timer);fs.closeSync(fd);}
  evidence.runs.push({name,command:[bin,...args],exitCode:code,signal,timedOut,durationMs:Date.now()-started,log,logSha256:crypto.createHash('sha256').update(fs.readFileSync(log)).digest('hex')});save();
  if(code!==0||timedOut)throw new Error(name+' failed; inspect '+log);
  console.log('PASS '+name);
}
try{
  if(!process.env.FINANCE_NATIVE_PG_CONFIG)throw new Error('FINANCE_NATIVE_PG_CONFIG is required for real concurrent transaction tests; no skipped native pass is permitted');
  const nativeConfigPath=path.resolve(process.env.FINANCE_NATIVE_PG_CONFIG);
  const nativeConfig=JSON.parse(fs.readFileSync(nativeConfigPath,'utf8'));
  if(nativeConfigPath===root||nativeConfigPath.startsWith(root+path.sep)||(fs.statSync(nativeConfigPath).mode&0o077)!==0||nativeConfig.host!=='127.0.0.1'||!Number.isSafeInteger(nativeConfig.port)||nativeConfig.port<1024||nativeConfig.port>65535||nativeConfig.port===5432||nativeConfig.database!=='postgres'||!nativeConfig.user||nativeConfig.ssl)throw new Error('Native configuration must be private, outside source, and select an explicit disposable loopback server on a non-default port');
  const nativeEnv={FINANCE_NATIVE_PG_CONFIG:nativeConfigPath,FINANCE_SUMMARY_PG_CONFIG:nativeConfigPath,FINANCE_SUMMARY_CONCURRENCY_EVIDENCE:path.join(output,'summary-native.json'),FINANCE_HR_TEST_PG_HOST:nativeConfig.host,FINANCE_HR_TEST_PG_PORT:String(nativeConfig.port),FINANCE_HR_TEST_PG_USER:nativeConfig.user,PGPASSWORD:nativeConfig.password||''};
  evidence.nativeServer={host:nativeConfig.host,port:nativeConfig.port,database:nativeConfig.database};
  evidence.sourceStart=sourceProof();save();
  await execute('release-candidate','pnpm',['release:build']);
  const browserScripts=Object.keys(pkg.scripts).filter(name=>/^test:/.test(name)&&/browser/.test(name)&&name!=='test:finance-completion-all').sort();
  for(const name of browserScripts)await execute(name,'pnpm',[name],{FINANCE_BUILD_TARGET:'local'});
  for(const file of ['check_formal_tus_browser_integration.cjs','check_finance_auth_recovery_browser.cjs','check_finance_oauth_error_browser.cjs','check_human_accounting_browser_20261002.cjs','check_employee_form_ux_browser.cjs','check_startup_bundle_browser.cjs'])await execute(file,'node',['scripts/'+file],{FINANCE_BUILD_TARGET:'local'});
  for(const file of ['check_approval_tab_colors_browser.cjs','check_attachment_download_browser.cjs','check_department_workspace_browser.cjs','check_employee_auth_notifications_browser.cjs','check_employee_progress_concerns_browser.cjs','check_expense_posting_browser.cjs','check_finance_approval_runtime_browser.cjs','check_hr_accounting_read_privacy_browser.mjs','check_mobile_role_navigation_browser_20261002.cjs','check_utility_bill_browser.cjs'])await execute(file,'node',['scripts/'+file],{FINANCE_BUILD_TARGET:'local'});
  await execute('cloud-draft-workspace-browser','node',['scripts/test_cloud_draft_workspace.cjs'],{FINANCE_BUILD_TARGET:'local',FINANCE_CLOUD_WORKSPACE_BROWSER:'1'});
  await execute('finance-ui-interactions','pnpm',['test:finance-ui-interactions'],{FINANCE_BUILD_TARGET:'local'});
  for(const name of ['test:audit-controls-native-concurrency','test:hr-contractor-native','test:finance-completion-native'])await execute(name,'pnpm',[name],{...nativeEnv,FINANCE_BUILD_TARGET:'local',FINANCE_CLOUD_NATIVE_EVIDENCE:path.join(output,'cloud-native.json')});
  for(const file of ['check_approval_history_summary_concurrency.cjs','test_hr_private_bridge_concurrency.mjs','test_hr_voucher_posting_concurrency.mjs'])await execute(file,'node',['scripts/'+file],{...nativeEnv,FINANCE_BUILD_TARGET:'local'});
  await execute('native-full-migration-rehearsal','node',['scripts/test_finance_completion_release_batch.cjs'],nativeEnv);
  evidence.sourceFinish=sourceProof();
  if(evidence.sourceFinish.candidate!==evidence.candidate||JSON.stringify(evidence.sourceFinish)!==JSON.stringify(evidence.sourceStart))throw new Error('Source content changed during acceptance; evidence cannot certify the candidate');
  evidence.automatedPassed=true;evidence.finishedAt=new Date().toISOString();save();
  console.log('Automated checks passed. Full acceptance remains pending external evidence: '+path.join(output,'evidence.json'));
}catch(error){evidence.failure=error.message;evidence.finishedAt=new Date().toISOString();save();console.error(error.message);process.exitCode=1;}
