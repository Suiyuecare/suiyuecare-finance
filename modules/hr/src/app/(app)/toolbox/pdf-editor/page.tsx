"use client";

import { useMemo, useState } from "react";
import { Download, FilePenLine, Files, RotateCw, Scissors, Stamp, UploadCloud } from "lucide-react";

const pdfTools = [
  { title: "合併 PDF", detail: "將多份 PDF 依排序合併成一份送簽檔案。", icon: Files },
  { title: "拆分頁面", detail: "依頁碼拆出指定頁面，適合只送部分附件。", icon: Scissors },
  { title: "旋轉頁面", detail: "修正掃描方向，避免主管檢核時需要手動旋轉。", icon: RotateCw },
  { title: "加簽名或章", detail: "保留簽名、章戳、日期與備註位置。", icon: Stamp },
];

export default function PdfEditorPage() {
  const [files, setFiles] = useState<File[]>([]);
  const totalSize = useMemo(
    () => files.reduce((sum, file) => sum + file.size, 0),
    [files],
  );

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-[16px] border border-[#ead8c2] bg-white shadow-[0_18px_45px_rgba(120,72,20,0.12)]">
        <div className="bg-[linear-gradient(135deg,#c86b00_0%,#e47d00_48%,#f4a737_100%)] p-5 text-white sm:p-6">
          <p className="text-sm font-bold uppercase tracking-[0.14em] text-white/80">PDF EDITOR</p>
          <h1 className="mt-2 text-3xl font-black sm:text-4xl">PDF 編輯器</h1>
          <p className="mt-3 max-w-3xl text-sm font-medium leading-6 text-white/88 sm:text-base">
            先整理公文、人資或會計附件，再送簽或歸檔。此頁已預留合併、拆分、旋轉、簽章與壓縮的操作區。
          </p>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="rounded-[14px] border border-[#ead8c2] bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <UploadCloud className="h-5 w-5 text-[#b45309]" />
            <h2 className="text-xl font-black text-slate-950">上傳 PDF</h2>
          </div>
          <label className="mt-5 flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-[14px] border border-dashed border-[#d6b98f] bg-[#fffaf4] px-4 py-8 text-center hover:border-[#d97706] hover:bg-[#fff7ed]">
            <UploadCloud className="h-10 w-10 text-[#b45309]" />
            <span className="mt-3 text-lg font-black text-slate-950">選擇一份或多份 PDF</span>
            <span className="mt-2 max-w-md text-sm leading-6 text-slate-500">
              建議檔名保留日期、單號、部門或用途。後續若要接正式編輯引擎，可在此處串 PDF-lib 或後端文件服務。
            </span>
            <input
              type="file"
              accept="application/pdf"
              multiple
              className="sr-only"
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
          </label>

          <div className="mt-5 rounded-lg border border-[#ead8c2] bg-[#fffaf4] p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-black text-slate-950">已選擇檔案</div>
                <p className="mt-1 text-sm text-slate-500">
                  {files.length ? `${files.length} 份，合計 ${(totalSize / 1024 / 1024).toFixed(2)} MB` : "尚未選擇 PDF。"}
                </p>
              </div>
              <button className="inline-flex items-center justify-center rounded-lg border border-[#ead8c2] bg-white px-3 py-2 text-sm font-black text-[#8a4b06] disabled:opacity-50" disabled={!files.length}>
                <Download className="mr-1 h-4 w-4" />
                匯出整理檔
              </button>
            </div>
            {files.length ? (
              <div className="mt-4 space-y-2">
                {files.map((file) => (
                  <div key={`${file.name}-${file.size}`} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm">
                    <span className="truncate font-semibold text-slate-700">{file.name}</span>
                    <span className="shrink-0 text-xs font-bold text-slate-400">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-4">
          {pdfTools.map((tool) => (
            <button key={tool.title} className="w-full rounded-[14px] border border-[#ead8c2] bg-white p-4 text-left shadow-sm transition hover:border-[#d97706] hover:bg-[#fffaf4] disabled:opacity-50" disabled={!files.length}>
              <div className="flex items-start gap-3">
                <span className="rounded-[10px] border border-[#f5c98d] bg-[#fff7ed] p-2 text-[#9a4f00]">
                  <tool.icon className="h-5 w-5" />
                </span>
                <div>
                  <div className="font-black text-slate-950">{tool.title}</div>
                  <p className="mt-1 text-sm leading-6 text-slate-500">{tool.detail}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-[14px] border border-[#ead8c2] bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <FilePenLine className="mt-1 h-5 w-5 text-[#b45309]" />
          <div>
            <h2 className="font-black text-slate-950">正式串接提醒</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              目前先建立工具入口與檔案選取體驗。若要正式編輯 PDF，下一步需要接入瀏覽器 PDF 處理套件或後端轉檔服務，並把產出檔案寫入 Supabase Storage 與附件 audit log。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
