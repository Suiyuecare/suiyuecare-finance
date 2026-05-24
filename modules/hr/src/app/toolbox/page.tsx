import Link from "next/link";
import { ArrowLeft, ArrowRight, FilePenLine, Files, Image, Stamp, Wrench } from "lucide-react";
import { SuiyueLogo } from "@/components/brand/suiyue-logo";

const tools = [
  {
    title: "PDF 編輯器",
    href: "/pdf-tools/index.html",
    description: "開啟你原本製作的 PDF 工具網站，支援合併、壓縮、轉檔、簽名、OCR 與翻譯等工具。",
    icon: FilePenLine,
    status: "可使用",
  },
  {
    title: "圖片轉 PDF",
    description: "將憑據照片、掃描文件或收據整理成單一 PDF。",
    icon: Image,
    status: "規劃中",
  },
  {
    title: "文件合併",
    description: "把 Word、Excel、PDF 與圖片整理成送簽附件包。",
    icon: Files,
    status: "規劃中",
  },
  {
    title: "電子章工具",
    description: "常用章、簽核章與日期章的文件標記工具。",
    icon: Stamp,
    status: "規劃中",
  },
];

export default function ToolboxPage() {
  return (
    <main className="min-h-screen bg-[#eee7de] p-0 text-slate-800 sm:p-4">
      <section className="finance-shell-card mx-auto min-h-screen max-w-[1200px] overflow-hidden sm:min-h-[calc(100vh-2rem)] sm:rounded-[18px]">
        <header className="finance-topbar flex min-h-[66px] items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <SuiyueLogo className="h-10 w-10 shrink-0 p-0.5" />
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-slate-800">歲悅長照集團</div>
              <div className="truncate text-[10px] tracking-[0.16em] text-slate-500">TOOLBOX MODULE</div>
            </div>
          </div>
          <Link className="inline-flex items-center rounded-lg border border-[#ead8c2] bg-white px-3 py-2 text-sm font-black text-[#8a4b06]" href="https://finance.suiyuecare.com/">
            <ArrowLeft className="mr-1 h-4 w-4" />
            回模組入口
          </Link>
        </header>

        <div className="space-y-5 px-4 py-5 sm:px-6 lg:px-8">
          <section className="overflow-hidden rounded-[16px] border border-[#ead8c2] bg-white shadow-[0_18px_45px_rgba(120,72,20,0.12)]">
            <div className="bg-[linear-gradient(135deg,#c86b00_0%,#e47d00_48%,#f4a737_100%)] p-5 text-white sm:p-6">
              <p className="text-sm font-bold uppercase tracking-[0.14em] text-white/80">TOOLBOX</p>
              <h1 className="mt-2 text-3xl font-black sm:text-4xl">工具箱</h1>
              <p className="mt-3 max-w-3xl text-sm font-medium leading-6 text-white/88 sm:text-base">
                這裡集中放置各式各樣的行政工具。第一個工具是 PDF 編輯器，點入後會開啟完整 PDF 工具網站。
              </p>
            </div>
          </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {tools.map((tool) => {
          const card = (
            <div className="h-full rounded-[14px] border border-[#ead8c2] bg-white p-5 shadow-sm transition hover:border-[#d97706] hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <span className="rounded-[10px] border border-[#f5c98d] bg-[#fff7ed] p-2 text-[#9a4f00]">
                  <tool.icon className="h-5 w-5" />
                </span>
                <span className="rounded-full bg-[#fff3de] px-2.5 py-1 text-xs font-black text-[#8a4b06]">{tool.status}</span>
              </div>
              <h2 className="mt-4 font-black text-slate-950">{tool.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">{tool.description}</p>
              <div className="mt-5 inline-flex items-center text-sm font-black text-[#8a4b06]">
                {tool.href ? "進入工具" : "等待串接"}
                <ArrowRight className="ml-1 h-4 w-4" />
              </div>
            </div>
          );

          return tool.href ? (
            <Link key={tool.title} href={tool.href}>
              {card}
            </Link>
          ) : (
            <div key={tool.title}>{card}</div>
          );
        })}
      </section>

      <section className="rounded-[14px] border border-[#ead8c2] bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <Wrench className="mt-1 h-5 w-5 text-[#b45309]" />
          <div>
            <h2 className="font-black text-slate-950">工具箱使用原則</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              工具產出的檔案若要進入表單、公文或會計簽核，後續應寫入附件歸檔規則與 audit log，確保下載、版本與觀看權限都可追溯。
            </p>
          </div>
        </div>
      </section>
        </div>
      </section>
    </main>
  );
}
