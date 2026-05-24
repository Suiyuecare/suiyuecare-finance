"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Bell,
  CalendarDays,
  CheckSquare,
  Clock3,
  FileText,
  Home,
  Landmark,
  LockKeyhole,
  LogOut,
  Menu,
  Search,
  Settings2,
  ShieldCheck,
  UserCheck,
  UserRound,
  UserRoundCog,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SuiyueLogo } from "@/components/brand/suiyue-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getVisibleNavigation } from "@/lib/auth/menu";
import { clearQuickLoginUser } from "@/lib/auth/current-user";
import { canAny, getRoleLabel, type HrRole, type Permission } from "@/lib/auth/rbac";
import { CENTRAL_AUTH_URL } from "@/lib/config/central-auth";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { isNavigationItemActive } from "@/lib/navigation/active-route";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

const mobilePrimaryActions: Array<{
  title: string;
  subtitle: string;
  href: string;
  icon: LucideIcon;
  permissions: Permission[];
  roles?: HrRole[];
}> = [
  { title: "今日打卡", subtitle: "上下班 / 外出 / 返回", href: "/clock", icon: Clock3, permissions: ["attendance:view"], roles: ["employee", "team_member"] },
  { title: "我要申請", subtitle: "請假、加班、補卡", href: "/requests/new", icon: CalendarDays, permissions: ["request:create"], roles: ["employee", "section_chief", "dept_manager", "general_affairs", "team_member", "supervisor"] },
  { title: "表單追蹤", subtitle: "查看我的申請進度", href: "/requests", icon: FileText, permissions: ["request:view"], roles: ["employee", "section_chief", "dept_manager", "general_affairs", "team_member", "supervisor"] },
  { title: "薪資袋", subtitle: "本人薪資與發薪紀錄", href: "/payslip", icon: LockKeyhole, permissions: ["payroll:self:view"], roles: ["employee", "team_member"] },
  { title: "主管入口", subtitle: "待辦、異常、人力缺口", href: "/manager-portal", icon: UserCheck, permissions: ["request:approve"], roles: ["section_chief", "dept_manager", "general_affairs", "supervisor"] },
  { title: "待簽核", subtitle: "請假、加班、補卡", href: "/approvals", icon: CheckSquare, permissions: ["request:approve"], roles: ["section_chief", "dept_manager", "general_affairs", "accountant", "supervisor", "hr", "admin_director", "ceo"] },
  { title: "人資後台", subtitle: "員工、出勤、證照訓練", href: "/hr-admin", icon: UserRoundCog, permissions: ["employee:manage"], roles: ["hr", "admin_director", "ceo"] },
  { title: "員工管理", subtitle: "人員主檔與異動紀錄", href: "/employees", icon: Users, permissions: ["employee:view"], roles: ["section_chief", "dept_manager", "general_affairs", "supervisor", "hr", "admin_director", "ceo"] },
  { title: "薪資後台", subtitle: "結薪、清冊、發薪", href: "/payroll", icon: Landmark, permissions: ["payroll:manage"], roles: ["hr", "admin_director", "ceo"] },
  { title: "法規檢核", subtitle: "勞基法與性平規則", href: "/compliance", icon: ShieldCheck, permissions: ["compliance:view"], roles: ["admin_director", "ceo"] },
];

const mobileSecondaryActions: Array<{
  title: string;
  href: string;
  icon: LucideIcon;
  permissions: Permission[];
  roles?: HrRole[];
}> = [
  { title: "首頁", href: "/dashboard", icon: Home, permissions: ["dashboard:view"] },
  { title: "員工入口", href: "/employee-portal", icon: UserRound, permissions: ["dashboard:view"] },
  { title: "待簽核", href: "/approvals", icon: CheckSquare, permissions: ["request:approve"] },
  { title: "報表", href: "/analytics", icon: BarChart3, permissions: ["analytics:view"], roles: ["hr", "admin_director", "ceo"] },
  { title: "設定", href: "/settings", icon: Settings2, permissions: ["system:settings"], roles: ["hr", "admin_director", "ceo"] },
  { title: "公告", href: "/announcements", icon: Bell, permissions: ["announcement:view"] },
];

