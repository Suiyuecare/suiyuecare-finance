"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDownUp,
  BadgeAlert,
  BarChart3,
  Building2,
  CalendarDays,
  ChevronRight,
  CheckCircle2,
  Download,
  FileBarChart,
  FileSpreadsheet,
  GraduationCap,
  IdCard,
  Landmark,
  LineChart,
  Route,
  Search,
  ShieldAlert,
  ShieldCheck,
  Table2,
  TrendingDown,
  TrendingUp,
  UsersRound,
  WalletCards,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { OperationFeedback } from "@/components/ui/operation-feedback";
import { csv, downloadTextFile } from "@/lib/client/download";
import { getCurrentAppUser, getDefaultCompanyId, getLiveClient, writeAuditLog } from "@/lib/supabase/live-modules";

type ReportCategory = "人員" | "出勤" | "薪資" | "證照訓練" | "組織" | "留任";
type SortKey = "name" | "category" | "records" | "updatedAt";
type DecisionSeverity = "good" | "watch" | "risk";
type DecisionLens = "老闆" | "人資" | "主管";

type ReportDefinition = {
  name: string;
  category: ReportCategory;
  description: string;
  records: number;
  owner: string;
  updatedAt: string;
  href: string;
  icon: LucideIcon;
  filters: string[];
};

const reports: ReportDefinition[] = [
  { name: "員工名冊", category: "人員", description: "全員基本資料、部門、據點、職稱、到職日與聯絡資訊。", records: 80, owner: "人資", updatedAt: "2026-05-18", href: "/employees", icon: UsersRound, filters: ["公司", "據點", "部門", "職稱", "在職狀態"] },
  { name: "在職名冊", category: "人員", description: "目前在職、留停與試用期人員清冊。", records: 74, owner: "人資", updatedAt: "2026-05-18", href: "/employees", icon: UsersRound, filters: ["公司", "據點", "部門", "到職區間"] },
  { name: "離職名冊", category: "人員", description: "已離職人員、離職日、離職原因與交接狀態。", records: 6, owner: "人資", updatedAt: "2026-05-16", href: "/retention", icon: TrendingDown, filters: ["離職區間", "據點", "部門", "離職原因"] },
  { name: "出勤明細", category: "出勤", description: "每日班別、上下班打卡、請假、加班與補卡狀態。", records: 2480, owner: "人資", updatedAt: "2026-05-18", href: "/attendance/reports", icon: CalendarDays, filters: ["日期區間", "員工", "據點", "部門"] },
  { name: "出勤異常", category: "出勤", description: "遲到、早退、曠職、未打卡、GPS 異常與工時異常。", records: 19, owner: "主管", updatedAt: "2026-05-18", href: "/attendance/anomalies", icon: BadgeAlert, filters: ["日期區間", "異常類型", "處理狀態"] },
  { name: "請假統計", category: "出勤", description: "依公司、部門、個人、月份彙總請假紀錄、核准狀態與附件留存。", records: 38, owner: "人資", updatedAt: "2026-05-17", href: "/leave-reports", icon: FileBarChart, filters: ["公司", "部門", "個人", "1-12 個月", "假別", "附件狀態"] },
  { name: "加班統計", category: "出勤", description: "平日、休息日、例假日與國定假日加班申請、核准與加班費計算。", records: 27, owner: "主管", updatedAt: "2026-05-17", href: "/overtime-reports", icon: BarChart3, filters: ["公司", "部門", "個人", "1-12 個月", "加班類型", "補償方式"] },
  { name: "排班統計", category: "出勤", description: "班別分布、缺口、人力配置與換班代班統計。", records: 920, owner: "主管", updatedAt: "2026-05-18", href: "/attendance/schedules", icon: Table2, filters: ["日期區間", "據點", "部門", "班別"] },
  { name: "薪資清冊", category: "薪資", description: "本薪、津貼、加班費、扣款、應發與實發金額。", records: 80, owner: "會計", updatedAt: "2026-05-15", href: "/payroll/roster", icon: WalletCards, filters: ["薪資月份", "部門", "據點", "薪資狀態"] },
  { name: "證照到期", category: "證照訓練", description: "證照有效期限、到期提醒、附件狀態與審核狀態。", records: 126, owner: "人資", updatedAt: "2026-05-18", href: "/licenses", icon: IdCard, filters: ["到期區間", "證照類型", "據點", "狀態"] },
  { name: "教育訓練", category: "證照訓練", description: "年度訓練時數、課程、講師、簽到、成績與證明文件。", records: 214, owner: "人資", updatedAt: "2026-05-18", href: "/training-records", icon: GraduationCap, filters: ["年度", "課程類型", "員工", "據點"] },
  { name: "人力成本", category: "薪資", description: "薪資、加班、津貼、勞健保、勞退與公司負擔。", records: 80, owner: "會計", updatedAt: "2026-05-15", href: "/payroll/attendance-calculation", icon: Landmark, filters: ["月份", "部門", "據點", "成本類型"] },
  { name: "部門人數", category: "組織", description: "各部門人數、職務分布、主管與人力編制。", records: 10, owner: "人資", updatedAt: "2026-05-14", href: "/organization", icon: Building2, filters: ["公司", "據點", "部門類型"] },
  { name: "據點人數", category: "組織", description: "各據點在職、支援、留停與缺口人數。", records: 6, owner: "營運", updatedAt: "2026-05-14", href: "/organization", icon: Building2, filters: ["公司", "據點類型", "狀態"] },
  { name: "離職率", category: "留任", description: "依月份、部門、據點與離職原因計算離職率。", records: 6, owner: "人資", updatedAt: "2026-05-16", href: "/retention", icon: TrendingDown, filters: ["日期區間", "部門", "據點", "離職原因"] },
];

