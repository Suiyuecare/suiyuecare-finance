"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useState } from "react";
import {
  Award,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Download,
  FileBadge2,
  FileText,
  GraduationCap,
  Plus,
  Search,
  TrendingUp,
  UploadCloud,
  UserCheck,
  UsersRound,
  AlertTriangle,
} from "lucide-react";
import { csv, downloadTextFile } from "@/lib/client/download";
import { getDefaultEmployee, getLiveClient, writeAuditLog } from "@/lib/supabase/live-modules";

type TrainingStatus = "已完成" | "進行中" | "未通過" | "已取消";
type AttendanceStatus = "已簽到" | "未簽到" | "補簽";

type TrainingType =
  | "新人訓練"
  | "長照專業"
  | "法規必修"
  | "證照複訓"
  | "感控安全"
  | "線上課程"
  | "外部訓練";

type TrainingRecord = {
  id: string;
  employeeNo: string;
  employeeName: string;
  role: string;
  branch: string;
  department: string;
  courseName: string;
  courseType: TrainingType;
  classDate: string;
  hours: number;
  instructor: string;
  attendees: string[];
  attendanceStatus: AttendanceStatus;
  score: number | null;
  certificate: string | null;
  status: TrainingStatus;
  note: string;
};

const trainingTypes: TrainingType[] = ["新人訓練", "長照專業", "法規必修", "證照複訓", "感控安全", "線上課程", "外部訓練"];

const initialTrainingRecords: TrainingRecord[] = [
  {
    id: "TR-001",
    employeeNo: "HC-018",
    employeeName: "林佳穎",
    role: "居服員",
    branch: "台北居服站",
    department: "居家服務部",
    courseName: "失智症照護實務與溝通技巧",
    courseType: "長照專業",
    classDate: "2026-02-18",
    hours: 6,
    instructor: "黃鈺婷 講師",
    attendees: ["林佳穎", "王淑芬", "張雅雯", "李承翰"],
    attendanceStatus: "已簽到",
    score: 92,
    certificate: "失智照護訓練證明.pdf",
    status: "已完成",
    note: "可列入長照評鑑訓練時數。",
  },
  {
    id: "TR-002",
    employeeNo: "DC-006",
    employeeName: "陳柏宏",
    role: "日照照服員",
    branch: "新北日照中心",
    department: "日照中心",
    courseName: "CPR + AED 急救複訓",
    courseType: "證照複訓",
    classDate: "2026-03-12",
    hours: 4,
    instructor: "紅十字會訓練師",
    attendees: ["陳柏宏", "周品妤", "許明哲"],
    attendanceStatus: "已簽到",
    score: 88,
    certificate: "CPR複訓證明.pdf",
    status: "已完成",
    note: "同步更新 CPR 證照附件。",
  },
  {
    id: "TR-003",
    employeeNo: "HC-021",
    employeeName: "王淑芬",
    role: "居服員",
    branch: "桃園據點",
    department: "居家服務部",
    courseName: "身障支持服務與安全移位",
    courseType: "長照專業",
    classDate: "2026-04-09",
    hours: 8,
    instructor: "林明德 治療師",
    attendees: ["王淑芬", "林佳穎"],
    attendanceStatus: "補簽",
    score: 84,
    certificate: "身障支持服務訓練.pdf",
    status: "已完成",
    note: "現場簽到漏刷，已由主管補簽。",
  },
  {
    id: "TR-004",
    employeeNo: "DC-002",
    employeeName: "周品妤",
    role: "護理師",
    branch: "台北日照中心",
    department: "護理組",
    courseName: "感染管制與用藥安全",
    courseType: "感控安全",
    classDate: "2026-05-03",
    hours: 3,
    instructor: "陳美惠 護理督導",
    attendees: ["周品妤", "陳柏宏"],
    attendanceStatus: "已簽到",
    score: 96,
    certificate: "感控訓練證明.pdf",
    status: "已完成",
    note: "年度必修已完成。",
  },
  {
    id: "TR-005",
    employeeNo: "AD-003",
    employeeName: "許明哲",
    role: "司機",
    branch: "新北日照中心",
    department: "交通接送",
    courseName: "日照交通接送與車輛安全",
    courseType: "法規必修",
    classDate: "2026-05-22",
    hours: 2,
    instructor: "內部行政主管",
    attendees: ["許明哲"],
    attendanceStatus: "未簽到",
    score: null,
    certificate: null,
    status: "進行中",
    note: "課後需補測驗與上傳證明文件。",
  },
  {
    id: "TR-006",
    employeeNo: "HR-001",
    employeeName: "陳羽俊",
    role: "人資主管",
    branch: "總公司",
    department: "人資部",
    courseName: "個資保護與勞動法令更新",
    courseType: "法規必修",
    classDate: "2026-01-16",
    hours: 3,
    instructor: "外部法務顧問",
    attendees: ["陳羽俊", "王怡婷"],
    attendanceStatus: "已簽到",
    score: 91,
    certificate: "個資法令訓練證明.pdf",
    status: "已完成",
    note: "供稽核與內部教育訓練報表使用。",
  },
];
void initialTrainingRecords;

