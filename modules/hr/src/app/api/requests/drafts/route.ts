import type { NextRequest } from "next/server";
import { jsonApiResponse, withApiPermission } from "@/lib/auth/api-guard";
import { writeAuditLog } from "@/lib/security/audit";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type DraftRequestBody = {
  request?: {
    id?: string;
    requestNo?: string;
    formId?: string;
    formTitle?: string;
    type?: string;
    date?: string;
    reason?: string;
    details?: Record<string, string>;
    currentStep?: string;
    currentOwnerRole?: string;
    attachmentNames?: string[];
    attachmentStatus?: string;
    integrationStatus?: string;
    integrationSummary?: Record<string, unknown>;
    revisionNo?: number;
    auditLogs?: string[];
    timeline?: unknown[];
  };
};

type UpsertClient = {
  from: (table: string) => {
    upsert: (payload: Record<string, unknown> | Record<string, unknown>[], options?: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
  };
};

export async function POST(request: NextRequest) {
  return withApiPermission(request, "request:create", async ({ user }) => {
    if (!user) return jsonApiResponse({ error: "Authentication required." }, { status: 401 });

    const body = await request.json().catch(() => null) as DraftRequestBody | null;
    const draft = body?.request;
    if (!draft?.id || !draft.type) {
      return jsonApiResponse({ error: "request.id and request.type are required." }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      return jsonApiResponse({ error: "SUPABASE_SERVICE_ROLE_KEY 或 NEXT_PUBLIC_SUPABASE_URL 尚未設定。" }, { status: 500 });
    }

    const now = new Date().toISOString();
    const requestNo = draft.requestNo ?? draft.id;
    const details = draft.details ?? {};
    const attachmentNames = draft.attachmentNames ?? [];
    const payload = {
      id: draft.id,
      no: requestNo,
      request_no: requestNo,
      form_id: draft.formId ?? null,
      form_title: draft.formTitle ?? draft.type,
      request_type: draft.type,
      applicant_id: user.userId,
      company_id: user.companyId,
      employee_id: user.employeeId,
      entity_id: "hr",
      department_code: details["部門"] ?? "",
      status: "草稿",
      current_step: "草稿",
      current_owner_role: "applicant",
      reason: draft.reason ?? "草稿未填原因",
      payload: { ...details, 申請日期: draft.date ?? "未指定" },
      files: attachmentNames,
      timeline: draft.timeline ?? [],
      audit_logs: draft.auditLogs ?? [`${new Date().toLocaleString("zh-TW", { hour12: false })} 儲存草稿`],
      attachment_status: draft.attachmentStatus ?? (attachmentNames.length > 0 ? "uploaded" : "not_required"),
      integration_status: draft.integrationStatus ?? "pending",
      integration_summary: draft.integrationSummary ?? { linkedModules: ["表單追蹤"], nextAction: "送出表單" },
      revision_no: draft.revisionNo ?? 1,
      return_reason: null,
      submitted_at: null,
      last_action_at: now,
      updated_at: now,
      deleted_at: null,
    };

    const { error } = await (supabase as unknown as UpsertClient)
      .from("hr_requests")
      .upsert(payload, { onConflict: "id" });

    if (error) return jsonApiResponse({ error: error.message }, { status: 500 });

    if (attachmentNames.length > 0) {
      await (supabase as unknown as UpsertClient).from("hr_request_attachments").upsert(
        attachmentNames.map((fileName) => ({
          request_id: draft.id,
          company_id: user.companyId,
          uploaded_by: user.userId,
          file_name: fileName,
          attachment_status: "uploaded",
          updated_at: now,
          deleted_at: null,
        })),
        { onConflict: "request_id,file_name" },
      );
    }

    await writeAuditLog(request, {
      companyId: user.companyId,
      actorUserId: user.userId,
      actorEmployeeId: user.employeeId,
      action: "hr_request.draft.save",
      resourceType: "hr_requests",
      resourceId: draft.id,
      afterData: payload,
    });

    return jsonApiResponse({ request: { id: draft.id, requestNo, status: "草稿" } });
  });
}
