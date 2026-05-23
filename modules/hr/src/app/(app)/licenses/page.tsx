"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BellRing,
  CalendarDays,
  CheckCircle2,
  Download,
  FileCheck2,
  FilePlus2,
  FileText,
  Filter,
  IdCard,
  Paperclip,
  RefreshCw,
  Search,
  ShieldCheck,
  UploadCloud,
  UsersRound,
} from "lucide-react";
import { csv, downloadTextFile } from "@/lib/client/download";
import { getDefaultEmployee, getLiveClient, writeAuditLog } from "@/lib/supabase/live-modules";

type LicenseStatus = "有效" | "即將到期" | "已逾期" | "待補件" | "審核中";

type LicenseType =
  | "照顧服務員證明"
  | "長照小卡"
  | "CPR 證照"
  | "失智症訓練證明"
  | "身障支持服務訓練"
  | "護理師證書"
  | "社工師證書"
  | "司機駕照"
  | "其他專業證照";

type LicenseRecord = {
  id: string;
  employeeNo: string;
  employeeName: string;
  role: string;
  branch: string;
  department: string;
  type: LicenseType;
  licenseNo: string;
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  reminderDays: number;
  status: LicenseStatus;
  attachments: string[];
  reviewer: string;
  updatedAt: string;
  note: string;
};

const licenseTypes: LicenseType[] = [
  "照顧服務員證明",
  "長照小卡",
  "CPR 證照",
  "失智症訓練證明",
  "身障支持服務訓練",
  "護理師證書",
  "社工師證書",
  "司機駕照",
  "其他專業證照",
];

const initialLicenseRecords: LicenseRecord[] = [
  {
    id: "LIC-001",
    employeeNo: "HC-018",
    employeeName: "林佳穎",
    role: "居服員",
    branch: "台北居服站",
    department: "居家服務部",
    type: "長照小卡",
    licenseNo: "LT-2024-0912",
    issuer: "臺北市長期照顧管理中心",
    issuedAt: "2024-06-12",
    expiresAt: "2026-06-10",
    reminderDays: 30,
    status: "即將到期",
    attachments: ["長照小卡正面.pdf", "長照小卡背面.pdf"],
    reviewer: "陳羽俊",
    updatedAt: "2026-05-13",
    note: "已通知員工補上新版證明。",
  },
  {
    id: "LIC-002",
    employeeNo: "DC-006",
    employeeName: "陳柏宏",
    role: "日照照服員",
    branch: "新北日照中心",
    department: "日照中心",
    type: "CPR 證照",
    licenseNo: "CPR-5531",
    issuer: "中華民國紅十字會",
    issuedAt: "2025-01-12",
    expiresAt: "2027-01-11",
    reminderDays: 60,
    status: "有效",
    attachments: ["CPR證照.pdf"],
    reviewer: "王怡婷",
    updatedAt: "2026-05-10",
    note: "排班資格可用於日照與臨時支援。",
  },
  {
    id: "LIC-003",
    employeeNo: "HC-021",
    employeeName: "王淑芬",
    role: "居服員",
    branch: "桃園據點",
    department: "居家服務部",
    type: "失智症訓練證明",
    licenseNo: "DEM-1188",
    issuer: "長照訓練合作單位",
    issuedAt: "2023-04-22",
    expiresAt: "2026-06-15",
    reminderDays: 30,
    status: "即將到期",
    attachments: ["失智症訓練證明.jpg"],
    reviewer: "陳羽俊",
    updatedAt: "2026-05-14",
    note: "需安排複訓課程並回傳附件。",
  },
  {
    id: "LIC-004",
    employeeNo: "HC-009",
    employeeName: "張雅雯",
    role: "居服督導",
    branch: "台中居服站",
    department: "居家服務部",
    type: "照顧服務員證明",
    licenseNo: "CARE-0087",
    issuer: "衛生福利部認可訓練單位",
    issuedAt: "2021-03-01",
    expiresAt: "永久",
    reminderDays: 0,
    status: "有效",
    attachments: ["照顧服務員結訓證明.pdf"],
    reviewer: "王怡婷",
    updatedAt: "2026-05-08",
    note: "已完成紙本與電子附件歸檔。",
  },
  {
    id: "LIC-005",
    employeeNo: "AD-003",
    employeeName: "許明哲",
    role: "司機",
    branch: "新北日照中心",
    department: "交通接送",
    type: "司機駕照",
    licenseNo: "D-220019",
    issuer: "交通部公路局",
    issuedAt: "2019-11-03",
    expiresAt: "2026-05-25",
    reminderDays: 45,
    status: "即將到期",
    attachments: [],
    reviewer: "未指派",
    updatedAt: "2026-05-15",
    note: "缺少附件，需上傳正反面影本。",
  },
  {
    id: "LIC-006",
    employeeNo: "DC-002",
    employeeName: "周品妤",
    role: "護理師",
    branch: "台北日照中心",
    department: "護理組",
    type: "護理師證書",
    licenseNo: "NUR-91331",
    issuer: "衛生福利部",
    issuedAt: "2020-09-01",
    expiresAt: "2026-04-30",
    reminderDays: 60,
    status: "已逾期",
    attachments: ["護理師證書.pdf"],
    reviewer: "陳羽俊",
    updatedAt: "2026-05-16",
    note: "已逾期，排班防呆需阻擋需護理資格的班別。",
  },
];
void initialLicenseRecords;