const categories: Array<"全部" | ReportCategory> = ["全部", "人員", "出勤", "薪資", "證照訓練", "組織", "留任"];
const decisionLenses: DecisionLens[] = ["老闆", "人資", "主管"];

const reportCountSources: Record<string, { table: string; filter?: { column: string; value: string | boolean } }> = {
  員工名冊: { table: "employees" },
  在職名冊: { table: "employees", filter: { column: "employment_status", value: "active" } },
  離職名冊: { table: "employees", filter: { column: "employment_status", value: "terminated" } },
  出勤明細: { table: "attendance_punches" },
  出勤異常: { table: "attendance_punches", filter: { column: "is_abnormal", value: true } },
  請假統計: { table: "leave_requests" },
  加班統計: { table: "overtime_requests" },
  排班統計: { table: "schedules" },
  薪資清冊: { table: "payroll_records" },
  證照到期: { table: "licenses" },
  教育訓練: { table: "training_records" },
  人力成本: { table: "payroll_records" },
  部門人數: { table: "departments" },
  據點人數: { table: "branches" },
  離職率: { table: "employees", filter: { column: "status", value: "離職" } },
};

const severityStyles: Record<DecisionSeverity, string> = {
  good: "border-emerald-200 bg-emerald-50 text-emerald-900",
  watch: "border-amber-200 bg-amber-50 text-amber-950",
  risk: "border-rose-200 bg-rose-50 text-rose-950",
};

