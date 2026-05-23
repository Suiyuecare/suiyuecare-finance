"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  Award,
  Banknote,
  BriefcaseBusiness,
  CalendarDays,
  Clock3,
  FileArchive,
  FileText,
  GraduationCap,
  History,
  IdCard,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  TrendingUp,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  canViewIndividualPayrollData,
  canViewSensitiveEmployeeData,
  maskNationalId,
  maskText,
  restrictedValue,
} from "@/lib/auth/privacy";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import {
  genderLabels,
  statusClassNames,
  statusLabels,
  type Employee,
} from "@/lib/employees/mock-data";
import { loadEmployees } from "@/lib/employees/employee-store";

type TabKey =
  | "basic"
  | "employment"
  | "payroll"
  | "attendance"
  | "leave"
  | "overtime"
  | "licenses"
  | "training"
  | "documents"
  | "changes";

const tabs: Array<{ key: TabKey; label: string; icon: typeof UserRound }> = [
  { key: "basic", label: "基本資料", icon: UserRound },
  { key: "employment", label: "任職資料", icon: BriefcaseBusiness },
  { key: "payroll", label: "薪資資料", icon: Banknote },
  { key: "attendance", label: "出勤紀錄", icon: Clock3 },
  { key: "leave", label: "請假紀錄", icon: CalendarDays },
  { key: "overtime", label: "加班紀錄", icon: History },
  { key: "licenses", label: "證照紀錄", icon: IdCard },
  { key: "training", label: "教育訓練", icon: GraduationCap },
  { key: "documents", label: "文件附件", icon: FileArchive },
  { key: "changes", label: "異動紀錄", icon: Award },
];

const payrollItems: [string, string][] = [
  ["薪資型態", "月薪"],
  ["本薪", "45,000"],
  ["伙食津貼", "2,400"],
  ["職務津貼", "5,000"],
  ["證照津貼", "1,500"],
  ["交通津貼", "1,200"],
  ["全勤獎金", "1,000"],
  ["主管加給", "0"],
  ["勞保級距", "45,800"],
  ["健保級距", "45,800"],
  ["勞退提繳", "6%"],
  ["所得稅設定", "依扶養人數與薪資級距"],
  ["二代健保設定", "啟用補充保費檢核"],
  ["銀行帳號", "808 *** *** 12345"],
];

const attendanceRows = [
  ["2026-05-18", "日班", "09:00-18:00", "08:58", "18:06", "8.1", "正常", "總公司"],
  ["2026-05-17", "日班", "09:00-18:00", "09:08", "18:02", "7.9", "遲到 8 分", "總公司"],
  ["2026-05-16", "外勤", "09:00-18:00", "09:00", "17:46", "7.8", "GPS 異常待審", "台北居服站"],
  ["2026-05-15", "日班", "09:00-18:00", "08:55", "18:01", "8.1", "正常", "總公司"],
];

const leaveRows = [
  ["2026-05-06", "特休", "整日", "8", "已核准", "家庭行程", "主管/人資"],
  ["2026-04-22", "病假", "上午", "4", "已核准", "門診", "主管/人資"],
  ["2026-03-15", "事假", "16:00-18:00", "2", "已核准", "個人事務", "主管/人資"],
];

const overtimeRows = [
  ["2026-05-10", "平日加班", "18:30-21:00", "2.5", "加班費", "已核准"],
  ["2026-04-28", "休息日加班", "09:00-13:00", "4", "補休", "已核准"],
  ["2026-03-29", "國定假日出勤", "09:00-18:00", "8", "加班費", "已核准"],
];

const licenseRows = [
  ["長照小卡", "LC-2024-018", "2024-08-01", "2026-06-30", "即將到期", "已上傳"],
  ["CPR 證照", "CPR-5531", "2025-01-12", "2027-01-11", "有效", "已上傳"],
  ["失智症訓練證明", "DEM-2025-411", "2025-05-20", "2028-05-19", "有效", "已上傳"],
];

const trainingRows = [
  ["新人職前訓練", "職前訓練", "2026-05-03", "8", "已完成"],
  ["長照倫理與個資保護", "法遵", "2026-04-18", "3", "已完成"],
  ["感染管制與安全照護", "專業課程", "2026-03-22", "4", "已完成"],
];