const statusStyles: Record<LicenseStatus, string> = {
  有效: "bg-emerald-50 text-emerald-700 border-emerald-200",
  即將到期: "bg-amber-50 text-amber-700 border-amber-200",
  已逾期: "bg-rose-50 text-rose-700 border-rose-200",
  待補件: "bg-sky-50 text-sky-700 border-sky-200",
  審核中: "bg-violet-50 text-violet-700 border-violet-200",
};

const careLicenseRequirements = [
  {
    role: "居服員",
    service: "居家服務",
    required: ["照顧服務員證明", "長照小卡", "CPR 證照"] as LicenseType[],
    recommended: ["失智症訓練證明", "身障支持服務訓練"] as LicenseType[],
    blockRule: "缺照服員證明或長照小卡時，阻擋居服個案排班與服務打卡點派案。",
  },
  {
    role: "居服督導",
    service: "督導訪視",
    required: ["照顧服務員證明", "長照小卡"] as LicenseType[],
    recommended: ["失智症訓練證明", "身障支持服務訓練"] as LicenseType[],
    blockRule: "缺長照資格時，督導紀錄與評鑑清冊需標示待補件。",
  },
  {
    role: "日照照服員",
    service: "日照中心",
    required: ["照顧服務員證明", "CPR 證照"] as LicenseType[],
    recommended: ["失智症訓練證明"] as LicenseType[],
    blockRule: "CPR 或照服員資格逾期時，阻擋日照照顧人力最低配置計算。",
  },
  {
    role: "護理師",
    service: "日照護理",
    required: ["護理師證書", "CPR 證照"] as LicenseType[],
    recommended: ["失智症訓練證明"] as LicenseType[],
    blockRule: "護理師證書逾期時，阻擋需護理資格的日照班表發布。",
  },
  {
    role: "司機",
    service: "交通接送",
    required: ["司機駕照", "CPR 證照"] as LicenseType[],
    recommended: [] as LicenseType[],
    blockRule: "駕照缺件或逾期時，阻擋接送排班與交通服務紀錄匯出。",
  },
];

function daysUntil(expiresAt: string) {
  if (expiresAt === "永久") return Infinity;
  const today = new Date("2026-05-18T00:00:00+08:00");
  const expires = new Date(`${expiresAt}T00:00:00+08:00`);
  return Math.ceil((expires.getTime() - today.getTime()) / 86_400_000);
}

