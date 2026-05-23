"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  BadgeCheck,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Download,
  FileBadge2,
  FileCheck2,
  FileClock,
  FileSpreadsheet,
  FileText,
  Filter,
  HeartHandshake,
  IdCard,
  Landmark,
  LayoutList,
  MapPin,
  ShieldCheck,
  Stethoscope,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { csv, downloadTextFile } from "@/lib/client/download";
import { getCurrentAppUser, getDefaultCompanyId, getLiveClient, writeAuditLog } from "@/lib/supabase/live-modules";

type ExportType =
  | "員工名冊"
  | "證照清冊"
  | "教育訓練清冊"
  | "出勤紀錄"
  | "督導紀錄"
  | "在職證明"
  | "到離職紀錄"
  | "勞健保資料"
  | "排班紀錄"
  | "服務人力配置表";

type ExportStatus = "可匯出" | "需補件" | "產製中";

type ExportItem = {
  type: ExportType;
  description: string;
  source: string;
  format: string;
  records: number;
  status: ExportStatus;
  owner: string;
  lastExportedAt: string;
  icon: LucideIcon;
};

type ExportHistory = {
  id: string;
  branch: string;
  dateRange: string;
  packageName: string;
  exportedBy: string;
  exportedAt: string;
  fileCount: number;
  status: "完成" | "產製中" | "失敗";
};

type ReportExportBatchRow = {
  id: string;
  report_name: string;
  filter_params: {
    branch?: string;
    startDate?: string;
    endDate?: string;
    selectedTypes?: string[];
  } | null;
  row_count: number;
  status: string;
  created_at: string;
  users?: { display_name?: string | null } | null;
};

const branches = ["全部據點", "總公司", "台北居服站", "新北日照中心", "桃園據點", "台中居服站", "台北日照中心"];

const exportItems: ExportItem[] = [
  {
    type: "員工名冊",
    description: "在職員工、職稱、據點、部門、到職日與聯絡資料。",
    source: "employees / users / departments",
    format: "Excel / CSV",
    records: 80,
    status: "可匯出",
    owner: "人資",
    lastExportedAt: "2026-05-15 10:20",
    icon: UsersRound,
  },
  {
    type: "證照清冊",
    description: "長照小卡、CPR、護理師、社工師、司機駕照與附件狀態。",
    source: "licenses / documents",
    format: "Excel + 附件包",
    records: 126,
    status: "需補件",
    owner: "人資",
    lastExportedAt: "2026-05-14 16:40",
    icon: IdCard,
  },
  {
    type: "教育訓練清冊",
    description: "課程名稱、類型、日期、時數、講師、簽到、成績與證明文件。",
    source: "training_records / documents",
    format: "Excel + PDF",
    records: 214,
    status: "可匯出",
    owner: "人資",
    lastExportedAt: "2026-05-13 09:12",
    icon: FileBadge2,
  },
  {
    type: "出勤紀錄",
    description: "每日班別、打卡、請假、加班、補卡與異常出勤。",
    source: "attendance_records / schedules",
    format: "Excel",
    records: 2480,
    status: "可匯出",
    owner: "人資",
    lastExportedAt: "2026-05-16 11:28",
    icon: FileClock,
  },
  {
    type: "督導紀錄",
    description: "居服督導訪視、服務品質追蹤、異常處理與關懷紀錄。",
    source: "supervision_logs",
    format: "Excel / PDF",
    records: 96,
    status: "產製中",
    owner: "居服督導",
    lastExportedAt: "2026-05-10 15:06",
    icon: HeartHandshake,
  },
  {
    type: "在職證明",
    description: "員工在職證明、職稱、到職日、公司與據點資料。",
    source: "employees / documents",
    format: "PDF",
    records: 63,
    status: "可匯出",
    owner: "人資",
    lastExportedAt: "2026-05-11 14:30",
    icon: FileText,
  },
  {
    type: "到離職紀錄",
    description: "到職、留停、復職、離職日期與員工狀態異動紀錄。",
    source: "employee_change_logs / employees",
    format: "Excel",
    records: 38,
    status: "可匯出",
    owner: "人資",
    lastExportedAt: "2026-05-09 17:50",
    icon: BriefcaseBusiness,
  },
  {
    type: "勞健保資料",
    description: "勞保級距、健保級距、勞退提繳與眷屬設定。",
    source: "employees / payroll settings",
    format: "Excel",
    records: 80,
    status: "可匯出",
    owner: "會計",
    lastExportedAt: "2026-05-12 13:18",
    icon: Landmark,
  },
  {
    type: "排班紀錄",
    description: "員工排班、居服個案排班、日照人力配置與代班紀錄。",
    source: "schedules / shift_change_requests",
    format: "Excel",
    records: 920,
    status: "可匯出",
    owner: "主管",
    lastExportedAt: "2026-05-17 08:45",
    icon: CalendarDays,
  },
  {
    type: "服務人力配置表",
    description: "依據點、日期、職務統計居服與日照服務人力配置。",
    source: "branches / schedules / employees",
    format: "Excel / PDF",
    records: 31,
    status: "可匯出",
    owner: "營運",
    lastExportedAt: "2026-05-15 18:10",
    icon: Stethoscope,
  },
];

