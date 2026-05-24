"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, KeyRound, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { canAny, getRolePolicy } from "@/lib/auth/rbac";
import { CENTRAL_AUTH_URL } from "@/lib/config/central-auth";
import { dataScopeMeta, getMissingPermissions } from "@/lib/auth/rbac-visualization";
import { getRoutePermissions } from "@/lib/auth/route-permissions";
import { useCurrentUser } from "@/lib/auth/use-current-user";

export function AccessGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const currentUser = useCurrentUser();
  const requiredPermissions = getRoutePermissions(pathname);
  const isAuthenticated = Boolean(currentUser.id);
  const allowed = canAny(currentUser.role, requiredPermissions);
  const currentPolicy = getRolePolicy(currentUser.role);
  const currentScope = dataScopeMeta[currentPolicy.dataScope];
  const missingPermissions = getMissingPermissions(currentUser.role, requiredPermissions);

  if (isAuthenticated && allowed) {
    return <>{children}</>;
  }

  if (!isAuthenticated) {
    return (
      <div className="mx-auto flex min-h-[calc(100vh-120px)] max-w-2xl items-center justify-center">
        <section className="w-full rounded-lg border border-[#f0c987] bg-white p-8 text-center shadow-[0_18px_50px_rgba(52,36,18,0.08)]">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#fff3de] text-[#b45309]">
            <ArrowLeft className="h-7 w-7" />
          </div>
          <h1 className="mt-5 text-2xl font-black text-slate-900">請由 Finance 統一入口進入</h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            人資系統不提供獨立登入口，請先回 Finance 選擇「人資系統」，系統會帶入同一組帳號與權限。
          </p>
          <div className="mt-6 flex justify-center">
            <Button asChild>
              <Link href={CENTRAL_AUTH_URL}>回到 Finance 模組入口</Link>
            </Button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-120px)] max-w-3xl items-center justify-center">
      <section className="w-full rounded-lg border border-[#f0c987] bg-white p-6 shadow-[0_18px_50px_rgba(52,36,18,0.08)] sm:p-8">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#fff3de] text-[#b45309]">
          <ShieldAlert className="h-7 w-7" />
        </div>
        <div className="text-center">
          <h1 className="mt-5 text-2xl font-black text-slate-900">此帳號沒有此功能權限</h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            系統已依照角色權限與資料範圍擋下此頁，避免一般員工看到他人個資、薪資或管理資料。
          </p>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <KeyRound className="h-4 w-4 text-[#b45309]" />
              目前帳號角色
            </div>
            <div className="mt-3 text-lg font-black text-slate-950">{currentPolicy.label}</div>
            <p className="mt-1 text-sm leading-6 text-slate-500">{currentPolicy.description}</p>
            <div className="mt-3 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-600">
              資料範圍：{currentScope.label}
            </div>
          </div>

          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
            <div className="text-sm font-semibold text-rose-900">此頁缺少的權限</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(missingPermissions.length ? missingPermissions : requiredPermissions.map((permission) => ({ permission, label: permission, risk: "一般" as const }))).map((permission) => (
                <span
                  key={permission.permission}
                  className="rounded-full border border-rose-200 bg-white px-2.5 py-1 text-xs font-semibold text-rose-700"
                >
                  {permission.label}
                </span>
              ))}
            </div>
            <p className="mt-3 text-xs leading-5 text-rose-700">
              若這是你的工作職責，請由人資、行政部門主任或執行長到「系統設定 → 角色權限」調整。
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <Button asChild>
            <Link href="/dashboard">回 Dashboard</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/employee-portal">回員工入口</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