export default function LicensesPage() {
  const [licenseRecords, setLicenseRecords] = useState<LicenseRecord[]>([]);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"全部" | LicenseType>("全部");
  const [statusFilter, setStatusFilter] = useState<"全部" | LicenseStatus>("全部");
  const [actionMessage, setActionMessage] = useState("");

  async function loadLicenses() {
    const supabase = getLiveClient();
    const { data, error } = await supabase
      .from("licenses")
      .select("*, employees(employee_no, full_name, primary_branch_id, primary_department_id, branches(name), departments(name))")
      .is("deleted_at", null)
      .order("expires_at", { ascending: true });
    if (error) throw error;
    setLicenseRecords(((data ?? []) as any[]).map((row) => {
      const expiresAt = row.expires_at ?? "永久";
      const days = daysUntil(expiresAt);
      const status: LicenseStatus = row.status === "expired" || days < 0
        ? "已逾期"
        : days !== Infinity && days <= Number(row.reminder_days ?? 30)
          ? "即將到期"
          : row.attachment_status === "missing"
            ? "待補件"
            : "有效";
      return {
        id: row.id,
        employeeNo: row.employees?.employee_no ?? "",
        employeeName: row.employees?.full_name ?? "",
        role: row.license_type ?? "",
        branch: row.employees?.branches?.name ?? "",
        department: row.employees?.departments?.name ?? "",
        type: (licenseTypes.includes(row.license_name) ? row.license_name : "其他專業證照") as LicenseType,
        licenseNo: row.license_no ?? "",
        issuer: row.note ?? "",
        issuedAt: row.issued_at ?? "",
        expiresAt,
        reminderDays: Number(row.reminder_days ?? 30),
        status,
        attachments: row.attachment_status === "uploaded" ? ["Supabase 附件"] : [],
        reviewer: "Supabase",
        updatedAt: row.updated_at ? String(row.updated_at).slice(0, 10) : "",
        note: row.note ?? "",
      };
    }));
  }

  useEffect(() => {
    loadLicenses().catch((error) => setActionMessage(error instanceof Error ? error.message : "讀取 Supabase 證照失敗。"));
  }, []);

  async function createLicenseDraft() {
    const supabase = getLiveClient();
    const employee = await getDefaultEmployee();
    const { error } = await supabase.from("licenses").insert({
      company_id: employee.company_id,
      employee_id: employee.id,
      license_type: "long_term_care",
      license_name: "其他專業證照",
      license_no: `LIC-${Date.now()}`,
      reminder_days: 30,
      attachment_status: "missing",
      status: "active",
      note: "新增證照草稿，請補齊附件與有效期限。",
    });
    if (error) throw error;
    await writeAuditLog({ action: "license.create_draft", resourceType: "licenses" });
    await loadLicenses();
    setActionMessage("已在 Supabase 建立證照草稿。");
  }

  async function updateLicense(id: string, patch: Record<string, unknown>, action: string) {
    const supabase = getLiveClient();
    const { error } = await supabase.from("licenses").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
    await writeAuditLog({ action, resourceType: "licenses", resourceId: id, afterData: patch });
    await loadLicenses();
  }

  const filteredRecords = useMemo(() => {
    return licenseRecords.filter((record) => {
      const matchesQuery = [record.employeeNo, record.employeeName, record.branch, record.licenseNo, record.type]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase());
      const matchesType = typeFilter === "全部" || record.type === typeFilter;
      const matchesStatus = statusFilter === "全部" || record.status === statusFilter;
      return matchesQuery && matchesType && matchesStatus;
    });
  }, [query, statusFilter, typeFilter]);

  const summary = useMemo(() => {
    const expiring = licenseRecords.filter((record) => {
      const days = daysUntil(record.expiresAt);
      return days !== Infinity && days >= 0 && days <= record.reminderDays;
    }).length;
    return {
      total: licenseRecords.length,
      expiring,
      expired: licenseRecords.filter((record) => record.status === "已逾期").length,
      missingAttachments: licenseRecords.filter((record) => record.attachments.length === 0).length,
      scheduleBlocked: licenseRecords.filter((record) => record.status === "已逾期" || record.attachments.length === 0).length,
      assessmentReady: licenseRecords.filter((record) => record.status === "有效" && record.attachments.length > 0).length,
    };
  }, [licenseRecords]);

  const careReadiness = useMemo(
    () =>
      careLicenseRequirements.map((requirement) => {
        const relatedRecords = licenseRecords.filter((record) => record.role.includes(requirement.role.replace("日照", "")) || record.department.includes(requirement.service.slice(0, 2)));
        const missingRequired = requirement.required.filter(
          (type) => !relatedRecords.some((record) => record.type === type && record.status !== "已逾期" && record.attachments.length > 0),
        );
        return {
          ...requirement,
          relatedCount: relatedRecords.length,
          missingRequired,
          ready: missingRequired.length === 0,
        };
      }),
    [licenseRecords],
  );

  async function exportLicenses() {
    downloadTextFile(
      "licenses.csv",
      csv([["員工", "證照", "狀態", "到期日"], ...filteredRecords.map((record) => [record.employeeName, record.type, record.status, record.expiresAt])]),
    );
    await writeAuditLog({
      action: "license.export",
      resourceType: "licenses",
      afterData: { rowCount: filteredRecords.length, query, typeFilter, statusFilter },
    });
    setActionMessage(`已匯出證照清冊 ${filteredRecords.length} 筆，並寫入 audit logs。`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700">Long-Term Care License Management</p>
          <h1 className="text-2xl font-semibold text-slate-950">長照人員證照管理</h1>
          <p className="mt-2 max-w-4xl text-sm text-slate-500">
            集中管理照顧服務員證明、長照小卡、CPR、失智症訓練、身障支持服務、護理師、社工師、司機駕照與其他專業證照，支援證照上傳、有效期限、到期提醒、證照狀態、附件管理與排班資格檢核。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => exportLicenses().catch((error) => setActionMessage(error instanceof Error ? error.message : "匯出證照清冊失敗。"))}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm"
          >
            <Download className="h-4 w-4" />
            匯出清冊
          </button>
          <button
            type="button"
            onClick={() => createLicenseDraft().catch((error) => setActionMessage(error instanceof Error ? error.message : "新增證照失敗。"))}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm"
          >
            <FilePlus2 className="h-4 w-4" />
            新增證照
          </button>
        </div>
      </div>
      {actionMessage ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{actionMessage}</div> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "證照總數", value: `${summary.total}`, detail: "跨居服、日照、行政與專業人員", icon: IdCard, tone: "bg-sky-50 text-sky-700" },
          { label: "即將到期", value: `${summary.expiring}`, detail: "依各證照提醒天數判斷", icon: BellRing, tone: "bg-amber-50 text-amber-700" },
          { label: "已逾期", value: `${summary.expired}`, detail: "需阻擋特定排班資格", icon: AlertTriangle, tone: "bg-rose-50 text-rose-700" },
          { label: "排班阻擋", value: `${summary.scheduleBlocked}`, detail: `評鑑可用 ${summary.assessmentReady} 筆`, icon: ShieldCheck, tone: "bg-violet-50 text-violet-700" },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-500">{item.label}</p>
              <span className={`rounded-lg p-2 ${item.tone}`}>
                <item.icon className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-3 text-2xl font-semibold text-slate-950">{item.value}</p>
            <p className="mt-1 text-xs text-slate-500">{item.detail}</p>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-violet-200 bg-violet-50 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-violet-950">長照資格牆與排班防呆</h2>
            <p className="mt-1 text-sm text-violet-900">
              依居服、日照、護理、接送職務檢查必要證照；缺件、逾期或附件未審核時，不應進入排班發布、服務派案與評鑑匯出。
            </p>
          </div>
          <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-black text-violet-700">
            缺附件 {summary.missingAttachments} 筆
          </span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {careReadiness.map((item) => (
            <div key={item.role} className="rounded-lg bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-bold text-slate-950">{item.role}</div>
                  <div className="mt-1 text-xs text-slate-500">{item.service} · {item.relatedCount} 筆</div>
                </div>
                <span className={`rounded-full px-2 py-1 text-xs font-bold ${item.ready ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                  {item.ready ? "可排班" : "阻擋"}
                </span>
              </div>
              <div className="mt-3 text-xs font-semibold text-slate-500">必要證照</div>
              <div className="mt-2 flex flex-wrap gap-1">
                {item.required.map((type) => (
                  <span key={type} className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">{type}</span>
                ))}
              </div>
              {item.missingRequired.length ? (
                <div className="mt-3 rounded-md bg-rose-50 p-2 text-xs font-semibold text-rose-700">
                  待補：{item.missingRequired.join("、")}
                </div>
              ) : null}
              <p className="mt-3 text-xs text-slate-600">{item.blockRule}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">證照清冊</h2>
                <p className="text-sm text-slate-500">可依人員、據點、證號、證照類型與狀態查詢。</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜尋人員 / 證號 / 據點"
                    className="w-56 rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm"
                  />
                </div>
                <select
                  value={typeFilter}
                  onChange={(event) => setTypeFilter(event.target.value as "全部" | LicenseType)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="全部">全部證照</option>
                  {licenseTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as "全部" | LicenseStatus)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  {["全部", "有效", "即將到期", "已逾期", "待補件", "審核中"].map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">人員</th>
                  <th className="px-4 py-3">證照</th>
                  <th className="px-4 py-3">有效期限</th>
                  <th className="px-4 py-3">狀態</th>
                  <th className="px-4 py-3">附件</th>
                  <th className="px-4 py-3">審核</th>
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredRecords.map((record) => {
                  const days = daysUntil(record.expiresAt);
                  return (
                    <tr key={record.id} className="align-top">
                      <td className="px-4 py-4">
                        <div className="font-semibold text-slate-950">{record.employeeName}</div>
                        <div className="mt-1 text-xs text-slate-500">{record.employeeNo} · {record.role}</div>
                        <div className="mt-1 text-xs text-slate-500">{record.branch} / {record.department}</div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="font-medium text-slate-900">{record.type}</div>
                        <div className="mt-1 text-xs text-slate-500">{record.licenseNo}</div>
                        <div className="mt-1 text-xs text-slate-500">{record.issuer}</div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="font-medium text-slate-900">{record.expiresAt}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {days === Infinity ? "永久有效" : days < 0 ? `逾期 ${Math.abs(days)} 天` : `${days} 天後到期`}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">提醒：到期前 {record.reminderDays} 天</div>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusStyles[record.status]}`}>
                          {record.status}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        {record.attachments.length > 0 ? (
                          <div className="space-y-1">
                            {record.attachments.map((attachment) => (
                              <div key={attachment} className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-600">
                                <FileText className="h-3.5 w-3.5" />
                                {attachment}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700">
                            <Paperclip className="h-3.5 w-3.5" />
                            尚未上傳
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <div className="text-slate-700">{record.reviewer}</div>
                        <div className="mt-1 text-xs text-slate-500">{record.updatedAt}</div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => updateLicense(record.id, { attachment_status: "uploaded", status: "pending_review" }, "license.upload_attachment").then(() => setActionMessage(`已上傳 ${record.employeeName} 的 ${record.type} 附件到 Supabase。`)).catch((error) => setActionMessage(error instanceof Error ? error.message : "上傳證照失敗。"))}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700"
                          >
                            <UploadCloud className="h-3.5 w-3.5" />
                            上傳
                          </button>
                          <button
                            type="button"
                            onClick={() => updateLicense(record.id, { status: "active", attachment_status: "uploaded", note: "已完成審核並可用於排班資格。" }, "license.approve").then(() => setActionMessage(`已將 ${record.employeeName} 的 ${record.type} 審核通過。`)).catch((error) => setActionMessage(error instanceof Error ? error.message : "更新證照失敗。"))}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            更新
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Filter className="h-5 w-5 text-slate-700" />
              <h2 className="text-lg font-semibold text-slate-950">證照類型</h2>
            </div>
            <div className="space-y-2">
              {licenseTypes.map((type) => {
                const count = licenseRecords.filter((record) => record.type === type).length;
                return (
                  <div key={type} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <span className="text-slate-700">{type}</span>
                    <span className="font-semibold text-slate-950">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
            <div className="mb-4 flex items-center gap-2">
              <BellRing className="h-5 w-5 text-amber-700" />
              <h2 className="text-lg font-semibold text-amber-950">到期提醒規則</h2>
            </div>
            <div className="space-y-3 text-sm text-amber-900">
              <div className="flex items-start gap-2">
                <CalendarDays className="mt-0.5 h-4 w-4" />
                <span>每張證照可設定提醒天數，預設 30 天，CPR / 駕照 / 專業證書可調整為 45 或 60 天。</span>
              </div>
              <div className="flex items-start gap-2">
                <UsersRound className="mt-0.5 h-4 w-4" />
                <span>通知對象包含員工本人、人資、直屬主管；逾期證照會同步排班防呆。</span>
              </div>
              <div className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4" />
                <span>審核通過後才列為有效，附件缺漏會標記待補件並保留異動紀錄。</span>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
            <div className="mb-4 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-700" />
              <h2 className="text-lg font-semibold text-emerald-950">附件管理流程</h2>
            </div>
            <div className="space-y-3 text-sm text-emerald-900">
              {["員工端上傳證照影本", "人資檢查證號與有效期限", "審核通過並建立提醒", "連動排班資格與評鑑資料匯出"].map((step, index) => (
                <div key={step} className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-semibold text-emerald-700">{index + 1}</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <FileCheck2 className="mt-0.5 h-5 w-5 text-slate-700" />
          <div>
            <h2 className="font-semibold text-slate-950">資料結構與權限</h2>
            <p className="mt-1 text-sm text-slate-500">
              證照資料對應 Supabase `licenses`，附件對應 `documents`。員工端可上傳與查看自己的證照，人資與主管依資料權限查看所屬公司、部門或據點的人員證照。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
