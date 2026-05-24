"use client";

import Link from "next/link";
import { ArrowRight, ClipboardList, FileClock, FileText, GitCompareArrows, Package } from "lucide-react";
import { canAny } from "@/lib/auth/rbac";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { requestFormDefinitions } from "@/lib/requests/form-catalog";

const attendanceFormIds = ["leave", "pre-overtime", "punch", "remote"];
const changeFormIds = ["position-change", "salary-change", "resignation", "new-hire"];
const documentFormIds = ["document", "labor-health-insurance-certificate", "employment-certificate"];
const businessFormIds = ["internal-approval", "meeting-minutes", "incident-report"];
const generalAffairsFormIds = ["equipment-request", "document-access-general", "official-mail-receipt", "company-seal-request", "venue-rental", "equipment-repair", "asset-disposal"];

export default function NewRequestPage() {
  const currentUser = useCurrentUser();
  const visibleForms = requestFormDefinitions.filter((form) => !form.hiddenFromRequestMenu && canAny(currentUser.role, form.permissions));
  const attendanceForms = visibleForms.filter((form) => attendanceFormIds.includes(form.id));
  const changeForms = visibleForms.filter((form) => changeFormIds.includes(form.id));
  const documentForms = visibleForms.filter((form) => documentFormIds.includes(form.id));
  const businessForms = visibleForms.filter((form) => businessFormIds.includes(form.id));
  const generalAffairsForms = visibleForms.filter((form) => generalAffairsFormIds.includes(form.id));

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-bold tracking-[0.12em] text-[#b45309]">FORM APPLICATION</p>
          <h1 className="mt-1 text-2xl font-black text-slate-900">表單申請</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            先選你現在要做的事。系統會帶你到對應表單，送出後自動進入表單追蹤與簽核中心。
          </p>
        </div>
        <div className="rounded-full border border-[#f0c987] bg-[#fff7ed] px-4 py-2 text-sm font-bold text-[#7c3f00]">
          申請人：{currentUser.name} · {currentUser.roleLabel}
        </div>
      </div>

      {attendanceForms.length ? <section>
        <div className="mb-3 flex items-center gap-2">
          <FileClock className="h-5 w-5 text-[#b45309]" />
          <h2 className="font-black text-slate-950">假勤類表單</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {attendanceForms.map((form) => {
          const Icon = form.icon;

          return (
            <Link
              key={form.id}
              href={`/requests/new/${form.id}`}
              className="group rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm transition hover:border-[#d97706] hover:bg-[#fffaf4] hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-4">
                <span className="rounded-lg bg-[#fff3de] p-2.5 text-[#b45309] transition group-hover:bg-[#d97706] group-hover:text-white">
                  <Icon className="h-5 w-5" />
                </span>
              </div>
              <div className="mt-4">
                <h2 className="font-black text-slate-900">{form.title}</h2>
                <p className="mt-1 text-xs font-semibold text-[#8a4b06]">{form.subtitle}</p>
              </div>
              <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                <span>{form.fields.length} 個欄位</span>
                <span>{form.requiresAttachment ? "可能需附件" : "附件選填"}</span>
              </div>
              <div className="mt-3 flex items-center gap-1 text-sm font-bold text-[#b45309]">
                開始填寫
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
              </div>
            </Link>
          );
        })}
        </div>
      </section> : null}

      {businessForms.length ? <section>
        <div className="mb-3 flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-[#b45309]" />
          <h2 className="font-black text-slate-950">業務類表單</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {businessForms.map((form) => {
            const Icon = form.icon;

            return (
              <Link
                key={form.id}
                href={`/requests/new/${form.id}`}
                className="group rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm transition hover:border-[#d97706] hover:bg-[#fffaf4] hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-4">
                  <span className="rounded-lg bg-[#fff3de] p-2.5 text-[#b45309] transition group-hover:bg-[#d97706] group-hover:text-white">
                    <Icon className="h-5 w-5" />
                  </span>
                </div>
                <div className="mt-4">
                  <h2 className="font-black text-slate-900">{form.title}</h2>
                  <p className="mt-1 text-xs font-semibold text-[#8a4b06]">{form.subtitle}</p>
                </div>
                <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                  <span>{form.fields.length} 個欄位</span>
                  <span>{form.requiresAttachment ? "可能需附件" : "附件選填"}</span>
                </div>
                <div className="mt-3 flex items-center gap-1 text-sm font-bold text-[#b45309]">
                  開始填寫
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                </div>
              </Link>
            );
          })}
        </div>
      </section> : null}

      {generalAffairsForms.length ? <section>
        <div className="mb-3 flex items-center gap-2">
          <Package className="h-5 w-5 text-[#b45309]" />
          <h2 className="font-black text-slate-950">總務類表單</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {generalAffairsForms.map((form) => {
            const Icon = form.icon;

            return (
              <Link
                key={form.id}
                href={`/requests/new/${form.id}`}
                className="group rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm transition hover:border-[#d97706] hover:bg-[#fffaf4] hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-4">
                  <span className="rounded-lg bg-[#fff3de] p-2.5 text-[#b45309] transition group-hover:bg-[#d97706] group-hover:text-white">
                    <Icon className="h-5 w-5" />
                  </span>
                </div>
                <div className="mt-4">
                  <h2 className="font-black text-slate-900">{form.title}</h2>
                  <p className="mt-1 text-xs font-semibold text-[#8a4b06]">{form.subtitle}</p>
                </div>
                <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                  <span>{form.fields.length} 個欄位</span>
                  <span>{form.requiresAttachment ? "可能需附件" : "附件選填"}</span>
                </div>
                <div className="mt-3 flex items-center gap-1 text-sm font-bold text-[#b45309]">
                  開始填寫
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                </div>
              </Link>
            );
          })}
        </div>
      </section> : null}

      {documentForms.length ? <section>
        <div className="mb-3 flex items-center gap-2">
          <FileText className="h-5 w-5 text-[#b45309]" />
          <h2 className="font-black text-slate-950">文件類表單</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {documentForms.map((form) => {
            const Icon = form.icon;

            return (
              <Link
                key={form.id}
                href={`/requests/new/${form.id}`}
                className="group rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm transition hover:border-[#d97706] hover:bg-[#fffaf4] hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-4">
                  <span className="rounded-lg bg-[#fff3de] p-2.5 text-[#b45309] transition group-hover:bg-[#d97706] group-hover:text-white">
                    <Icon className="h-5 w-5" />
                  </span>
                </div>
                <div className="mt-4">
                  <h2 className="font-black text-slate-900">{form.title}</h2>
                  <p className="mt-1 text-xs font-semibold text-[#8a4b06]">{form.subtitle}</p>
                </div>
                <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                  <span>{form.fields.length} 個欄位</span>
                  <span>{form.requiresAttachment ? "可能需附件" : "附件選填"}</span>
                </div>
                <div className="mt-3 flex items-center gap-1 text-sm font-bold text-[#b45309]">
                  開始填寫
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                </div>
              </Link>
            );
          })}
        </div>
      </section> : null}

      {changeForms.length ? <section>
        <div className="mb-3 flex items-center gap-2">
          <GitCompareArrows className="h-5 w-5 text-[#b45309]" />
          <h2 className="font-black text-slate-950">異動類表單</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {changeForms.map((form) => {
            const Icon = form.icon;

            return (
              <Link
                key={form.id}
                href={`/requests/new/${form.id}`}
                className="group rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm transition hover:border-[#d97706] hover:bg-[#fffaf4] hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-4">
                  <span className="rounded-lg bg-[#fff3de] p-2.5 text-[#b45309] transition group-hover:bg-[#d97706] group-hover:text-white">
                    <Icon className="h-5 w-5" />
                  </span>
                </div>
                <div className="mt-4">
                  <h2 className="font-black text-slate-900">{form.title}</h2>
                  <p className="mt-1 text-xs font-semibold text-[#8a4b06]">{form.subtitle}</p>
                </div>
                <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                  <span>{form.fields.length} 個欄位</span>
                  <span>{form.requiresAttachment ? "可能需附件" : "附件選填"}</span>
                </div>
                <div className="mt-3 flex items-center gap-1 text-sm font-bold text-[#b45309]">
                  開始填寫
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                </div>
              </Link>
            );
          })}
        </div>
      </section> : null}

      {!visibleForms.length ? (
        <section className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-center">
          <h2 className="font-black text-rose-950">此角色目前沒有可送出的表單</h2>
          <p className="mt-2 text-sm text-rose-700">請由人資、行政部門主任或執行長到「系統設定 → 角色權限」勾選表單類別權限。</p>
        </section>
      ) : null}

    </div>
  );
}
