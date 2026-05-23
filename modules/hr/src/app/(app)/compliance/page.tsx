import { AlertTriangle, CheckCircle2, ExternalLink, LockKeyhole, Scale, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { complianceGuardrails, legalBaselinePrinciple, legalDomains, legalRuleCatalog } from "@/lib/compliance/legal-baseline";

const rules = [
  ["勞基法工時", "每日正常工時 8 小時、每週 40 小時，系統排班與出勤異常會依此提醒。"],
  ["加班上限", "加班申請會檢查平日、休息日、例假日與國定假日類型，並留下計算版本。"],
  ["請假扣薪", "假別支薪比例、最小請假單位、附件規則可由後台維護，避免公式寫死。"],
  ["個資與薪資", "一般員工只能查看本人資料與本人薪資袋，主管依部門範圍查看。"],
];

const engineEntrypoints = [
  ["表單送出", "請假、加班、補卡送出前檢核附件、保護假別、例假日出勤原因與每日加班上限。"],
  ["班表發布", "拖曳、複製、批次排班與發布前檢核重複排班、單日工時與七日休息底線。"],
  ["薪資結算", "鎖定、發布薪資單與匯出清冊前檢核待審異常、銀行資料、負薪資與鎖定程序。"],
  ["設定發布", "系統設定可存草稿，但發布套用前會檢核狀態、保護假別與加班上限控管。"],
];

const blockingRules = legalRuleCatalog.filter((rule) => rule.blocking).length;
const enforcedAreas = Array.from(new Set(legalRuleCatalog.flatMap((rule) => rule.enforcedAt)));
const complianceSummaryCards: Array<{
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  tone: string;
}> = [
  { label: "法規規則", value: `${legalRuleCatalog.length}`, detail: "已整理可系統化檢核規則", icon: ShieldCheck, tone: "bg-emerald-50 text-emerald-700" },
  { label: "阻擋規則", value: `${blockingRules}`, detail: "低於法規不可送出或發布", icon: LockKeyhole, tone: "bg-rose-50 text-rose-700" },
  { label: "套用節點", value: `${enforcedAreas.length}`, detail: "表單、排班、薪資、設定", icon: Scale, tone: "bg-sky-50 text-sky-700" },
  { label: "待人工覆核", value: "高風險", detail: "例假日、扣款、性平申訴", icon: AlertTriangle, tone: "bg-amber-50 text-amber-700" },
];

export default function CompliancePage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-bold tracking-[0.12em] text-[#b45309]">COMPLIANCE RULEBOOK</p>
        <h1 className="mt-1 text-2xl font-black text-slate-900">法規規則庫</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-500">集中管理台灣勞動法規、人資制度、薪資公式與長照評鑑規則版本。</p>
      </div>

      <section className="rounded-lg border border-[#ead8c2] bg-[#fffaf3] p-5">
        <div className="flex items-start gap-3">
          <span className="rounded-lg bg-[#fff3de] p-2 text-[#b45309]">
            <Scale className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-black text-slate-900">系統法遵總原則</h2>
            <p className="mt-2 text-sm leading-6 text-slate-700">{legalBaselinePrinciple}</p>
            <p className="mt-2 text-sm font-semibold text-[#92400e]">
              注意：原稱「兩性平等」相關職場規範，系統採現行法規名稱「性別平等工作法」作為設計基準。
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {complianceSummaryCards.map((card) => (
          <div key={card.label} className="rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-bold text-slate-600">{card.label}</p>
              <span className={`rounded-lg p-2 ${card.tone}`}>
                <card.icon className="h-4 w-4" />
              </span>
            </div>
            <p className="mt-3 text-2xl font-black text-slate-950">{card.value}</p>
            <p className="mt-1 text-xs text-slate-500">{card.detail}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        {legalDomains.map((domain) => (
          <article key={domain.lawName} className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-black text-slate-900">{domain.lawName}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{domain.systemScope}</p>
              </div>
              <a
                href={domain.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#ead8c2] px-3 py-2 text-xs font-bold text-[#92400e]"
              >
                法規來源
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
            <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm font-semibold text-slate-700">
              {domain.baselinePolicy}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {domain.implementationAreas.map((area) => (
                <span key={area} className="rounded-full bg-[#fff3de] px-3 py-1 text-xs font-bold text-[#92400e]">
                  {area}
                </span>
              ))}
            </div>
          </article>
        ))}
      </section>

      <section className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
        <h2 className="font-black text-slate-900">系統建置防線</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {complianceGuardrails.map((guardrail) => (
            <div key={guardrail} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">
              {guardrail}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="rounded-lg bg-white p-2 text-emerald-700">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-black text-emerald-950">法規合規檢核引擎已啟用</h2>
            <p className="mt-2 text-sm leading-6 text-emerald-900">
              低於法規或缺少必要稽核資料時，系統會阻擋送出、排班、結薪或發布設定；草稿仍可保存，方便補件。
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {engineEntrypoints.map(([title, description]) => (
            <div key={title} className="rounded-lg bg-white p-4 text-sm shadow-sm">
              <div className="font-black text-slate-900">{title}</div>
              <p className="mt-2 leading-6 text-slate-600">{description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="font-black text-slate-900">可執行法規規則</h2>
            <p className="mt-1 text-sm text-slate-500">以下規則已整理成系統可判斷的阻擋或提醒節點。</p>
          </div>
          <span className="rounded-full bg-[#fff3de] px-3 py-1 text-xs font-bold text-[#92400e]">官方資料核對日：2026-05-22</span>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-[#fffaf4] text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">規則</th>
                <th className="px-4 py-3">法源</th>
                <th className="px-4 py-3">最低底線</th>
                <th className="px-4 py-3">套用位置</th>
                <th className="px-4 py-3">結果</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {legalRuleCatalog.map((rule) => (
                <tr key={rule.code} className="align-top hover:bg-[#fffaf4]">
                  <td className="px-4 py-4">
                    <p className="font-black text-slate-950">{rule.title}</p>
                    <p className="mt-1 text-xs text-slate-500">{rule.code}</p>
                  </td>
                  <td className="px-4 py-4">
                    <a href={rule.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold text-[#92400e]">
                      {rule.lawName} {rule.article}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </td>
                  <td className="px-4 py-4 text-slate-600">{rule.minimumRule}</td>
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap gap-1.5">
                      {rule.enforcedAt.map((area) => (
                        <span key={area} className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">{area}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${rule.blocking ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>
                      {rule.blocking ? <LockKeyhole className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                      {rule.blocking ? "阻擋" : "提醒"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {rules.map(([title, description]) => (
          <article key={title} className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="rounded-lg bg-[#fff3de] p-2 text-[#b45309]"><ShieldCheck className="h-5 w-5" /></span>
              <h2 className="font-black text-slate-900">{title}</h2>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>
          </article>
        ))}
      </section>

      <section className="rounded-lg border border-amber-200 bg-amber-50 p-5">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 text-amber-700" />
          <div>
            <h2 className="font-black text-amber-950">已補上的缺口</h2>
            <p className="mt-2 text-sm leading-6 text-amber-900">
              新增假別規則發布檢核、薪資扣款項目檢核、月加班上限、七日工時、家庭照顧假、性騷擾申訴管道、保護假別不得影響全勤與薪資結算扣款合法性檢查。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
