import { NextResponse, type NextRequest } from "next/server";
import { requireApiPermission, type ApiUserContext } from "@/lib/auth/server-guard";
import type { Permission } from "@/lib/auth/rbac";
import { writeErrorLog } from "@/lib/security/audit";

export type ApiSource = "authenticated" | "cron";

export type ApiHandlerContext = {
  source: ApiSource;
  user: ApiUserContext | null;
};

export function jsonApiResponse(payload: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return NextResponse.json(payload, { ...init, headers });
}

export function isCronAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function requireCronRequest(request: NextRequest) {
  if (isCronAuthorized(request)) {
    return { ok: true as const };
  }

  await writeErrorLog(request, {
    severity: "warning",
    source: "api",
    message: "Unauthorized cron API request.",
    metadata: {
      route: request.nextUrl.pathname,
      method: request.method,
      hasAuthorizationHeader: Boolean(request.headers.get("authorization")),
    },
  });

  return {
    ok: false as const,
    response: jsonApiResponse({ error: "Unauthorized cron request." }, { status: 401 }),
  };
}

export async function withApiPermission(
  request: NextRequest,
  permission: Permission,
  handler: (context: ApiHandlerContext) => Promise<NextResponse>,
) {
  const guard = await requireApiPermission(request, permission);
  if (!guard.ok) return withNoStore(guard.response);

  try {
    return withNoStore(await handler({ source: "authenticated", user: guard.user }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "API request failed.";
    await writeErrorLog(request, {
      companyId: guard.user.companyId,
      userId: guard.user.userId,
      employeeId: guard.user.employeeId,
      severity: "error",
      source: "api",
      message,
      metadata: {
        route: request.nextUrl.pathname,
        method: request.method,
        permission,
      },
    });
    return jsonApiResponse({ error: message }, { status: 500 });
  }
}

export async function withCronOrApiPermission(
  request: NextRequest,
  permission: Permission,
  handler: (context: ApiHandlerContext) => Promise<NextResponse>,
) {
  if (isCronAuthorized(request)) {
    try {
      return withNoStore(await handler({ source: "cron", user: null }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cron API request failed.";
      await writeErrorLog(request, {
        severity: "error",
        source: "cron",
        message,
        metadata: {
          route: request.nextUrl.pathname,
          method: request.method,
          permission,
        },
      });
      return jsonApiResponse({ error: message }, { status: 500 });
    }
  }

  return withApiPermission(request, permission, handler);
}

export function withNoStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
