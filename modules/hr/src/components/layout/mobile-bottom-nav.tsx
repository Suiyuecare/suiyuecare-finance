"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bell,
  CalendarDays,
  Clock3,
  ClipboardCheck,
  FileText,
  Home,
  Landmark,
  LockKeyhole,
  Settings2,
  ShieldCheck,
  UserCheck,
  UserRoundCog,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { canAny, type HrRole, type Permission } from "@/lib/auth/rbac";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { isNavigationItemActive } from "@/lib/navigation/active-route";
import { cn } from "@/lib/utils";

type MobileItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  permissions: Permission[];
};

const roleMobileItems: Record<HrRole, MobileItem[]> = {
  team_member: [
    { title: "總覽", href: "/dashboard", icon: Home, permissions: ["dashboard:view"] },
    { title: "打卡", href: "/clock", icon: Clock3, permissions: ["attendance:view"] },
    { title: "申請", href: "/requests/new", icon: CalendarDays, permissions: ["request:create"] },
    { title: "追蹤", href: "/requests", icon: FileText, permissions: ["request:view"] },
    { title: "薪資", href: "/payslip", icon: LockKeyhole, permissions: ["payroll:self:view"] },
  ],
  supervisor: [
    { title: "總覽", href: "/dashboard", icon: Home, permissions: ["dashboard:view"] },
    { title: "主管", href: "/manager-portal", icon: UserCheck, permissions: ["request:approve"] },
    { title: "簽核", href: "/approvals", icon: ClipboardCheck, permissions: ["request:approve"] },
    { title: "表單", href: "/requests", icon: FileText, permissions: ["request:view"] },
    { title: "公告", href: "/announcements", icon: Bell, permissions: ["announcement:view"] },
  ],
  hr: [
    { title: "總覽", href: "/dashboard", icon: Home, permissions: ["dashboard:view"] },
    { title: "人資", href: "/hr-admin", icon: UserRoundCog, permissions: ["employee:manage"] },
    { title: "員工", href: "/employees", icon: Users, permissions: ["employee:view"] },
    { title: "簽核", href: "/approvals", icon: ClipboardCheck, permissions: ["request:approve"] },
    { title: "薪資", href: "/payroll", icon: Landmark, permissions: ["payroll:manage"] },
  ],
  admin_director: [
    { title: "總覽", href: "/dashboard", icon: Home, permissions: ["dashboard:view"] },
    { title: "人資", href: "/hr-admin", icon: UserRoundCog, permissions: ["employee:manage"] },
    { title: "薪資", href: "/payroll", icon: Landmark, permissions: ["payroll:manage"] },
    { title: "法規", href: "/compliance", icon: ShieldCheck, permissions: ["compliance:view"] },
    { title: "設定", href: "/settings", icon: Settings2, permissions: ["system:settings"] },
  ],
  ceo: [
    { title: "總覽", href: "/dashboard", icon: Home, permissions: ["dashboard:view"] },
    { title: "報表", href: "/analytics", icon: BarChart3, permissions: ["analytics:view"] },
    { title: "薪資", href: "/payroll", icon: Landmark, permissions: ["payroll:manage"] },
    { title: "法規", href: "/compliance", icon: ShieldCheck, permissions: ["compliance:view"] },
    { title: "設定", href: "/settings", icon: Settings2, permissions: ["system:settings"] },
  ],
};

export function MobileBottomNav() {
  const pathname = usePathname();
  const currentUser = useCurrentUser();
  if (!currentUser.id) return null;
  const visibleItems = roleMobileItems[currentUser.role].filter((item) => canAny(currentUser.role, item.permissions));

  return (
    <nav aria-label="手機主要導覽" className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#171b24]/96 px-2 pb-[calc(env(safe-area-inset-bottom)+8px)] pt-2 shadow-[0_-12px_32px_rgba(25,16,8,0.18)] backdrop-blur lg:hidden">
      <div className="mx-auto grid max-w-md grid-cols-5 gap-1.5">
        {visibleItems.map((item) => {
          const active = isNavigationItemActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-[54px] flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-bold text-slate-300 transition active:scale-[0.98] active:bg-white/10",
                active && "bg-[#8a4b06] text-white ring-1 ring-[#d97706]",
              )}
            >
              <span className={cn("rounded-lg border border-white/10 p-1 text-[#f6b35d]", active && "border-[#d97706] bg-[#d97706] text-white")}>
                <item.icon className="h-4 w-4" />
              </span>
              <span className="max-w-full truncate px-0.5">{item.title}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
