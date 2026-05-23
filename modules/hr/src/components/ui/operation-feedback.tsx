"use client";

import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Info,
  Loader2,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type OperationStatus = "idle" | "loading" | "success" | "warning" | "error" | "blocked";

const statusConfig: Record<OperationStatus, {
  label: string;
  icon: LucideIcon;
  className: string;
  iconClassName: string;
}> = {
  idle: {
    label: "待操作",
    icon: Info,
    className: "border-slate-200 bg-slate-50 text-slate-700",
    iconClassName: "text-slate-500",
  },
  loading: {
    label: "處理中",
    icon: Loader2,
    className: "border-sky-200 bg-sky-50 text-sky-800",
    iconClassName: "animate-spin text-sky-600",
  },
  success: {
    label: "已完成",
    icon: CheckCircle2,
    className: "border-emerald-200 bg-emerald-50 text-emerald-800",
    iconClassName: "text-emerald-600",
  },
  warning: {
    label: "需確認",
    icon: AlertTriangle,
    className: "border-amber-200 bg-amber-50 text-amber-900",
    iconClassName: "text-amber-600",
  },
  error: {
    label: "操作失敗",
    icon: XCircle,
    className: "border-rose-200 bg-rose-50 text-rose-900",
    iconClassName: "text-rose-600",
  },
  blocked: {
    label: "已阻擋",
    icon: ShieldAlert,
    className: "border-rose-300 bg-rose-50 text-rose-900",
    iconClassName: "text-rose-700",
  },
};

export function inferOperationStatus(message: string, isLoading = false): OperationStatus {
  if (isLoading || message.includes("正在") || message.includes("處理中") || message.includes("同步中") || message.includes("送出中")) {
    return "loading";
  }
  if (message.includes("阻擋") || message.includes("不可") || message.includes("不得") || message.includes("不能")) {
    return "blocked";
  }
  if (message.includes("失敗") || message.includes("錯誤") || message.includes("找不到") || message.includes("尚未設定")) {
    return "error";
  }
  if (message.includes("需") || message.includes("請先") || message.includes("警示") || message.includes("未通過") || message.includes("補件")) {
    return "warning";
  }
  if (message.includes("已") || message.includes("通過") || message.includes("完成") || message.includes("成功")) {
    return "success";
  }
  return "idle";
}

export function OperationFeedback({
  title = "操作狀態",
  message,
  status,
  details = [],
  updatedAt,
  actionLabel,
  actionHref,
  className,
}: {
  title?: string;
  message: string;
  status?: OperationStatus;
  details?: string[];
  updatedAt?: Date | string;
  actionLabel?: string;
  actionHref?: string;
  className?: string;
}) {
  const resolvedStatus = status ?? inferOperationStatus(message);
  const config = statusConfig[resolvedStatus];
  const Icon = config.icon;
  const formattedTime =
    updatedAt instanceof Date
      ? updatedAt.toLocaleTimeString("zh-TW", { hour12: false })
      : updatedAt;

  return (
    <div className={cn("rounded-lg border px-4 py-3 shadow-sm", config.className, className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="mt-0.5 shrink-0">
            <Icon className={cn("h-5 w-5", config.iconClassName)} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-black">{title}</span>
              <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-bold">{config.label}</span>
              {formattedTime ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold opacity-80">
                  <Clock3 className="h-3.5 w-3.5" />
                  {formattedTime}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm leading-6">{message}</p>
            {details.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {details.map((detail) => (
                  <span key={detail} className="rounded-full bg-white/70 px-2 py-1 text-xs font-semibold">
                    {detail}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        {actionHref && actionLabel ? (
          <Link
            href={actionHref}
            className="inline-flex shrink-0 items-center justify-center rounded-md bg-white px-3 py-2 text-xs font-black text-slate-700 shadow-sm hover:bg-white/80"
          >
            {actionLabel}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export function OperationTimeline({
  steps,
}: {
  steps: Array<{ label: string; status: OperationStatus; detail?: string }>;
}) {
  return (
    <div className="grid gap-2">
      {steps.map((step, index) => {
        const config = statusConfig[step.status];
        const Icon = config.icon;

        return (
          <div key={`${step.label}-${index}`} className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3">
            <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-black", config.className)}>
              {step.status === "loading" ? <Icon className={cn("h-3.5 w-3.5", config.iconClassName)} /> : index + 1}
            </span>
            <div>
              <div className="font-bold text-slate-900">{step.label}</div>
              {step.detail ? <div className="mt-1 text-xs leading-5 text-slate-500">{step.detail}</div> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
