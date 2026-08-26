const fs=require('fs');
const path=require('path');

const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'index.html'),'utf8');
const engine=fs.readFileSync(path.join(root,'assets/engines/accounting-engine.js'),'utf8');
let passed=0;
function check(label,condition){
  if(!condition)throw new Error(`FAIL: ${label}`);
  passed+=1;
  process.stdout.write(`PASS: ${label}\n`);
}

check('missing account scope defaults to all',/var mode=String\(source\.mode\|\|'all'\)/.test(source));
check('all mode is selectable in every company and department',/if\(scope\.mode!=='restricted'\)return true;/.test(source));
check('restricted mode requires both company and department',/accountScopeEntityMatches\(scope\.entityIds,entityId\)&&accountScopeDepartmentMatches\(scope\.departmentCodes,departmentCode\)/.test(source));
check('entity and department wildcard tokens remain supported',/token\.slice\(-1\)==='\*'/.test(source));
check('inactive accounts remain unavailable',/if\(!account\|\|account\.on===false\)return false;/.test(source));
check('manual debit list excludes account 1144',/return account\.s==='debit'&&code!=='1144';/.test(source));
check('debit and credit selectors share the scoped runtime guard',(source.match(/accountSelectableForContext\(a,entityId,departmentCode\)/g)||[]).length>=2);
check('advance settlement selector reuses the scoped debit list',/function advanceFinalAccountOptions\([\s\S]{0,260}expenseDebitAccounts\(departmentCode,entityId\)/.test(source));
check('selected legacy value cannot bypass side and scope checks',/!accountSelectableForContext\(a,entityId,departmentCode\)\|\|!accountMatchesManualSelectionSide\(a,side\)/.test(source));
check('account summary reports only explicit restricted scopes',/selectionScope\(account\)\.mode === 'restricted'/.test(engine));
check('settings UI explains current all-company/all-department mode',source.includes('目前全部公司／部門共用'));

const builtIndex=path.join(root,'www/index.html');
const builtEngine=path.join(root,'www/assets/engines/accounting-engine.js');
if(fs.existsSync(builtIndex)&&fs.existsSync(builtEngine)){
  const built=fs.readFileSync(builtIndex,'utf8');
  const builtEngineSource=fs.readFileSync(builtEngine,'utf8');
  check('built frontend contains the same scoped account selector',built.includes('function accountSelectableForContext(account,entityId,departmentCode)'));
  check('built accounting engine contains the restricted-scope summary',builtEngineSource.includes("selectionScope(account).mode === 'restricted'"));
}

process.stdout.write(`OK: ${passed} account selection scope checks passed\n`);
