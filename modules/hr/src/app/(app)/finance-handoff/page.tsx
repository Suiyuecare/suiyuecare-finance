import { Landmark, ReceiptText, ShieldCheck } from "lucide-react";

const handoffItems = [
  { title: "薪資清冊", status: "待會計確認", amount: "NT$ 5,824,300" },
  { title: "銀行轉帳檔", status: "已產生草稿", amount: "80 筆" },
  { title: "勞健保提繳", status: "待行政部門主任覆核", amount: "NT$ 716,400" },
];

export default function FinanceHandoffPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-bold tracking-[0.12em] text-[#b45309]">FINANCE HANDOFF</p>
        <h1 className="mt-1 text-2xl font-black text-slate-900">會計串接</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-500">薪資鎖定後將薪資清冊、銀行轉帳檔與公司負擔項交接至歲悅會計系統。</p>
      </div>
      <section className="grid gap-4 md:grid-cols-3">
        {handoffItems.map((item) => (
          <article key={item.title} className="rounded-lg border border-[#ead8c2] bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <ReceiptText className="h-6 w-6 text-[#b45309]" />
              <span className="rounded-full bg-[#fff3de] px-3 py-1 text-xs font-black text-[#8a4b06]">{item.status}</span>
            </div>
            <h2 className="mt-4 font-black text-slate-900">{item.title}</h2>
            <p className="mt-2 text-2xl font-black text-slate-950">{item.amount}</p>
          </article>
        ))}
      </section>
      <section className="rounded-lg border border-[#f0c987] bg-[#fff7ed] p-5">
        <div className="flex items-center gap-3">
          <Landmark className="h-5 w-5 text-[#b45309]" />
          <h2 className="font-black text-[#7c3f00]">串接檢查</h2>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {["薪資已鎖定才可交接", "調整紀錄需完整", "一般員工無權查看清冊"].map((item) => (
            <div key={item} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-bold text-slate-700">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              {item}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
