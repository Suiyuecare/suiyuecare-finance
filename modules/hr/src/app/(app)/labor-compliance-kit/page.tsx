"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Download,
  FileArchive,
  FileCheck2,
  FileSpreadsheet,
  HeartPulse,
  Landmark,
  Loader2,
  RefreshCcw,
  Scale,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { csv, downloadTextFile } from "@/lib/client/download";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type EvidenceStatus = "ready" | "review" | "missing";

type EvidenceItem = {
  key: string;
  title: string;
  description: string;
  href: string;
  status: EvidenceStatus;
  count: number;
  expected?: number;
  owner: string;
  source: string;
  blocker: string;
};

type DepartmentOption = {
  id: string;
  name: string;
};

const statusMeta: Record<EvidenceStatus, { label: string; className: string }> = {
  ready: { label: "可交付", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  review: { label: "需複核", className: "border-amber-200 bg-amber-50 text-amber-700" },
  missing: { label: "缺資料", className: "border-rose-200 bg-rose-50 text-rose-700" },
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function monthStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

function twDate(value: string) {
  return new Date(`${value}T00:00:00+08:00`).toLocaleDateString("zh-TW");
}

function statusFromCount(count: number, expected = 1): EvidenceStatus {
  if (count <= 0) return "missing";
  if (count < expected) return "review";
  return "ready";
}

async function countRows(query: PromiseLike<{ count: number | null; error: Error | null }>) {
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

export default function LaborComplianceKitPage() {
  const currentUser = useCurrentUser();
  const [dateStart, setDateStart] = useState(monthStart());
  const [dateEnd, setDateEnd] = useState(today());
  const [departmentId, setDepartmentId] = useState("all");
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [items, setItems] = useState<EvidenceItem[]>([]);
  const [message, setMessage] = useState("勞檢資料包會依公司、部門與日期區間彙整各正式模組資料。");
  const [loading, setLoading] = useState(false);

  const filteredSummary = useMemo(() => {
    const ready = items.filter((item) => item.status === "ready").length;
    const review = items.filter((item) => item.status === "review").length;
    const missing = items.filter((item) => item.status === "missing").length;
    const score = items.length ? Math.round((ready / items.length) * 100) : 0;
    return { ready, review, missing, score };
  }, [items]);

  async function loadKit() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !currentUser.companyId) {
      setMessage("尚未登入公司或 Supabase 尚未設定，無法建立勞檢資料包。");
      return;
    }

    setLoading(true);
    try {
      const departmentResult = await (supabase as any)
        .from("departments")
        .select("id, name")
        .eq("company_id", currentUser.companyId)
        .is("deleted_at", null)
        .order("name", { ascending: true });
      if (departmentResult.error) throw departmentResult.error;
      setDepartments((departmentResult.data ?? []) as DepartmentOption[]);

      const employeeBase = (supabase as any)
        .from("employees")
        .select("id", { count: "exact", head: true })
        .eq("company_id", currentUser.companyId)
        .is("deleted_at", null);
      const activeEmployeeBase = (supabase as any)
        .from("employees")
        .select("id", { count: "exact", head: true })
        .eq("company_id", currentUser.companyId)
        .eq("employment_status", "active")
        .is("deleted_at", null);
      if (departmentId !== "all") {
        employeeBase.eq("department_id", departmentId);
        activeEmployeeBase.eq("department_id", departmentId);
      }

      const employeeCount = await countRows(employeeBase);
      const activeEmployeeCount = await countRows(activeEmployeeBase);
      const expectedPeople = Math.max(activeEmployeeCount, 1);

      const [
        contractCount,
        attendanceCount,
        leaveCount,
        hrLeaveCount,
        overtimeCount,
        payrollRecordCount,
        payslipCount,
        payrollSettingCount,
        insuranceSettingCount,
        harassmentSettingCount,
        harassmentAckCount,
        policyDocumentCount,
      ] = await Promise.all([
        countRows((supabase as any)
          .from("documents")
          .select("id", { count: "exact", head: true })
          .eq("company_id", currentUser.companyId)
          .eq("document_type", "contract")
          .is("deleted_at", null)),
        countRows((supabase as any)
          .from("attendance_records")
          .select("id", { count: "exact", head: true })
          .eq("company_id", currentUser.companyId)
          .gte("work_date", dateStart)
          .lte("work_date", dateEnd)
          .is("deleted_at", null)),
        countRows((supabase as any)
          .from("leave_requests")
          .select("id", { count: "exact", head: true })
          .eq("company_id", currentUser.companyId)
          .gte("starts_at", `${dateStart}T00:00:00+08:00`)
          .lte("ends_at", `${dateEnd}T23:59:59+08:00`)
          .is("deleted_at", null)),
        countRows((supabase as any)
          .from("hr_requests")
          .select("id", { count: "exact", head: true })
          .eq("company_id", currentUser.companyId)
          .eq("request_type", "請假")
          .gte("created_at", `${dateStart}T00:00:00+08:00`)
          .lte("created_at", `${dateEnd}T23:59:59+08:00`)
          .is("deleted_at", null)),
        countRows((supabase as any)
          .from("overtime_requests")
          .select("id", { count: "exact", head: true })
          .eq("company_id", currentUser.companyId)
          .gte("work_date", dateStart)
          .lte("work_date", dateEnd)
          .is("deleted_at", null)),
        countRows((supabase as any)
          .from("payroll_records")
          .select("id", { count: "exact", head: true })
          .eq("company_id", currentUser.companyId)
          .gte("payroll_month", dateStart)
          .lte("payroll_month", dateEnd)
          .is("deleted_at", null)),
        countRows((supabase as any)
          .from("payroll_payslips")
          .select("id", { count: "exact", head: true })
          .eq("company_id", currentUser.companyId)
          .gte("payroll_month", dateStart)
          .lte("payroll_month", dateEnd)
          .is("deleted_at", null)),
        countRows((supabase as any)
          .from("employee_payroll_settings")
          .select("id", { count: "exact", head: true })
          .eq("company_id", currentUser.companyId)
          .eq("status", "active")
          .is("deleted_at", null)),
        countRows((supabase as any)
          .from("system_settings")
          .select("id", { count: "exact", head: true })
          .eq("company_id", currentUser.companyId)
          .eq("setting_key", "insurance_pension_rate_settings")
          .is("deleted_at", null)),
        countRows((supabase as any)
          .from("system_settings")
          .select("id", { count: "exact", head: true })
          .eq("company_id", currentUser.companyId)
          .eq("setting_key", "sexual_harassment_prevention_policy")
          .is("deleted_at", null)),
        countRows((supabase as any)
          .from("policy_acknowledgements")
          .select("id", { count: "exact", head: true })
          .eq("company_id", currentUser.companyId)
          .eq("policy_key", "sexual_harassment_prevention_policy")
          .is("deleted_at", null)),
        countRows((supabase as any)
          .from("policy_documents")
          .select("id", { count: "exact", head: true })
          .eq("company_id", currentUser.companyId)
          .in("category", ["work_rules", "hr_policy", "sexual_harassment", "labor_contract_template", "payroll_policy", "attendance_policy"])
          .is("deleted_at", null)),
      ]);

      const nextItems: EvidenceItem[] = [
        {
          key: "employee-roster",
          title: "員工名冊",
          description: "員工編號、姓名、部門、職稱、到職日、在職狀態。",
          href: "/employee-contracts",
          status: statusFromCount(employeeCount),
          count: employeeCount,
          owner: "人資",
          source: "employees",
          blocker: "若員工主檔缺漏，先至人員主檔補齊。",
        },
        {
          key: "labor-contracts",
          title: "勞動契約",
          description: "每位在職員工應能提出已簽署勞動契約或聘僱文件。",
          href: "/employee-contracts",
          status: statusFromCount(contractCount, expectedPeople),
          count: contractCount,
          expected: activeEmployeeCount,
          owner: "人資",
          source: "documents(contract)",
          blocker: "缺契約者需回到名冊與契約頁上傳。",
        },
        {
          key: "attendance",
          title: "1-12 個月出勤紀錄",
          description: "可依公司、部門、個人與日期區間提供出勤明細。",
          href: "/attendance/reports",
          status: statusFromCount(attendanceCount),
          count: attendanceCount,
          owner: "人資 / 主管",
          source: "attendance_records",
          blocker: "無出勤紀錄時，需確認打卡與出勤月曆是否正常回寫。",
        },
        {
          key: "payroll-roster",
          title: "1-12 個月工資清冊與薪資袋",
          description: "薪資清冊、電子薪資單與薪資鎖定/發布紀錄。",
          href: "/payroll/roster",
          status: statusFromCount(payrollRecordCount + payslipCount),
          count: payrollRecordCount + payslipCount,
          owner: "人資 / 會計",
          source: "payroll_records / payroll_payslips",
          blocker: "薪資未產生或未發布時，回到薪資結算流程處理。",
        },
        {
          key: "overtime",
          title: "加班申請、核准與加班費計算表",
          description: "加班申請、核准狀態、平日/休息日/例假日加班費計算。",
          href: "/overtime-reports",
          status: statusFromCount(overtimeCount),
          count: overtimeCount,
          owner: "人資 / 主管",
          source: "overtime_requests",
          blocker: "若有加班但沒有申請或核准紀錄，不應進入結薪。",
        },
        {
          key: "leave",
          title: "請假紀錄與附件",
          description: "請假單、假別、日期、原因、附件與核准狀態。",
          href: "/leave-reports",
          status: statusFromCount(leaveCount + hrLeaveCount),
          count: leaveCount + hrLeaveCount,
          owner: "人資 / 主管",
          source: "leave_requests / hr_requests",
          blocker: "保護假別、病假附件或代理人未齊時需補件。",
        },
        {
          key: "insurance",
          title: "勞健保、勞退投保級距與提繳資料",
          description: "勞保級距、健保級距、勞退提繳率與員工薪資主檔。",
          href: "/payroll/insurance-calculator",
          status: statusFromCount(payrollSettingCount + insuranceSettingCount, expectedPeople),
          count: payrollSettingCount,
          expected: activeEmployeeCount,
          owner: "人資 / 會計",
          source: "employee_payroll_settings / system_settings",
          blocker: "薪資主檔或費率未設定會影響結薪與扣繳。",
        },
        {
          key: "harassment",
          title: "性騷擾防治措施與申訴管道公告",
          description: "公告版本、申訴窗口、外部管道、員工知悉回條。",
          href: "/policy-documents",
          status: harassmentSettingCount > 0 && harassmentAckCount > 0 ? "ready" : harassmentSettingCount > 0 ? "review" : "missing",
          count: harassmentAckCount,
          expected: activeEmployeeCount,
          owner: "人資 / 行政主任",
          source: "system_settings / policy_acknowledgements",
          blocker: "未公告或未收回條時，需補公告與員工知悉紀錄。",
        },
        {
          key: "work-rules",
          title: "工作規則與人事規章",
          description: "工作規則、人事規章、版本與上傳文件。",
          href: "/policy-documents",
          status: statusFromCount(policyDocumentCount),
          count: policyDocumentCount,
          owner: "人資 / 行政主任",
          source: "policy_documents / documents",
          blocker: "尚未集中版本管理時，需先上傳正式文件並公告員工。",
        },
      ];

      setItems(nextItems);
      setMessage(`已建立 ${twDate(dateStart)} 至 ${twDate(dateEnd)} 的勞檢/法遵資料包，共 ${nextItems.length} 類證據。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "建立勞檢資料包失敗。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadKit();
  }, [currentUser.companyId]);

  function exportChecklist() {
    downloadTextFile(
      `labor-compliance-kit-${dateStart}-${dateEnd}.csv`,
      csv([
        ["項目", "狀態", "目前筆數", "應備數", "負責", "資料來源", "處理建議", "連結"],
        ...items.map((item) => [
          item.title,
          statusMeta[item.status].label,
          item.count,
          item.expected ?? "",
          item.owner,
          item.source,
          item.blocker,
          item.href,
        ]),
      ]),
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-bold tracking-[0.12em] text-[#b45309]">LABOR INSPECTION CENTER</p>
          <h1 className="mt-1 text-2xl font-black text-slate-950">勞檢 / 法遵資料包</h1>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
            將勞檢常要求的員工名冊、勞動契約、出勤、請假、加班、薪資、勞健保勞退、性騷防治公告與規章文件集中檢核，避免資料散落在不同模組。
          </p>
          <p className="mt-2 text-sm font-semibold text-[#8a4b06]">{message}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void loadKit()} disabled={loading}>
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            重新產生
          </Button>
          <Button onClick={exportChecklist} disabled={!items.length}>
            <Download className="h-4 w-4" />
            匯出檢核表
          </Button>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "可交付項目", value: filteredSummary.ready, detail: `${filteredSummary.score}% 完成`, icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-700" },
          { label: "需複核", value: filteredSummary.review, detail: "資料存在但需補強", icon: AlertTriangle, tone: "bg-amber-50 text-amber-700" },
          { label: "缺資料", value: filteredSummary.missing, detail: "上線/勞檢優先處理", icon: FileArchive, tone: "bg-rose-50 text-rose-700" },
          { label: "資料包項目", value: items.length, detail: "勞檢常見證據", icon: ShieldCheck, tone: "bg-sky-50 text-sky-700" },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-slate-500">{item.label}</div>
              <span className={`rounded-lg p-2 ${item.tone}`}><item.icon className="h-5 w-5" /></span>
            </div>
            <div className="mt-3 text-2xl font-black text-slate-950">{item.value}</div>
            <div className="mt-1 text-xs font-semibold text-slate-500">{item.detail}</div>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
          <label className="space-y-1 text-sm font-bold text-slate-700">
            起始日期
            <Input type="date" value={dateStart} onChange={(event) => setDateStart(event.target.value)} />
          </label>
          <label className="space-y-1 text-sm font-bold text-slate-700">
            結束日期
            <Input type="date" value={dateEnd} onChange={(event) => setDateEnd(event.target.value)} />
          </label>
          <label className="space-y-1 text-sm font-bold text-slate-700">
            部門
            <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="all">全部部門</option>
              {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
            </select>
          </label>
          <Button onClick={() => void loadKit()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}
            套用
          </Button>
        </div>
      </section>

      <section className="grid gap-4">
        {items.map((item) => {
          const meta = statusMeta[item.status];
          return (
            <article key={item.key} className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${meta.className}`}>{meta.label}</span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{item.owner}</span>
                    <span className="rounded-full bg-[#fff7ed] px-2.5 py-1 text-xs font-bold text-[#9a5a16]">{item.source}</span>
                  </div>
                  <h2 className="mt-3 text-lg font-black text-slate-950">{item.title}</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{item.description}</p>
                  <p className="mt-2 text-sm font-semibold text-slate-500">{item.blocker}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-[140px_140px_auto] lg:min-w-[430px] lg:items-center">
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="text-xs font-bold text-slate-500">目前筆數</div>
                    <div className="mt-1 text-xl font-black text-slate-950">{item.count}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="text-xs font-bold text-slate-500">應備數</div>
                    <div className="mt-1 text-xl font-black text-slate-950">{item.expected ?? "依區間"}</div>
                  </div>
                  <Button asChild variant={item.status === "missing" ? "default" : "outline"}>
                    <Link href={item.href}>前往處理</Link>
                  </Button>
                </div>
              </div>
            </article>
          );
        })}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { title: "名冊與契約", href: "/employee-contracts", icon: UsersRound },
          { title: "出勤報表", href: "/attendance/reports", icon: CalendarDays },
          { title: "薪資清冊", href: "/payroll/roster", icon: FileSpreadsheet },
          { title: "加班費報表", href: "/overtime-reports", icon: Scale },
          { title: "請假紀錄", href: "/leave-reports", icon: FileCheck2 },
          { title: "勞健保勞退", href: "/payroll/insurance-calculator", icon: HeartPulse },
          { title: "性騷申訴公告", href: "/harassment-policy", icon: ShieldCheck },
          { title: "文件制度中心", href: "/policy-documents", icon: FileArchive },
          { title: "評鑑資料包", href: "/assessment-exports", icon: Landmark },
        ].map((link) => (
          <Link key={link.href} href={link.href} className="flex items-center justify-between rounded-lg border border-[#ead8c2] bg-white p-4 text-sm font-black text-slate-800 shadow-sm hover:bg-[#fffaf4]">
            <span className="flex items-center gap-2"><link.icon className="h-4 w-4 text-[#b45309]" />{link.title}</span>
            <span className="text-[#b45309]">前往</span>
          </Link>
        ))}
      </section>
    </div>
  );
}
