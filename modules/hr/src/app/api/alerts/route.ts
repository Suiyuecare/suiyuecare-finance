import type { NextRequest } from "next/server";
import { jsonApiResponse, withApiPermission } from "@/lib/auth/api-guard";
import { loadAlertCenterItems, updateAlertCenterStatus, type AlertStatus } from "@/lib/alerts/alert-center";
import { writeAuditLog } from "@/lib/security/audit";

export const dynamic = "force-dynamic";

const allowedStatuses: AlertStatus[] = ["open", "acknowledged", "in_progress", "resolved", "dismissed"];

export async function GET(request: NextRequest) {
  return withApiPermission(request, "compliance:view", async ({ user }) => {
    const result = await loadAlertCenterItems({
      companyId: user?.companyId,
      role: user?.role,
      limit: Number(request.nextUrl.searchParams.get("limit") ?? 120),
    });
    return jsonApiResponse(result);
  });
}

export async function POST(request: NextRequest) {
  return withApiPermission(request, "compliance:manage", async ({ user }) => {
    const body = await request.json().catch(() => null) as { alertId?: string; status?: AlertStatus } | null;
    if (!body?.alertId) return jsonApiResponse({ error: "alertId is required." }, { status: 400 });
    if (!body.status || !allowedStatuses.includes(body.status)) {
      return jsonApiResponse({ error: "status 不合法。" }, { status: 400 });
    }

    await updateAlertCenterStatus({
      alertId: body.alertId,
      status: body.status,
      userId: user?.userId,
    });

    await writeAuditLog(request, {
      companyId: user?.companyId,
      actorUserId: user?.userId,
      actorEmployeeId: user?.employeeId,
      action: "alert_center.status_update",
      resourceType: "alert_center_items",
      resourceId: body.alertId,
      afterData: { status: body.status },
    });

    return jsonApiResponse({ ok: true });
  });
}
