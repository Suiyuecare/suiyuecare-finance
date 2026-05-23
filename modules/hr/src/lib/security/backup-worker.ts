import { getSupabaseAdminClient } from "@/lib/supabase/admin";

type BackupRunStatus = "completed" | "failed" | "blocked";
type BackupHealthStatus = "healthy" | "warning" | "blocked" | "failed" | "unknown";

type CompanyRow = {
  id: string;
  name: string | null;
};

type RunRow = {
  id: string;
  company_id: string;
};

type BackupCandidate = {
  id?: string;
  name?: string;
  status?: string;
  type?: string;
  created_at?: string;
  inserted_at?: string;
  completed_at?: string;
  finished_at?: string;
  size?: number;
  size_bytes?: number;
  [key: string]: unknown;
};

type SupabaseBackupResponse =
  | BackupCandidate[]
  | {
      data?: BackupCandidate[];
      backups?: BackupCandidate[];
      database_backups?: BackupCandidate[];
      [key: string]: unknown;
    };

type BackupEvidence = {
  ok: boolean;
  configMissing?: boolean;
  backups: BackupCandidate[];
  latestBackup: BackupCandidate | null;
  latestBackupAt: string | null;
  error: string | null;
};

type BackupRunUpdate = {
  status: BackupRunStatus;
  backup_completed_at?: string;
  latest_backup_at?: string | null;
  health_status: BackupHealthStatus;
  checked_at: string;
  next_check_at: string;
  backup_reference?: string | null;
  backup_kind?: string | null;
  storage_location?: string | null;
  evidence_url?: string | null;
  notes: string;
  metadata: Record<string, unknown>;
};

type SupabaseWriteClient = {
  from: (table: string) => {
    select: (columns: string, options?: Record<string, unknown>) => {
      is?: (column: string, value: unknown) => {
        order?: (column: string, options?: Record<string, unknown>) => Promise<{ data: CompanyRow[] | null; error: { message: string } | null }>;
      };
    };
    insert: (payload: Record<string, unknown>) => {
      select: (columns: string) => {
        single: () => Promise<{ data: RunRow | null; error: { message: string } | null }>;
      };
    };
    update: (payload: Record<string, unknown>) => {
      eq: (column: string, value: unknown) => Promise<{ error: { message: string } | null }>;
    };
  };
};

type SupabaseCountClient = {
  from: (table: string) => {
    select: (columns: string, options: { count: "exact"; head: true }) => Promise<{ count: number | null; error: { message: string } | null }>;
  };
};

export type BackupWorkerResult = {
  ok: boolean;
  configMissing?: boolean;
  checkedAt: string;
  projectRef: string | null;
  latestBackupAt: string | null;
  availableBackups: number;
  companies: number;
  completed: number;
  blocked: number;
  failed: number;
  errors: string[];
};

const criticalTables = [
  "companies",
  "users",
  "employees",
  "attendance_records",
  "leave_requests",
  "overtime_requests",
  "punch_correction_requests",
  "payroll_records",
  "payroll_items",
  "payroll_payslips",
  "approval_flows",
  "approval_steps",
  "documents",
  "licenses",
  "training_records",
  "audit_logs",
  "notifications",
];

