"use client";

import type { ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { canAny, type Permission } from "@/lib/auth/rbac";
import { getPermissionMeta } from "@/lib/auth/rbac-visualization";
import { useCurrentUser } from "@/lib/auth/use-current-user";

type ActionGuardProps = {
  permissions: Permission[];
  children: ReactNode;
  mode?: "hide" | "disable";
  fallback?: ReactNode;
};

export function ActionGuard({ permissions, children, mode = "hide", fallback }: ActionGuardProps) {
  const currentUser = useCurrentUser();
  const allowed = canAny(currentUser.role, permissions);
  if (allowed) return <>{children}</>;
  if (mode === "hide") return <>{fallback ?? null}</>;

  const labels = permissions.map((permission) => getPermissionMeta(permission).label).join("、");
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <span>缺少權限：{labels}</span>
      </div>
    </div>
  );
}
