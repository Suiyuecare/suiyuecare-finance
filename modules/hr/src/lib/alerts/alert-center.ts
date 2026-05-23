import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type SourceType =
  | "attendance"
  | "payroll"
  | "license"
  | "notification"
  | "background_job"
  | "security"
  | "file_generation";

export type AlertSeverity = "info" | "warning" | "critical" | "blocking";
export type AlertStatus = "open" | "acknowledged" | "in_progress" | "resolved" | "dismissed";

export type AlertCenterItem = {
  id: string;
  company_id: string | null;
  source_type: SourceType;
  source_table: string | null;
  source_id: string | null;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  description: string | null;
  action_label: string | null;
  action_href: string | null;
  detected_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  owner_user_id: string | null;
  metadata: Record<string, unknown>;
};

export type AlertCenterSummary = {
  totalOpen: number;
  blocking: number;
  critical: number;
  warning: number;
  bySource: Record<string, number>;
};

type QueryResult<T> = Promise<{ data: T[] | null; error: { message: string } | null }>;

type AlertCenterClient = {
  from: (table: string) => {
    select: (columns: string) => AlertQueryBuilder;
    upsert: (
      payload: Record<string, unknown>[],
      options: { onConflict: string; ignoreDuplicates?: boolean },
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    update: (payload: Record<string, unknown>) => {
      eq: (column: string, value: unknown) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
  };
};

type AlertQueryBuilder = {
  is: (column: string, value: unknown) => AlertQueryBuilder;
  in: (column: string, values: string[]) => AlertQueryBuilder;
  neq: (column: string, value: unknown) => AlertQueryBuilder;
  eq: (column: string, value: unknown) => AlertQueryBuilder;
  order: (column: string, options: { ascending: boolean }) => AlertQueryBuilder;
  limit: (count: number) => QueryResult<Record<string, unknown>>;
};

export type AlertCenterSyncResult = {
  ok: boolean;
  generated: number;
  sources: Record<string, number>;
  errors: string[];
};

export async function syncAlertCenter(): Promise<AlertCenterSyncResult> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return {
      ok: false,
      generated: 0,
      sources: {},
      errors: ["SUPABASE_SERVICE_ROLE_KEY 或 NEXT_PUBLIC_SUPABASE_URL 尚未設定，無法同步異常告警。"],
    };
  }

  const client = supabase as unknown as AlertCenterClient;
  const errors: string[] = [];
  const drafts = [
    ...(await collectAttendanceAlerts(client, errors)),
    ...(await collectPayrollAlerts(client, errors)),
    ...(await collectLicenseAlerts(client, errors)),
    ...(await collectEmailAlerts(client, errors)),
    ...(await collectBackgroundJobAlerts(client, errors)),
    ...(await collectGeneratedFileAlerts(client, errors)),
    ...(await collectSecurityAlerts(client, errors)),
  ];

  if (drafts.length) {
    const payload = drafts.map((draft) => ({
      ...draft,
      source_key: buildSourceKey(draft.company_id, draft.source_type, draft.source_table, draft.source_id),
      status: "open",
      source_id: draft.source_id,
      metadata: {
        ...draft.metadata,
        synced_at: new Date().toISOString(),
      },
    }));

    const { error } = await client
      .from("alert_center_items")
      .upsert(payload, { onConflict: "source_key" });
    if (error) errors.push(`alert_center_items upsert failed: ${error.message}`);
  }

  return {
    ok: errors.length === 0,
    generated: drafts.length,
    sources: drafts.reduce<Record<string, number>>((acc, item) => {
      acc[item.source_type] = (acc[item.source_type] ?? 0) + 1;
      return acc;
    }, {}),
    errors,
  };
}

export async function loadAlertCenterItems(input: {
  companyId?: string | null;
  role?: string;
  limit?: number;
}) {
  const supabase = getSupabaseAdminClient() ?? await getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase client is not configured.");

  const client = supabase as unknown as AlertCenterClient;
  const query = client
    .from("alert_center_items")
    .select("id, company_id, source_type, source_table, source_id, severity, status, title, description, action_label, action_href, detected_at, acknowledged_at, resolved_at, owner_user_id, metadata")
    .is("deleted_at", null);

  const { data, error } = input.role === "ceo" || !input.companyId
    ? await query.order("detected_at", { ascending: false }).limit(input.limit ?? 100)
    : await query.eq("company_id", input.companyId).is("deleted_at", null).order("detected_at", { ascending: false }).limit(input.limit ?? 100);

  if (error) throw new Error(error.message);
  const items = (data ?? []) as unknown as AlertCenterItem[];
  return {
    items,
    summary: summarizeAlerts(items),
  };
}

