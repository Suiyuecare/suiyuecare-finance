#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const migrationPath=path.join(root,'supabase/migrations/20260820052216_repair_account_and_new_taipei_runtime.sql');
const sql=fs.readFileSync(migrationPath,'utf8');
let passed=0;
function check(name,predicate){
  if(!predicate){console.error('FAIL:',name);process.exitCode=1;return;}
  passed++;console.log('PASS:',name);
}
function hasAll(values){return values.every(value=>sql.includes(value));}

check('repair is one bounded transaction',/\bbegin;[\s\S]*set local lock_timeout = '5s';[\s\S]*set local statement_timeout = '60s';[\s\S]*commit;\s*$/i.test(sql));
check('repair never mutates or manufactures Auth identities',!/(?:update|insert\s+into|delete\s+from)\s+auth\./i.test(sql)&&!/set\s+auth_user_id\s*=/i.test(sql));
check('accountant profile and tenant membership converge on E1 A1101',/update public\.finance_users[\s\S]{0,300}set entity_id = 'E1'[\s\S]{0,250}id = 'u6'/i.test(sql)&&/update public\.tenant_members[\s\S]{0,300}entity_id = 'E1'[\s\S]{0,100}department_code = 'A1101'[\s\S]{0,250}finance_user_id = 'u6'/i.test(sql));
check('Su Zhixuan gets canonical E1 A1200 identity',hasAll(["id = 'u_1785138353548'","department_code = 'A1200'","entity_id = 'E1'","direct_supervisor_finance_user_id = 'u_1779425863955'"]));
check('three New Taipei case managers are individual contributors in E9 G1102',hasAll(['u_ppt_58b24e472ef9efdd','u_ppt_3e10a7f120d84353','u_ppt_46a575c1cbecffdc',"role = 'employee'","department_code = 'G1102'","entity_id = 'E9'","direct_supervisor_finance_user_id = 'u_ppt_a25be81b2bcc9e00'","is_department_manager = false"]));
check('New Taipei home-care head and two subordinates are explicit',hasAll(['u_1785138304566','u_ppt_1e57f2bfdec1e65e','u_ppt_5df79081f0c7c3cb',"direct_supervisor_finance_user_id = 'u_1785138304566'","is_department_manager = true"]));
check('Yang is director and case-management head while G1103 is retired',hasAll(["finance_user_id = 'u_ppt_a25be81b2bcc9e00'","department_code in ('G1100', 'G1101', 'G1102')","is_department_director = true","department_code = 'G1103'","active = false"]));
check('obsolete CEO placeholders in both New Taipei branches are retired',/finance_user_id = 'u_entrepreneur'[\s\S]{0,180}department_code in \('G1101', 'G1102'\)[\s\S]{0,100}active = true/i.test(sql));
check('canonical department settings publish both manager branches',hasAll(["when 'G1101'","'managerId', 'u_1785138304566'","when 'G1102'","'managerId', 'u_ppt_a25be81b2bcc9e00'","finance_org_chart_rows_for_tenant"]));
check('four pending first-login identities remain exact and unbound',hasAll(['cms.ntpc1@suiyuecare.com','cms.ntpc2@suiyuecare.com','cms.ntpc3@suiyuecare.com','u_ppt_65af0fe56faa6789','homecare.taipei2@suiyuecare.com',"auth_user_id is null","google_link_status = 'pending_first_login'"]));
check('postflight covers repaired profiles, reporting graph, and projection',hasAll(['Accountant entity repair did not converge','Su Zhixuan primary role projection did not converge','New Taipei case-manager supervisor graph did not converge','New Taipei home-care subordinate graph did not converge','New Taipei director/case-management head did not converge','Canonical New Taipei unit leadership projection did not converge','Published org chart is missing repaired users']));

if(!process.exitCode)console.log(`Account/org incident repair: ${passed}/11 checks passed`);