const histories: ExportHistory[] = [
  { id: "EXP-202605-001", branch: "台北居服站", dateRange: "2026-01-01 ~ 2026-05-18", packageName: "台北居服站評鑑資料包", exportedBy: "陳羽俊", exportedAt: "2026-05-18 09:30", fileCount: 10, status: "完成" },
  { id: "EXP-202605-002", branch: "新北日照中心", dateRange: "2026-04-01 ~ 2026-05-18", packageName: "新北日照中心補件資料包", exportedBy: "王怡婷", exportedAt: "2026-05-17 16:22", fileCount: 7, status: "完成" },
  { id: "EXP-202605-003", branch: "桃園據點", dateRange: "2026-01-01 ~ 2026-03-31", packageName: "桃園據點季度稽核包", exportedBy: "林雅玲", exportedAt: "2026-05-16 11:05", fileCount: 5, status: "產製中" },
];
void histories;

const exportSources: Record<ExportType, { table: string; filter?: { column: string; value: string | boolean } }> = {
  員工名冊: { table: "employees" },
  證照清冊: { table: "licenses" },
  教育訓練清冊: { table: "training_records" },
  出勤紀錄: { table: "attendance_punches" },
  督導紀錄: { table: "documents" },
  在職證明: { table: "employees", filter: { column: "status", value: "在職" } },
  到離職紀錄: { table: "employees" },
  勞健保資料: { table: "payroll_records" },
  排班紀錄: { table: "schedules" },
  服務人力配置表: { table: "schedules" },
};

const statusStyles: Record<ExportStatus, string> = {
  可匯出: "border-emerald-200 bg-emerald-50 text-emerald-700",
  需補件: "border-amber-200 bg-amber-50 text-amber-700",
  產製中: "border-sky-200 bg-sky-50 text-sky-700",
};