export async function updateAlertCenterStatus(input: {
  alertId: string;
  status: AlertStatus;
  userId?: string | null;
}) {
  const supabase = getSupabaseAdminClient() ?? await getSupabaseServerClient();
  if (!supabase) throw new Error("Supabase client is not configured.");

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: input.status,
    owner_user_id: input.userId ?? null,
  };
  if (input.status === "acknowledged" || input.status === "in_progress") patch.acknowledged_at = now;
  if (input.status === "resolved" || input.status === "dismissed") patch.resolved_at = now;

  const client = supabase as unknown as AlertCenterClient;
  const { error } = await client.from("alert_center_items").update(patch).eq("id", input.alertId);
  if (error) throw new Error(error.message);
}

function summarizeAlerts(items: AlertCenterItem[]): AlertCenterSummary {
  const active = items.filter((item) => !["resolved", "dismissed"].includes(item.status));
  return {
    totalOpen: active.length,
    blocking: active.filter((item) => item.severity === "blocking").length,
    critical: active.filter((item) => item.severity === "critical").length,
    warning: active.filter((item) => item.severity === "warning").length,
    bySource: active.reduce<Record<string, number>>((acc, item) => {
      acc[item.source_type] = (acc[item.source_type] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

async function collectAttendanceAlerts(client: AlertCenterClient, errors: string[]) {
  const { data, error } = await client
    .from("attendance_records")
    .select("id, company_id, employee_id, work_date, status, anomaly_code, note, updated_at")
    .is("deleted_at", null)
    .in("status", ["late", "early_leave", "absent", "missing_punch", "exception"])
    .order("updated_at", { ascending: false })
    .limit(80);
  if (error) {
    errors.push(`attendance_records: ${error.message}`);
    return [];
  }
  return (data ?? []).map((row) => ({
    company_id: getString(row.company_id),
    source_type: "attendance" as const,
    source_table: "attendance_records",
    source_id: getString(row.id) ?? crypto.randomUUID(),
    severity: row.status === "absent" || row.status === "missing_punch" ? "critical" as const : "warning" as const,
    title: `出勤異常：${formatText(row.status)}`,
    description: `日期 ${formatText(row.work_date)}，異常代碼 ${formatText(row.anomaly_code ?? row.status)}。${row.note ? `備註：${formatText(row.note)}` : ""}`,
    action_label: "處理出勤",
    action_href: "/attendance/anomalies",
    detected_at: getString(row.updated_at) ?? new Date().toISOString(),
    metadata: row,
  }));
}

async function collectPayrollAlerts(client: AlertCenterClient, errors: string[]) {
  const { data, error } = await client
    .from("payroll_blockers")
    .select("id, company_id, payroll_record_id, employee_id, blocker_type, severity, status, title, detail, updated_at")
    .is("deleted_at", null)
    .neq("status", "resolved")
    .order("updated_at", { ascending: false })
    .limit(80);
  if (error) {
    errors.push(`payroll_blockers: ${error.message}`);
    return [];
  }
  return (data ?? []).map((row) => ({
    company_id: getString(row.company_id),
    source_type: "payroll" as const,
    source_table: "payroll_blockers",
    source_id: getString(row.id) ?? crypto.randomUUID(),
    severity: row.severity === "block" ? "blocking" as const : "warning" as const,
    title: `薪資阻擋：${formatText(row.title)}`,
    description: formatText(row.detail ?? row.blocker_type),
    action_label: "看結薪阻擋",
    action_href: "/payroll/attendance-calculation",
    detected_at: getString(row.updated_at) ?? new Date().toISOString(),
    metadata: row,
  }));
}

async function collectLicenseAlerts(client: AlertCenterClient, errors: string[]) {
  const { data, error } = await client
    .from("licenses")
    .select("id, company_id, employee_id, license_name, license_type, expires_at, status, updated_at")
    .is("deleted_at", null)
    .in("status", ["expiring", "expired", "pending_review", "missing_attachment"])
    .order("updated_at", { ascending: false })
    .limit(80);
  if (error) {
    errors.push(`licenses: ${error.message}`);
    return [];
  }
  return (data ?? []).map((row) => ({
    company_id: getString(row.company_id),
    source_type: "license" as const,
    source_table: "licenses",
    source_id: getString(row.id) ?? crypto.randomUUID(),
    severity: row.status === "expired" || row.status === "missing_attachment" ? "critical" as const : "warning" as const,
    title: `證照提醒：${formatText(row.license_name ?? row.license_type)}`,
    description: `狀態 ${formatText(row.status)}，到期日 ${formatText(row.expires_at ?? "未設定")}。`,
    action_label: "補證照",
    action_href: "/licenses",
    detected_at: getString(row.updated_at) ?? new Date().toISOString(),
    metadata: row,
  }));
}

async function collectEmailAlerts(client: AlertCenterClient, errors: string[]) {
  const { data, error } = await client
    .from("notification_email_deliveries")
    .select("id, company_id, notification_id, subject, recipient_email, status, attempts, error_message, updated_at")
    .is("deleted_at", null)
    .in("status", ["failed", "config_missing"])
    .order("updated_at", { ascending: false })
    .limit(60);
  if (error) {
    errors.push(`notification_email_deliveries: ${error.message}`);
    return [];
  }
  return (data ?? []).map((row) => ({
    company_id: getString(row.company_id),
    source_type: "notification" as const,
    source_table: "notification_email_deliveries",
    source_id: getString(row.id) ?? crypto.randomUUID(),
    severity: row.status === "config_missing" ? "blocking" as const : "critical" as const,
    title: `Email 通知失敗：${formatText(row.subject)}`,
    description: `收件者 ${maskEmail(getString(row.recipient_email))}，嘗試 ${formatText(row.attempts)} 次。${row.error_message ? `原因：${formatText(row.error_message)}` : ""}`,
    action_label: "看通知",
    action_href: "/notifications",
    detected_at: getString(row.updated_at) ?? new Date().toISOString(),
    metadata: { ...row, recipient_email: maskEmail(getString(row.recipient_email)) },
  }));
}

async function collectBackgroundJobAlerts(client: AlertCenterClient, errors: string[]) {
  const { data, error } = await client
    .from("background_job_runs")
    .select("id, company_id, job_key, job_name, status, error_message, started_at, completed_at")
    .is("deleted_at", null)
    .in("status", ["failed", "blocked"])
    .order("started_at", { ascending: false })
    .limit(40);
  if (error) {
    errors.push(`background_job_runs: ${error.message}`);
    return [];
  }
  return (data ?? []).map((row) => ({
    company_id: getString(row.company_id),
    source_type: "background_job" as const,
    source_table: "background_job_runs",
    source_id: getString(row.id) ?? crypto.randomUUID(),
    severity: row.status === "blocked" ? "blocking" as const : "critical" as const,
    title: `背景排程異常：${formatText(row.job_name)}`,
    description: formatText(row.error_message ?? "排程未成功完成，請檢查環境變數、API 權限或服務狀態。"),
    action_label: "排程檢查",
    action_href: "/security",
    detected_at: getString(row.completed_at ?? row.started_at) ?? new Date().toISOString(),
    metadata: row,
  }));
}

async function collectGeneratedFileAlerts(client: AlertCenterClient, errors: string[]) {
  const { data, error } = await client
    .from("generated_file_exports")
    .select("id, company_id, artifact_type, format, delivery_method, file_name, status, email_status, error_message, updated_at")
    .is("deleted_at", null)
    .in("status", ["failed"])
    .order("updated_at", { ascending: false })
    .limit(40);
  if (error) {
    errors.push(`generated_file_exports: ${error.message}`);
    return [];
  }
  return (data ?? []).map((row) => ({
    company_id: getString(row.company_id),
    source_type: "file_generation" as const,
    source_table: "generated_file_exports",
    source_id: getString(row.id) ?? crypto.randomUUID(),
    severity: "warning" as const,
    title: `檔案產出失敗：${formatText(row.file_name)}`,
    description: formatText(row.error_message ?? `${formatText(row.artifact_type)} / ${formatText(row.format)} 產出失敗。`),
    action_label: "重新產出",
    action_href: "/analytics",
    detected_at: getString(row.updated_at) ?? new Date().toISOString(),
    metadata: row,
  }));
}

async function collectSecurityAlerts(client: AlertCenterClient, errors: string[]) {
  const { data, error } = await client
    .from("error_logs")
    .select("id, company_id, severity, source, message, route, created_at")
    .is("deleted_at", null)
    .in("severity", ["error", "critical"])
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) {
    errors.push(`error_logs: ${error.message}`);
    return [];
  }
  return (data ?? []).map((row) => ({
    company_id: getString(row.company_id),
    source_type: "security" as const,
    source_table: "error_logs",
    source_id: getString(row.id) ?? crypto.randomUUID(),
    severity: row.severity === "critical" ? "critical" as const : "warning" as const,
    title: `系統錯誤：${formatText(row.source)}`,
    description: `${formatText(row.message)}${row.route ? `（${formatText(row.route)}）` : ""}`,
    action_label: "資安中心",
    action_href: "/security",
    detected_at: getString(row.created_at) ?? new Date().toISOString(),
    metadata: row,
  }));
}

function getString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function formatText(value: unknown) {
  if (value === null || value === undefined || value === "") return "未提供";
  return String(value);
}

function maskEmail(email: string | null) {
  if (!email) return "未提供";
  const [name, domain] = email.split("@");
  if (!domain) return "已遮蔽";
  return `${name.slice(0, 2)}***@${domain}`;
}

function buildSourceKey(companyId: string | null, sourceType: string, sourceTable: string, sourceId: string) {
  return [companyId ?? "global", sourceType, sourceTable, sourceId].join(":");
}
