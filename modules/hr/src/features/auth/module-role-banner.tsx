"use client";

import { getRolePolicy } from "@/lib/auth/rbac";
import { useCurrentUser } from "@/lib/auth/use-current-user";

export function ModuleRoleBanner() {
  const currentUser = useCurrentUser();
  const policy = getRolePolicy(currentUser.role);

  return (
    <div className="mt-6 rounded-lg border border-[#ead8c2] bg-[#fffaf4] p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-xs font-bold tracking-[0.12em] text-slate-500">CURRENT ACCOUNT</div>
          <div className="mt-1 text-lg font-bold text-slate-800">
            {currentUser.name} · {currentUser.roleLabel}
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-500">{policy.description}</p>
        </div>
        <div className="rounded-md border border-[#dfc9b1] bg-white px-3 py-2 text-sm font-semibold text-slate-700">
          {currentUser.email || "Supabase Auth"}
        </div>
      </div>
    </div>
  );
}
