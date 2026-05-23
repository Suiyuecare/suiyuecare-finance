"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock3, ExternalLink, FileClock, RefreshCw, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { upsertPunchCorrectionFromAnomaly } from "@/lib/attendance/punch-correction-store";
import { getGoogleMapsUrl } from "@/lib/maps/google-maps";
import { getLiveClient } from "@/lib/supabase/live-modules";

type AttendancePunchRow = {
  id: string;
  user_id: string;
  punched_at: string;
  punch_type: string;
  latitude: number | string | null;
  longitude: number | string | null;
  address: string | null;
  passed_rule: string | null;
  rule_name: string | null;
  is_abnormal: boolean;
  abnormal_reason: string | null;
  review_status: string;
  users?: {
    display_name?: string | null;
    employees?: {
      employee_no?: string | null;
      full_name?: string | null;
      branches?: { name?: string | null } | null;
    } | null;
  } | null;
};

const anomalyTypes = [
  "遲到",
  "早退",
  "曠職",
  "未打上班卡",
  "未打下班卡",
  "打卡地點異常",
  "工時不足",
  "工時超過",
  "休息時間不足",
  "非排班日打卡",
];

const reviewStatusLabels: Record<string, string> = {
  none: "未審核",
  pending: "待審核",
  approved: "已確認",
  rejected: "已駁回",
  pending_correction: "待補卡",
};

const reviewStatusStyles: Record<string, string> = {
  none: "bg-amber-50 text-amber-700 border-amber-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-rose-50 text-rose-700 border-rose-200",
  pending_correction: "bg-cyan-50 text-cyan-700 border-cyan-200",
};