function isActionVisible(item: { permissions: Permission[]; roles?: HrRole[] }, role: HrRole) {
  return (!item.roles || item.roles.includes(role)) && canAny(role, item.permissions);
}

export function Header() {
  const currentUser = useCurrentUser();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const isAuthenticated = Boolean(currentUser.id);
  const visibleNavigationGroups = isAuthenticated ? getVisibleNavigation(currentUser.role) : [];
  const visiblePrimaryActions = useMemo(
    () => isAuthenticated ? mobilePrimaryActions.filter((item) => isActionVisible(item, currentUser.role)).slice(0, 8) : [],
    [currentUser.role, isAuthenticated],
  );
  const visibleSecondaryActions = useMemo(
    () => isAuthenticated ? mobileSecondaryActions.filter((item) => isActionVisible(item, currentUser.role)).slice(0, 5) : [],
    [currentUser.role, isAuthenticated],
  );

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [mobileMenuOpen]);

  function submitSearch() {
    const query = searchQuery.trim();
    if (!query) return;
    const encoded = encodeURIComponent(query);
    const destination = query.includes("薪資")
      ? "/payroll"
      : query.includes("公告") || query.includes("通知")
        ? "/announcements"
        : query.includes("表單") || query.includes("簽核")
          ? "/requests"
          : query.includes("打卡") || query.includes("出勤")
            ? "/clock"
            : `/employees?search=${encoded}`;
    setMobileMenuOpen(false);
    router.push(destination);
  }

  async function logout() {
    const supabase = getSupabaseBrowserClient();
    await supabase?.auth.signOut();
    clearQuickLoginUser();
    setMobileMenuOpen(false);
    window.location.assign(CENTRAL_AUTH_URL);
  }

  return (
    <>
      <header className="sticky top-0 z-30 shrink-0 border-b border-[#ead8c2] bg-white/95 backdrop-blur">
        <div className="flex h-[60px] items-center gap-2 px-3 lg:h-[54px] lg:px-[18px]">
          <Button
            variant="outline"
            size="icon"
            aria-label="開啟功能選單"
            className="bg-white lg:hidden"
            onClick={() => setMobileMenuOpen(true)}
          >
            <Menu className="h-4 w-4" />
          </Button>
          <SuiyueLogo className="h-9 w-9 shrink-0 p-0.5 lg:hidden" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold text-[#172033]">歲悅長照集團 · 人資管理系統 V3</div>
            <div className="truncate text-xs text-slate-500">HR OS · 即時同步 · {isAuthenticated ? currentUser.roleLabel : "請先登入"}</div>
          </div>
        <form
          className="hidden w-80 items-center gap-2 rounded-md border border-[#dfc9b1] bg-[#fffaf4] px-3 md:flex"
          onSubmit={(event) => {
            event.preventDefault();
            submitSearch();
          }}
        >
          <Search className="h-4 w-4 text-slate-400" />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="border-0 px-0 shadow-none focus-visible:ring-0"
            placeholder="搜尋員工、表單、假勤、公告"
          />
        </form>
        {isAuthenticated ? (
          <Button asChild variant="outline" size="icon" aria-label="通知" className="bg-white">
            <Link href="/notifications">
              <Bell className="h-4 w-4" />
            </Link>
          </Button>
        ) : (
          <Button asChild variant="outline" className="bg-white">
            <Link href={CENTRAL_AUTH_URL}>登入</Link>
          </Button>
        )}
        <div className="hidden text-right sm:block">
          <div className="text-sm font-bold text-slate-800">{isAuthenticated ? currentUser.name : "未登入"}</div>
          <div className="text-xs text-slate-500">{isAuthenticated ? getRoleLabel(currentUser.role) : "請先登入"}</div>
        </div>
        {isAuthenticated ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="登出"
            title="登出"
            className="hidden bg-white sm:inline-flex"
            onClick={() => void logout()}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        ) : null}
        </div>
      </header>

      {mobileMenuOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="關閉功能選單"
            className="absolute inset-0 bg-slate-950/45"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="手機功能選單"
            className="absolute left-0 top-0 flex h-full w-[min(94vw,390px)] flex-col bg-[#fbfaf8] text-slate-900 shadow-2xl"
          >
            <div className="finance-sidebar border-b border-[#ead8c2] p-4 text-white">
              <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <SuiyueLogo className="h-10 w-10 shrink-0 border-white/70 bg-[#fff3de] p-0.5" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold">歲悅長照集團</div>
                  <div className="truncate text-[11px] text-slate-400">{isAuthenticated ? `${currentUser.name} · ${getRoleLabel(currentUser.role)}` : "請先登入"}</div>
                </div>
              </div>
              <Button variant="outline" size="icon" aria-label="關閉" className="border-white/20 bg-white/10 text-white hover:bg-white/20" onClick={() => setMobileMenuOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="rounded-md border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold text-white">
              {isAuthenticated ? currentUser.email : "尚未登入 Supabase"}
            </div>
            </div>

            <div className="border-b border-[#ead8c2] bg-white p-4">
              <form
                className="flex h-11 items-center gap-2 rounded-lg border border-[#dfc9b1] bg-[#fffaf4] px-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitSearch();
                }}
              >
                <Search className="h-4 w-4 text-slate-400" />
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                  placeholder="搜尋員工、表單、薪資、公告"
                />
              </form>
              <div className="mt-4 flex items-center justify-between gap-3">
                <div className="text-sm font-black text-slate-900">常用工作</div>
                <div className="rounded-full bg-[#fff3de] px-2.5 py-1 text-[11px] font-bold text-[#8a4b06]">
                  {isAuthenticated ? getRoleLabel(currentUser.role) : "未登入"}
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {visiblePrimaryActions.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className="min-h-[76px] rounded-lg border border-[#ead8c2] bg-[#fffaf4] p-3 active:bg-[#fff3de]"
                  >
                    <div className="flex items-center gap-2 text-sm font-black text-[#7c3f00]">
                      <item.icon className="h-4 w-4" />
                      {item.title}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{item.subtitle}</div>
                  </Link>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-5 gap-2">
                {visibleSecondaryActions.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className="min-h-[54px] rounded-lg bg-slate-100 px-2 py-2 text-center text-[11px] font-bold text-slate-600 active:bg-[#fff3de]"
                  >
                    <item.icon className="mx-auto mb-1 h-4 w-4" />
                    {item.title}
                  </Link>
                ))}
              </div>
            </div>

            <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
              {visibleNavigationGroups.map((group) => (
                <div key={group.label}>
                  <div className="px-1 pb-2 text-[11px] font-black tracking-[0.14em] text-[#b45309]">
                    {group.label}
                  </div>
                  <div className="space-y-2">
                    {group.items.map((item) => {
                      const isActive = isNavigationItemActive(pathname, item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setMobileMenuOpen(false)}
                          className={cn(
                            "flex min-h-[52px] items-center gap-3 rounded-lg border border-[#ead8c2] bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition",
                            isActive && "border-[#d97706] bg-[#fff3de] text-[#7c3f00]",
                          )}
                        >
                          <span className={cn(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#fff7ed] text-[#b45309]",
                            isActive && "bg-[#d97706] text-white",
                          )}>
                            <item.icon className="h-4 w-4" />
                          </span>
                          <span className="truncate">{item.title}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>
            <div className="border-t border-[#ead8c2] bg-white p-3">
              <div className="grid grid-cols-2 gap-2">
                <Button asChild variant="outline" className="bg-white" onClick={() => setMobileMenuOpen(false)}>
                  <Link href="/dashboard">回首頁</Link>
                </Button>
                <Button className="bg-[#d97706] text-white hover:bg-[#b45309]" onClick={() => void logout()}>
                  <LogOut className="h-4 w-4" />
                  登出
                </Button>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
