"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Gift,
  ReceiptText,
  RefreshCw,
  Scale,
  WalletCards,
} from "lucide-react";
import {
  calculateOvertimePay,
  taiwanDefaultOvertimeRules,
  type OvertimeCompensation,
  type OvertimeDayType,
} from "@/lib/payroll/overtime-calculation-service";

const dayTypes: OvertimeDayType[] = ["平日加班", "休息日加班", "例假日出勤", "國定假日出勤"];
const compensations: OvertimeCompensation[] = ["加班費", "補休"];

const dayTypeNotes: Record<OvertimeDayType, string> = {
  平日加班: "支援平日延長工時，前 2 小時與第 3 小時起分段計算。",
  休息日加班: "支援休息日前 2 小時、第 3 至 8 小時、第 9 小時起分段計算。",
  例假日出勤: "支援例假日出勤試算，並提示高風險與法定例外檢查。",
  國定假日出勤: "支援國定假日出勤 8 小時內與超時部分分段試算。",
};

function currency(value: number) {
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(value);
}

export default function OvertimeCalculatorPage() {
  const [monthlySalary, setMonthlySalary] = useState(42000);
  const [overtimeHours, setOvertimeHours] = useState(3);
  const [monthAccumulatedHours, setMonthAccumulatedHours] = useState(18);
  const [dayType, setDayType] = useState<OvertimeDayType>("平日加班");
  const [compensation, setCompensation] = useState<OvertimeCompensation>("加班費");

  const result = useMemo(
    () =>
      calculateOvertimePay({
        monthlySalary,
        overtimeHours,
        monthAccumulatedHours,
        dayType,
        compensation,
      }),
    [compensation, dayType, monthAccumulatedHours, monthlySalary, overtimeHours],
  );

  const totalRuleSegments = Object.values(taiwanDefaultOvertimeRules.dayTypeRules).reduce((sum, segments) => sum + segments.length, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-violet-700">Taiwan Payroll Calculation Service</p>
          <h1 className="text-2xl font-semibold text-slate-950">台灣加班費計算模組</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            支援平日加班、休息日加班、例假日出勤、國定假日出勤、補休轉換、加班費試算、加班時數上限提醒與加班費明細。
          </p>
        </div>
        <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">
          service: src/lib/payroll/overtime-calculation-service.ts
        </span>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "支援日別", value: `${dayTypes.length} 種`, icon: CalendarDays, tone: "bg-violet-50 text-violet-700" },
          { label: "公式分段", value: `${totalRuleSegments} 段`, icon: Scale, tone: "bg-sky-50 text-sky-700" },
          { label: "試算加班費", value: currency(result.totalPay), icon: WalletCards, tone: "bg-emerald-50 text-emerald-700" },
          { label: "補休時數", value: `${result.compensatoryLeaveHours.toFixed(1)} 小時`, icon: Gift, tone: "bg-amber-50 text-amber-700" },
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
              <h2 className="text-lg font-semibold text-slate-950">加班費試算</h2>
              <p className="text-sm text-slate-500">輸入月薪、加班時數與當月累計時數，即時產生明細。</p>
            </div>
            <RefreshCw className="h-5 w-5 text-violet-600" />
          </div>

          <div className="grid gap-4">
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
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm font-medium text-slate-700">
                本次加班時數
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={overtimeHours}
                  onChange={(event) => setOvertimeHours(Number(event.target.value))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700">
                本月已累計加班
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={monthAccumulatedHours}
                  onChange={(event) => setMonthAccumulatedHours(Number(event.target.value))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
            </div>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              加班類型
              <select
                value={dayType}
                onChange={(event) => setDayType(event.target.value as OvertimeDayType)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {dayTypes.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              加班費或補休轉換
              <select
                value={compensation}
                onChange={(event) => setCompensation(event.target.value as OvertimeCompensation)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {compensations.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4 rounded-lg border border-violet-200 bg-violet-50 p-4">
            <p className="text-sm font-semibold text-violet-900">{dayType}</p>
            <p className="mt-1 text-sm text-violet-800">{dayTypeNotes[dayType]}</p>
            <p className="mt-2 text-xs text-violet-700">平日時薪：{currency(result.hourlyWage)}</p>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <h2 className="text-lg font-semibold text-slate-950">加班費明細</h2>
            <p className="text-sm text-slate-500">計算邏輯由 payroll calculation service 產生，頁面只負責顯示結果。</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">分段</th>
                  <th className="px-4 py-3">時數</th>
                  <th className="px-4 py-3">倍率</th>
                  <th className="px-4 py-3">平日時薪</th>
                  <th className="px-4 py-3">金額</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.details.map((detail) => (
                  <tr key={detail.label} className="hover:bg-slate-50">
                    <td className="px-4 py-4 font-semibold text-slate-950">{detail.label}</td>
                    <td className="px-4 py-4 text-slate-700">{detail.hours.toFixed(1)} 小時</td>
                    <td className="px-4 py-4 text-slate-700">{detail.multiplier.toFixed(2)}</td>
                    <td className="px-4 py-4 text-slate-700">{currency(detail.hourlyWage)}</td>
                    <td className="px-4 py-4 font-semibold text-slate-950">{currency(detail.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 border-t border-slate-200 p-5 md:grid-cols-3">
            <div className="rounded-lg bg-emerald-50 p-4">
              <p className="text-xs font-medium text-emerald-700">加班費試算</p>
              <p className="mt-2 text-2xl font-semibold text-emerald-900">{currency(result.totalPay)}</p>
            </div>
            <div className="rounded-lg bg-sky-50 p-4">
              <p className="text-xs font-medium text-sky-700">補休轉換</p>
              <p className="mt-2 text-2xl font-semibold text-sky-900">{result.compensatoryLeaveHours.toFixed(1)} 小時</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-4">
              <p className="text-xs font-medium text-slate-600">本月累計</p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">{(monthAccumulatedHours + overtimeHours).toFixed(1)} 小時</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <ReceiptText className="h-5 w-5 text-violet-700" />
            <h2 className="text-lg font-semibold text-slate-950">公式規則表</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {dayTypes.map((type) => (
              <div key={type} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="font-semibold text-slate-950">{type}</p>
                <div className="mt-3 space-y-2">
                  {taiwanDefaultOvertimeRules.dayTypeRules[type].map((segment) => (
                    <div key={`${type}-${segment.label}`} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-sm">
                      <span className="text-slate-600">{segment.label}</span>
                      <span className="font-semibold text-slate-900">{segment.multiplier.toFixed(2)} 倍</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-700" />
              <h2 className="font-semibold text-amber-900">加班時數上限提醒</h2>
            </div>
            <div className="space-y-2">
              {result.warnings.length ? (
                result.warnings.map((warning) => (
                  <div key={warning} className="rounded-lg bg-white/80 px-3 py-2 text-sm text-amber-800">
                    {warning}
                  </div>
                ))
              ) : (
                <p className="text-sm text-amber-800">目前試算未觸發上限或高風險提醒。</p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
            <div className="mb-3 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-700" />
              <h2 className="font-semibold text-emerald-900">獨立 service</h2>
            </div>
            <p className="text-sm text-emerald-800">
              加班費公式、補休換算、分段明細與上限提醒都集中在 payroll calculation service，未來修改法規公式時可只調整 service。
            </p>
          </div>

          <div className="rounded-lg border border-sky-200 bg-sky-50 p-5">
            <div className="mb-3 flex items-center gap-2">
              <Clock3 className="h-5 w-5 text-sky-700" />
              <h2 className="font-semibold text-sky-900">可串接來源</h2>
            </div>
            <p className="text-sm text-sky-800">正式計算時可接加班申請、班表、國定假日行事曆、薪資設定與薪資結算草稿。</p>
          </div>
        </div>
      </section>
    </div>
  );
}
