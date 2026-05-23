import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export type SupabaseQueryClient = {
  // The generated Database type is behind the live schema while we harden P1.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

export function getLiveClient() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase 尚未設定，無法讀寫正式資料。");
  return supabase as unknown as SupabaseQueryClient;
}

export async function getCurrentAppUser() {
  const supabase = getLiveClient();
  const { data: authData, error: authError } = await (getSupabaseBrowserClient())!.auth.getUser();
  if (authError) throw authError;
  if (!authData.user) throw new Error("尚未登入 Supabase，無法執行此操作。");

  const { data, error } = await supabase
    .from("users")
    .select("id, company_id, employee_id, display_name")
    .eq("auth_user_id", authData.user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("找不到目前登入者的 public.users 對應資料。");
  return data as { id: string; company_id: string | null; employee_id: string | null; display_name: string };
}

export async function getDefaultCompanyId() {
  const supabase = getLiveClient();
  const { data, error } = await supabase
    .from("companies")
    .select("id")
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error("找不到公司主檔，請先建立 companies 資料。");
  return data.id as string;
}

export async function getDefaultEmployee() {
  const supabase = getLiveClient();
  const { data, error } = await supabase
    .from("employees")
    .select("id, company_id, primary_branch_id, primary_department_id, full_name, employee_no")
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error("找不到員工主檔，請先建立 employees 資料。");
  return data as {
    id: string;
    company_id: string;
    primary_branch_id: string | null;
    primary_department_id: string | null;
    full_name: string;
    employee_no: string;
  };
}

export async function writeAuditLog(input: {
  action: string;
  resourceType: string;
  resourceId?: string;
  afterData?: unknown;
}) {
  try {
    const supabase = getLiveClient();
    const user = await getCurrentAppUser();
    await supabase.from("audit_logs").insert({
      company_id: user.company_id,
      actor_user_id: user.id,
      action: input.action,
      resource_type: input.resourceType,
      resource_id: input.resourceId ?? null,
      after_data: input.afterData ?? null,
      metadata: { source: "hris-p1" },
    });
  } catch {
    // Audit logging should not block the user-facing operation.
  }
}