export async function processBackupAutomation(): Promise<BackupWorkerResult> {
  const checkedAt = new Date();
  const nextCheckAt = addHours(checkedAt, 24);
  const supabase = getSupabaseAdminClient();
  const projectRef = process.env.SUPABASE_PROJECT_REF ?? parseProjectRef(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  const errors: string[] = [];

  if (!supabase) {
    return {
      ok: false,
      configMissing: true,
      checkedAt: checkedAt.toISOString(),
      projectRef,
      latestBackupAt: null,
      availableBackups: 0,
      companies: 0,
      completed: 0,
      blocked: 0,
      failed: 0,
      errors: ["SUPABASE_SERVICE_ROLE_KEY 或 NEXT_PUBLIC_SUPABASE_URL 尚未設定，無法寫入備份紀錄。"],
    };
  }

  const queryClient = supabase as unknown as SupabaseWriteClient;
  const companiesResult = await queryClient
    .from("companies")
    .select("id, name")
    .is?.("deleted_at", null)
    .order?.("created_at", { ascending: true });

  if (!companiesResult || companiesResult.error) {
    return {
      ok: false,
      checkedAt: checkedAt.toISOString(),
      projectRef,
      latestBackupAt: null,
      availableBackups: 0,
      companies: 0,
      completed: 0,
      blocked: 0,
      failed: 1,
      errors: [companiesResult?.error?.message ?? "無法讀取 companies。"],
    };
  }

  const companies = companiesResult.data ?? [];
  const tableSnapshot = await collectCriticalTableSnapshot(supabase as unknown as SupabaseCountClient);
  const backupEvidence: BackupEvidence = accessToken && projectRef
    ? await fetchSupabaseBackups({ accessToken, projectRef })
    : {
        ok: false,
        configMissing: true,
        backups: [],
        latestBackup: null,
        latestBackupAt: null,
        error: "SUPABASE_ACCESS_TOKEN 或 SUPABASE_PROJECT_REF 尚未設定，無法檢查 Supabase managed backups。",
      };

  if (!backupEvidence.ok && backupEvidence.error) {
    errors.push(backupEvidence.error);
  }

  const latestBackupAt = backupEvidence.latestBackupAt;
  const latestBackupAgeMinutes = latestBackupAt ? minutesBetween(new Date(latestBackupAt), checkedAt) : null;
  const health = evaluateHealth({
    configMissing: Boolean(backupEvidence.configMissing),
    latestBackupAgeMinutes,
    error: backupEvidence.error,
  });

  let completed = 0;
  let blocked = 0;
  let failed = 0;

  for (const company of companies) {
    const run = await createRun(queryClient, company, checkedAt);
    if (!run) {
      failed += 1;
      errors.push(`公司 ${company.name ?? company.id} 無法建立 backup_restore_runs。`);
      continue;
    }

    const status: BackupRunStatus = health.status === "healthy" || health.status === "warning" ? "completed" : health.status === "blocked" ? "blocked" : "failed";
    if (status === "completed") completed += 1;
    if (status === "blocked") blocked += 1;
    if (status === "failed") failed += 1;

    const latestBackup = backupEvidence.latestBackup;
    await updateRun(queryClient, run.id, {
      status,
      backup_completed_at: status === "completed" ? checkedAt.toISOString() : undefined,
      latest_backup_at: latestBackupAt,
      health_status: health.status,
      checked_at: checkedAt.toISOString(),
      next_check_at: nextCheckAt.toISOString(),
      backup_reference: getBackupReference(latestBackup),
      backup_kind: getBackupKind(latestBackup),
      storage_location: "Supabase Database Backups",
      evidence_url: projectRef ? `https://supabase.com/dashboard/project/${projectRef}/database/backups` : null,
      notes: health.notes,
      metadata: {
        source: "backup_automation_worker",
        provider: "Supabase managed backups",
        projectRef,
        availableBackups: backupEvidence.backups.length,
        latestBackup,
        latestBackupAgeMinutes,
        tableSnapshot,
        managementApi: {
          checked: Boolean(accessToken && projectRef),
          configMissing: Boolean(backupEvidence.configMissing),
          error: backupEvidence.error ?? null,
        },
      },
    });
  }

  return {
    ok: failed === 0,
    configMissing: Boolean(backupEvidence.configMissing),
    checkedAt: checkedAt.toISOString(),
    projectRef,
    latestBackupAt,
    availableBackups: backupEvidence.backups.length,
    companies: companies.length,
    completed,
    blocked,
    failed,
    errors,
  };
}

async function createRun(queryClient: SupabaseWriteClient, company: CompanyRow, checkedAt: Date) {
  const { data, error } = await queryClient
    .from("backup_restore_runs")
    .insert({
      company_id: company.id,
      run_type: "scheduled_backup",
      scope: "full_system",
      status: "running",
      backup_started_at: checkedAt.toISOString(),
      rpo_minutes: 1440,
      rto_minutes: 240,
      retention_days: Number(process.env.BACKUP_RETENTION_DAYS ?? 30),
      backup_provider: "Supabase managed backups",
      checked_at: checkedAt.toISOString(),
      metadata: {
        source: "backup_automation_worker",
        companyName: company.name,
      },
    })
    .select("id, company_id")
    .single();

  if (error || !data) return null;
  return data;
}

async function updateRun(queryClient: SupabaseWriteClient, id: string, payload: BackupRunUpdate) {
  const { error } = await queryClient.from("backup_restore_runs").update(payload).eq("id", id);
  if (error) throw new Error(error.message);
}

async function collectCriticalTableSnapshot(supabase: SupabaseCountClient) {
  const snapshot: Record<string, { count: number | null; ok: boolean; error?: string }> = {};

  for (const table of criticalTables) {
    const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
    snapshot[table] = error ? { count: null, ok: false, error: error.message } : { count: count ?? 0, ok: true };
  }

  return snapshot;
}

async function fetchSupabaseBackups({ accessToken, projectRef }: { accessToken: string; projectRef: string }) {
  try {
    const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/backups`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => null)) as SupabaseBackupResponse | null;
    if (!response.ok) {
      return {
        ok: false,
        backups: [],
        latestBackup: null,
        latestBackupAt: null,
        error: `Supabase Management API 備份查詢失敗：HTTP ${response.status}`,
      };
    }

    const backups = normalizeBackups(payload);
    const sorted = [...backups].sort((a, b) => getBackupTimeMs(b) - getBackupTimeMs(a));
    const latestBackup = sorted[0] ?? null;
    return {
      ok: true,
      backups: sorted,
      latestBackup,
      latestBackupAt: latestBackup ? getBackupTime(latestBackup) : null,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      backups: [],
      latestBackup: null,
      latestBackupAt: null,
      error: error instanceof Error ? error.message : "Supabase Management API 備份查詢發生未知錯誤。",
    };
  }
}

function normalizeBackups(payload: SupabaseBackupResponse | null): BackupCandidate[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.backups)) return payload.backups;
  if (Array.isArray(payload.database_backups)) return payload.database_backups;
  return [];
}

function evaluateHealth(input: { configMissing: boolean; latestBackupAgeMinutes: number | null; error?: string | null }): { status: BackupHealthStatus; notes: string } {
  if (input.configMissing) {
    return {
      status: "blocked",
      notes: "備份自動化尚未設定 Supabase Management API 金鑰，無法驗證正式備份。",
    };
  }

  if (input.error) {
    return {
      status: "failed",
      notes: `備份自動化查詢失敗：${input.error}`,
    };
  }

  if (input.latestBackupAgeMinutes === null) {
    return {
      status: "unknown",
      notes: "Supabase Management API 未回傳可用備份，需到 Dashboard 複核。",
    };
  }

  if (input.latestBackupAgeMinutes <= 1440) {
    return {
      status: "healthy",
      notes: "已確認 24 小時內有 Supabase managed backup，可作為每日備份證據。",
    };
  }

  if (input.latestBackupAgeMinutes <= 2880) {
    return {
      status: "warning",
      notes: "最近一次備份超過 24 小時但未超過 48 小時，需追蹤 RPO。",
    };
  }

  return {
    status: "failed",
    notes: "最近一次備份超過 48 小時，已低於正式上線備份要求。",
  };
}

function parseProjectRef(url?: string) {
  if (!url) return null;
  try {
    return new URL(url).hostname.split(".")[0] || null;
  } catch {
    return null;
  }
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function minutesBetween(start: Date, end: Date) {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

function getBackupTime(backup: BackupCandidate) {
  return backup.completed_at ?? backup.finished_at ?? backup.created_at ?? backup.inserted_at ?? null;
}

function getBackupTimeMs(backup: BackupCandidate) {
  const value = getBackupTime(backup);
  return value ? new Date(value).getTime() : 0;
}

function getBackupReference(backup: BackupCandidate | null) {
  if (!backup) return null;
  return backup.id ?? backup.name ?? null;
}

function getBackupKind(backup: BackupCandidate | null) {
  if (!backup) return null;
  return backup.type ?? backup.status ?? null;
}
