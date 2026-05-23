import Link from "next/link";
import { Archive, ArrowRight, FileCheck2, FileText, Inbox, Send, ShieldCheck } from "lucide-react";

const documentQueues = [
  { title: "待收文", value: "0 件", detail: "外部來文、政府機關、合作單位文件。", icon: Inbox },
  { title: "待發文", value: "0 件", detail: "正式函文、通知、回覆與內部公告。", icon: Send },
  { title: "簽辦中", value: "0 件", detail: "主管簽核、會辦、加簽與退回補件。", icon: FileCheck2 },
  { title: "已歸檔", value: "0 件", detail: "依年度、法人、部門與主旨分類保存。", icon: Archive },
];

export default function OfficialDocumentsPage() {
  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-[16px] border border-[#ead8c2] bg-white shadow-[0_18px_45px_rgba(120,72,20,0.12)]">
        <div className="bg-[linear-gradient(135deg,#c86b00_0%,#e47d00_48%,#f4a737_100%)] p-5 text-white sm:p-6">
          <p className="text-sm font-bold uppercase tracking-[0.14em] text-white/80">DOCUMENT EXCHANGE</p>
          <h1 className="mt-2 text-3xl font-black sm:text-4xl">電子公文交換系統</h1>
          <p className="mt-3 max-w-3xl text-sm font-medium leading-6 text-white/88 sm:text-base">
            統一處理收文、發文、簽辦、會辦與歸檔，讓公文資料可以跟法人、部門、專案與簽核流程接在一起。
          </p>
        </div>
        <div className="grid gap-3 bg-[#fffaf4] p-4 md:grid-cols-4">
          {documentQueues.map((item) => (
            <div key={item.title} className="rounded-[12px] border border-[#ead8c2] bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <span className="rounded-[10px] border border-[#f5c98d] bg-[#fff7ed] p-2 text-[#9a4f00]">
                  <item.icon className="h-5 w-5" />
                </span>
                <span className="text-2xl font-black text-slate-950">{item.value}</span>
              </div>
              <h2 className="mt-4 text-sm font-black text-[#7c3f00]">{item.title}</h2>
              <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">{item.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="rounded-[14px] border border-[#ead8c2] bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-[#b45309]" />
            <h2 className="text-xl font-black text-slate-950">公文流程規劃</h2>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {[
              ["建立公文", "選擇收文或發文，填入來文單位、主旨、密等、期限與附件。"],
              ["指派承辦", "可指定承辦人、會辦部門與主管簽核順序。"],
              ["追蹤期限", "逾期、退回與待補件會出現在待辦與通知中心。"],
              ["正式歸檔", "結案後依年度、法人、部門、主旨與公文字號保存。"],
            ].map(([title, detail]) => (
              <div key={title} className="rounded-lg border border-[#ead8c2] bg-[#fffaf4] p-4">
                <div className="font-black text-slate-950">{title}</div>
                <p className="mt-2 text-sm leading-6 text-slate-500">{detail}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[14px] border border-[#ead8c2] bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[#b45309]" />
            <h2 className="font-black text-slate-950">保存原則</h2>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            公文附件會依法人、部門、年度、日期與字號歸檔；正式版本應保留簽核紀錄、附件版本與操作 audit log。
          </p>
          <Link href="/toolbox/pdf-editor" className="mt-5 inline-flex items-center rounded-lg border border-[#ead8c2] bg-[#fff7ed] px-3 py-2 text-sm font-black text-[#8a4b06] hover:border-[#d97706]">
            先整理 PDF 附件
            <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
