import type { ReactNode } from "react";
import { AccessGuard } from "@/components/auth/access-guard";
import { Header } from "@/components/layout/header";
import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";
import { Sidebar } from "@/components/layout/sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-stretch bg-[#eee7de] p-0 text-slate-800 lg:p-[14px]">
      <div className="finance-shell-card flex min-h-screen w-full overflow-hidden lg:min-h-[calc(100vh-28px)] lg:rounded-[18px]">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header />
          <main className="suiyue-page flex-1 overflow-x-hidden overflow-y-auto px-3 py-4 pb-[calc(env(safe-area-inset-bottom)+7.25rem)] sm:px-4 lg:p-[18px]">
            <AccessGuard>
              <div className="space-y-4">
                {children}
              </div>
            </AccessGuard>
          </main>
          <MobileBottomNav />
        </div>
      </div>
    </div>
  );
}
