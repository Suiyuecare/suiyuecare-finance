"use client";

import Link from "next/link";
import { ArchiveX, ArrowRight, Building2, CalendarClock, Clock3, ClipboardList, FileClock, FileSearch, FileText, GitCompareArrows, HandCoins, Home, LogOut, MailOpen, Package, Search, ShieldCheck, Stamp, TriangleAlert, UploadCloud, UserPlus, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { canAny } from "@/lib/auth/rbac";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { requestFormDefinitions } from "@/lib/requests/form-catalog";

const attendanceFormIds = ["leave", "pre-overtime", "punch", "remote"];
const changeFormIds = ["position-change", "salary-change", "resignation", "new-hire"];
const documentFormIds = ["document", "labor-health-insurance-certificate", "employment-certificate"];
const businessFormIds = ["internal-approval", "meeting-minutes", "incident-report"];
const generalAffairsFormIds = ["equipment-request", "document-access-general", "official-mail-receipt", "company-seal-request", "venue-rental", "equipment-repair", "asset-disposal"];
const scenarioShortcuts = [
  { label: "我要請假", formId: "leave", hint: "特休、病假、家庭照顧假", icon: CalendarClock },
  { label: "我要預先申請加班", formId: "pre-overtime", hint: "事前核准加班", icon: Clock3 },
  { label: "我忘記打卡", formId: "punch", hint: "補上班、補下班、修正時間", icon: Clock3 },
  { label: "我要居家辦公", formId: "remote", hint: "居家遠端辦公申請", icon: Home },
];
const changeShortcuts = [
  { label: "職務調動", formId: "position-change", hint: "部門、職稱、主管異動", icon: GitCompareArrows },
  { label: "薪資異動", formId: "salary-change", hint: "本薪、津貼、投保級距", icon: HandCoins },
  { label: "離職申請", formId: "resignation", hint: "離職日、交接、面談", icon: LogOut },
  { label: "新進人員", formId: "new-hire", hint: "到職建檔與帳號開通", icon: UserPlus },
];
const documentShortcuts = [
  { label: "文件證明申請單", formId: "document", hint: "通用證明與其他文件", icon: FileText },
  { label: "勞健保證明申請單", formId: "labor-health-insurance-certificate", hint: "勞保、健保、投保證明", icon: FileText },
  { label: "在職證明申請單", formId: "employment-certificate", hint: "在職與任職資料證明", icon: FileText },
];
const businessShortcuts = [
  { label: "內部簽核", formId: "internal-approval", hint: "一般事項、採購、制度、專案", icon: ClipboardList },
  { label: "會議記錄上傳", formId: "meeting-minutes", hint: "會議紀錄、決議與待辦", icon: UploadCloud },
  { label: "異常事件通報", formId: "incident-report", hint: "營運、服務、資安或職安異常", icon: TriangleAlert },
];
const generalAffairsShortcuts = [
  { label: "設備請領申請單", formId: "equipment-request", hint: "設備、耗材、工作用品", icon: Package },
  { label: "各式文件調閱申請單（總務）", formId: "document-access-general", hint: "合約、憑證、歸檔文件", icon: FileSearch },
  { label: "公文收件申請單", formId: "official-mail-receipt", hint: "公文、掛號、重要郵件", icon: MailOpen },
  { label: "公司對外用印申請", formId: "company-seal-request", hint: "合約、正式文件用印", icon: Stamp },
  { label: "公司場地租借", formId: "venue-rental", hint: "會議室、教室、活動場地", icon: Building2 },
  { label: "設備維修申請書", formId: "equipment-repair", hint: "設備故障、維修、檢測", icon: Wrench },
  { label: "財產報廢申請", formId: "asset-disposal", hint: "固定資產與用品報廢", icon: ArchiveX },
];

export default function NewRequestPage() {
  const currentUser = useCurrentUser();
  const visibleForms = requestFormDefinitions.filter((form) => !form.hiddenFromRequestMenu && canAny(currentUser.role, form.permissions));
  const attendanceForms = visibleForms.filter((form) => attendanceFormIds.includes(form.id));
  const changeForms = visibleForms.filter((form) => changeFormIds.includes(form.id));
  const documentForms = visibleForms.filter((form) => documentFormIds.includes(form.id));
  const businessForms = visibleForms.filter((form) => businessFormIds.includes(form.id));
  const generalAffairsForms = visibleForms.filter((form) => generalAffairsFormIds.includes(form.id));
  const visibleShortcutIds = new Set(visibleForms.map((form) => form.id));

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

      {attendanceForms.length ? <section className="rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Search className="h-5 w-5 text-[#b45309]" />
          <h2 className="font-black text-slate-950">假勤類：你現在想做什麼？</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {scenarioShortcuts.filter((shortcut) => visibleShortcutIds.has(shortcut.formId)).map((shortcut) => {
            const Icon = shortcut.icon;
            return (
              <Link
                key={shortcut.formId}
                href={`/requests/new/${shortcut.formId}`}
                className="rounded-lg border border-[#ead8c2] bg-[#fffaf4] p-4 transition hover:border-[#d97706] hover:bg-[#fff3de]"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="rounded-lg bg-white p-2 text-[#b45309]">
                    <Icon className="h-5 w-5" />
                  </span>
                  <ArrowRight className="h-4 w-4 text-slate-400" />
                </div>
                <div className="mt-3 font-black text-slate-950">{shortcut.label}</div>
                <div className="mt-1 text-xs text-slate-500">{shortcut.hint}</div>
              </Link>
            );
          })}
        </div>
      </section> : null}

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
                <Badge variant="outline">{form.estimatedMinutes} 分鐘</Badge>
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

      {documentForms.length ? <section className="rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Search className="h-5 w-5 text-[#b45309]" />
          <h2 className="font-black text-slate-950">文件類：你現在想申請什麼？</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {documentShortcuts.filter((shortcut) => visibleShortcutIds.has(shortcut.formId)).map((shortcut) => {
            const Icon = shortcut.icon;
            return (
              <Link
                key={shortcut.formId}
                href={`/requests/new/${shortcut.formId}`}
                className="rounded-lg border border-[#ead8c2] bg-[#fffaf4] p-4 transition hover:border-[#d97706] hover:bg-[#fff3de]"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="rounded-lg bg-white p-2 text-[#b45309]">
                    <Icon className="h-5 w-5" />
                  </span>
                  <ArrowRight className="h-4 w-4 text-slate-400" />
                </div>
                <div className="mt-3 font-black text-slate-950">{shortcut.label}</div>
                <div className="mt-1 text-xs text-slate-500">{shortcut.hint}</div>
              </Link>
            );
          })}
        </div>
      </section> : null}

      {businessForms.length ? <section className="rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Search className="h-5 w-5 text-[#b45309]" />
          <h2 className="font-black text-slate-950">業務類：你現在想處理什麼？</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {businessShortcuts.filter((shortcut) => visibleShortcutIds.has(shortcut.formId)).map((shortcut) => {
            const Icon = shortcut.icon;
            return (
              <Link
                key={shortcut.formId}
                href={`/requests/new/${shortcut.formId}`}
                className="rounded-lg border border-[#ead8c2] bg-[#fffaf4] p-4 transition hover:border-[#d97706] hover:bg-[#fff3de]"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="rounded-lg bg-white p-2 text-[#b45309]">
                    <Icon className="h-5 w-5" />
                  </span>
                  <ArrowRight className="h-4 w-4 text-slate-400" />
                </div>
                <div className="mt-3 font-black text-slate-950">{shortcut.label}</div>
                <div className="mt-1 text-xs text-slate-500">{shortcut.hint}</div>
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
                  <Badge variant="outline">{form.estimatedMinutes} 分鐘</Badge>
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

      {generalAffairsForms.length ? <section className="rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Search className="h-5 w-5 text-[#b45309]" />
          <h2 className="font-black text-slate-950">總務類（採購/維修）：你現在想處理什麼？</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {generalAffairsShortcuts.filter((shortcut) => visibleShortcutIds.has(shortcut.formId)).map((shortcut) => {
            const Icon = shortcut.icon;
            return (
              <Link
                key={shortcut.formId}
                href={`/requests/new/${shortcut.formId}`}
                className="rounded-lg border border-[#ead8c2] bg-[#fffaf4] p-4 transition hover:border-[#d97706] hover:bg-[#fff3de]"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="rounded-lg bg-white p-2 text-[#b45309]">
                    <Icon className="h-5 w-5" />
                  </span>
                  <ArrowRight className="h-4 w-4 text-slate-400" />
                </div>
                <div className="mt-3 font-black text-slate-950">{shortcut.label}</div>
                <div className="mt-1 text-xs text-slate-500">{shortcut.hint}</div>
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
                  <Badge variant="outline">{form.estimatedMinutes} 分鐘</Badge>
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
                  <Badge variant="outline">{form.estimatedMinutes} 分鐘</Badge>
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

      {changeForms.length ? <section className="rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Search className="h-5 w-5 text-[#b45309]" />
          <h2 className="font-black text-slate-950">異動類：你現在想做什麼？</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {changeShortcuts.filter((shortcut) => visibleShortcutIds.has(shortcut.formId)).map((shortcut) => {
            const Icon = shortcut.icon;
            return (
              <Link
                key={shortcut.formId}
                href={`/requests/new/${shortcut.formId}`}
                className="rounded-lg border border-[#ead8c2] bg-[#fffaf4] p-4 transition hover:border-[#d97706] hover:bg-[#fff3de]"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="rounded-lg bg-white p-2 text-[#b45309]">
                    <Icon className="h-5 w-5" />
                  </span>
                  <ArrowRight className="h-4 w-4 text-slate-400" />
                </div>
                <div className="mt-3 font-black text-slate-950">{shortcut.label}</div>
                <div className="mt-1 text-xs text-slate-500">{shortcut.hint}</div>
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
                  <Badge variant="outline">{form.estimatedMinutes} 分鐘</Badge>
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

      <section className="rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-[#b45309]" />
          <h2 className="font-black text-slate-950">簽核提醒</h2>
        </div>
        <div className="mt-3 grid gap-2 text-sm text-slate-600 md:grid-cols-2 xl:grid-cols-4">
          {["你只需要選表單、填必填、送出。", "固定流程：申請人主管 → 部門主管 → 行政主任 → 人資。", "退回補件會回到表單追蹤，不用重填。", "低於法規底線的申請會被系統擋下。"].map((item) => (
            <div key={item} className="rounded-lg bg-[#fffaf4] px-3 py-2">{item}</div>
          ))}
        </div>
      </section>
    </div>
  );
}
