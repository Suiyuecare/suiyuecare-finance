import type { NextRequest } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseInsertClient = {
  from: (table: string) => {
    insert: (payload: Record<string, unknown>) => Promise<unknown>;
  };
};

type AuditLogInput = {
  companyId?: string | null;
  actorUserId?: string | null;
  actorEmployeeId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
  metadata?: Record<string, unknown>;
};

type ErrorLogInput = {
  companyId?: string | null;
  userId?: string | null;
  employeeId?: string | null;
  severity?: "debug" | "info" | "warning" | "error" | "critical";
  source?: "client" | "server" | "api" | "database" | "integration" | "cron";
  message: string;
  stackTrace?: string;
  metadata?: Record<string, unknown>;
};

type LoginLogInput = {
  companyId?: string | null;
  userId?: string | null;
  employeeId?: string | null;
  email?: string | null;
  authProvider?: string | null;
  success: boolean;
  failureReason?: string | null;
  sessionId?: string | null;
  metadata?: Record<string, unknown>;
};

export async function writeAuditLog(request: NextRequest, input: AuditLogInput) {
  const supabase = getSupabaseAdminClient() ?? await getSupabaseServerClient();
  if (!supabase) return;

  const queryClient = supabase as unknown as SupabaseInsertClient;
  await queryClient.from("audit_logs").insert({
    company_id: input.companyId ?? null,
    actor_user_id: input.actorUserId ?? null,
    actor_employee_id: input.actorEmployeeId ?? null,
    action: input.action,
    resource_type: input.resourceType,
    resource_id: input.resourceId ?? null,
    request_id: request.headers.get("x-request-id"),
    ip_address: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    user_agent: request.headers.get("user-agent"),
    before_data: input.beforeData ?? null,
    after_data: input.afterData ?? null,
    metadata: input.metadata ?? {},
  });
}

export async function writeErrorLog(request: NextRequest, input: ErrorLogInput) {
  const supabase = getSupabaseAdminClient() ?? await getSupabaseServerClient();
  if (!supabase) return;

  const queryClient = supabase as unknown as SupabaseInsertClient;
  await queryClient.from("error_logs").insert({
    company_id: input.companyId ?? null,
    user_id: input.userId ?? null,
    employee_id: input.employeeId ?? null,
    severity: input.severity ?? "error",
    source: input.source ?? "api",
    message: input.message,
    stack_trace: input.stackTrace ?? null,
    request_id: request.headers.get("x-request-id"),
    route: request.nextUrl.pathname,
    ip_address: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    user_agent: request.headers.get("user-agent"),
    metadata: input.metadata ?? {},
  });
}

export async function writeLoginLog(request: NextRequest, input: LoginLogInput) {
  const supabase = getSupabaseAdminClient() ?? await getSupabaseServerClient();
  if (!supabase) return;

  const queryClient = supabase as unknown as SupabaseInsertClient;
  await queryClient.from("login_logs").insert({
    company_id: input.companyId ?? null,
    user_id: input.userId ?? null,
    employee_id: input.employeeId ?? null,
    email: input.email ?? null,
    ip_address: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    user_agent: request.headers.get("user-agent"),
    auth_provider: input.authProvider ?? null,
    success: input.success,
    failure_reason: input.failureReason ?? null,
    session_id: input.sessionId ?? null,
    metadata: input.metadata ?? {},
  });
}