const statusStyles: Record<TrainingStatus, string> = {
  已完成: "border-emerald-200 bg-emerald-50 text-emerald-700",
  進行中: "border-sky-200 bg-sky-50 text-sky-700",
  未通過: "border-rose-200 bg-rose-50 text-rose-700",
  已取消: "border-slate-200 bg-slate-50 text-slate-600",
};

const attendanceStyles: Record<AttendanceStatus, string> = {
  已簽到: "text-emerald-700",
  未簽到: "text-rose-700",
  補簽: "text-amber-700",
};

const careTrainingRequirements = [
  {
    role: "居服員",
    targetHours: 20,
    mustHave: ["失智症照護", "身障支持", "感染管制", "服務倫理"],
    assessmentUse: "居服員年度訓練清冊、服務派案資格、評鑑補件清單",
  },
  {
    role: "居服督導",
    targetHours: 24,
    mustHave: ["督導紀錄", "個案風險", "照顧計畫", "勞動法令"],
    assessmentUse: "督導紀錄佐證、個案服務品質、主管訓練時數",
  },
  {
    role: "日照照服員",
    targetHours: 20,
    mustHave: ["CPR/AED", "失智照護", "感控安全", "移位安全"],
    assessmentUse: "日照中心人力配置、照顧服務員訓練清冊",
  },
  {
    role: "護理師",
    targetHours: 16,
    mustHave: ["感染管制", "用藥安全", "CPR/AED", "緊急事件處理"],
    assessmentUse: "護理人員年度訓練、日照醫護配置佐證",
  },
  {
    role: "司機",
    targetHours: 8,
    mustHave: ["交通接送安全", "CPR/AED", "車輛清潔", "緊急應變"],
    assessmentUse: "交通接送紀錄、車輛與人員安全訓練",
  },
];

