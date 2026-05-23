import Link from "next/link";
import {
  BriefcaseBusiness,
  Calculator,
  FileText,
  KanbanSquare,
  UsersRound,
  Wrench,
} from "lucide-react";
import { SuiyueLogo } from "@/components/brand/suiyue-logo";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ModuleRoleBanner } from "@/features/auth/module-role-banner";

const modules = [
  {
    name: "業務系統",
    status: "規劃中",
    icon: BriefcaseBusiness,
    copy: "個案、居服排班、服務紀錄、合約與督導追蹤。",
  },
  {
    name: "人資系統",
    href: "/dashboard",
    status: "可進入",
    icon: UsersRound,
    copy: "員工自助、表單簽核、假勤出勤、薪資袋與法遵規則。",
  },
  {
    name: "會計系統",
    href: "https://finance.suiyuecare.com",
    status: "外部模組",
    icon: Calculator,
    copy: "支出申請、付款、收款、傳票、三表與薪資傳票。",
  },
  {
    name: "電子公文交換系統",
    href: "/official-documents",
    status: "可進入",
    icon: FileText,
    copy: "收文、發文、簽辦、歸檔與跨部門公文追蹤。",
  },
  {
    name: "敏捷式專案管理",
    href: "/agile-projects",
    status: "可進入",
    icon: KanbanSquare,
    copy: "任務看板、Sprint、負責人、期限與跨模組專案進度。",
  },
  {
    name: "工具列",
    href: "/toolbox",
    status: "可進入",
    icon: Wrench,
    copy: "PDF 編輯器、檔案整理與日常行政工具集中入口。",
  },
];

export default function ModulesPage() {
  return (
    <main className="min-h-screen bg-[#eee7de] p-0 sm:p-4">
      <section className="suiyue-system-shell mx-auto min-h-screen max-w-[1200px] overflow-hidden bg-[#fbfaf8] sm:min-h-[calc(100vh-2rem)] sm:rounded-[18px]">
        <header className="flex h-[66px] items-center justify-between border-b border-[#ead8c2] bg-white/80 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <SuiyueLogo className="h-10 w-10 p-0.5" />
            <div>
              <div className="text-sm font-bold text-slate-800">歲悅長照集團</div>
              <div className="text-[10px] tracking-[0.16em] text-slate-500">
                MODULE ACCESS CENTER
              </div>
            </div>
          </div>
          <Link className="text-sm font-semibold text-[#b45309]" href="/login">
            切換帳號
          </Link>
        </header>

        <div className="bg-[linear-gradient(180deg,#fffaf4_0%,#f7efe5_100%)] px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
          <div className="max-w-3xl">
            <div className="mb-3 inline-flex rounded-full border border-[#f0c987] bg-white px-3 py-1 text-xs font-black tracking-[0.14em] text-[#8a4b06]">
              SUIYUE CARE GROUP
            </div>
            <h1 className="text-[26px] font-black leading-tight text-[#172033] sm:text-[34px]">選擇今天要處理的系統</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-500">
              登入完成後，依照權限進入業務、人資或會計模組。HR 會共用 Finance 的帳號、法人、部門、組織與權限主檔，避免兩邊資料打架。
            </p>
          </div>
          <ModuleRoleBanner />

          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {modules.map((module) => {
              const card = (
                <Card className="h-full rounded-[14px] border-[#ead8c2] bg-white shadow-[0_16px_40px_rgba(52,36,18,0.06)] transition hover:-translate-y-0.5 hover:border-[#d97706] hover:shadow-[0_22px_60px_rgba(52,36,18,0.11)]">
                  <CardContent className="flex h-full min-h-[210px] flex-col p-5 sm:p-6">
                    <div className="flex h-14 w-14 items-center justify-center rounded-[14px] border border-[#f0c987] bg-[#fff7ed] text-[#b45309]">
                      <module.icon className="h-6 w-6" />
                    </div>
                    <div className="mt-6 flex items-center justify-between gap-3">
                      <h2 className="text-xl font-black text-[#172033]">{module.name}</h2>
                      <Badge variant={module.name === "人資系統" ? "default" : "secondary"}>
                        {module.status}
                      </Badge>
                    </div>
                    <p className="mt-3 flex-1 text-sm leading-6 text-slate-500">
                      {module.copy}
                    </p>
                    <div className="mt-5 rounded-lg border border-[#f0c987] bg-[#fff7ed] px-3 py-2 text-center text-sm font-black text-[#8a4b06]">
                      {module.href ? "進入模組" : "等待正式串接"}
                    </div>
                  </CardContent>
                </Card>
              );

              return module.href ? (
                <Link key={module.name} href={module.href}>
                  {card}
                </Link>
              ) : (
                <div key={module.name} aria-disabled="true">
                  {card}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}
