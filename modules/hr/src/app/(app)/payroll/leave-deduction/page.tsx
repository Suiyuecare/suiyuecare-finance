"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarX2,
  CheckCircle2,
  ClipboardList,
  Percent,
  Save,
  Settings2,
  WalletCards,
  XCircle,
} from "lucide-react";
import {
  calculateLeaveDeduction,
  defaultLeaveDeductionRules,
  type LeaveDeductionRule,
  type LeaveDeductionRules,
  type LeaveDeductionType,
  type SalaryBasis,
} from "@/lib/payroll/leave-deduction-service";

const leaveTypes = Object.keys(defaultLeaveDeductionRules) as LeaveDeductionType[];
const salaryBases: SalaryBasis[] = ["月薪", "時薪"];

function currency(value: number) {
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(value);
}

export default function LeaveDeductionPage() {
  const [rules, setRules] = useState<LeaveDeductionRules>(defaultLeaveDeductionRules);
  const [salaryBasis, setSalaryBasis] = useState<SalaryBasis>("月薪");
  const [monthlySalary, setMonthlySalary] = useState(42000);
  const [hourlyWage, setHourlyWage] = useState(220);
  const [leaveType, setLeaveType] = useState<LeaveDeductionType>("病假");
  const [leaveHours, setLeaveHours] = useState(8);
  const [normalDailyHours, setNormalDailyHours] = useState(8);
  const [normalMonthlyDays, setNormalMonthlyDays] = useState(30);
  const [attendanceBonus, setAttendanceBonus] = useState(2000);
  const [selectedRuleType, setSelectedRuleType] = useState<LeaveDeductionType>("病假");
  const [message, setMessage] = useState("假別規則調整會即時計入右側試算；按下套用可留下操作回饋。");

  const result = useMemo(
    () =>
      calculateLeaveDeduction({
        salaryBasis,
        monthlySalary,
        hourlyWage,
        leaveType,
        leaveHours,
        normalDailyHours,
        normalMonthlyDays,
        attendanceBonus,
        rules,
      }),
    [attendanceBonus, hourlyWage, leaveHours, leaveType, monthlySalary, normalDailyHours, normalMonthlyDays, rules, salaryBasis],
  );

  const selectedRule = rules[selectedRuleType];

  const updateRule = <K extends keyof LeaveDeductionRule>(key: K, value: LeaveDeductionRule[K]) => {
    setRules((current) => ({
      ...current,
      [selectedRuleType]: {
        ...current[selectedRuleType],
        [key]: value,
        deductionRatio: key === "payRatio" ? Number((1 - Number(value)).toFixed(2)) : current[selectedRuleType].deductionRatio,
      },
    }));
  };

  const stats = useMemo(
    () => ({
      paid: leaveTypes.filter((type) => rules[type].isPaid).length,
      unpaid: leaveTypes.filter((type) => !rules[type].isPaid).length,
      halfPaid: leaveTypes.filter((type) => rules[type].payRatio === 0.5).length,
      noDeduction: leaveTypes.filter((type) => rules[type].deductionRatio === 0).length,
    }),
    [rules],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-rose-700">Leave Deduction Service</p>
          <h1 className="text-2xl font-semibold text-slate-950">請假扣薪計算模組</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            支援事假扣薪、病假半薪、生理假、特休不扣薪、公假不扣薪、無薪假，並可依月薪換算日薪或依時薪換算扣款。
          </p>
        </div>
        <span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">
          service: src/lib/payroll/leave-deduction-service.ts
        </span>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "支薪假別", value: `${stats.paid} 種`, icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-700" },
          { label: "不支薪假別", value: `${stats.unpaid} 種`, icon: XCircle, tone: "bg-rose-50 text-rose-700" },
          { label: "半薪規則", value: `${stats.halfPaid} 種`, icon: Percent, tone: "bg-sky-50 text-sky-700" },
          { label: "不扣薪", value: `${stats.noDeduction} 種`, icon: WalletCards, tone: "bg-amber-50 text-amber-700" },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-500">{item.label}</p>
              <span className={`rounded-lg p-2 ${item.tone}`}>
                <item.icon className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-3 text-2xl font-semibold text-slate-950">{item.value}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.78fr_1.22fr]">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">扣薪試算</h2>
              <p className="text-sm text-slate-500">依薪資基礎、假別、請假時數與人資後台規則計算。</p>
            </div>
            <CalendarX2 className="h-5 w-5 text-rose-600" />
          </div>

          <div className="grid gap-4">
            <label className="space-y-1 text-sm font-medium text-slate-700">
              薪資基礎
              <select
                value={salaryBasis}
                onChange={(event) => setSalaryBasis(event.target.value as SalaryBasis)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {salaryBases.map((basis) => (
                  <option key={basis}>{basis}</option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm font-medium text-slate-700">
                月薪
                <input
                  type="number"
                  min="0"
                  value={monthlySalary}
                  onChange={(event) => setMonthlySalary(Number(event.target.value))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700">
                時薪
                <input
                  type="number"
                  min="0"
                  value={hourlyWage}
                  onChange={(event) => setHourlyWage(Number(event.target.value))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm font-medium text-slate-700">
                假別
                <select
                  value={leaveType}
                  onChange={(event) => setLeaveType(event.target.value as LeaveDeductionType)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  {leaveTypes.map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700">
                請假時數
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={leaveHours}
                  onChange={(event) => setLeaveHours(Number(event.target.value))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1 text-sm font-medium text-slate-700">
                每日工時
                <input
                  type="number"
                  min="1"
                  value={normalDailyHours}
                  onChange={(event) => setNormalDailyHours(Number(event.target.value))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700">
                月計薪日
                <input
                  type="number"
                  min="1"
                  value={normalMonthlyDays}
                  onChange={(event) => setNormalMonthlyDays(Number(event.target.value))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700">
                全勤獎金
                <input
                  type="number"
                  min="0"
                  value={attendanceBonus}
                  onChange={(event) => setAttendanceBonus(Number(event.target.value))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <h2 className="text-lg font-semibold text-slate-950">扣薪計算結果</h2>
            <p className="text-sm text-slate-500">計算結果由 leave deduction service 產生。</p>
          </div>
          <div className="grid gap-3 p-5 md:grid-cols-4">
            <div className="rounded-lg bg-sky-50 p-4">
              <p className="text-xs font-medium text-sky-700">日薪</p>
              <p className="mt-2 text-2xl font-semibold text-sky-900">{currency(result.dailyWage)}</p>
            </div>
            <div className="rounded-lg bg-violet-50 p-4">
              <p className="text-xs font-medium text-violet-700">時薪</p>
              <p className="mt-2 text-2xl font-semibold text-violet-900">{currency(result.hourlyWage)}</p>
            </div>
            <div className="rounded-lg bg-rose-50 p-4">
              <p className="text-xs font-medium text-rose-700">請假扣薪</p>
              <p className="mt-2 text-2xl font-semibold text-rose-900">{currency(result.deductionAmount)}</p>
            </div>
            <div className="rounded-lg bg-amber-50 p-4">
              <p className="text-xs font-medium text-amber-700">總扣款</p>
              <p className="mt-2 text-2xl font-semibold text-amber-900">{currency(result.totalDeduction)}</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">項目</th>
                  <th className="px-4 py-3">金額</th>
                  <th className="px-4 py-3">說明</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.details.map((detail) => (
                  <tr key={detail.label} className="hover:bg-slate-50">
                    <td className="px-4 py-4 font-semibold text-slate-950">{detail.label}</td>
                    <td className="px-4 py-4 font-semibold text-slate-800">{currency(detail.amount)}</td>
                    <td className="px-4 py-4 text-slate-600">{detail.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">人資後台假別支薪規則</h2>
              <p className="text-sm text-slate-500">人資可設定假別是否支薪與扣薪比例，計算服務會即時套用。</p>
            </div>
            <Settings2 className="h-5 w-5 text-rose-600" />
          </div>
          <div className="grid gap-3 md:grid-cols-[220px_1fr]">
            <div className="space-y-2">
              {leaveTypes.map((type) => (
                <button
                  key={type}
                  onClick={() => setSelectedRuleType(type)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm font-semibold ${
                    selectedRuleType === type ? "border-rose-300 bg-rose-50 text-rose-700" : "border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={selectedRule.isPaid}
                    onChange={(event) => updateRule("isPaid", event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  是否支薪
                </label>
                <label className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={selectedRule.deductAttendanceBonus}
                    onChange={(event) => updateRule("deductAttendanceBonus", event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  是否扣全勤
                </label>
                <label className="space-y-1 text-sm font-medium text-slate-700">
                  支薪比例
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.1"
                    value={selectedRule.payRatio}
                    onChange={(event) => updateRule("payRatio", Number(event.target.value))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </label>
                <label className="space-y-1 text-sm font-medium text-slate-700">
                  扣薪比例
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.1"
                    value={selectedRule.deductionRatio}
                    onChange={(event) => updateRule("deductionRatio", Number(event.target.value))}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </label>
              </div>
              <label className="mt-4 block space-y-1 text-sm font-medium text-slate-700">
                規則說明
                <textarea
                  value={selectedRule.description}
                  onChange={(event) => updateRule("description", event.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <button
                type="button"
                onClick={() => setMessage(`${selectedRuleType} 規則已套用：支薪 ${(selectedRule.payRatio * 100).toFixed(0)}%，扣薪 ${(selectedRule.deductionRatio * 100).toFixed(0)}%。`)}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white"
              >
                <Save className="h-4 w-4" />
                已即時套用設定
              </button>
              <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
                {message}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
            <div className="mb-3 flex items-center gap-2">
              <WalletCards className="h-5 w-5 text-emerald-700" />
              <h2 className="font-semibold text-emerald-900">不扣薪假別</h2>
            </div>
            <p className="text-sm text-emerald-800">特休不扣薪、公假不扣薪，預設支薪比例 100%、扣薪比例 0%。</p>
          </div>
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-5">
            <div className="mb-3 flex items-center gap-2">
              <Percent className="h-5 w-5 text-sky-700" />
              <h2 className="font-semibold text-sky-900">半薪假別</h2>
            </div>
            <p className="text-sm text-sky-800">病假半薪與生理假預設支薪 50%，實際適用仍可由人資依制度調整。</p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-700" />
              <h2 className="font-semibold text-amber-900">法規維護提醒</h2>
            </div>
            <p className="text-sm text-amber-800">假別給薪、全勤與扣薪比例應依最新法規、公司工作規則與勞動契約維護，避免寫死在頁面。</p>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <ClipboardList className="mt-0.5 h-5 w-5 text-slate-700" />
          <div>
            <h2 className="font-semibold text-slate-950">支援假別與計算方式</h2>
            <p className="mt-1 text-sm text-slate-500">
              已支援事假扣薪、病假半薪、生理假、特休不扣薪、公假不扣薪、無薪假、依月薪換算日薪、依時薪換算扣款，並依不同假別規則計算。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