export default function TrainingRecordsPage() {
  const [trainingRecords, setTrainingRecords] = useState<TrainingRecord[]>([]);
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("2026");
  const [typeFilter, setTypeFilter] = useState<"全部" | TrainingType>("全部");
  const [actionMessage, setActionMessage] = useState("");

  async function loadTrainingRecords() {
    const supabase = getLiveClient();
    const { data, error } = await supabase
      .from("training_records")
      .select("*, employees(employee_no, full_name, branches(name), departments(name))")
      .is("deleted_at", null)
      .order("class_date", { ascending: false });
    if (error) throw error;
    setTrainingRecords(((data ?? []) as any[]).map((row) => ({
      id: row.id,
      employeeNo: row.employees?.employee_no ?? "",
      employeeName: row.employees?.full_name ?? "",
      role: row.training_type ?? "",
      branch: row.employees?.branches?.name ?? "",
      department: row.employees?.departments?.name ?? "",
      courseName: row.course_name,
      courseType: trainingTypes.includes(row.training_type) ? row.training_type : "外部訓練",
      classDate: row.class_date ?? "",
      hours: Number(row.hours ?? 0),
      instructor: row.instructor ?? "",
      attendees: Array.isArray(row.attendees) ? row.attendees : [],
      attendanceStatus: row.attendance_status === "signed" ? "已簽到" : row.attendance_status === "makeup" ? "補簽" : "未簽到",
      score: row.score === null ? null : Number(row.score),
      certificate: row.certificate_document_id ? "Supabase 證明文件" : null,
      status: row.status === "completed" ? "已完成" : row.status === "cancelled" ? "已取消" : "進行中",
      note: "",
    })));
  }

  useEffect(() => {
    loadTrainingRecords().catch((error) => setActionMessage(error instanceof Error ? error.message : "讀取 Supabase 教育訓練失敗。"));
  }, []);

  async function createTrainingDraft() {
    const supabase = getLiveClient();
    const employee = await getDefaultEmployee();
    const { error } = await supabase.from("training_records").insert({
      company_id: employee.company_id,
      employee_id: employee.id,
      branch_id: employee.primary_branch_id,
      department_id: employee.primary_department_id,
      course_name: "教育訓練草稿",
      training_type: "外部訓練",
      class_date: new Date().toISOString().slice(0, 10),
      hours: 0,
      instructor: "",
      attendees: [employee.full_name],
      attendance_status: "not_signed",
      status: "planned",
    });
    if (error) throw error;
    await writeAuditLog({ action: "training.create_draft", resourceType: "training_records" });
    await loadTrainingRecords();
    setActionMessage("已在 Supabase 建立教育訓練草稿。");
  }

  async function completeTraining(record: TrainingRecord) {
    const supabase = getLiveClient();
    const { error } = await supabase
      .from("training_records")
      .update({
        attendance_status: "signed",
        score: record.score ?? 85,
        status: "completed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", record.id);
    if (error) throw error;
    await writeAuditLog({ action: "training.complete", resourceType: "training_records", resourceId: record.id });
    await loadTrainingRecords();
  }

  const filteredRecords = useMemo(() => {
    return trainingRecords.filter((record) => {
      const matchesQuery = [record.employeeNo, record.employeeName, record.courseName, record.branch, record.instructor]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase());
      const matchesYear = record.classDate.startsWith(year);
      const matchesType = typeFilter === "全部" || record.courseType === typeFilter;
      return matchesQuery && matchesYear && matchesType;
    });
  }, [query, trainingRecords, typeFilter, year]);

  const annualStats = useMemo(() => {
    const completed = filteredRecords.filter((record) => record.status === "已完成");
    const totalHours = completed.reduce((sum, record) => sum + record.hours, 0);
    const employeeHours = completed.reduce<Record<string, number>>((acc, record) => {
      acc[record.employeeName] = (acc[record.employeeName] ?? 0) + record.hours;
      return acc;
    }, {});

    return {
      totalHours,
      completedCount: completed.length,
      participantCount: new Set(filteredRecords.map((record) => record.employeeName)).size,
      missingCertificateCount: filteredRecords.filter((record) => !record.certificate).length,
      employeeHours,
    };
  }, [filteredRecords]);

  const employeeHourRows = Object.entries(annualStats.employeeHours).sort(([, a], [, b]) => b - a);

  const careTrainingReadiness = useMemo(
    () =>
      careTrainingRequirements.map((requirement) => {
        const relatedRecords = filteredRecords.filter((record) => record.role.includes(requirement.role.replace("日照", "")) || record.courseName.includes(requirement.role));
        const completedHours = relatedRecords
          .filter((record) => record.status === "已完成")
          .reduce((sum, record) => sum + record.hours, 0);
        const missingCourses = requirement.mustHave.filter(
          (keyword) => !relatedRecords.some((record) => record.courseName.includes(keyword) && record.status === "已完成"),
        );
        return {
          ...requirement,
          completedHours,
          missingCourses,
          completionRate: Math.min(Math.round((completedHours / requirement.targetHours) * 100), 100),
          ready: completedHours >= requirement.targetHours && missingCourses.length === 0,
        };
      }),
    [filteredRecords],
  );
  const longTermCareGaps = careTrainingReadiness.filter((item) => !item.ready).length;

  async function exportTrainingRecords() {
    downloadTextFile(
      "training-records.csv",
      csv([["課程", "類型", "日期", "時數", "講師"], ...filteredRecords.map((record) => [record.courseName, record.courseType, record.classDate, record.hours, record.instructor])]),
    );
    await writeAuditLog({
      action: "training.export",
      resourceType: "training_records",
      afterData: { rowCount: filteredRecords.length, year, query, typeFilter },
    });
    setActionMessage(`已匯出訓練清冊 ${filteredRecords.length} 筆，並寫入 audit logs。`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700">Training Records</p>
          <h1 className="text-2xl font-semibold text-slate-950">教育訓練紀錄管理</h1>
          <p className="mt-2 max-w-4xl text-sm text-slate-500">
            管理課程名稱、課程類型、上課日期、上課時數、講師、參訓員工、簽到紀錄、測驗成績、證明文件，並可依員工查詢年度教育訓練紀錄與年度訓練時數統計。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => exportTrainingRecords().catch((error) => setActionMessage(error instanceof Error ? error.message : "匯出訓練清冊失敗。"))}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm"
          >
            <Download className="h-4 w-4" />
            匯出訓練清冊
          </button>
          <button
            type="button"
            onClick={() => createTrainingDraft().catch((error) => setActionMessage(error instanceof Error ? error.message : "新增訓練紀錄失敗。"))}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm"
          >
            <Plus className="h-4 w-4" />
            新增訓練紀錄
          </button>
        </div>
      </div>
      {actionMessage ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{actionMessage}</div> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "年度訓練時數", value: `${annualStats.totalHours} 小時`, detail: `${year} 已完成課程合計`, icon: BarChart3, tone: "bg-emerald-50 text-emerald-700" },
          { label: "完成課程", value: `${annualStats.completedCount}`, detail: "已完成且可列入統計", icon: CheckCircle2, tone: "bg-sky-50 text-sky-700" },
          { label: "參訓員工", value: `${annualStats.participantCount}`, detail: "依員工去重計算", icon: UsersRound, tone: "bg-violet-50 text-violet-700" },
          { label: "長照缺口", value: `${longTermCareGaps}`, detail: `缺證明 ${annualStats.missingCertificateCount} 筆`, icon: AlertTriangle, tone: "bg-amber-50 text-amber-700" },
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

      <section className="rounded-lg border border-amber-200 bg-amber-50 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-amber-950">長照年度必修訓練地圖</h2>
            <p className="mt-1 text-sm text-amber-900">
              依居服、日照、護理、接送職務追蹤年度時數、必修主題、簽到、測驗與證明文件；缺訓會影響排班資格、評鑑清冊與補件通知。
            </p>
          </div>
          <span className="w-fit rounded-full bg-white px-3 py-1 text-xs font-black text-amber-700">
            {year} 年度缺口 {longTermCareGaps} 類
          </span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {careTrainingReadiness.map((item) => (
            <div key={item.role} className="rounded-lg bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-bold text-slate-950">{item.role}</div>
                  <div className="mt-1 text-xs text-slate-500">目標 {item.targetHours} 小時</div>
                </div>
                <span className={`rounded-full px-2 py-1 text-xs font-bold ${item.ready ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                  {item.ready ? "達標" : "待補訓"}
                </span>
              </div>
              <div className="mt-3 h-2 rounded-full bg-slate-100">
                <div className="h-2 rounded-full bg-amber-500" style={{ width: `${item.completionRate}%` }} />
              </div>
              <div className="mt-2 text-xs font-semibold text-slate-600">
                已完成 {item.completedHours} 小時 / {item.completionRate}%
              </div>
              <div className="mt-3 text-xs font-semibold text-slate-500">必修主題</div>
              <div className="mt-2 flex flex-wrap gap-1">
                {item.mustHave.map((course) => (
                  <span key={course} className={`rounded px-2 py-1 text-xs ${item.missingCourses.includes(course) ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
                    {course}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-600">{item.assessmentUse}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">訓練紀錄清冊</h2>
                <p className="text-sm text-slate-500">可依員工、課程、講師、據點與年度查詢。</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜尋員工 / 課程 / 講師"
                    className="w-56 rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm"
                  />
                </div>
                <select value={year} onChange={(event) => setYear(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                  {["2026", "2025", "2024"].map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                <select
                  value={typeFilter}
                  onChange={(event) => setTypeFilter(event.target.value as "全部" | TrainingType)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="全部">全部課程類型</option>
                  {trainingTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">參訓員工</th>
                  <th className="px-4 py-3">課程名稱</th>
                  <th className="px-4 py-3">上課日期</th>
                  <th className="px-4 py-3">時數</th>
                  <th className="px-4 py-3">講師</th>
                  <th className="px-4 py-3">簽到 / 成績</th>
                  <th className="px-4 py-3">證明文件</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredRecords.map((record) => (
                  <tr key={record.id} className="align-top">
                    <td className="px-4 py-4">
                      <div className="font-semibold text-slate-950">{record.employeeName}</div>
                      <div className="mt-1 text-xs text-slate-500">{record.employeeNo} · {record.role}</div>
                      <div className="mt-1 text-xs text-slate-500">{record.branch} / {record.department}</div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-medium text-slate-900">{record.courseName}</div>
                      <div className="mt-1 inline-flex rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-600">{record.courseType}</div>
                      <div className="mt-2 text-xs text-slate-500">同課參訓：{record.attendees.join("、")}</div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="inline-flex items-center gap-1 text-slate-800">
                        <CalendarDays className="h-4 w-4 text-slate-400" />
                        {record.classDate}
                      </div>
                      <div className="mt-2">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusStyles[record.status]}`}>
                          {record.status}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-4 font-semibold text-slate-950">{record.hours} 小時</td>
                    <td className="px-4 py-4 text-slate-700">{record.instructor}</td>
                    <td className="px-4 py-4">
                      <div className={`inline-flex items-center gap-1 font-medium ${attendanceStyles[record.attendanceStatus]}`}>
                        <UserCheck className="h-4 w-4" />
                        {record.attendanceStatus}
                      </div>
                      <div className="mt-2 text-xs text-slate-500">
                        測驗成績：{record.score === null ? "尚未登錄" : `${record.score} 分`}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      {record.certificate ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                          <FileText className="h-3.5 w-3.5" />
                          {record.certificate}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => completeTraining(record).then(() => setActionMessage(`已完成「${record.courseName}」並寫入 Supabase。`)).catch((error) => setActionMessage(error instanceof Error ? error.message : "完成訓練失敗。"))}
                          className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700"
                        >
                          <UploadCloud className="h-3.5 w-3.5" />
                          上傳證明
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-slate-700" />
              <h2 className="text-lg font-semibold text-slate-950">依員工年度查詢</h2>
            </div>
            <div className="space-y-3">
              {employeeHourRows.map(([name, hours]) => (
                <div key={name} className="rounded-lg bg-slate-50 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-800">{name}</span>
                    <span className="font-semibold text-slate-950">{hours} 小時</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-slate-200">
                    <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${Math.min((hours / 20) * 100, 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-violet-200 bg-violet-50 p-5">
            <div className="mb-4 flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-violet-700" />
              <h2 className="text-lg font-semibold text-violet-950">年度訓練時數統計</h2>
            </div>
            <div className="space-y-2 text-sm text-violet-900">
              {trainingTypes.map((type) => {
                const hours = filteredRecords.filter((record) => record.courseType === type && record.status === "已完成").reduce((sum, record) => sum + record.hours, 0);
                return (
                  <div key={type} className="flex items-center justify-between rounded-lg bg-white/70 px-3 py-2">
                    <span>{type}</span>
                    <span className="font-semibold">{hours} 小時</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
            <div className="mb-4 flex items-center gap-2">
              <Award className="h-5 w-5 text-emerald-700" />
              <h2 className="text-lg font-semibold text-emerald-950">管理流程</h2>
            </div>
            <div className="space-y-3 text-sm text-emerald-900">
              {["建立課程與參訓名單", "登錄簽到紀錄與測驗成績", "上傳證明文件", "納入年度時數與評鑑匯出"].map((step, index) => (
                <div key={step} className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-semibold text-emerald-700">{index + 1}</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <FileBadge2 className="mt-0.5 h-5 w-5 text-slate-700" />
          <div>
            <h2 className="font-semibold text-slate-950">資料結構與附件</h2>
            <p className="mt-1 text-sm text-slate-500">
              教育訓練資料對應 Supabase `training_records`，證明文件對應 `documents`。未來可依員工、年度、課程類型、據點與部門產出長照評鑑所需訓練清冊。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
