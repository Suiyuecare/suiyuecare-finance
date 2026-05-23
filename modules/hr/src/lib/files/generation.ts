import { createHash } from "node:crypto";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ApiUserContext } from "@/lib/auth/server-guard";

export type FileArtifactType = "report_summary" | "payroll_roster" | "payslip" | "employment_certificate" | "assessment_package";
export type GeneratedFileFormat = "csv" | "json" | "html" | "pdf_print";
export type FileDeliveryMethod = "download" | "email" | "record";

export type GenerateFileInput = {
  artifactType: FileArtifactType;
  format: GeneratedFileFormat;
  deliveryMethod?: FileDeliveryMethod;
  recipientEmail?: string;
  employeeId?: string;
  payrollMonth?: string;
  dateStart?: string;
  dateEnd?: string;
};

export type GeneratedFileResult = {
  ok: boolean;
  generatedFileId: string | null;
  artifactType: FileArtifactType;
  format: GeneratedFileFormat;
  deliveryMethod: FileDeliveryMethod;
  fileName: string;
  mimeType: string;
  contentBase64: string | null;
  fileSize: number;
  sha256: string;
  emailStatus: "not_required" | "sent" | "failed" | "config_missing";
  error?: string;
};

type DbError = { message: string };

type QueryResult<T> = Promise<{ data: T[] | null; error: DbError | null; count?: number | null }>;
type SingleQueryResult<T> = Promise<{ data: T | null; error: DbError | null }>;

type SupabaseFileClient = {
  from: (table: string) => {
    select: (columns: string, options?: { count?: "exact"; head?: boolean }) => QueryBuilder;
    insert: (payload: Record<string, unknown>) => {
      select: (columns: string) => {
        single: <T>() => SingleQueryResult<T>;
      };
    };
    update: (payload: Record<string, unknown>) => {
      eq: (column: string, value: unknown) => Promise<{ error: DbError | null }>;
    };
  };
};

