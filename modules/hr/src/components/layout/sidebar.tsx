"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SuiyueLogo } from "@/components/brand/suiyue-logo";
import { getVisibleNavigation } from "@/lib/auth/menu";
import { getRoleLabel } from "@/lib/auth/rbac";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { isNavigationItemActive } from "@/lib/navigation/active-route";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const pathname = usePathname();
  const currentUser = useCurrentUser();
  const isAuthenticated = Boolean(currentUser.id);
  const visibleNavigationGroups = isAuthenticated ? getVisibleNavigation(currentUser.role) : [];

  return (
    <aside className="finance-sidebar hidden w-[212px] shrink-0 flex-col border-r border-white/10 px-[14px] py-[16px] text-white lg:flex">
      <div className="mb-4 flex items-center gap-3 border-b border-white/10 pb-4">
        <SuiyueLogo className="h-[42px] w-[42px] shrink-0 border-white/70 bg-[#fff3de] p-0.5 shadow-[0_8px_24px_rgba(0,0,0,0.22)]" />
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-white">歲悅長照集團</div>
          <div className="truncate text-[10px] tracking-[0.12em] text-slate-400">
            HR OS V3 · {isAuthenticated ? getRoleLabel(currentUser.role) : "Finance 入口"}
          </div>
        </div>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto pr-1">
        {visibleNavigationGroups.map((group) => (
          <div key={group.label}>
            <div className="px-2 pb-2 text-[10px] font-semibold tracking-[0.16em] text-slate-500">
              {group.label}
            </div>
            <div className="space-y-1">
              {group.items.map((item) => {
                const isActive = isNavigationItemActive(pathname, item.href);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "finance-sidebar-item flex items-center gap-3 rounded-[9px] px-3 py-2 text-[12px] transition hover:bg-white/10 hover:text-white",
                      isActive && "finance-sidebar-item-active font-semibold",
                    )}
                  >
                    <span className={cn(
                      "flex h-[22px] w-[22px] items-center justify-center rounded-md border border-white/15 text-[#f6b35d]",
                      isActive && "border-[#d97706] bg-[#d97706] text-white",
                    )}>
                      <item.icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="truncate">{item.title}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
