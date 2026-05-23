import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const rbac = read("src/lib/auth/rbac.ts");
const routes = read("src/lib/auth/route-permissions.ts");
const privacy = read("src/lib/auth/privacy.ts");
const pressure = read("src/lib/auth/permission-pressure-test.ts");

function extractRoleBlock(role) {
  const start = rbac.indexOf(`  ${role}: {`);
  if (start < 0) return "";
  const nextRoleMatch = rbac.slice(start + 1).match(/\n  [a-z_]+: \{/);
  const end = nextRoleMatch ? start + 1 + nextRoleMatch.index : rbac.indexOf("\n};", start);
  return rbac.slice(start, end);
}

const ceoBlock = extractRoleBlock("ceo");

const checks = [
  {
    label: "組員硬阻擋員工主檔與薪資權限",
    ok:
      /team_member:[\s\S]*"employee:view"[\s\S]*"employee:sensitive:view"[\s\S]*"payroll:individual:view"[\s\S]*"system:settings"/.test(rbac),
  },
  {
    label: "主管硬阻擋身分證、地址、個人薪資與薪資管理",
    ok:
      /supervisor:[\s\S]*"employee:national_id:view"[\s\S]*"employee:address:view"[\s\S]*"employee:salary:view"[\s\S]*"payroll:individual:view"[\s\S]*"payroll:manage"/.test(rbac),
  },
  {
    label: "人資具備員工敏感資料與個人薪資權限",
    ok: /hr:[\s\S]*"employee:sensitive:view"[\s\S]*"employee:national_id:view"[\s\S]*"payroll:individual:view"/.test(rbac),
  },
  {
    label: "執行長預設薪資總額視圖，不預設個人薪資明細",
    ok: ceoBlock.includes('"payroll:aggregate:view"') && !ceoBlock.includes('"payroll:individual:view"'),
  },
  {
    label: "勞動契約頁需 employee:manage 與 employee:sensitive:view",
    ok: /href: "\/employee-contracts", permissions: \["employee:manage", "employee:sensitive:view"\]/.test(routes),
  },
  {
    label: "薪資清冊頁允許 aggregate 或 individual 分層視圖",
    ok: /href: "\/payroll\/roster", permissions: \["payroll:aggregate:view", "payroll:individual:view"\]/.test(routes),
  },
  {
    label: "員工薪資設定頁需 payroll:manage",
    ok: /title: "薪資設定"[\s\S]*href: "\/payroll\/employee-settings"[\s\S]*permissions: \["payroll:manage"\]/.test(read("src/lib/config/navigation.ts")),
  },
  {
    label: "敏感資料 helper 區分身分證、地址、薪資與薪資總額",
    ok:
      privacy.includes("canViewEmployeeNationalId") &&
      privacy.includes("canViewEmployeeAddressData") &&
      privacy.includes("canViewIndividualPayrollData") &&
      privacy.includes("canViewPayrollAggregateData"),
  },
  {
    label: "壓力測試矩陣包含五種角色",
    ok: ["team_member", "supervisor", "hr", "admin_director", "ceo"].every((role) => pressure.includes(role)),
  },
  {
    label: "壓力測試矩陣包含功能、路由、敏感資料、資料範圍",
    ok: ["功能權限", "頁面路由", "敏感資料", "資料範圍"].every((group) => pressure.includes(group)),
  },
];

const failed = checks.filter((check) => !check.ok);

for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.label}`);
}

if (failed.length > 0) {
  console.error(`\nPermission pressure check failed: ${failed.length}/${checks.length}`);
  process.exit(1);
}

console.log(`\nPermission pressure check passed: ${checks.length}/${checks.length}`);