const documentRows = [
  ["勞動契約", "PDF", "2026-05-01", "已簽署", "人資專區"],
  ["身分證附件", "PDF", "2026-05-01", "已歸檔", "個資文件"],
  ["體檢報告", "PDF", "2026-05-04", "待複核", "健康檢查"],
  ["在職證明", "PDF", "2026-05-10", "可下載", "員工申請"],
];

const changeRows = [
  ["2026-05-01", "到職", "未建立", "在職", "新人報到", "陳羽俊"],
  ["2026-05-08", "據點異動", "總公司", "台北居服站", "支援居服排班", "王淑芬"],
  ["2026-05-12", "薪資異動", "本薪 42,000", "本薪 45,000", "試用期調整", "陳羽俊"],
];

function InfoGrid({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {rows.map(([label, value]) => (
        <div key={label} className="rounded-lg border p-4">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="mt-2 font-bold">{value || "未設定"}</div>
        </div>
      ))}
    </div>
  );
}

function SummaryCard({ label, value, detail, icon: Icon }: { label: string; value: string; detail: string; icon: typeof UserRound }) {
  return (
    <Card className="rounded-lg">
      <CardContent className="flex items-start gap-3 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="mt-1 text-xl font-black">{value}</div>
          <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function SectionIntro({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <div className="font-black">{title}</div>
      <div className="mt-1 text-sm text-muted-foreground">{description}</div>
    </div>
  );
}

function DataTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  const badgeWords = ["正常", "已核准", "有效", "已完成", "已簽署", "已歸檔", "可下載"];
  const warningWords = ["遲到", "異常", "即將到期", "待複核", "待審"];

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-muted/70 text-xs text-muted-foreground">
            <tr>
              {headers.map((header) => (
                <th key={header} className="px-4 py-3 font-bold">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.join("-")} className="bg-card">
                {row.map((cell, index) => {
                  const shouldUseSuccessBadge = badgeWords.some((word) => cell.includes(word));
                  const shouldUseWarningBadge = warningWords.some((word) => cell.includes(word));
                  return (
                    <td key={`${cell}-${index}`} className="px-4 py-3">
                      {shouldUseSuccessBadge || shouldUseWarningBadge ? (
                        <Badge className={shouldUseWarningBadge ? "bg-amber-600" : "bg-emerald-600"}>
                          {cell}
                        </Badge>
                      ) : (
                        cell
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function calculateAge(birthday: string) {
  if (!birthday) return "未設定";
  const birthDate = new Date(birthday);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) age -= 1;
  return `${age} 歲`;
}

function calculateTenure(hireDate: string, terminationDate?: string) {
  if (!hireDate) return "未設定";
  const start = new Date(hireDate);
  const end = terminationDate ? new Date(terminationDate) : new Date();
  const months = Math.max(0, (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth());
  return `${Math.floor(months / 12)} 年 ${months % 12} 個月`;
}

export default function EmployeeDetailPage() {
  const params = useParams<{ employeeNo: string }>();
  const currentUser = useCurrentUser();
  const [activeTab, setActiveTab] = useState<TabKey>("basic");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [loadMessage, setLoadMessage] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadRows() {
      setLoadMessage("");
      try {
        const rows = await loadEmployees();
        if (!isMounted) return;
        setEmployees(rows);
      } catch (error) {
        if (!isMounted) return;
        setLoadMessage(error instanceof Error ? error.message : "讀取 Supabase 員工資料失敗。");
      } finally {
        if (isMounted) setIsReady(true);
      }
    }

    void loadRows();

    return () => {
      isMounted = false;
    };
  }, []);

  const employee = useMemo<Employee | undefined>(
    () =>
      employees.find(
        (item) => item.employeeNo === decodeURIComponent(params.employeeNo),
      ),
    [employees, params.employeeNo],
  );

  if (!employee && !isReady) {
    return (
      <Card className="rounded-lg">
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          正在讀取員工資料...
        </CardContent>
      </Card>
    );
  }

  if (!employee) {
    return (
      <Card className="rounded-lg">
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          {loadMessage || "找不到此員工資料。"}
        </CardContent>
      </Card>
    );
  }

  const tenure = calculateTenure(employee.hireDate, employee.terminationDate);
  const age = calculateAge(employee.birthday);
  const alertCount = licenseRows.filter((row) => row[4].includes("即將到期")).length + attendanceRows.filter((row) => row[6].includes("異常") || row[6].includes("遲到")).length;
  const canViewSensitive = canViewSensitiveEmployeeData(currentUser);
  const canViewPayroll = canViewIndividualPayrollData(currentUser);
  const visibleTabs = tabs.filter((tab) => {
    if (tab.key === "payroll") return canViewPayroll;
    if (tab.key === "documents") return canViewSensitive;
    return true;
  });
  const safeChangeRows = canViewPayroll ? changeRows : changeRows.filter((row) => !row[1].includes("薪資"));
  const safeActiveTab = visibleTabs.some((tab) => tab.key === activeTab) ? activeTab : "basic";
  const basicRows: [string, string][] = canViewSensitive
    ? [
        ["員工編號", employee.employeeNo],
        ["中文姓名", employee.name],
        ["英文姓名", restrictedValue(canViewSensitive, employee.englishName, maskText(employee.englishName, 2))],
        ["身分證字號", restrictedValue(canViewSensitive, employee.nationalId, maskNationalId(employee.nationalId))],
        ["生日", restrictedValue(canViewSensitive, employee.birthday, "已遮罩")],
        ["年齡", age],
        ["性別", genderLabels[employee.gender]],
        ["手機", employee.phone || "未設定"],
        ["Email", employee.email || "未設定"],
        ["戶籍地址", employee.registeredAddress || "未設定"],
        ["通訊地址", employee.mailingAddress || "未設定"],
        ["緊急聯絡人", employee.emergencyContact || "未設定"],
        ["緊急聯絡人電話", employee.emergencyPhone || "未設定"],
      ]
    : [
        ["員工編號", employee.employeeNo],
        ["中文姓名", employee.name],
        ["部門", employee.department],
        ["據點", employee.branch],
        ["職稱", employee.position],
        ["任職狀態", statusLabels[employee.status]],
      ];

  return (
    <div className="space-y-5">
      <Card className="rounded-lg">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-primary text-xl font-black text-primary-foreground">
                {employee.name.slice(0, 1)}
              </div>
              <div>
                <p className="text-sm font-semibold tracking-[0.14em] text-primary">EMPLOYEE PROFILE</p>
                <h1 className="mt-1 text-2xl font-black">{employee.name}</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {employee.employeeNo} / {employee.position} / {employee.branch}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                {canViewSensitive
                    ? "人資生命週期檢視：任職、薪資、出勤假勤、證照訓練、文件與異動紀錄。"
                    : "主管安全視圖：僅顯示部門管理、排班、出勤與簽核必要資訊。"}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className={statusClassNames[employee.status]}>{statusLabels[employee.status]}</Badge>
              <Badge variant="secondary">{employee.department}</Badge>
              <Badge variant="outline">{employee.company}</Badge>
            </div>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {canViewSensitive ? (
              <>
                <div className="flex items-center gap-2 rounded-lg border p-3 text-sm">
                  <Phone className="h-4 w-4 text-primary" />
                  <span className="font-semibold">{employee.phone || "未設定"}</span>
                </div>
                <div className="flex items-center gap-2 rounded-lg border p-3 text-sm">
                  <Mail className="h-4 w-4 text-primary" />
                  <span className="font-semibold">{employee.email || "未設定"}</span>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 md:col-span-2">
                <ShieldCheck className="h-4 w-4 text-emerald-700" />
                <span className="font-semibold">主管視圖已隱藏手機、Email、地址、身分資料與緊急聯絡資訊</span>
              </div>
            )}
            <div className="flex items-center gap-2 rounded-lg border p-3 text-sm">
              <MapPin className="h-4 w-4 text-primary" />
              <span className="font-semibold">{employee.branch}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label={canViewSensitive ? "年齡" : "個資保護"}
          value={canViewSensitive ? age : "已隱藏"}
          detail={canViewSensitive ? employee.birthday || "未設定生日" : "主管只看管理必要欄位"}
          icon={UserRound}
        />
        <SummaryCard label="年資" value={tenure} detail={`到職日 ${employee.hireDate || "未設定"}`} icon={BriefcaseBusiness} />
        <SummaryCard label="本月出勤" value="21 / 22 天" detail="含 1 筆異常待確認" icon={Clock3} />
        <SummaryCard label="待注意項目" value={`${alertCount} 件`} detail="證照到期、出勤異常與文件複核" icon={AlertTriangle} />
      </section>

      <div className="grid gap-4 xl:grid-cols-[260px_1fr]">
        <Card className="rounded-lg">
          <CardContent className="grid gap-1 p-3">
            <Button asChild variant="outline" className="mb-2 justify-start">
              <Link href="/employees">
                <UserRound className="h-4 w-4" />
                返回員工列表
              </Link>
            </Button>
            {visibleTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-semibold transition-colors ${
                  safeActiveTab === tab.key
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            ))}
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle>{visibleTabs.find((tab) => tab.key === safeActiveTab)?.label}</CardTitle>
              <p className="mt-2 text-sm text-muted-foreground">
                {safeActiveTab === "basic" ? (canViewSensitive ? "個人身分、聯絡方式與緊急聯絡資訊。" : "主管只顯示識別、任職與遮罩後聯絡資訊。") : null}
                {safeActiveTab === "employment" ? "任職歸屬、主管、狀態與跨據點支援資訊。" : null}
                {safeActiveTab === "payroll" ? "薪資設定、保險級距與銀行資訊，僅供授權人員檢視。" : null}
                {safeActiveTab === "attendance" ? "近期班表、實際打卡、工時與異常狀態。" : null}
                {safeActiveTab === "leave" ? "請假紀錄、時數、原因與已完成簽核關卡。" : null}
                {safeActiveTab === "overtime" ? "加班日期、類型、時段、給付方式與核准狀態。" : null}
                {safeActiveTab === "licenses" ? "長照相關證照、有效期限、附件與到期提醒。" : null}
                {safeActiveTab === "training" ? "年度教育訓練紀錄、時數與完成狀態。" : null}
                {safeActiveTab === "documents" ? "勞動契約、個資附件、體檢與員工申請文件。" : null}
                {safeActiveTab === "changes" ? "到職、據點、薪資、主管與狀態異動歷程。" : null}
              </p>
            </div>
            <Badge variant="secondary">{employee.employeeNo}</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            {safeActiveTab === "basic" ? (
              <>
                <SectionIntro
                  title={canViewSensitive ? "個資保護" : "主管安全視圖"}
                  description={canViewSensitive ? "身分證字號已遮罩呈現；正式串接 Supabase 後，薪資與個資欄位需依角色與 RLS 控管。" : "主管端僅保留員工識別、部門、據點、職稱與任職狀態；其他個資不在此頁揭露。"}
                />
                <InfoGrid rows={basicRows} />
              </>
            ) : null}

            {safeActiveTab === "employment" ? (
              <>
                <div className="grid gap-3 md:grid-cols-3">
                  <SummaryCard label="主要據點" value={employee.branch} detail="排班與出勤主要歸屬" icon={MapPin} />
                  <SummaryCard label="直屬主管" value={employee.supervisor} detail="請假、加班、補卡第一關" icon={ShieldCheck} />
                  <SummaryCard label="任職狀態" value={statusLabels[employee.status]} detail={`年資 ${tenure}`} icon={BriefcaseBusiness} />
                </div>
                <InfoGrid
                  rows={[
                    ["公司", employee.company],
                    ["主要據點", employee.branch],
                    ["支援據點", "台北居服站、板橋日照中心"],
                    ["部門", employee.department],
                    ["職稱", employee.position],
                    ["職等", "L3"],
                    ["直屬主管", employee.supervisor],
                    ["員工狀態", statusLabels[employee.status]],
                    ["到職日", employee.hireDate],
                    ["離職日", employee.terminationDate || "未設定"],
                    ["年資", tenure],
                    ["人員類型", employee.position.includes("居服") ? "居服員" : "一般員工"],
                  ]}
                />
              </>
            ) : null}

            {safeActiveTab === "payroll" ? (
              <>
                <SectionIntro title="薪資權限提醒" description="薪資頁只開放人資、會計、行政部門主任、執行長等授權角色；主管端不顯示部屬薪資。" />
                <div className="grid gap-3 md:grid-cols-3">
                  <SummaryCard label="應發估算" value="55,100" detail="本薪、津貼、獎金合計" icon={TrendingUp} />
                  <SummaryCard label="固定扣項" value="3,428" detail="勞保、健保、所得稅估算" icon={Banknote} />
                  <SummaryCard label="實發估算" value="51,672" detail="本月尚未鎖定" icon={ShieldCheck} />
                </div>
                <InfoGrid rows={payrollItems} />
              </>
            ) : null}

            {safeActiveTab === "attendance" ? (
              <>
                <div className="grid gap-3 md:grid-cols-4">
                  <SummaryCard label="應出勤" value="22 天" detail="本月排班統計" icon={CalendarDays} />
                  <SummaryCard label="已出勤" value="21 天" detail="含外勤服務" icon={Clock3} />
                  <SummaryCard label="異常" value="2 件" detail="遲到與 GPS 待審" icon={AlertTriangle} />
                  <SummaryCard label="補卡" value="1 件" detail="主管簽核中" icon={FileText} />
                </div>
                <DataTable
                  headers={["日期", "班別", "排班時間", "上班打卡", "下班打卡", "工時", "狀態", "據點"]}
                  rows={attendanceRows}
                />
              </>
            ) : null}

            {safeActiveTab === "leave" ? (
              <>
                <div className="grid gap-3 md:grid-cols-3">
                  <SummaryCard label="特休剩餘" value="72 小時" detail="年度可用額度" icon={CalendarDays} />
                  <SummaryCard label="本月請假" value="8 小時" detail="已核准" icon={ShieldCheck} />
                  <SummaryCard label="待簽核" value="0 件" detail="目前無卡關申請" icon={FileText} />
                </div>
                <DataTable
                  headers={["日期", "假別", "時間", "時數", "狀態", "原因", "簽核關卡"]}
                  rows={leaveRows}
                />
              </>
            ) : null}

            {safeActiveTab === "overtime" ? (
              <>
                <div className="grid gap-3 md:grid-cols-3">
                  <SummaryCard label="本月加班" value="2.5 小時" detail="平日加班" icon={Clock3} />
                  <SummaryCard label="補休累積" value="4 小時" detail="休息日轉補休" icon={CalendarDays} />
                  <SummaryCard label={canViewPayroll ? "費用估算" : "給付方式"} value={canViewPayroll ? "1,145" : "依核准結果"} detail={canViewPayroll ? "依薪資設定試算" : "主管端不顯示金額"} icon={Banknote} />
                </div>
                <DataTable
                  headers={["日期", "加班類型", "加班時段", "時數", "給付方式", "狀態"]}
                  rows={overtimeRows}
                />
              </>
            ) : null}

            {safeActiveTab === "licenses" ? (
              <>
                <SectionIntro title="證照到期提醒" description="長照小卡將於 2026-06-30 到期，建議於 30 天內完成展延或重新上傳證明。" />
                <DataTable
                  headers={["證照名稱", "證號", "發證日", "到期日", "狀態", "附件"]}
                  rows={licenseRows}
                />
              </>
            ) : null}

            {safeActiveTab === "training" ? (
              <>
                <div className="grid gap-3 md:grid-cols-3">
                  <SummaryCard label="年度訓練" value="15 小時" detail="已完成紀錄" icon={GraduationCap} />
                  <SummaryCard label="法遵課程" value="3 小時" detail="個資與倫理" icon={ShieldCheck} />
                  <SummaryCard label="待補課程" value="0 門" detail="目前皆已完成" icon={Award} />
                </div>
                <DataTable
                  headers={["課程名稱", "類型", "日期", "時數", "狀態"]}
                  rows={trainingRows}
                />
              </>
            ) : null}

            {safeActiveTab === "documents" ? (
              <DataTable
                headers={["文件名稱", "格式", "上傳日", "狀態", "分類"]}
                rows={canViewSensitive ? documentRows : []}
              />
            ) : null}

            {safeActiveTab === "changes" ? (
              <DataTable
                headers={["生效日期", "異動類型", "異動前", "異動後", "異動原因", "建立人"]}
                rows={safeChangeRows}
              />
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