function formatTime(value: string | null) {
  if (!value) return "未打卡";
  return new Intl.DateTimeFormat("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date(value));
}

function punchTypeLabel(type: string) {
  const labels: Record<string, string> = {
    clock_in: "上班",
    clock_out: "下班",
    out: "外出",
    return: "返回",
  };
  return labels[type] ?? type;
}

function getEmployeeName(punch: AttendancePunchRow) {
  return punch.users?.employees?.full_name ?? punch.users?.display_name ?? "未命名使用者";
}

function getEmployeeNo(punch: AttendancePunchRow) {
  return punch.users?.employees?.employee_no ?? punch.user_id;
}

export default function AttendanceAnomaliesPage() {
  const currentUser = useCurrentUser();
  const [punches, setPunches] = useState<AttendancePunchRow[]>([]);
  const [message, setMessage] = useState("正在讀取 Supabase 出勤異常資料...");
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    void loadAnomalies();
  }, []);

  async function loadAnomalies() {
    try {
      const supabase = getLiveClient();
      const { data, error } = await supabase
        .from("attendance_punches")
        .select("id,user_id,punched_at,punch_type,latitude,longitude,address,passed_rule,rule_name,is_abnormal,abnormal_reason,review_status,users(display_name,employees(employee_no,full_name,branches(name)))")
        .is("deleted_at", null)
        .order("punched_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      setPunches((data ?? []) as AttendancePunchRow[]);
      setMessage(`已連線 Supabase，載入 ${(data ?? []).length} 筆打卡紀錄。`);
    } catch (error) {
      setPunches([]);
      setMessage(error instanceof Error ? error.message : "出勤異常資料讀取失敗。");
    }
  }

  const abnormalPunches = useMemo(() => punches.filter((punch) => punch.is_abnormal), [punches]);
  const normalCount = punches.length - abnormalPunches.length;
  const pendingReviewPunches = useMemo(
    () => abnormalPunches.filter((punch) => ["none", "pending", "", null].includes(punch.review_status)),
    [abnormalPunches],
  );
  const correctionNeededPunches = useMemo(
    () =>
      pendingReviewPunches.filter((punch) =>
        `${punch.abnormal_reason ?? ""} ${punch.punch_type}`.includes("未打") ||
        `${punch.abnormal_reason ?? ""}`.includes("補卡"),
      ),
    [pendingReviewPunches],
  );
  const pendingReviewCount = pendingReviewPunches.length;

  async function updatePunchReviewStatus(ids: string[], reviewStatus: "approved" | "pending_correction" | "rejected", successMessage: string) {
    if (!ids.length) {
      setMessage("目前沒有符合條件的出勤異常可處理。");
      return;
    }

    setIsProcessing(true);
    try {
      const supabase = getLiveClient();
      const { error } = await supabase
        .from("attendance_punches")
        .update({ review_status: reviewStatus, updated_at: new Date().toISOString() })
        .in("id", ids);
      if (error) throw error;
      setPunches((current) =>
        current.map((punch) => (ids.includes(punch.id) ? { ...punch, review_status: reviewStatus } : punch)),
      );
      setMessage(successMessage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "出勤異常處理失敗。");
    } finally {
      setIsProcessing(false);
    }
  }

  function oneClickConfirmDepartmentAnomalies() {
    void updatePunchReviewStatus(
      pendingReviewPunches.map((punch) => punch.id),
      "approved",
      `已一鍵確認 ${pendingReviewPunches.length} 筆部門出勤異常，薪資前置阻擋會同步解除。`,
    );
  }

  function oneClickSendToPunchCorrection() {
    void sendPunchesToCorrection(correctionNeededPunches);
  }

  async function sendPunchesToCorrection(targetPunches: AttendancePunchRow[]) {
    if (!targetPunches.length) {
      setMessage("目前沒有可轉補卡的出勤異常。");
      return;
    }

    targetPunches.forEach((punch) => {
      upsertPunchCorrectionFromAnomaly({
        anomalyId: punch.id,
        employeeId: punch.user_id,
        employeeName: getEmployeeName(punch),
        punchType: punch.punch_type,
        workDate: formatDate(punch.punched_at),
        punchTime: formatTime(punch.punched_at),
        reason: punch.abnormal_reason ?? "由部門出勤異常轉入補卡待處理。",
        address: punch.address ?? "未提供地址",
        actorName: currentUser.name || "主管",
      });
    });

    await updatePunchReviewStatus(
      targetPunches.map((punch) => punch.id),
      "pending_correction",
      `已將 ${targetPunches.length} 筆出勤異常建立為補卡待處理，請到補打卡申請頁追蹤簽核與回寫。`,
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold tracking-[0.14em] text-primary">ATTENDANCE ANOMALIES</p>
          <h1 className="mt-2 text-2xl font-black text-foreground">出勤異常自動判斷</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            此頁改讀 Supabase `attendance_punches` 的正式異常標記；班表法規檢核會在排班與結薪流程攔截。
          </p>
        </div>
        <Badge variant="secondary">{formatDate(new Date().toISOString())}</Badge>
      </div>

      <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">{message}</div>

      <Card className="rounded-lg border-amber-200 bg-amber-50/70">
        <CardContent className="grid gap-4 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="flex gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div>
              <div className="font-black text-amber-950">部門出勤異常一鍵處理</div>
              <p className="mt-1 text-sm text-amber-900">
                主管可先批次確認低風險異常；未打卡、缺佐證或需改時間的紀錄，會直接建立補卡待處理單，補卡完成後再回寫出勤，避免卡住薪資結算。
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold text-amber-950">
                <span className="rounded-full bg-white px-3 py-1">待審 {pendingReviewCount}</span>
                <span className="rounded-full bg-white px-3 py-1">可轉補卡 {correctionNeededPunches.length}</span>
                <span className="rounded-full bg-white px-3 py-1">會影響薪資 {pendingReviewCount}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <Button
              onClick={oneClickConfirmDepartmentAnomalies}
              disabled={isProcessing || pendingReviewCount === 0}
            >
              <CheckCircle2 className="h-4 w-4" />
              一鍵確認
            </Button>
            <Button
              variant="outline"
              onClick={oneClickSendToPunchCorrection}
              disabled={isProcessing || correctionNeededPunches.length === 0}
            >
              <FileClock className="h-4 w-4" />
              一鍵轉補卡
            </Button>
            <Button variant="outline" onClick={() => void loadAnomalies()} disabled={isProcessing}>
              <RefreshCw className={`h-4 w-4 ${isProcessing ? "animate-spin" : ""}`} />
              重新同步
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-lg border-cyan-200 bg-cyan-50/70">
        <CardContent className="grid gap-3 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div className="font-black text-cyan-950">出勤異常 → 補卡 → 回寫出勤</div>
            <p className="mt-1 text-sm text-cyan-800">
              點「轉補卡」後，補打卡申請頁會出現來源異常、原因、地址與原始打卡時間；主管與人資可沿同一條流程追蹤到薪資前置解除。
            </p>
          </div>
          <a href="/punch-corrections" className="inline-flex items-center justify-center rounded-lg border border-cyan-200 bg-white px-3 py-2 text-sm font-bold text-cyan-800">
            查看補卡待處理
          </a>
        </CardContent>
      </Card>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="rounded-lg">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarClock className="h-4 w-4 text-primary" />
              打卡紀錄
            </div>
            <div className="mt-2 text-2xl font-black">{punches.length}</div>
          </CardContent>
        </Card>
        <Card className="rounded-lg">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldAlert className="h-4 w-4 text-rose-600" />
              異常筆數
            </div>
            <div className="mt-2 text-2xl font-black text-rose-600">{abnormalPunches.length}</div>
          </CardContent>
        </Card>
        <Card className="rounded-lg">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              待審核
            </div>
            <div className="mt-2 text-2xl font-black text-amber-600">{pendingReviewCount}</div>
          </CardContent>
        </Card>
        <Card className="rounded-lg">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              正常筆數
            </div>
            <div className="mt-2 text-2xl font-black text-emerald-600">{normalCount}</div>
          </CardContent>
        </Card>
      </section>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle>異常類型覆蓋</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {anomalyTypes.map((type) => (
            <Badge key={type} variant="secondary">
              {type}
            </Badge>
          ))}
        </CardContent>
      </Card>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle>正式打卡異常清單</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1120px] text-left text-sm">
                <thead className="bg-muted/70 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-bold">員工</th>
                    <th className="px-4 py-3 font-bold">日期</th>
                    <th className="px-4 py-3 font-bold">打卡類型</th>
                    <th className="px-4 py-3 font-bold">打卡時間</th>
                    <th className="px-4 py-3 font-bold">據點/地址</th>
                <th className="px-4 py-3 font-bold">GPS/Wi-Fi/IP</th>
                <th className="px-4 py-3 font-bold">異常狀態</th>
                <th className="px-4 py-3 font-bold">審核狀態</th>
                <th className="px-4 py-3 text-right font-bold">一鍵操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
                  {abnormalPunches.length ? abnormalPunches.map((punch) => {
                    const employee = punch.users?.employees;
                    const canTransfer = punch.review_status !== "pending_correction";
                    const mapsUrl = getGoogleMapsUrl(punch.latitude, punch.longitude);

                    return (
                      <tr key={punch.id} className="bg-card hover:bg-muted/40">
                        <td className="px-4 py-3">
                          <div className="font-bold">{getEmployeeName(punch)}</div>
                          <div className="text-xs text-muted-foreground">{getEmployeeNo(punch).slice(0, 12)}</div>
                        </td>
                        <td className="px-4 py-3">{formatDate(punch.punched_at)}</td>
                        <td className="px-4 py-3">{punchTypeLabel(punch.punch_type)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Clock3 className="h-4 w-4 text-primary" />
                            {formatTime(punch.punched_at)}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div>{employee?.branches?.name ?? "未分類據點"}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{punch.address ?? "未提供地址"}</div>
                          {mapsUrl ? (
                            <a
                              className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-primary underline-offset-4 hover:underline"
                              href={mapsUrl}
                            >
                              <ExternalLink className="h-3 w-3" />
                              Google Maps
                            </a>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold">{punch.passed_rule ?? punch.rule_name ?? "未標記"}</div>
                          {mapsUrl ? (
                            <div className="mt-1 text-xs text-muted-foreground">
                              {Number(punch.latitude).toFixed(6)}, {Number(punch.longitude).toFixed(6)}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <Badge className="bg-rose-600">{punch.abnormal_reason ?? "異常打卡"}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${
                              reviewStatusStyles[punch.review_status || "none"] ?? "border-slate-200 bg-slate-50 text-slate-600"
                            }`}
                          >
                            {reviewStatusLabels[punch.review_status || "none"] ?? punch.review_status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                void updatePunchReviewStatus([punch.id], "approved", `${employee?.full_name ?? "員工"} 的出勤異常已確認。`)
                              }
                              disabled={isProcessing || punch.review_status === "approved"}
                            >
                              確認
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void sendPunchesToCorrection([punch])}
                              disabled={isProcessing || !canTransfer}
                            >
                              {canTransfer ? "轉補卡" : "已轉補卡"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  }) : (
                    <tr>
                      <td className="px-4 py-8 text-center text-muted-foreground" colSpan={9}>
                        目前沒有 Supabase 正式異常打卡紀錄。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
