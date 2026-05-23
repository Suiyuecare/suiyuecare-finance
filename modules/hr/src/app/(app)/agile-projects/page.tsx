import Link from "next/link";
import { ArrowRight, CalendarClock, CheckCircle2, KanbanSquare, ListChecks, Target, Users } from "lucide-react";

const projectColumns = [
  { title: "待規劃", value: "0", detail: "需求、議題、改善提案與跨部門事項。" },
  { title: "進行中", value: "0", detail: "已指定負責人與期限的工作項目。" },
  { title: "待驗收", value: "0", detail: "已完成，等待主管、專案負責人或需求單位確認。" },
  { title: "已完成", value: "0", detail: "可回顧成果、附件、會議紀錄與異動歷程。" },
];

export default function AgileProjectsPage() {
  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-[16px] border border-[#ead8c2] bg-white shadow-[0_18px_45px_rgba(120,72,20,0.12)]">
        <div className="bg-[linear-gradient(135deg,#c86b00_0%,#e47d00_48%,#f4a737_100%)] p-5 text-white sm:p-6">
          <p className="text-sm font-bold uppercase tracking-[0.14em] text-white/80">AGILE PROJECTS</p>
          <h1 className="mt-2 text-3xl font-black sm:text-4xl">敏捷式專案管理</h1>
          <p className="mt-3 max-w-3xl text-sm font-medium leading-6 text-white/88 sm:text-base">
            把 HR、Finance、總務、長照營運的跨部門工作集中到同一個看板，清楚看到負責人、期限、狀態與附件。
          </p>
        </div>
        <div className="grid gap-3 bg-[#fffaf4] p-4 md:grid-cols-4">
          {projectColumns.map((column) => (
            <div key={column.title} className="rounded-[12px] border border-[#ead8c2] bg-white p-4">
              <div className="flex items-start justify-between">
                <span className="rounded-[10px] border border-[#f5c98d] bg-[#fff7ed] p-2 text-[#9a4f00]">
                  <KanbanSquare className="h-5 w-5" />
                </span>
                <span className="text-3xl font-black text-slate-950">{column.value}</span>
              </div>
              <h2 className="mt-4 text-sm font-black text-[#7c3f00]">{column.title}</h2>
              <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">{column.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { title: "任務看板", detail: "以 To do、Doing、Review、Done 管理每日進度。", icon: ListChecks },
          { title: "Sprint 週期", detail: "可用週、雙週或月份作為改善週期。", icon: CalendarClock },
          { title: "負責人與協作者", detail: "每張任務卡都要有 owner 與協作部門。", icon: Users },
          { title: "成果驗收", detail: "完成後留下驗收說明、附件與下一步。", icon: CheckCircle2 },
        ].map((item) => (
          <div key={item.title} className="rounded-[14px] border border-[#ead8c2] bg-white p-5 shadow-sm">
            <span className="inline-flex rounded-[10px] border border-[#f5c98d] bg-[#fff7ed] p-2 text-[#9a4f00]">
              <item.icon className="h-5 w-5" />
            </span>
            <h2 className="mt-4 font-black text-slate-950">{item.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">{item.detail}</p>
          </div>
        ))}
      </section>

      <section className="rounded-[14px] border border-[#ead8c2] bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <Target className="mt-1 h-5 w-5 text-[#b45309]" />
            <div>
              <h2 className="font-black text-slate-950">建議優先放入的專案</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                可先放上線缺失修正、Google 登入、手機版優化、HR/Finance 串接、SOP 文件與教育訓練追蹤。
              </p>
            </div>
          </div>
          <Link href="/dashboard" className="inline-flex items-center justify-center rounded-lg border border-[#ead8c2] bg-[#fff7ed] px-3 py-2 text-sm font-black text-[#8a4b06] hover:border-[#d97706]">
            回儀表板
            <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
