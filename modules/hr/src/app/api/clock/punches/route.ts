import type { NextRequest } from "next/server";
import { jsonApiResponse, withApiPermission } from "@/lib/auth/api-guard";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/security/audit";

export const dynamic = "force-dynamic";

type PunchBody = {
  punchType?: string;
  latitude?: number | null;
  longitude?: number | null;
  address?: string;
  deviceInfo?: string;
  wifiSsid?: string;
  ipAddress?: string;
  isAbnormal?: boolean;
  abnormalReason?: string;
  ruleName?: string;
  passedRule?: string;
  distanceMeters?: number | null;
  reviewStatus?: string;
};

type ReviewBody = {
  punchId?: string;
  reviewStatus?: "approved" | "rejected";
};

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: Record<string, unknown> | Record<string, unknown>[] | null; error: { message: string } | null }>;
};

export async function GET(request: NextRequest) {
  return withApiPermission(request, "attendance:view", async ({ user }) => {
    if (!user) return jsonApiResponse({ error: "Authentication required." }, { status: 401 });
    const supabase = await getSupabaseServerClient();
    if (!supabase) return jsonApiResponse({ error: "Supabase 尚未設定。" }, { status: 500 });

    const { data, error } = await (supabase as unknown as RpcClient).rpc("hris_list_attendance_punches", {
      input_user_id: user.userId,
      input_email: user.email,
      input_role: user.role,
      input_limit: Number(request.nextUrl.searchParams.get("limit") ?? 200),
    });

    if (error) return jsonApiResponse({ error: error.message }, { status: 500 });
    return jsonApiResponse({ punches: data ?? [] });
  });
}

export async function POST(request: NextRequest) {
  return withApiPermission(request, "attendance:self:punch", async ({ user }) => {
    if (!user) return jsonApiResponse({ error: "Authentication required." }, { status: 401 });
    const supabase = await getSupabaseServerClient();
    if (!supabase) return jsonApiResponse({ error: "Supabase 尚未設定。" }, { status: 500 });

    const body = await request.json().catch(() => null) as PunchBody | null;
    if (!body?.punchType) return jsonApiResponse({ error: "punchType is required." }, { status: 400 });

    const { data, error } = await (supabase as unknown as RpcClient).rpc("hris_create_attendance_punch", {
      input_user_id: user.userId,
      input_email: user.email,
      input_punch_type: body.punchType,
      input_latitude: body.latitude ?? null,
      input_longitude: body.longitude ?? null,
      input_address: body.address ?? "",
      input_device_info: body.deviceInfo ?? "",
      input_wifi_ssid: body.wifiSsid ?? "",
      input_ip_address: body.ipAddress ?? "",
      input_is_abnormal: body.isAbnormal ?? false,
      input_abnormal_reason: body.abnormalReason ?? "",
      input_rule_name: body.ruleName ?? "",
      input_passed_rule: body.passedRule ?? "",
      input_distance_meters: body.distanceMeters ?? null,
      input_review_status: body.reviewStatus ?? "none",
    });

    if (error) return jsonApiResponse({ error: error.message }, { status: 500 });

    await writeAuditLog(request, {
      companyId: user.companyId,
      actorUserId: user.userId,
      actorEmployeeId: user.employeeId,
      action: "attendance.punch.create",
      resourceType: "attendance_punches",
      resourceId: typeof data === "object" && !Array.isArray(data) ? String(data?.id ?? "") : null,
      afterData: { punchType: body.punchType, isAbnormal: body.isAbnormal },
    });

    return jsonApiResponse({ punch: data });
  });
}

export async function PATCH(request: NextRequest) {
  return withApiPermission(request, "attendance:abnormal:review", async ({ user }) => {
    if (!user) return jsonApiResponse({ error: "Authentication required." }, { status: 401 });
    const supabase = await getSupabaseServerClient();
    if (!supabase) return jsonApiResponse({ error: "Supabase 尚未設定。" }, { status: 500 });

    const body = await request.json().catch(() => null) as ReviewBody | null;
    if (!body?.punchId || !body.reviewStatus) {
      return jsonApiResponse({ error: "punchId and reviewStatus are required." }, { status: 400 });
    }

    const { data, error } = await (supabase as unknown as RpcClient).rpc("hris_review_attendance_punch", {
      input_user_id: user.userId,
      input_email: user.email,
      input_role: user.role,
      input_punch_id: body.punchId,
      input_review_status: body.reviewStatus,
    });

    if (error) return jsonApiResponse({ error: error.message }, { status: 500 });

    await writeAuditLog(request, {
      companyId: user.companyId,
      actorUserId: user.userId,
      actorEmployeeId: user.employeeId,
      action: "attendance.punch.review",
      resourceType: "attendance_punches",
      resourceId: body.punchId,
      afterData: { reviewStatus: body.reviewStatus },
    });

    return jsonApiResponse({ punch: data });
  });
}