function percent(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function clampScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

export default function AnalyticsPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"全部" | ReportCategory>("全部");
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");
  const [decisionLens, setDecisionLens] = useState<DecisionLens>("老闆");
  const [exportMessage, setExportMessage] = useState("尚未匯出報表");
  const [liveCounts, setLiveCounts] = useState<Record<string, number>>({});
  const [loadMessage, setLoadMessage] = useState("正在讀取 Supabase 正式資料...");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    void loadReportCounts();
  }, []);

  async function countRows(table: string, filter?: { column: string; value: string | boolean }) {
    const supabase = getLiveClient();
    let queryBuilder = supabase.from(table).select("id", { count: "exact", head: true }).is("deleted_at", null);
    if (filter) queryBuilder = queryBuilder.eq(filter.column, filter.value);
    const { count, error } = await queryBuilder;
    if (error) throw error;
    return count ?? 0;
  }

  async function loadReportCounts() {
    try {
      const entries = await Promise.all(
        reports.map(async (report) => {
          const source = reportCountSources[report.name];
          if (!source) return [report.name, 0] as const;
          try {
            return [report.name, await countRows(source.table, source.filter)] as const;
          } catch {
            return [report.name, 0] as const;
          }
        }),
      );
      setLiveCounts(Object.fromEntries(entries));
      setLoadMessage("已連線 Supabase，報表筆數以正式資料表即時計算。");
      setLastUpdatedAt(new Date());
    } catch (error) {
      setLiveCounts({});
      setLoadMessage(error instanceof Error ? error.message : "報表資料讀取失敗。");
      setLastUpdatedAt(new Date());
    }
  }

  const liveReports = useMemo(() => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
    return reports.map((report) => ({
      ...report,
      records: liveCounts[report.name] ?? 0,
      updatedAt: today,
    }));
  }, [liveCounts]);

  const filteredReports = useMemo(() => {
    const base = liveReports.filter((report) => {
      const matchesQuery = [report.name, report.description, report.owner, report.filters.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase());
      const matchesCategory = category === "全部" || report.category === category;
      return matchesQuery && matchesCategory;
    });

    return [...base].sort((a, b) => {
      if (sortKey === "records") return b.records - a.records;
      return String(b[sortKey]).localeCompare(String(a[sortKey]), "zh-Hant");
    });
  }, [category, liveReports, query, sortKey]);

  const decisionMetrics = useMemo(() => {
    const activeEmployees = liveCounts["在職名冊"] ?? 0;
    const terminatedEmployees = liveCounts["離職名冊"] ?? 0;
    const attendanceAnomalies = liveCounts["出勤異常"] ?? 0;
    const payrollRows = liveCounts["薪資清冊"] ?? 0;
    const licenseRows = liveCounts["證照到期"] ?? 0;
    const trainingRows = liveCounts["教育訓練"] ?? 0;
    const scheduleRows = liveCounts["排班統計"] ?? 0;
    const turnoverRate = percent(terminatedEmployees, activeEmployees + terminatedEmployees);
    const anomalyRate = percent(attendanceAnomalies, Math.max(liveCounts["出勤明細"] ?? 0, 1));

    return {
      activeEmployees,
      terminatedEmployees,
      attendanceAnomalies,
      payrollRows,
      licenseRows,
      trainingRows,
      scheduleRows,
      turnoverRate,
      anomalyRate,
      totalRows: liveReports.reduce((sum, report) => sum + report.records, 0),
      payrollReadyRate: percent(payrollRows, Math.max(activeEmployees, 1)),
      licenseCoverageRate: percent(licenseRows, Math.max(activeEmployees, 1)),
      trainingCoverageRate: percent(trainingRows, Math.max(activeEmployees, 1)),
    };
  }, [liveCounts, liveReports]);

  const decisionScore = useMemo(() => {
    const anomalyPenalty = Math.min(decisionMetrics.attendanceAnomalies * 3, 30);
    const payrollPenalty = decisionMetrics.payrollRows > 0 ? 0 : 22;
    const licensePenalty = Math.min(decisionMetrics.licenseRows, 18);
    const turnoverPenalty = decisionMetrics.turnoverRate >= 8 ? 18 : decisionMetrics.turnoverRate >= 4 ? 9 : 0;
    const schedulePenalty = decisionMetrics.scheduleRows > 0 ? 0 : 12;
    return clampScore(100 - anomalyPenalty - payrollPenalty - licensePenalty - turnoverPenalty - schedulePenalty);
  }, [decisionMetrics]);

  const decisionCards = useMemo(() => {
    const turnoverSeverity: DecisionSeverity = decisionMetrics.turnoverRate >= 8 ? "risk" : decisionMetrics.turnoverRate >= 4 ? "watch" : "good";
    const anomalySeverity: DecisionSeverity = decisionMetrics.attendanceAnomalies >= 10 ? "risk" : decisionMetrics.attendanceAnomalies > 0 ? "watch" : "good";
    const licenseSeverity: DecisionSeverity = decisionMetrics.licenseRows >= 20 ? "risk" : decisionMetrics.licenseRows > 0 ? "watch" : "good";
    const payrollSeverity: DecisionSeverity = decisionMetrics.payrollRows > 0 ? "good" : "watch";

    return [
      {
        title: "人力穩定度",
        value: `${decisionMetrics.turnoverRate}%`,
        detail: `${decisionMetrics.activeEmployees} 位在職、${decisionMetrics.terminatedEmployees} 位離職資料`,
        recommendation: turnoverSeverity === "risk" ? "優先查看離職率與留任追蹤，安排主管關懷。" : "持續追蹤 30/90/180 天留任節點。",
        href: "/retention",
        severity: turnoverSeverity,
        icon: TrendingDown,
      },
      {
        title: "出勤風險",
        value: `${decisionMetrics.attendanceAnomalies} 筆`,
        detail: `異常占比約 ${decisionMetrics.anomalyRate}%`,
        recommendation: anomalySeverity === "good" ? "目前可進入一般出勤報表複核。" : "先處理未打卡、GPS/IP 異常與補卡待審。",
        href: "/attendance/anomalies",
        severity: anomalySeverity,
        icon: ShieldAlert,
      },
      {
        title: "長照資格風險",
        value: `${decisionMetrics.licenseRows} 筆`,
        detail: `${decisionMetrics.trainingRows} 筆訓練紀錄可供評鑑檢查`,
        recommendation: licenseSeverity === "good" ? "可準備評鑑資料包。" : "先補證照附件、到期展延與必修訓練。",
        href: "/licenses",
        severity: licenseSeverity,
        icon: IdCard,
      },
      {
        title: "薪資決策準備度",
        value: `${decisionMetrics.payrollRows} 筆`,
        detail: "薪資清冊需與出勤、加班、請假扣薪連動",
        recommendation: payrollSeverity === "good" ? "可前往薪資清冊與結算流程複核。" : "尚未看到薪資清冊資料，請先建立薪資草稿。",
        href: "/payroll/closing",
        severity: payrollSeverity,
        icon: WalletCards,
      },
    ];
  }, [decisionMetrics]);

  const executiveInsights = useMemo(() => {
    return [
      {
        label: "先處理",
        title: decisionMetrics.attendanceAnomalies > 0 ? "出勤異常會影響薪資結算" : "出勤資料目前沒有明顯異常",
        detail: decisionMetrics.attendanceAnomalies > 0 ? `${decisionMetrics.attendanceAnomalies} 筆異常需清掉後再結薪。` : "可直接查看出勤報表或進入薪資前置。",
        href: decisionMetrics.attendanceAnomalies > 0 ? "/attendance/anomalies" : "/payroll/attendance-calculation",
      },
      {
        label: "再檢查",
        title: decisionMetrics.licenseRows > 0 ? "證照與訓練會影響長照評鑑" : "證照訓練資料可進入評鑑打包",
        detail: decisionMetrics.licenseRows > 0 ? "請先處理到期、缺附件與待審證照。" : "可依日期與據點匯出評鑑資料包。",
        href: decisionMetrics.licenseRows > 0 ? "/licenses" : "/assessment-exports",
      },
      {
        label: "最後決策",
        title: decisionMetrics.turnoverRate >= 4 ? "留任風險需要主管介入" : "人力穩定度可持續追蹤",
        detail: `目前離職率粗估 ${decisionMetrics.turnoverRate}%，請搭配離職原因與主管關懷紀錄判斷。`,
        href: "/retention",
      },
    ];
  }, [decisionMetrics]);

  const decisionPriorities = useMemo(() => {
    const rows = [
      {
        key: "attendance",
        audience: ["老闆", "人資", "主管"] as DecisionLens[],
        title: "出勤異常未結案",
        count: decisionMetrics.attendanceAnomalies,
        severityScore: decisionMetrics.attendanceAnomalies >= 10 ? 95 : decisionMetrics.attendanceAnomalies > 0 ? 72 : 15,
        question: "這些異常會不會卡住薪資結算？",
        impact: "會影響出勤轉薪資、補卡回寫與主管簽核效率。",
        nextAction: "處理出勤異常",
        href: "/attendance/anomalies",
      },
      {
        key: "payroll",
        audience: ["老闆", "人資"] as DecisionLens[],
        title: "薪資清冊準備度",
        count: decisionMetrics.payrollRows,
        severityScore: decisionMetrics.payrollRows > 0 ? 25 : 88,
        question: "本月能不能鎖定薪資與發布薪資袋？",
        impact: "未產生薪資清冊時，銀行轉帳檔、薪資袋與會計串接都無法正式上線。",
        nextAction: "進入薪資結算",
        href: "/payroll/closing",
      },
      {
        key: "license",
        audience: ["老闆", "人資", "主管"] as DecisionLens[],
        title: "長照證照與訓練風險",
        count: decisionMetrics.licenseRows,
        severityScore: decisionMetrics.licenseRows >= 20 ? 90 : decisionMetrics.licenseRows > 0 ? 66 : 20,
        question: "評鑑或排班時會不會出現資格不足？",
        impact: "會影響居服、日照排班資格檢核，也會影響評鑑資料匯出。",
        nextAction: "補證照訓練",
        href: "/licenses",
      },
      {
        key: "retention",
        audience: ["老闆", "人資", "主管"] as DecisionLens[],
        title: "留任與離職率",
        count: decisionMetrics.terminatedEmployees,
        severityScore: decisionMetrics.turnoverRate >= 8 ? 84 : decisionMetrics.turnoverRate >= 4 ? 58 : 18,
        question: "哪些部門或據點需要主管介入關懷？",
        impact: "離職率會影響排班穩定、訓練成本與服務人力配置。",
        nextAction: "查看留任追蹤",
        href: "/retention",
      },
      {
        key: "schedule",
        audience: ["人資", "主管"] as DecisionLens[],
        title: "排班資料覆蓋",
        count: decisionMetrics.scheduleRows,
        severityScore: decisionMetrics.scheduleRows > 0 ? 28 : 76,
        question: "班表是否足以支撐出勤、薪資與人力缺口判斷？",
        impact: "沒有正式班表就無法判斷遲到早退、工時、請假衝突與人力缺口。",
        nextAction: "檢查排班",
        href: "/attendance/schedules",
      },
    ];
    return rows
      .filter((row) => row.audience.includes(decisionLens))
      .sort((a, b) => b.severityScore - a.severityScore);
  }, [decisionLens, decisionMetrics]);

  const categoryDecisionSummary = useMemo(() => {
    return categories
      .filter((item): item is ReportCategory => item !== "全部")
      .map((item) => {
        const reportsInCategory = liveReports.filter((report) => report.category === item);
        const rows = reportsInCategory.reduce((sum, report) => sum + report.records, 0);
        const decision =
          item === "人員" ? `在職 ${decisionMetrics.activeEmployees} 人、離職率 ${decisionMetrics.turnoverRate}%`
          : item === "出勤" ? `異常 ${decisionMetrics.attendanceAnomalies} 筆、異常率 ${decisionMetrics.anomalyRate}%`
          : item === "薪資" ? `薪資清冊 ${decisionMetrics.payrollRows} 筆、準備率 ${decisionMetrics.payrollReadyRate}%`
          : item === "證照訓練" ? `證照 ${decisionMetrics.licenseRows} 筆、訓練 ${decisionMetrics.trainingRows} 筆`
          : item === "組織" ? `部門 ${liveCounts["部門人數"] ?? 0} 個、據點 ${liveCounts["據點人數"] ?? 0} 個`
          : `離職率 ${decisionMetrics.turnoverRate}%`;
        return { category: item, reports: reportsInCategory.length, rows, decision };
      });
  }, [decisionMetrics, liveCounts, liveReports]);

  const decisionQuestions = useMemo(() => {
    const questionsByLens: Record<DecisionLens, Array<{ question: string; answer: string; href: string; label: string }>> = {
      老闆: [
        { question: "本月薪資能不能準時發？", answer: decisionMetrics.payrollRows > 0 && decisionMetrics.attendanceAnomalies === 0 ? "可進入薪資覆核與鎖定。" : "需先處理出勤異常與薪資草稿。", href: "/payroll/closing", label: "看薪資結算" },
        { question: "哪個風險最該今天處理？", answer: decisionPriorities[0]?.title ?? "目前沒有高風險事項。", href: decisionPriorities[0]?.href ?? "/dashboard", label: "處理最高風險" },
        { question: "長照評鑑資料能不能打包？", answer: decisionMetrics.licenseRows > 0 ? "需先補證照、訓練與附件。" : "可進入評鑑匯出流程。", href: "/assessment-exports", label: "看評鑑匯出" },
      ],
      人資: [
        { question: "今天人資要先清哪一類待辦？", answer: decisionPriorities[0]?.impact ?? "先例行檢查人員主檔與報表。", href: decisionPriorities[0]?.href ?? "/hr-admin", label: "前往處理" },
        { question: "員工資料能不能支撐報表？", answer: `${decisionMetrics.totalRows.toLocaleString("zh-TW")} 筆正式資料已納入報表中心。`, href: "/employees", label: "看員工主檔" },
        { question: "哪些報表可直接匯出？", answer: `${filteredReports.length} 份符合目前篩選條件。`, href: "/analytics", label: "匯出目前清單" },
      ],
      主管: [
        { question: "我今天最該處理什麼？", answer: decisionMetrics.attendanceAnomalies > 0 ? "先處理部門出勤異常與補卡。" : "可查看部門排班與請假加班趨勢。", href: "/manager-portal", label: "回主管首頁" },
        { question: "是否有人力缺口？", answer: decisionMetrics.scheduleRows > 0 ? "已有排班資料，可進一步檢查缺口與衝突。" : "尚未看到排班資料，需先建立班表。", href: "/attendance/schedules", label: "看排班" },
        { question: "我能看個資或薪資嗎？", answer: "主管視角只看部門營運與異常，不顯示身分證、地址與個人薪資。", href: "/security", label: "看權限規則" },
      ],
    };
    return questionsByLens[decisionLens];
  }, [decisionLens, decisionMetrics, decisionPriorities, filteredReports.length]);

  async function exportExcel(targetReports = filteredReports, filePrefix = "hris-reports") {
    const fileName = `${filePrefix}.csv`;
    downloadTextFile(
      fileName,
      csv([
        ["報表名稱", "分類", "描述", "資料筆數", "負責單位", "更新日期", "來源頁面", "篩選條件"],
        ...targetReports.map((report) => [
          report.name,
          report.category,
          report.description,
          report.records,
          report.owner,
          report.updatedAt,
          report.href,
          report.filters.join("、"),
        ]),
      ]),
    );
    try {
      const supabase = getLiveClient();
      const [companyId, user] = await Promise.all([getDefaultCompanyId(), getCurrentAppUser()]);
      const rowCount = targetReports.reduce((sum, report) => sum + report.records, 0);
      const { error } = await supabase.from("report_export_batches").insert({
        company_id: companyId,
        requested_by: user.id,
        report_name: targetReports.length === 1 ? targetReports[0].name : "HRIS 報表中心",
        report_category: targetReports.length === 1 ? targetReports[0].category : category,
        filter_params: { query, category, sortKey, report_count: targetReports.length },
        row_count: rowCount,
        export_format: "csv",
        status: "completed",
        file_name: fileName,
      });
      if (error) throw error;
      await writeAuditLog({
        action: "report.export",
        resourceType: "report_export_batches",
        afterData: { fileName, reportNames: targetReports.map((report) => report.name), rowCount },
      });
      setExportMessage(`Excel 匯出完成：${targetReports.length} 份報表，正式資料 ${rowCount.toLocaleString("zh-TW")} 筆，已寫入匯出批次與 audit logs。`);
      setLastUpdatedAt(new Date());
    } catch (error) {
      setExportMessage(error instanceof Error ? `已下載檔案，但匯出批次寫入失敗：${error.message}` : "已下載檔案，但匯出批次寫入失敗。");
      setLastUpdatedAt(new Date());
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700">HRIS Reports</p>
          <h1 className="text-2xl font-semibold text-slate-950">HRIS 報表中心</h1>
          <p className="mt-2 max-w-4xl text-sm text-slate-500">
            集中管理員工名冊、在職名冊、離職名冊、出勤明細、出勤異常、請假統計、加班統計、排班統計、薪資清冊、證照到期、教育訓練、人力成本、部門人數、據點人數與離職率，所有報表支援篩選、排序、Excel 匯出。
          </p>
        </div>
        <button onClick={() => void exportExcel()} className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm">
          <Download className="h-4 w-4" />
          Excel 匯出
        </button>
      </div>

      <OperationFeedback
        title="報表中心資料狀態"
        message={`${loadMessage} ${exportMessage}`}
        updatedAt={lastUpdatedAt ?? undefined}
        details={["Supabase", `${liveReports.length} 份報表`, `${decisionMetrics.totalRows.toLocaleString("zh-TW")} 筆資料`]}
        actionLabel="查看評鑑匯出"
        actionHref="/assessment-exports"
      />

      <section className="grid gap-4 xl:grid-cols-[340px_1fr]">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-black text-emerald-700">決策準備分數</p>
              <p className="mt-2 text-5xl font-black text-emerald-950">{decisionScore}</p>
              <p className="mt-2 text-sm leading-6 text-emerald-800">
                綜合出勤異常、薪資清冊、證照訓練、留任與排班資料，分數越高代表越能支撐明天上線後的管理決策。
              </p>
            </div>
            <span className="rounded-lg bg-white p-3 text-emerald-700">
              <CheckCircle2 className="h-6 w-6" />
            </span>
          </div>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-white">
            <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${decisionScore}%` }} />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs font-bold text-emerald-900">
            <div className="rounded-lg bg-white px-2 py-2">0-59 卡關</div>
            <div className="rounded-lg bg-white px-2 py-2">60-79 追蹤</div>
            <div className="rounded-lg bg-white px-2 py-2">80+ 可決策</div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-black text-slate-950">用角色問題看報表</h2>
              <p className="mt-1 text-sm text-slate-500">成熟的人資系統不只問「有哪些報表」，而是直接回答不同角色今天要決定什麼。</p>
            </div>
            <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1">
              {decisionLenses.map((lens) => (
                <button
                  key={lens}
                  onClick={() => setDecisionLens(lens)}
                  className={`rounded-md px-3 py-1.5 text-sm font-bold transition ${decisionLens === lens ? "bg-white text-emerald-700 shadow-sm" : "text-slate-500 hover:text-slate-900"}`}
                >
                  {lens}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {decisionQuestions.map((item) => (
              <Link key={item.question} href={item.href} className="rounded-lg border border-slate-200 bg-slate-50 p-4 transition hover:border-emerald-200 hover:bg-emerald-50">
                <p className="text-sm font-black text-slate-950">{item.question}</p>
                <p className="mt-2 min-h-10 text-xs leading-5 text-slate-500">{item.answer}</p>
                <p className="mt-3 inline-flex items-center text-xs font-black text-emerald-700">
                  {item.label}
                  <ChevronRight className="ml-1 h-3.5 w-3.5" />
                </p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black text-rose-700">PRIORITY RANKING</p>
            <h2 className="mt-1 text-xl font-black text-slate-950">風險排序與決策動作</h2>
            <p className="mt-2 text-sm text-slate-500">依目前角色視角排序，把報表數字轉成「為什麼重要」與「下一步去哪裡處理」。</p>
          </div>
          <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">{decisionLens}視角</span>
        </div>

        <div className="mt-4 grid gap-3">
          {decisionPriorities.map((priority, index) => (
            <Link key={priority.key} href={priority.href} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 transition hover:border-emerald-200 hover:shadow-sm lg:grid-cols-[72px_1fr_1.2fr_140px] lg:items-center">
              <div>
                <div className={`flex h-12 w-12 items-center justify-center rounded-lg text-lg font-black ${priority.severityScore >= 80 ? "bg-rose-50 text-rose-700" : priority.severityScore >= 50 ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                  {index + 1}
                </div>
              </div>
              <div>
                <p className="text-sm font-black text-slate-950">{priority.title}</p>
                <p className="mt-1 text-xs text-slate-500">目前數字：{priority.count.toLocaleString("zh-TW")}</p>
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">{priority.question}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{priority.impact}</p>
              </div>
              <div className="inline-flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm font-black text-emerald-700">
                {priority.nextAction}
                <ChevronRight className="h-4 w-4" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "報表總數", value: `${liveReports.length}`, detail: "15 種 HRIS 報表", icon: FileSpreadsheet, tone: "bg-sky-50 text-sky-700" },
          { label: "目前篩選", value: `${filteredReports.length}`, detail: "符合條件報表", icon: Search, tone: "bg-violet-50 text-violet-700" },
          { label: "預估資料量", value: filteredReports.reduce((sum, report) => sum + report.records, 0).toLocaleString("zh-TW"), detail: "依報表來源估算", icon: BarChart3, tone: "bg-emerald-50 text-emerald-700" },
          { label: "匯出格式", value: "Excel", detail: "可延伸 CSV / PDF", icon: Download, tone: "bg-amber-50 text-amber-700" },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-500">{item.label}</p>
              <span className={`rounded-lg p-2 ${item.tone}`}>
                <item.icon className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-3 text-2xl font-semibold text-slate-950">{item.value}</p>
            <p className="mt-1 text-xs text-slate-500">{item.detail}</p>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-emerald-700" />
          <h2 className="text-lg font-black text-slate-950">決策構面摘要</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {categoryDecisionSummary.map((item) => (
            <button
              key={item.category}
              onClick={() => setCategory(item.category)}
              className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-emerald-200 hover:bg-emerald-50"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-black text-slate-950">{item.category}</p>
                  <p className="mt-1 text-xs text-slate-500">{item.reports} 份報表，{item.rows.toLocaleString("zh-TW")} 筆資料</p>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </div>
              <p className="mt-3 text-sm font-bold leading-6 text-slate-700">{item.decision}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-bold tracking-[0.12em] text-emerald-700">EXECUTIVE DECISION BOARD</p>
              <h2 className="mt-1 text-xl font-black text-slate-950">決策儀表板</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                報表中心會把出勤、薪資、留任、證照訓練與長照評鑑資料轉成管理者可以行動的判斷，不只是下載 Excel。
              </p>
            </div>
            <Link href="/hr-admin" className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
              回人資總控
              <ChevronRight className="ml-1 h-4 w-4" />
            </Link>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {decisionCards.map((card) => (
              <Link key={card.title} href={card.href} className={`rounded-lg border p-4 transition hover:shadow-md ${severityStyles[card.severity]}`}>
                <div className="flex items-start justify-between gap-3">
                  <span className="rounded-lg bg-white/70 p-2">
                    <card.icon className="h-5 w-5" />
                  </span>
                  <span className="rounded-full bg-white/70 px-2 py-1 text-xs font-black">
                    {card.severity === "risk" ? "高風險" : card.severity === "watch" ? "需追蹤" : "穩定"}
                  </span>
                </div>
                <div className="mt-4 flex items-end justify-between gap-3">
                  <h3 className="font-black">{card.title}</h3>
                  <span className="text-2xl font-black">{card.value}</span>
                </div>
                <p className="mt-2 text-xs leading-5 opacity-80">{card.detail}</p>
                <p className="mt-3 text-sm font-bold leading-6">{card.recommendation}</p>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <LineChart className="h-5 w-5 text-emerald-700" />
            <h2 className="text-lg font-black text-slate-950">建議下一步</h2>
          </div>
          <div className="space-y-3">
            {executiveInsights.map((insight) => (
              <Link key={insight.label} href={insight.href} className="block rounded-lg border border-slate-200 bg-slate-50 p-4 hover:border-emerald-200 hover:bg-emerald-50">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="rounded-full bg-white px-2 py-1 text-xs font-black text-emerald-700">{insight.label}</span>
                    <h3 className="mt-3 font-black text-slate-950">{insight.title}</h3>
                    <p className="mt-2 text-xs leading-5 text-slate-500">{insight.detail}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "人力規模", value: `${decisionMetrics.activeEmployees}`, detail: "在職名冊可用人數", icon: UsersRound, href: "/employees", tone: "bg-sky-50 text-sky-700" },
          { label: "排班量", value: `${decisionMetrics.scheduleRows}`, detail: "班表與人力配置資料", icon: Route, href: "/attendance/schedules", tone: "bg-violet-50 text-violet-700" },
          { label: "資格訓練", value: `${decisionMetrics.licenseRows + decisionMetrics.trainingRows}`, detail: "證照與訓練資料", icon: ShieldCheck, href: "/assessment-exports", tone: "bg-amber-50 text-amber-700" },
          { label: "決策資料量", value: decisionMetrics.totalRows.toLocaleString("zh-TW"), detail: "全部報表來源筆數", icon: TrendingUp, href: "/analytics", tone: "bg-emerald-50 text-emerald-700" },
        ].map((item) => (
          <Link key={item.label} href={item.href} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-emerald-200 hover:shadow-md">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-500">{item.label}</p>
              <span className={`rounded-lg p-2 ${item.tone}`}>
                <item.icon className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-3 text-2xl font-semibold text-slate-950">{item.value}</p>
            <p className="mt-1 text-xs text-slate-500">{item.detail}</p>
          </Link>
        ))}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[1fr_180px_180px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜尋報表、欄位、負責單位"
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm"
            />
          </div>
          <select value={category} onChange={(event) => setCategory(event.target.value as "全部" | ReportCategory)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            {categories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            <option value="updatedAt">依更新日期排序</option>
            <option value="records">依資料筆數排序</option>
            <option value="name">依報表名稱排序</option>
            <option value="category">依報表分類排序</option>
          </select>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">報表清單</h2>
              <p className="text-sm text-slate-500">每份報表都可套用篩選、排序並匯出 Excel。</p>
            </div>
            <ArrowDownUp className="h-5 w-5 text-slate-500" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">報表</th>
                <th className="px-4 py-3">分類</th>
                <th className="px-4 py-3">篩選條件</th>
                <th className="px-4 py-3">筆數</th>
                <th className="px-4 py-3">負責</th>
                <th className="px-4 py-3">更新</th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filteredReports.map((report) => (
                <tr key={report.name} className="align-top">
                  <td className="px-4 py-4">
                    <div className="flex items-start gap-3">
                      <span className="rounded-lg bg-slate-50 p-2 text-slate-700">
                        <report.icon className="h-5 w-5" />
                      </span>
                      <div>
                        <div className="font-semibold text-slate-950">{report.name}</div>
                        <div className="mt-1 max-w-lg text-xs text-slate-500">{report.description}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{report.category}</span>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex max-w-sm flex-wrap gap-1.5">
                      {report.filters.map((filter) => (
                        <span key={filter} className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">{filter}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-4 font-semibold text-slate-950">{report.records.toLocaleString("zh-TW")}</td>
                  <td className="px-4 py-4 text-slate-600">{report.owner}</td>
                  <td className="px-4 py-4 text-slate-600">{report.updatedAt}</td>
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap gap-2">
                      <Link href={report.href} className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700">開啟</Link>
                      <button onClick={() => void exportExcel([report], `hris-${report.name}`)} className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">Excel</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-slate-950">篩選</h2>
          <p className="mt-2 text-sm text-slate-500">各報表支援日期區間、公司、據點、部門、員工、狀態與類型等條件。</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-slate-950">排序</h2>
          <p className="mt-2 text-sm text-slate-500">報表清單可依名稱、分類、筆數與更新日期排序，後續可延伸欄位排序。</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-slate-950">Excel 匯出</h2>
          <p className="mt-2 text-sm text-slate-500">匯出批次會保留報表類型、篩選條件、產製人、筆數與檔案路徑。</p>
        </div>
      </section>
    </div>
  );
}
