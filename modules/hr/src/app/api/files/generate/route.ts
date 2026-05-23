import type { NextRequest } from "next/server";
import { jsonApiResponse, withApiPermission } from "@/lib/auth/api-guard";
import { generateFileOutput, type GenerateFileInput } from "@/lib/files/generation";
import { writeAuditLog, writeErrorLog } from "@/lib/security/audit";

export const dynamic = "force-dynamic";

type GenerateBody = Partial<GenerateFileInput>;

const allowedArtifactTypes = ["report_summary", "payroll_roster", "payslip", "employment_certificate", "assessment_package"];
const allowedFormats = ["csv", "json", "html", "pdf_print"];
const allowedDeliveryMethods = ["download", "email", "record"];

export async function POST(request: NextRequest) {
  return withApiPermission(request, "analytics:export", async ({ user }) => {
    if (!user) return jsonApiResponse({ error: "Authentication required." }, { status: 401 });

    const body = await request.json().catch(() => null) as GenerateBody | null;
    const validation = validateBody(body);
    if (!validation.ok) return jsonApiResponse({ error: validation.error }, { status: 400 });

    const result = await generateFileOutput(validation.input, user);

    if (!result.ok) {
      await writeErrorLog(request, {
        companyId: user.companyId,
        userId: user.userId,
        employeeId: user.employeeId,
        source: "api",
        severity: result.emailStatus === "config_missing" ? "warning" : "error",
        message: result.error ?? "File generation failed.",
        metadata: result,
      });
      return jsonApiResponse(result, { status: result.emailStatus === "config_missing" ? 503 : 500 });
    }

    await writeAuditLog(request, {
      companyId: user.companyId,
      actorUserId: user.userId,
      actorEmployeeId: user.employeeId,
      action: "file.generate",
      resourceType: "generated_file_exports",
      resourceId: result.generatedFileId,
      metadata: {
        artifactType: result.artifactType,
        format: result.format,
        deliveryMethod: result.deliveryMethod,
        fileName: result.fileName,
        fileSize: result.fileSize,
        sha256: result.sha256,
      },
    });

    return jsonApiResponse(result);
  });
}

function validateBody(body: GenerateBody | null): { ok: true; input: GenerateFileInput } | { ok: false; error: string } {
  if (!body) return { ok: false, error: "Request body is required." };
  if (!body.artifactType || !allowedArtifactTypes.includes(body.artifactType)) {
    return { ok: false, error: "artifactType 不合法。" };
  }
  if (!body.format || !allowedFormats.includes(body.format)) {
    return { ok: false, error: "format 不合法。" };
  }
  if (body.deliveryMethod && !allowedDeliveryMethods.includes(body.deliveryMethod)) {
    return { ok: false, error: "deliveryMethod 不合法。" };
  }
  if (body.deliveryMethod === "email" && !body.recipientEmail) {
    return { ok: false, error: "Email 產出需提供 recipientEmail。" };
  }

  return {
    ok: true,
    input: {
      artifactType: body.artifactType,
      format: body.format,
      deliveryMethod: body.deliveryMethod ?? "download",
      recipientEmail: body.recipientEmail,
      employeeId: body.employeeId,
      payrollMonth: body.payrollMonth,
      dateStart: body.dateStart,
      dateEnd: body.dateEnd,
    },
  };
}
