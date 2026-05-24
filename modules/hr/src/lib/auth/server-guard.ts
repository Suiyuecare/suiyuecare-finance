import { NextResponse, type NextRequest } from "next/server";
import { can, toCanonicalRole, type HrRole, type Permission } from "@/lib/auth/rbac";
import { quickLoginCookieKey, supabaseAccountOptions } from "@/lib/auth/current-user";
import { writeErrorLog } from "@/lib/security/audit";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseQueryClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => {
        eq: (column: string, value: unknown) => {
          is: (column: string, value: unknown) => {
            single: () => Promise<{ data: HrUserRow | null; error: { message: string } | null }>;
          };
        };
      };
    };
  };
};

type HrUserRow = {
  id: string;
  employee_id: string | null;
  company_id: string | null;
  email: string;
  roles: unknown;
};

export type ApiUserContext = {
  authUserId: string;
  userId: string;
  employeeId: string | null;
  companyId: string | null;
  role: HrRole;
  email: string;
};

export type ApiGuardResult =
  | { ok: true; user: ApiUserContext }
  | { ok: false; response: NextResponse };

export async function requireApiPermission(
  request: NextRequest,
  permission: Permission,
): Promise<ApiGuardResult> {
  const quickLoginUser = getQuickLoginApiUser(request);
  if (quickLoginUser) {
    if (!can(quickLoginUser.role, permission)) {
      await writeApiDeniedLog(request, {
        permission,
        status: 403,
        reason: "Permission denied.",
        userId: quickLoginUser.userId,
        companyId: quickLoginUser.companyId,
        employeeId: quickLoginUser.employeeId,
        role: quickLoginUser.role,
      });
      return {
        ok: false,
        response: NextResponse.json({ error: "Permission denied." }, { status: 403 }),
      };
    }

    return { ok: true, user: quickLoginUser };
  }

  const supabase = await getSupabaseServerClient();

  if (!supabase) {
    await writeApiDeniedLog(request, {
      permission,
      status: 500,
      reason: "Supabase environment is not configured.",
    });
    return {
      ok: false,
      response: NextResponse.json({ error: "Supabase environment is not configured." }, { status: 500 }),
    };
  }

  const {
    data: { user: authUser },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !authUser) {
    await writeApiDeniedLog(request, {
      permission,
      status: 401,
      reason: authError?.message ?? "Authentication required.",
    });
    return {
      ok: false,
      response: NextResponse.json({ error: "Authentication required." }, { status: 401 }),
    };
  }

  const queryClient = supabase as unknown as SupabaseQueryClient;
  const { data, error } = await queryClient
    .from("users")
    .select("id, employee_id, company_id, email, roles!inner(key)")
    .eq("auth_user_id", authUser.id)
    .eq("status", "active")
    .is("deleted_at", null)
    .single();

  if (error || !data) {
    await writeApiDeniedLog(request, {
      permission,
      status: 403,
      reason: error?.message ?? "Active HRIS user profile was not found.",
      authUserId: authUser.id,
    });
    return {
      ok: false,
      response: NextResponse.json({ error: "Active HRIS user profile was not found." }, { status: 403 }),
    };
  }

  const role = normalizeRole(data.roles);
  if (!can(role, permission)) {
    await writeApiDeniedLog(request, {
      permission,
      status: 403,
      reason: "Permission denied.",
      authUserId: authUser.id,
      userId: data.id,
      companyId: data.company_id,
      employeeId: data.employee_id,
      role,
    });
    return {
      ok: false,
      response: NextResponse.json({ error: "Permission denied." }, { status: 403 }),
    };
  }

  return {
    ok: true,
    user: {
      authUserId: authUser.id,
      userId: data.id,
      employeeId: data.employee_id,
      companyId: data.company_id,
      role,
      email: data.email,
    },
  };
}

function getQuickLoginApiUser(request: NextRequest): ApiUserContext | null {
  const raw = request.cookies.get(quickLoginCookieKey)?.value;
  if (!raw) return null;

  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as { id?: string; email?: string };
    const matched = supabaseAccountOptions.find(
      (account) => account.email === parsed.email && (!parsed.id || account.id === parsed.id),
    ) ?? supabaseAccountOptions.find((account) => account.email === parsed.email);
    if (!matched) return null;

    return {
      authUserId: `quick-login:${matched.id}`,
      userId: matched.id,
      employeeId: matched.id,
      companyId: matched.companyId,
      role: matched.role,
      email: matched.email,
    };
  } catch {
    return null;
  }
}

async function writeApiDeniedLog(
  request: NextRequest,
  input: {
    permission: Permission;
    status: number;
    reason: string;
    authUserId?: string;
    userId?: string;
    companyId?: string | null;
    employeeId?: string | null;
    role?: HrRole;
  },
) {
  await writeErrorLog(request, {
    companyId: input.companyId ?? null,
    userId: input.userId ?? input.authUserId ?? null,
    employeeId: input.employeeId ?? null,
    severity: input.status >= 500 ? "error" : "warning",
    source: "api",
    message: `API permission denied: ${input.permission}`,
    metadata: {
      permission: input.permission,
      status: input.status,
      reason: input.reason,
      role: input.role ?? null,
      route: request.nextUrl.pathname,
      method: request.method,
    },
  });
}

function normalizeRole(role: unknown): HrRole {
  if (Array.isArray(role)) {
    return normalizeRole(role[0]);
  }

  if (role && typeof role === "object" && "key" in role) {
    return toCanonicalRole(String((role as { key: string }).key));
  }

  if (typeof role === "string") {
    return toCanonicalRole(role);
  }

  return "employee";
}