type QueryBuilder = {
  eq: (column: string, value: unknown) => QueryBuilder;
  gte: (column: string, value: unknown) => QueryBuilder;
  lte: (column: string, value: unknown) => QueryBuilder;
  is: (column: string, value: null) => QueryBuilder;
  order: (column: string, options: { ascending: boolean }) => QueryBuilder;
  limit: <T>(count: number) => QueryResult<T>;
  single: <T>() => SingleQueryResult<T>;
  then: <TResult1 = { count: number | null; error: DbError | null }, TResult2 = never>(
    onfulfilled?: ((value: { count: number | null; error: DbError | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) => Promise<TResult1 | TResult2>;
};

type ExportRow = {
  id: string;
};

type EmployeeRow = {
  id: string;
  employee_no: string;
  full_name: string;
  hire_date: string | null;
  email: string | null;
};

type PayslipRow = {
  id: string;
  employee_id: string;
  payroll_month: string;
  payment_date: string | null;
  gross_pay_total: number | string;
  deduction_total: number | string;
  employer_cost_total: number | string;
  net_pay_total: number | string;
  bank_account_last_five: string;
  remark: string | null;
  status: string;
};

type PayrollItemRow = {
  item_type: string;
  item_code: string;
  item_name: string;
  quantity: number | string | null;
  unit_amount: number | string | null;
  amount: number | string;
};

const artifactLabels: Record<FileArtifactType, string> = {
  report_summary: "HRIS 報表摘要",
  payroll_roster: "薪資清冊",
  payslip: "電子薪資單",
  employment_certificate: "在職證明",
  assessment_package: "長照評鑑資料包",
};

const mimeTypes: Record<GeneratedFileFormat, string> = {
  csv: "text/csv;charset=utf-8",
  json: "application/json;charset=utf-8",
  html: "text/html;charset=utf-8",
  pdf_print: "text/html;charset=utf-8",
};

export async function generateFileOutput(input: GenerateFileInput, user: ApiUserContext): Promise<GeneratedFileResult> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return failure(input, "SUPABASE_SERVICE_ROLE_KEY 或 NEXT_PUBLIC_SUPABASE_URL 尚未設定。");
  }

  const client = supabase as unknown as SupabaseFileClient;
  const deliveryMethod = input.deliveryMethod ?? "download";
  const artifact = await buildArtifact(client, input, user);
  const content = renderContent(input.format, artifact);
  const buffer = Buffer.from(content, "utf8");
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const fileName = buildFileName(input, artifact.title);
  const mimeType = mimeTypes[input.format];

  const exportRow = await createGeneratedFileRecord(client, {
    user,
    input,
    deliveryMethod,
    fileName,
    mimeType,
    fileSize: buffer.byteLength,
    sha256,
    metadata: {
      title: artifact.title,
      rowCount: artifact.rows.length,
      columns: artifact.columns,
      pdfPrintNote: input.format === "pdf_print" ? "Print-ready HTML for browser Save as PDF." : null,
    },
  });

  let emailStatus: GeneratedFileResult["emailStatus"] = "not_required";
  let emailError: string | undefined;

  if (deliveryMethod === "email") {
    const emailResult = await sendGeneratedFileEmail({
      to: input.recipientEmail || user.email,
      subject: `${artifact.title} 檔案產出`,
      html: buildEmailHtml(artifact.title, fileName),
      attachment: {
        filename: fileName,
        contentBase64: buffer.toString("base64"),
      },
      mimeType,
    });
    emailStatus = emailResult.status;
    emailError = emailResult.error;
    if (exportRow?.id) {
      await client.from("generated_file_exports").update({
        status: emailStatus === "sent" ? "sent" : "failed",
        email_status: emailStatus,
        sent_at: emailStatus === "sent" ? new Date().toISOString() : null,
        error_message: emailError ?? null,
      }).eq("id", exportRow.id);
    }
  }

  return {
    ok: !emailError,
    generatedFileId: exportRow?.id ?? null,
    artifactType: input.artifactType,
    format: input.format,
    deliveryMethod,
    fileName,
    mimeType,
    contentBase64: deliveryMethod === "download" ? buffer.toString("base64") : null,
    fileSize: buffer.byteLength,
    sha256,
    emailStatus,
    error: emailError,
  };
}

async function buildArtifact(client: SupabaseFileClient, input: GenerateFileInput, user: ApiUserContext) {
  switch (input.artifactType) {
    case "payroll_roster":
      return buildPayrollRoster(client, input, user);
    case "payslip":
      return buildPayslip(client, input, user);
    case "employment_certificate":
      return buildEmploymentCertificate(client, input, user);
    case "assessment_package":
      return buildAssessmentPackage(client, input, user);
    case "report_summary":
    default:
      return buildReportSummary(client, input, user);
  }
}

async function buildReportSummary(client: SupabaseFileClient, input: GenerateFileInput, user: ApiUserContext) {
  const tables = ["employees", "attendance_records", "leave_requests", "overtime_requests", "payroll_payslips", "licenses", "training_records"];
  const rows: Array<Record<string, string | number>> = [];

  for (const table of tables) {
    const query = client.from(table).select("*", { count: "exact", head: true }).eq("company_id", user.companyId).is("deleted_at", null);
    const { count } = await query;
    rows.push({ module: table, count: count ?? 0, date_start: input.dateStart ?? "", date_end: input.dateEnd ?? "" });
  }

  return {
    title: "HRIS 報表摘要",
    columns: ["module", "count", "date_start", "date_end"],
    rows,
  };
}

async function buildPayrollRoster(client: SupabaseFileClient, input: GenerateFileInput, user: ApiUserContext) {
  let query = client
    .from("payroll_payslips")
    .select("id, employee_id, payroll_month, payment_date, gross_pay_total, deduction_total, employer_cost_total, net_pay_total, bank_account_last_five, remark, status")
    .eq("company_id", user.companyId)
    .is("deleted_at", null)
    .order("payroll_month", { ascending: false });
  if (input.payrollMonth) query = query.eq("payroll_month", input.payrollMonth);
  const { data, error } = await query.limit<PayslipRow>(300);
  if (error) throw new Error(error.message);

  return {
    title: "薪資清冊",
    columns: ["payroll_month", "employee_id", "gross_pay_total", "deduction_total", "employer_cost_total", "net_pay_total", "bank_account_last_five", "status"],
    rows: (data ?? []).map((row) => ({
      payroll_month: row.payroll_month,
      employee_id: row.employee_id,
      gross_pay_total: row.gross_pay_total,
      deduction_total: row.deduction_total,
      employer_cost_total: row.employer_cost_total,
      net_pay_total: row.net_pay_total,
      bank_account_last_five: `*****${row.bank_account_last_five}`,
      status: row.status,
    })),
  };
}

async function buildPayslip(client: SupabaseFileClient, input: GenerateFileInput, user: ApiUserContext) {
  const employeeId = input.employeeId || user.employeeId;
  if (!employeeId) throw new Error("缺少員工 ID，無法產出薪資單。");

  let payslipQuery = client
    .from("payroll_payslips")
    .select("id, employee_id, payroll_month, payment_date, gross_pay_total, deduction_total, employer_cost_total, net_pay_total, bank_account_last_five, remark, status")
    .eq("employee_id", employeeId)
    .is("deleted_at", null)
    .order("payroll_month", { ascending: false });
  if (input.payrollMonth) payslipQuery = payslipQuery.eq("payroll_month", input.payrollMonth);
  const { data: payslips, error } = await payslipQuery.limit<PayslipRow>(1);
  if (error) throw new Error(error.message);
  const payslip = payslips?.[0];
  if (!payslip) throw new Error("找不到可產出的薪資單。");

  const { data: items, error: itemError } = await client
    .from("payroll_items")
    .select("item_type, item_code, item_name, quantity, unit_amount, amount")
    .eq("payroll_payslip_id", payslip.id)
    .is("deleted_at", null)
    .order("item_type", { ascending: true })
    .limit<PayrollItemRow>(200);
  if (itemError) throw new Error(itemError.message);

  return {
    title: `電子薪資單-${payslip.payroll_month}`,
    columns: ["section", "item_name", "quantity", "unit_amount", "amount"],
    rows: [
      { section: "summary", item_name: "應發總額", quantity: "", unit_amount: "", amount: payslip.gross_pay_total },
      { section: "summary", item_name: "扣款總額", quantity: "", unit_amount: "", amount: payslip.deduction_total },
      { section: "summary", item_name: "實發金額", quantity: "", unit_amount: "", amount: payslip.net_pay_total },
      ...(items ?? []).map((item) => ({
        section: item.item_type,
        item_name: item.item_name,
        quantity: item.quantity ?? "",
        unit_amount: item.unit_amount ?? "",
        amount: item.amount,
      })),
    ],
  };
}

async function buildEmploymentCertificate(client: SupabaseFileClient, input: GenerateFileInput, user: ApiUserContext) {
  const employeeId = input.employeeId || user.employeeId;
  if (!employeeId) throw new Error("缺少員工 ID，無法產出在職證明。");
  const { data, error } = await client
    .from("employees")
    .select("id, employee_no, full_name, hire_date, email")
    .eq("id", employeeId)
    .is("deleted_at", null)
    .single<EmployeeRow>();
  if (error || !data) throw new Error(error?.message ?? "找不到員工資料。");

  return {
    title: `在職證明-${data.full_name}`,
    columns: ["field", "value"],
    rows: [
      { field: "員工編號", value: data.employee_no },
      { field: "姓名", value: data.full_name },
      { field: "到職日", value: data.hire_date ?? "" },
      { field: "Email", value: data.email ?? "" },
      { field: "產出日期", value: new Date().toISOString().slice(0, 10) },
    ],
  };
}

async function buildAssessmentPackage(client: SupabaseFileClient, input: GenerateFileInput, user: ApiUserContext) {
  const tables = ["employees", "licenses", "training_records", "attendance_records", "schedules"];
  const rows: Array<Record<string, string | number>> = [];
  for (const table of tables) {
    const { count } = await client.from(table).select("*", { count: "exact", head: true }).eq("company_id", user.companyId).is("deleted_at", null);
    rows.push({ export_type: table, record_count: count ?? 0, date_start: input.dateStart ?? "", date_end: input.dateEnd ?? "" });
  }
  return {
    title: "長照評鑑資料包",
    columns: ["export_type", "record_count", "date_start", "date_end"],
    rows,
  };
}

function renderContent(format: GeneratedFileFormat, artifact: { title: string; columns: string[]; rows: Array<Record<string, unknown>> }) {
  if (format === "json") {
    return JSON.stringify({ title: artifact.title, rows: artifact.rows, generatedAt: new Date().toISOString() }, null, 2);
  }
  if (format === "html" || format === "pdf_print") {
    return renderHtml(artifact, format === "pdf_print");
  }
  return renderCsv(artifact.columns, artifact.rows);
}

function renderCsv(columns: string[], rows: Array<Record<string, unknown>>) {
  return [columns, ...rows.map((row) => columns.map((column) => row[column] ?? ""))]
    .map((row) => row.map((cell) => csvCell(String(cell))).join(","))
    .join("\n");
}

function renderHtml(artifact: { title: string; columns: string[]; rows: Array<Record<string, unknown>> }, printReady: boolean) {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(artifact.title)}</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:32px;color:#172033;background:#fff}
    h1{font-size:22px;margin:0 0 6px}
    .meta{font-size:12px;color:#64748b;margin-bottom:18px}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th,td{border:1px solid #ead8c2;padding:8px;text-align:left;vertical-align:top}
    th{background:#fff7ed;color:#7c3f00}
    ${printReady ? "@media print{body{margin:18mm}.no-print{display:none}}" : ""}
  </style>
</head>
<body>
  <button class="no-print" onclick="window.print()" style="margin-bottom:16px;border:1px solid #ead8c2;background:#d97706;color:#fff;border-radius:8px;padding:8px 12px;font-weight:800">列印 / 另存 PDF</button>
  <h1>${escapeHtml(artifact.title)}</h1>
  <div class="meta">產出時間：${new Date().toLocaleString("zh-TW", { hour12: false })} · 筆數：${artifact.rows.length}</div>
  <table>
    <thead><tr>${artifact.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead>
    <tbody>
      ${artifact.rows.map((row) => `<tr>${artifact.columns.map((column) => `<td>${escapeHtml(String(row[column] ?? ""))}</td>`).join("")}</tr>`).join("")}
    </tbody>
  </table>
</body>
</html>`;
}

function buildFileName(input: GenerateFileInput, title: string) {
  const safeTitle = title.replace(/[^\p{L}\p{N}-]+/gu, "-").replace(/^-|-$/g, "");
  const extension = input.format === "pdf_print" ? "html" : input.format;
  return `${safeTitle || artifactLabels[input.artifactType]}-${new Date().toISOString().slice(0, 10)}.${extension}`;
}

async function createGeneratedFileRecord(
  client: SupabaseFileClient,
  input: {
    user: ApiUserContext;
    input: GenerateFileInput;
    deliveryMethod: FileDeliveryMethod;
    fileName: string;
    mimeType: string;
    fileSize: number;
    sha256: string;
    metadata: Record<string, unknown>;
  },
) {
  const { data, error } = await client.from("generated_file_exports").insert({
    company_id: input.user.companyId,
    employee_id: input.input.employeeId ?? (input.input.artifactType === "payslip" || input.input.artifactType === "employment_certificate" ? input.user.employeeId : null),
    requested_by: input.user.userId,
    artifact_type: input.input.artifactType,
    format: input.input.format,
    delivery_method: input.deliveryMethod,
    file_name: input.fileName,
    mime_type: input.mimeType,
    file_size: input.fileSize,
    content_sha256: input.sha256,
    recipient_email: input.input.recipientEmail ?? null,
    email_status: input.deliveryMethod === "email" ? "queued" : "not_required",
    status: "generated",
    filters: {
      payrollMonth: input.input.payrollMonth ?? null,
      dateStart: input.input.dateStart ?? null,
      dateEnd: input.input.dateEnd ?? null,
    },
    metadata: input.metadata,
  }).select("id").single<ExportRow>();
  if (error) throw new Error(error.message);
  return data;
}

async function sendGeneratedFileEmail(input: {
  to: string;
  subject: string;
  html: string;
  attachment: { filename: string; contentBase64: string };
  mimeType: string;
}): Promise<{ status: "sent" | "failed" | "config_missing"; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { status: "config_missing", error: "RESEND_API_KEY 尚未設定。" };

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || "歲悅長照 HRIS <no-reply@suiyuecare.com>",
      to: [input.to],
      reply_to: process.env.EMAIL_REPLY_TO ? [process.env.EMAIL_REPLY_TO] : undefined,
      subject: input.subject,
      html: input.html,
      attachments: [
        {
          filename: input.attachment.filename,
          content: input.attachment.contentBase64,
          content_type: input.mimeType,
        },
      ],
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    return { status: "failed", error: typeof payload?.message === "string" ? payload.message : `Resend HTTP ${response.status}` };
  }

  return { status: "sent" };
}

function buildEmailHtml(title: string, fileName: string) {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#172033">
    <h2>${escapeHtml(title)} 已產出</h2>
    <p>附件檔名：${escapeHtml(fileName)}</p>
    <p>此信由歲悅 HRIS 自動發送，檔案內容涉及個資或薪資時請妥善保存。</p>
  </div>`;
}

function csvCell(value: string) {
  return value.includes(",") || value.includes("\n") || value.includes('"') ? `"${value.replaceAll('"', '""')}"` : value;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function failure(input: GenerateFileInput, message: string): GeneratedFileResult {
  return {
    ok: false,
    generatedFileId: null,
    artifactType: input.artifactType,
    format: input.format,
    deliveryMethod: input.deliveryMethod ?? "download",
    fileName: "",
    mimeType: mimeTypes[input.format],
    contentBase64: null,
    fileSize: 0,
    sha256: "",
    emailStatus: "not_required",
    error: message,
  };
}
