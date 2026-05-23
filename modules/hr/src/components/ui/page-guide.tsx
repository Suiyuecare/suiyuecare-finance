"use client";

import Link from "next/link";
import { BookOpenCheck, ChevronDown, Lightbulb, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PageGuide as PageGuideData } from "@/lib/help/page-guidance";
import { can, type HrRole } from "@/lib/auth/rbac";

export function PageGuide({
  guide,
  role,
}: {
  guide: PageGuideData;
  role: HrRole;
}) {
  const primaryVisible = guide.primaryAction && canViewAction(guide.primaryAction, role);
  const secondaryVisible = guide.secondaryAction && canViewAction(guide.secondaryAction, role);

  return (
    <details className="group rounded-lg border border-[#ead8c2] bg-white shadow-[0_8px_24px_rgba(52,36,18,0.04)]">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-4 py-3 marker:hidden">
        <div className="flex min-w-0 gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#fff3de] text-[#b45309]">
            <BookOpenCheck className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-black text-slate-950">操作教學</span>
              <span className="rounded-full bg-[#fff7ed] px-2 py-0.5 text-xs font-black text-[#8a4b06]">
                {guide.title}
              </span>
            </div>
            <p className="mt-1 text-sm leading-6 text-slate-500">{guide.summary}</p>
          </div>
        </div>
        <ChevronDown className="mt-2 h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180" />
      </summary>

      <div className="border-t border-[#f0dfcd] px-4 py-4">
        <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
          <div>
            <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-800">
              <ListChecks className="h-4 w-4 text-[#b45309]" />
              建議操作順序
            </div>
            <ol className="grid gap-2">
              {guide.steps.map((step, index) => (
                <li key={step} className="flex gap-3 rounded-md border border-[#f0dfcd] bg-[#fffaf4] p-3 text-sm leading-6 text-slate-700">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-black text-[#b45309]">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="rounded-lg border border-dashed border-[#dfc9b1] bg-[#fffaf4] p-4">
            <div className="flex items-center gap-2 text-sm font-black text-slate-800">
              <Lightbulb className="h-4 w-4 text-[#b45309]" />
              空狀態怎麼辦
            </div>
            <h3 className="mt-3 text-base font-black text-slate-950">{guide.emptyTitle}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">{guide.emptyDescription}</p>
            {(primaryVisible || secondaryVisible) ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {primaryVisible ? (
                  <Button asChild size="sm">
                    <Link href={guide.primaryAction!.href}>{guide.primaryAction!.label}</Link>
                  </Button>
                ) : null}
                {secondaryVisible ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href={guide.secondaryAction!.href}>{guide.secondaryAction!.label}</Link>
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </details>
  );
}

function canViewAction(action: NonNullable<PageGuideData["primaryAction"]>, role: HrRole) {
  return !action.permissions?.length || action.permissions.some((permission) => can(role, permission));
}
