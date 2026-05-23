import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const risk = read("src/lib/payroll/payroll-risk-controls.ts");
const closing = read("src/app/(app)/payroll/closing/page.tsx");
const store = read("src/lib/payroll/payroll-store.ts");

const checks = [
  {
    label: "薪資風險控制涵蓋產生草稿、鎖定、發布、銀行匯出、清冊匯出、調整紀錄",
    ok: ["generate_draft", "lock_payroll", "publish_payslips", "export_bank_file", "export_roster", "create_adjustment"].every((action) => risk.includes(action)),
  },
  {
    label: "薪資風險控制檢查來源阻擋與流程阻擋",
    ok: risk.includes("sourceBlockers") && risk.includes("derivePayrollProcessBlockers") && risk.includes("processBlockers"),
  },
  {
    label: "薪資風險控制檢查薪資草稿、覆核、公式完整與實發負數",
    ok: ["draft-exists", "draft-review", "amount-integrity", "negativeNetDrafts", "moneyMismatch"].every((token) => risk.includes(token)),
  },
  {
    label: "薪資風險控制檢查鎖定、重複發布與銀行資料",
    ok: ["locked", "not-published", "bank-data", "missingBankDrafts"].every((token) => risk.includes(token)),
  },
  {
    label: "薪資結算頁所有高風險操作都呼叫 blockPayrollAction",
    ok: ["generate_draft", "lock_payroll", "publish_payslips", "export_bank_file", "export_roster", "create_adjustment"].every((action) => closing.includes(`blockPayrollAction("${action}")`)),
  },
  {
    label: "薪資結算頁按鈕 disabled 連動 canRunPayrollRiskAction",
    ok: ["generate_draft", "lock_payroll", "publish_payslips", "export_bank_file", "export_roster", "create_adjustment"].every((action) => closing.includes(`canRunPayrollRiskAction("${action}", payrollRiskControls)`)),
  },
  {
    label: "薪資結算頁顯示最高風險壓力測試區塊",
    ok: closing.includes("薪資最高風險壓力測試") && closing.includes("PAYROLL RISK GATE"),
  },
  {
    label: "薪資草稿產生前檢查銀行資料末五碼",
    ok: store.includes("missingBankSettings") && store.includes("缺少銀行帳號末五碼"),
  },
  {
    label: "薪資鎖定與發布寫入 audit log",
    ok: store.includes('action: "payroll.batch.lock"') && store.includes('action: "payroll.payslips.release"'),
  },
  {
    label: "薪資袋發布會發送員工通知",
    ok: store.includes('type: "薪資單發布"') && store.includes("recipientUserIds"),
  },
];

const failed = checks.filter((check) => !check.ok);

for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.label}`);
}

if (failed.length > 0) {
  console.error(`\nPayroll risk check failed: ${failed.length}/${checks.length}`);
  process.exit(1);
}

console.log(`\nPayroll risk check passed: ${checks.length}/${checks.length}`);
