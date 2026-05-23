import type { NextRequest } from "next/server";
import { jsonApiResponse, withApiPermission } from "@/lib/auth/api-guard";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type LeaveRulesPayload = {
  settings: unknown;
  status?: string;
};

type SystemSettingsRow = {
  settings: unknown;
  status: string | null;
  updated_at: string | null;
};

function requireAdminClient() {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY 或 NEXT_PUBLIC_SUPABASE_URL 尚未設定，無法由後端讀寫假別規則。");
  }
  return supabase;
}

type LooseSupabaseClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => {
        eq: (column: string, value: unknown) => {
          is: (column: string, value: unknown) => {
            maybeSingle: () => Promise<{ data: SystemSettingsRow | null; error: { message: string } | null }>;
          };
        };
      };
    };
    upsert: (values: Record<string, unknown>, options?: Record<string, unknown>) => {
      select: (columns: string) => {
        single: () => Promise<{ data: SystemSettingsRow; error: { message: string } | null }>;
      };
    };
  };
};

export async function GET(request: NextRequest) {
  return withApiPermission(request, "attendance:manage", async ({ user }) => {
    if (!user?.companyId) return jsonApiResponse({ error: "找不到公司權限。" }, { status: 403 });
    const supabase = requireAdminClient() as unknown as LooseSupabaseClient;
    const { data, error } = await supabase
      .from("system_settings")
      .select("settings,status,updated_at")
      .eq("company_id", user.companyId)
      .eq("setting_key", "leave_type_rules")
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw error;
    return jsonApiResponse({
      settings: data?.settings ?? null,
      status: data?.status ?? "default",
      updatedAt: data?.updated_at ?? null,
    });
  });
}

export async function PUT(request: NextRequest) {
  return withApiPermission(request, "attendance:manage", async ({ user }) => {
    if (!user?.companyId) return jsonApiResponse({ error: "找不到公司權限。" }, { status: 403 });
    const payload = (await request.json()) as LeaveRulesPayload;
    if (!payload.settings || typeof payload.settings !== "object") {
      return jsonApiResponse({ error: "假別規則格式不正確。" }, { status: 400 });
    }
    const supabase = requireAdminClient() as unknown as LooseSupabaseClient;
    const { data, error } = await supabase
      .from("system_settings")
      .upsert({
        company_id: user.companyId,
        setting_key: "leave_type_rules",
        category: "leave_rules",
        display_name: "假別管理規則",
        description: "假別支薪、扣全勤、單日最少申請分鐘、單日最多申請時數、年度額度與附件要求。",
        settings: payload.settings,
        status: payload.status ?? "active",
        updated_by: user.userId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "company_id,setting_key" })
      .select("settings,status,updated_at")
      .single();
    if (error) throw error;
    return jsonApiResponse({ settings: data.settings, status: data.status, updatedAt: data.updated_at });
  });
}
