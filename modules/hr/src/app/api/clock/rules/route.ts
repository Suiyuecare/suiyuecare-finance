import type { NextRequest } from "next/server";
import { jsonApiResponse, withApiPermission } from "@/lib/auth/api-guard";
import {
  defaultClockRuleSettings,
  normalizeClockRuleSettings,
} from "@/lib/attendance/clock-rule-settings";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SystemSettingsClient = {
  from: (table: "system_settings") => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        eq: (column: string, value: string) => {
          is: (column: string, value: null) => {
            maybeSingle: () => Promise<{
              data: { settings: unknown; status: string | null; updated_at: string | null } | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
    };
  };
};

export async function GET(request: NextRequest) {
  return withApiPermission(request, "attendance:self:punch", async ({ user }) => {
    if (!user) return jsonApiResponse({ error: "Authentication required." }, { status: 401 });
    const supabase = await getSupabaseServerClient();
    if (!supabase) return jsonApiResponse({ settings: defaultClockRuleSettings, source: "default" });

    const { data, error } = await (supabase as unknown as SystemSettingsClient)
      .from("system_settings")
      .select("settings,status,updated_at")
      .eq("company_id", user.companyId ?? "")
      .eq("setting_key", "punch_rules")
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      return jsonApiResponse({ settings: defaultClockRuleSettings, source: "default", warning: error.message });
    }

    return jsonApiResponse({
      settings: normalizeClockRuleSettings(data?.settings),
      source: data ? "system_settings" : "default",
      status: data?.status ?? "default",
      updatedAt: data?.updated_at ?? null,
    });
  });
}
