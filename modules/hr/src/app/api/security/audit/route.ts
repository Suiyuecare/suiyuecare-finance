import type { NextRequest } from "next/server";
import { jsonApiResponse, withApiPermission } from "@/lib/auth/api-guard";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAuditLog, writeErrorLog } from "@/lib/security/audit";

type AuditQueryClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => {
        is: (column: string, value: unknown) => {
          order: (
            column: string,
            options: { ascending: boolean },
          ) => {
            limit: (count: number) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
          };
        };
      };
    };
  };
};

export async function GET(request: NextRequest) {
  return withApiPermission(request, "system:audit:view", async ({ user }) => {
    if (!user) {
      return jsonApiResponse({ error: "Authentication required." }, { status: 401 });
    }

    const supabase = await getSupabaseServerClient();
    if (!supabase) {
      return jsonApiResponse({ error: "Supabase environment is not configured." }, { status: 500 });
    }

    const queryClient = supabase as unknown as AuditQueryClient;
    const { data, error } = await queryClient
      .from("audit_logs")
      .select("id, action, resource_type, resource_id, actor_user_id, created_at, metadata")
      .eq("company_id", user.companyId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      await writeErrorLog(request, {
        companyId: user.companyId,
        userId: user.userId,
        employeeId: user.employeeId,
        message: error.message,
        metadata: { endpoint: "/api/security/audit" },
      });
      return jsonApiResponse({ error: "Unable to load audit logs." }, { status: 500 });
    }

    await writeAuditLog(request, {
      companyId: user.companyId,
      actorUserId: user.userId,
      actorEmployeeId: user.employeeId,
      action: "security.audit_logs.view",
      resourceType: "audit_logs",
      metadata: { count: data?.length ?? 0 },
    });

    return jsonApiResponse({ data });
  });
}
