"use client";

import { cn } from "@/lib/utils";

export type FinanceApprovalStepState = "done" | "current" | "pending" | "returned" | "rejected";

export type FinanceApprovalStep = {
  label: string;
  detail: string;
  state?: FinanceApprovalStepState;
  actedAt?: string;
  comment?: string;
  badge?: string;
};

const stateClassName: Record<FinanceApprovalStepState, {
  dot: string;
  label: string;
  badge: string;
}> = {
  done: {
    dot: "border-emerald-600 bg-emerald-600 text-white",
    label: "text-emerald-900",
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  current: {
    dot: "border-[#d97706] bg-[#d97706] text-white",
    label: "text-[#7c3f00]",
    badge: "border-[#f0c987] bg-[#fff3de] text-[#8a4b06]",
  },
  pending: {
    dot: "border-[#e0d0b8] bg-[#fffaf4] text-[#b09070]",
    label: "text-slate-800",
    badge: "border-slate-200 bg-slate-50 text-slate-500",
  },
  returned: {
    dot: "border-violet-500 bg-violet-500 text-white",
    label: "text-violet-900",
    badge: "border-violet-200 bg-violet-50 text-violet-700",
  },
  rejected: {
    dot: "border-rose-500 bg-rose-500 text-white",
    label: "text-rose-900",
    badge: "border-rose-200 bg-rose-50 text-rose-700",
  },
};

const stateLabel: Record<FinanceApprovalStepState, string> = {
  done: "已完成",
  current: "目前關卡",
  pending: "尚未到站",
  returned: "退回補件",
  rejected: "已駁回",
};

export function FinanceStyleApprovalFlow({
  steps,
  title,
  subtitle = "每關任務",
  compact = false,
}: {
  steps: FinanceApprovalStep[];
  title?: string;
  subtitle?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("rounded-lg border border-[#ead8c2] bg-white", compact ? "p-3" : "p-4")}>
      {title ? (
        <div className="mb-3 flex items-center justify-between gap-3 border-b border-[#f0e0c8] pb-3">
          <div className="min-w-0 font-black text-slate-950">{title}</div>
          <div className="shrink-0 text-[10px] font-bold text-slate-400">{subtitle}</div>
        </div>
      ) : null}
      <ol className="space-y-0">
        {steps.map((step, index) => {
          const state = step.state ?? "pending";
          const tone = stateClassName[state];

          return (
            <li key={`${step.label}-${index}`} className="relative flex gap-3">
              {index < steps.length - 1 ? (
                <span className="absolute left-[9px] top-6 h-[calc(100%-1.25rem)] w-px bg-[#e0d0b8]" aria-hidden="true" />
              ) : null}
              <span
                className={cn(
                  "relative z-[1] mt-0.5 flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full border text-[9px] font-black",
                  tone.dot,
                )}
              >
                {state === "current" && step.badge ? step.badge : index + 1}
              </span>
              <div className={cn("min-w-0 flex-1", compact ? "pb-3" : "pb-4")}>
                <div className="flex flex-wrap items-center gap-2">
                  <div className={cn("text-sm font-black", tone.label)}>{step.label}</div>
                  <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold", tone.badge)}>
                    {stateLabel[state]}
                  </span>
                </div>
                <div className={cn("mt-1 leading-5 text-slate-500", compact ? "text-[11px]" : "text-xs")}>{step.detail}</div>
                {step.actedAt ? <div className="mt-1 text-[10px] font-semibold text-slate-400">時間：{step.actedAt}</div> : null}
                {step.comment ? (
                  <div className="mt-2 inline-block rounded-md border border-[#d97706] bg-white px-2 py-1 text-[11px] font-bold leading-5 text-slate-800 shadow-sm">
                    {step.comment}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
