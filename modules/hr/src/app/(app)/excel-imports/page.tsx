"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  ClipboardCheck,
  Download,
  Eye,
  FileSpreadsheet,
  GraduationCap,
  IdCard,
  ListChecks,
  Moon,
  ReceiptText,
  UploadCloud,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { csv, downloadTextFile } from "@/lib/client/download";
import { writeAuditLog } from "@/lib/supabase/live-modules";

type ImportType = "員工資料" | "部門資料" | "班別資料" | "月排班資料" | "薪資項目" | "證照資料" | "教育訓練紀錄";
type ImportStep = "範本下載" | "欄位檢查" | "錯誤提示" | "預覽資料" | "確認寫入";
type ImportStatus = "可匯入" | "有錯誤" | "待確認";

type ImportConfig = {
  type: ImportType;
  description: string;
  templateName: string;
  requiredFields: string[];
  previewRows: number;
  errors: number;
  status: ImportStatus;
  targetTable: string;
  icon: LucideIcon;
};

const importConfigs: ImportConfig[] = [
  { type: "員工資料", description: "員工編號、姓名、部門、據點、職稱、到職日與聯絡資訊。", templateName: "employee_import_template.xlsx", requiredFields: ["員工編號", "中文姓名", "公司", "據點", "部門", "到職日"], previewRows: 80, errors: 1, status: "有錯誤", targetTable: "employees", icon: UsersRound },
  { type: "部門資料", description: "公司、據點、部門代碼、部門名稱、主管與狀態。", templateName: "department_import_template.xlsx", requiredFields: ["公司", "部門代碼", "部門名稱"], previewRows: 10, errors: 0, status: "可匯入", targetTable: "departments", icon: ListChecks },
  { type: "班別資料", description: "班別名稱、上下班時間、休息時間、跨日、寬限分鐘與顏色。", templateName: "shift_import_template.xlsx", requiredFields: ["班別名稱", "上班時間", "下班時間"], previewRows: 8, errors: 0, status: "可匯入", targetTable: "shifts", icon: Moon },
  { type: "月排班資料", description: "員工、日期、班別、據點、部門與排班備註。", templateName: "monthly_schedule_import_template.xlsx", requiredFields: ["員工編號", "日期", "班別"], previewRows: 920, errors: 4, status: "有錯誤", targetTable: "schedules", icon: CalendarRange },
  { type: "薪資項目", description: "項目代碼、名稱、分類、計算方式、課稅與啟用狀態。", templateName: "payroll_item_import_template.xlsx", requiredFields: ["項目代碼", "項目名稱", "分類"], previewRows: 18, errors: 0, status: "待確認", targetTable: "payroll_items", icon: ReceiptText },
  { type: "證照資料", description: "員工、證照類型、證號、發證日、到期日與附件狀態。", templateName: "license_import_template.xlsx", requiredFields: ["員工編號", "證照類型", "證照名稱"], previewRows: 126, errors: 2, status: "有錯誤", targetTable: "licenses", icon: IdCard },
  { type: "教育訓練紀錄", description: "課程名稱、類型、日期、時數、講師、簽到、成績與證明文件。", templateName: "training_record_import_template.xlsx", requiredFields: ["員工編號", "課程名稱", "上課日期", "上課時數"], previewRows: 214, errors: 0, status: "可匯入", targetTable: "training_records", icon: GraduationCap },
];

const steps: ImportStep[] = ["範本下載", "欄位檢查", "錯誤提示", "預覽資料", "確認寫入"];

const errorSamples = [
  { row: 12, field: "員工編號", message: "員工編號 EMP-0007 已存在，請確認是否更新既有資料。" },
  { row: 26, field: "班別", message: "找不到班別代碼 N2，請先建立班別或修正 Excel。" },
  { row: 41, field: "到期日", message: "日期格式需為 YYYY-MM-DD。" },
  { row: 55, field: "部門", message: "此部門不屬於選定據點。" },
];

const previewRows: string[][] = [];

const statusStyles: Record<ImportStatus, string> = {
  可匯入: "border-emerald-200 bg-emerald-50 text-emerald-700",
  有錯誤: "border-rose-200 bg-rose-50 text-rose-700",
  待確認: "border-amber-200 bg-amber-50 text-amber-700",
};