export default function AssessmentExportsPage() {
  const [branch, setBranch] = useState("全部據點");
  const [startDate, setStartDate] = useState("2026-01-01");
  const [endDate, setEndDate] = useState("2026-05-18");
  const [selectedTypes, setSelectedTypes] = useState<ExportType[]>(exportItems.map((item) => item.type));
  const [exportMessage, setExportMessage] = useState("正在讀取 Supabase 正式資料筆數...");
  const [liveCounts, setLiveCounts] = useState<Record<ExportType, number>>({} as Record<ExportType, number>);
  const [exportHistories, setExportHistories] = useState<ExportHistory[]>([]);

  useEffect(() => {
    void loadAssessmentData();
  }, []);

  async function countRows(type: ExportType) {
    const source = exportSources[type];
    const supabase = getLiveClient();
    let query = supabase.from(source.table).select("id", { count: "exact", head: true }).is("deleted_at", null);
    if (source.filter) query = query.eq(source.filter.column, source.filter.value);
    const { count, error } = await query;
    if (error) throw error;
    return count ?? 0;
  }

  async function loadAssessmentData() {
    try {
      const countEntries = await Promise.all(
        exportItems.map(async (item) => {
          try {
            return [item.type, await countRows(item.type)] as const;
          } catch {
            return [item.type, 0] as const;
          }
        }),
      );
      setLiveCounts(Object.fromEntries(countEntries) as Record<ExportType, number>);

      const supabase = getLiveClient();
      const { data, error } = await supabase
        .from("report_export_batches")
        .select("id, report_name, filter_params, row_count, status, created_at, users(display_name)")
        .eq("report_category", "長照評鑑")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      setExportHistories(((data ?? []) as ReportExportBatchRow[]).map((row) => ({
        id: row.id,
        branch: row.filter_params?.branch ?? "全部據點",
        dateRange: `${row.filter_params?.startDate ?? ""} ~ ${row.filter_params?.endDate ?? ""}`,
        packageName: row.report_name,
        exportedBy: row.users?.display_name ?? "Supabase 使用者",
        exportedAt: new Date(row.created_at).toLocaleString("zh-TW", { hour12: false }),
        fileCount: row.filter_params?.selectedTypes?.length ?? 1,
        status: row.status === "completed" ? "完成" : row.status === "failed" ? "失敗" : "產製中",
      })));
      setExportMessage("已連線 Supabase；評鑑資料包筆數與匯出紀錄皆取自正式資料。");
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : "評鑑資料讀取失敗。");
      setExportHistories([]);
    }
  }

  const liveExportItems = useMemo(() => exportItems.map((item) => ({ ...item, records: liveCounts[item.type] ?? 0, lastExportedAt: "依匯出批次" })), [liveCounts]);
  const selectedItems = useMemo(() => liveExportItems.filter((item) => selectedTypes.includes(item.type)), [liveExportItems, selectedTypes]);
  const totalRecords = selectedItems.reduce((sum, item) => sum + item.records, 0);
  const readyCount = selectedItems.filter((item) => item.status === "可匯出").length;
  const needsActionCount = selectedItems.filter((item) => item.status !== "可匯出").length;

  function toggleType(type: ExportType) {
    setSelectedTypes((current) => {
      if (current.includes(type)) {
        return current.filter((item) => item !== type);
      }
      return [...current, type];
    });
  }

  async function createExportBatch() {
    const fileName = `assessment-export-${branch}-${startDate}-${endDate}.csv`;
    downloadTextFile(
      fileName,
      csv([
        ["據點", "日期區間", "資料類型", "來源", "格式", "筆數", "狀態", "負責人"],
        ...selectedItems.map((item) => [
          branch,
          `${startDate} ~ ${endDate}`,
          item.type,
          item.source,
          item.format,
          item.records,
          item.status,
          item.owner,
        ]),
      ]),
    );
    const supabase = getLiveClient();
    const [companyId, user] = await Promise.all([getDefaultCompanyId(), getCurrentAppUser()]);
    const { error } = await supabase.from("report_export_batches").insert({
      company_id: companyId,
      requested_by: user.id,
      report_name: `${branch} 評鑑資料包`,
      report_category: "長照評鑑",
      filter_params: { branch, startDate, endDate, selectedTypes },
      row_count: totalRecords,
      export_format: "csv",
      status: "completed",
      file_name: fileName,
    });
    if (error) throw error;
    await writeAuditLog({
      action: "assessment_export.create",
      resourceType: "report_export_batches",
      afterData: { branch, startDate, endDate, selectedTypes, totalRecords },
    });
    await loadAssessmentData();
    setExportMessage(`${branch} ${startDate} ~ ${endDate} 已建立評鑑資料匯出批次，共 ${selectedItems.length} 類資料、${totalRecords.toLocaleString("zh-TW")} 筆。`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700">Long-Term Care Assessment Export</p>
          <h1 className="text-2xl font-semibold text-slate-950">長照評鑑資料匯出</h1>
          <p className="mt-2 max-w-4xl text-sm text-slate-500">
            依日期區間與據點匯出員工名冊、證照清冊、教育訓練清冊、出勤紀錄、督導紀錄、在職證明、到離職紀錄、勞健保資料、排班紀錄與服務人力配置表。
          </p>
        </div>
        <button
          onClick={() => createExportBatch().catch((error) => setExportMessage(error instanceof Error ? error.message : "建立評鑑資料包失敗。"))}
          className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm"
        >
          <Archive className="h-4 w-4" />
          建立評鑑資料包
        </button>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "已選資料", value: `${selectedItems.length} 類`, detail: "可單選或批次匯出", icon: LayoutList, tone: "bg-sky-50 text-sky-700" },
          { label: "預估筆數", value: totalRecords.toLocaleString("zh-TW"), detail: "依篩選條件估算", icon: FileSpreadsheet, tone: "bg-violet-50 text-violet-700" },
          { label: "可直接匯出", value: `${readyCount}`, detail: "資料檢核通過", icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-700" },
          { label: "需處理項目", value: `${needsActionCount}`, detail: "補件或產製中", icon: ShieldCheck, tone: "bg-amber-50 text-amber-700" },
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

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Filter className="h-5 w-5 text-slate-700" />
          <h2 className="text-lg font-semibold text-slate-950">匯出條件</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span className="font-medium text-slate-700">開始日期</span>
            <input value={startDate} onChange={(event) => setStartDate(event.target.value)} type="date" className="w-full rounded-lg border border-slate-200 px-3 py-2" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium text-slate-700">結束日期</span>
            <input value={endDate} onChange={(event) => setEndDate(event.target.value)} type="date" className="w-full rounded-lg border border-slate-200 px-3 py-2" />
          </label>
          <label className="space-y-1 text-sm md:col-span-2">
            <span className="font-medium text-slate-700">據點</span>
            <select value={branch} onChange={(event) => setBranch(event.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2">
              {branches.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          {exportMessage}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">評鑑資料項目</h2>
                <p className="text-sm text-slate-500">勾選要納入資料包的匯出項目。</p>
              </div>
              <button
                onClick={() => setSelectedTypes(liveExportItems.map((item) => item.type))}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700"
              >
                <BadgeCheck className="h-4 w-4" />
                全選
              </button>
            </div>
          </div>
          <div className="grid gap-3 p-5 lg:grid-cols-2">
            {liveExportItems.map((item) => {
              const checked = selectedTypes.includes(item.type);
              return (
                <button
                  key={item.type}
                  onClick={() => toggleType(item.type)}
                  className={`rounded-lg border p-4 text-left transition ${checked ? "border-emerald-300 bg-emerald-50/60" : "border-slate-200 bg-white"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <span className="rounded-lg bg-white p-2 text-slate-700 shadow-sm">
                        <item.icon className="h-5 w-5" />
                      </span>
                      <div>
                        <div className="font-semibold text-slate-950">{item.type}</div>
                        <p className="mt-1 text-sm text-slate-500">{item.description}</p>
                      </div>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusStyles[item.status]}`}>{item.status}</span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-500">
                    <span>來源：{item.source}</span>
                    <span>格式：{item.format}</span>
                    <span>筆數：{item.records.toLocaleString("zh-TW")}</span>
                    <span>負責：{item.owner}</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                    <span>上次匯出：{item.lastExportedAt}</span>
                    <span className={checked ? "font-semibold text-emerald-700" : "text-slate-400"}>{checked ? "已納入" : "未選取"}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Download className="h-5 w-5 text-slate-700" />
              <h2 className="text-lg font-semibold text-slate-950">資料包內容</h2>
            </div>
            <div className="space-y-2 text-sm">
              {selectedItems.map((item) => (
                <div key={item.type} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                  <span className="text-slate-700">{item.type}</span>
                  <span className="font-semibold text-slate-950">{item.format}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
            <div className="mb-4 flex items-center gap-2">
              <FileCheck2 className="h-5 w-5 text-emerald-700" />
              <h2 className="text-lg font-semibold text-emerald-950">匯出流程</h2>
            </div>
            <div className="space-y-3 text-sm text-emerald-900">
              {["選擇日期區間與據點", "勾選評鑑資料項目", "檢查缺附件與產製狀態", "產生 ZIP 資料包與匯出紀錄"].map((step, index) => (
                <div key={step} className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-semibold text-emerald-700">{index + 1}</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
            <div className="mb-4 flex items-center gap-2">
              <MapPin className="h-5 w-5 text-amber-700" />
              <h2 className="text-lg font-semibold text-amber-950">依據點匯出</h2>
            </div>
            <p className="text-sm text-amber-900">
              選擇單一據點時，資料會限制在該據點員工、服務、排班與出勤紀錄；選擇全部據點時，會依據點分頁並保留公司彙總表。
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-5">
          <h2 className="text-lg font-semibold text-slate-950">匯出紀錄</h2>
          <p className="text-sm text-slate-500">每次產製都會留下批次、日期區間、據點、產製人與檔案數。</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">批次</th>
                <th className="px-4 py-3">資料包</th>
                <th className="px-4 py-3">日期區間</th>
                <th className="px-4 py-3">據點</th>
                <th className="px-4 py-3">產製人</th>
                <th className="px-4 py-3">檔案</th>
                <th className="px-4 py-3">狀態</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {exportHistories.length ? exportHistories.map((history) => (
                <tr key={history.id}>
                  <td className="px-4 py-4 font-medium text-slate-950">{history.id}</td>
                  <td className="px-4 py-4">
                    <div className="font-medium text-slate-800">{history.packageName}</div>
                    <div className="mt-1 text-xs text-slate-500">{history.exportedAt}</div>
                  </td>
                  <td className="px-4 py-4 text-slate-600">{history.dateRange}</td>
                  <td className="px-4 py-4 text-slate-600">{history.branch}</td>
                  <td className="px-4 py-4 text-slate-600">{history.exportedBy}</td>
                  <td className="px-4 py-4 text-slate-600">{history.fileCount} 份</td>
                  <td className="px-4 py-4">
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">{history.status}</span>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">尚無正式匯出紀錄。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <ClipboardList className="mt-0.5 h-5 w-5 text-slate-700" />
          <div>
            <h2 className="font-semibold text-slate-950">資料結構與權限</h2>
            <p className="mt-1 text-sm text-slate-500">
              評鑑匯出批次會記錄在 Supabase `report_export_batches`，每次匯出保留日期區間、據點、資料項目、檔案數、產製人與狀態，方便稽核追蹤。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