export default function ExcelImportsPage() {
  const [activeType, setActiveType] = useState<ImportType>("員工資料");
  const [message, setMessage] = useState("請先下載範本，完成欄位檢查與預覽後再寫入資料庫。");
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [uploadedRows, setUploadedRows] = useState<string[][]>([]);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const activeConfig = useMemo(() => importConfigs.find((config) => config.type === activeType) ?? importConfigs[0], [activeType]);
  const totalRows = uploadedRows.length;
  const totalErrors = validationErrors.length;

  function downloadTemplate() {
    downloadTextFile(
      activeConfig.templateName.replace(".xlsx", ".csv"),
      csv([activeConfig.requiredFields, ...previewRows]),
    );
    setMessage(`${activeConfig.type} 範本下載：${activeConfig.templateName}`);
    void writeAuditLog({ action: "excel_import.template_download", resourceType: activeConfig.targetTable, afterData: { type: activeConfig.type } });
  }

  function validateFields() {
    if (!uploadedRows.length) {
      setValidationErrors(["尚未上傳 CSV 檔案，不能進行欄位檢查。"]);
      setMessage("尚未上傳 CSV 檔案，不能進行欄位檢查。");
      return;
    }
    const headers = uploadedRows[0] ?? [];
    const missing = activeConfig.requiredFields.filter((field) => !headers.includes(field));
    setValidationErrors(missing.map((field) => `缺少必填欄位：${field}`));
    setMessage(missing.length ? `${activeConfig.type} 欄位檢查失敗：缺少 ${missing.join("、")}。` : `${activeConfig.type} 欄位檢查通過，預覽 ${Math.max(uploadedRows.length - 1, 0)} 筆資料。`);
  }

  async function confirmImport() {
    if (!uploadedRows.length) {
      setMessage("尚未上傳檔案，系統不會建立任何資料。");
      return;
    }
    if (validationErrors.length > 0) {
      setMessage(`${activeConfig.type} 仍有 ${validationErrors.length} 個欄位錯誤，修正後才允許寫入。`);
      return;
    }
    await writeAuditLog({
      action: "excel_import.blocked_before_parser",
      resourceType: activeConfig.targetTable,
      afterData: { type: activeConfig.type, rows: Math.max(uploadedRows.length - 1, 0), uploadedFileName },
    });
    setMessage("P1 已封鎖假寫入：目前僅完成上傳、欄位檢查與預覽，正式寫入需接 server-side parser、交易寫入與錯誤回滾後才開放。");
  }

  function parseCsvText(text: string) {
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, "")));
  }

  async function handleUpload(file: File | undefined) {
    if (!file) return;
    setUploadedFileName(file.name);
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setUploadedRows([]);
      setValidationErrors(["P1 安全限制：目前前端只預覽 CSV，xlsx 需由後端解析後才可寫入。"]);
      setMessage("已選擇檔案，但目前僅允許 CSV 預覽；xlsx 需接後端解析服務。");
      return;
    }
    const text = await file.text();
    const rows = parseCsvText(text);
    setUploadedRows(rows);
    setValidationErrors([]);
    setMessage(`已上傳 ${file.name}，共 ${Math.max(rows.length - 1, 0)} 筆待檢查資料。`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700">Excel Import Center</p>
          <h1 className="text-2xl font-semibold text-slate-950">Excel 匯入功能</h1>
          <p className="mt-2 max-w-4xl text-sm text-slate-500">
            可匯入員工資料、部門資料、班別資料、月排班資料、薪資項目、證照資料、教育訓練紀錄；匯入前提供範本下載、欄位檢查、錯誤提示、預覽資料，確認後才寫入資料庫。
          </p>
        </div>
        <button onClick={() => confirmImport().catch((error) => setMessage(error instanceof Error ? error.message : "確認匯入失敗。"))} className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm">
          <ClipboardCheck className="h-4 w-4" />
          確認寫入資料庫
        </button>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "匯入類型", value: `${importConfigs.length}`, detail: "七種 Excel 匯入", icon: FileSpreadsheet, tone: "bg-sky-50 text-sky-700" },
          { label: "預覽資料", value: totalRows.toLocaleString("zh-TW"), detail: "目前上傳檔案筆數", icon: Eye, tone: "bg-violet-50 text-violet-700" },
          { label: "錯誤提示", value: `${totalErrors}`, detail: "需修正後才能寫入", icon: AlertTriangle, tone: "bg-rose-50 text-rose-700" },
          { label: "可寫入狀態", value: validationErrors.length === 0 && uploadedRows.length > 0 ? "待後端" : "未通過", detail: "正式寫入需後端交易", icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-700" },
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

      <section className="grid gap-5 xl:grid-cols-[360px_1fr]">
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <h2 className="text-lg font-semibold text-slate-950">匯入項目</h2>
            <p className="text-sm text-slate-500">選擇要匯入的資料類型。</p>
          </div>
          <div className="divide-y divide-slate-100">
            {importConfigs.map((config) => (
              <button
                key={config.type}
                onClick={() => setActiveType(config.type)}
                className={`w-full p-4 text-left transition ${activeType === config.type ? "bg-emerald-50" : "bg-white hover:bg-slate-50"}`}
              >
                <div className="flex items-start gap-3">
                  <span className="rounded-lg bg-white p-2 text-slate-700 shadow-sm">
                    <config.icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-950">{config.type}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${statusStyles[config.status]}`}>{config.status}</span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{config.description}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-5">
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">{activeConfig.type}</h2>
                <p className="text-sm text-slate-500">{activeConfig.description}</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">寫入：{activeConfig.targetTable}</span>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-5">
              {steps.map((step, index) => (
                <div key={step} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs font-semibold text-slate-700">{index + 1}</div>
                  <div className="mt-2 font-semibold text-slate-950">{step}</div>
                  <p className="mt-1 text-xs text-slate-500">
                    {step === "範本下載" ? "取得標準欄位" : step === "欄位檢查" ? "檢查必填與格式" : step === "錯誤提示" ? "列出行列錯誤" : step === "預覽資料" ? "確認匯入內容" : "通過後寫入"}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <button onClick={downloadTemplate} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700">
                <Download className="h-4 w-4" />
                範本下載
              </button>
              <button onClick={validateFields} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700">
                <ListChecks className="h-4 w-4" />
                欄位檢查
              </button>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700">
                <UploadCloud className="h-4 w-4" />
                上傳 Excel
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(event) => void handleUpload(event.target.files?.[0])} />
              </label>
            </div>

            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">{message}</div>
          </section>

          <section className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-950">欄位檢查</h2>
              <p className="mt-1 text-sm text-slate-500">必填欄位需完整，格式與關聯資料需通過。</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {activeConfig.requiredFields.map((field) => (
                  <span key={field} className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">{field}</span>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-rose-200 bg-rose-50 p-5">
              <h2 className="text-lg font-semibold text-rose-950">錯誤提示</h2>
              <p className="mt-1 text-sm text-rose-800">會顯示列號、欄位與修正原因。</p>
              <div className="mt-4 space-y-2">
                {(validationErrors.length ? validationErrors : uploadedRows.length ? ["目前沒有欄位錯誤。"] : errorSamples.slice(0, 1).map((error) => `範例：第 ${error.row} 列 ${error.field}，${error.message}`)).map((error) => (
                  <div key={error} className="rounded-lg bg-white/80 p-3 text-sm">
                    <div className="font-semibold text-rose-700">{validationErrors.length ? "需修正" : "提示"}</div>
                    <div className="mt-1 text-rose-900">{error}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-5">
              <h2 className="text-lg font-semibold text-slate-950">預覽資料</h2>
              <p className="text-sm text-slate-500">確認內容正確後才允許寫入資料庫。</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    {(uploadedRows[0] ?? activeConfig.requiredFields).map((header) => (
                      <th key={header} className="px-4 py-3">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(uploadedRows.length > 1 ? uploadedRows.slice(1, 6) : []).map((row, index) => (
                    <tr key={`${index}-${row.join("-")}`}>
                      {row.map((cell) => (
                        <td key={cell} className="px-4 py-3 text-slate-700">{cell}</td>
                      ))}
                    </tr>
                  ))}
                  {uploadedRows.length <= 1 ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-slate-500" colSpan={(uploadedRows[0] ?? activeConfig.requiredFields).length}>
                        尚未上傳可預覽的 CSV 資料。
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
