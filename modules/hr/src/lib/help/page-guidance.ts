import type { Permission } from "@/lib/auth/rbac";

export type PageGuideAction = {
  label: string;
  href: string;
  permissions?: Permission[];
};

export type PageGuide = {
  match: string;
  title: string;
  summary: string;
  steps: string[];
  emptyTitle: string;
  emptyDescription: string;
  primaryAction?: PageGuideAction;
  secondaryAction?: PageGuideAction;
};

export const pageGuides: PageGuide[] = [
  {
    match: "/alerts",
    title: "異常告警中心操作教學",
    summary: "先看阻擋與重大項，確認來源後前往原功能處理，最後回到此頁結案。",
    steps: [
      "先看上方四個數字，阻擋項代表會影響結薪、通知、排程或上線穩定。",
      "用來源篩選切到出勤、薪資、證照、通知或系統，避免一次看太多。",
      "點「前往處理」回到原始功能修正資料，修完後回來按「結案」。",
      "若資料剛更新，按「同步告警」重新掃描正式資料來源。",
    ],
    emptyTitle: "目前沒有告警",
    emptyDescription: "代表出勤、薪資、證照、通知與系統錯誤沒有未處理風險。若剛補資料，請同步一次。",
    primaryAction: { label: "同步告警", href: "/alerts", permissions: ["compliance:manage"] },
    secondaryAction: { label: "看資安中心", href: "/security", permissions: ["system:settings"] },
  },
  {
    match: "/dashboard",
    title: "首頁工作台操作教學",
    summary: "首頁以今天要處理的事情為主，先做紅色阻擋，再做黃色提醒。",
    steps: [
      "先看今日摘要與高優先待辦，判斷是否有出勤、簽核、薪資或證照阻擋。",
      "點每張待辦卡的行動按鈕進入原功能處理。",
      "完成後回到首頁確認數字是否下降，避免漏處理。",
    ],
    emptyTitle: "目前沒有急件",
    emptyDescription: "可從常用功能開始日常操作，或前往報表中心查看趨勢。",
    primaryAction: { label: "前往表單", href: "/requests/new", permissions: ["request:create"] },
    secondaryAction: { label: "報表中心", href: "/analytics", permissions: ["analytics:view"] },
  },
  {
    match: "/requests/new",
    title: "表單申請操作教學",
    summary: "先選表單，再依欄位填寫；送出前系統會檢查班表、餘額、附件與法規底線。",
    steps: [
      "從表單卡片選擇請假、加班、補卡、文件或異動類型。",
      "進入獨立表單頁後，先填必填欄位，再上傳附件。",
      "送出前查看檢核結果，若被阻擋請依提示補資料。",
      "送出後到表單追蹤查看目前關卡。",
    ],
    emptyTitle: "目前沒有可用表單",
    emptyDescription: "通常是權限或表單設定尚未啟用，請請人資檢查系統設定與簽核流程。",
    primaryAction: { label: "表單追蹤", href: "/requests", permissions: ["request:view"] },
  },
  {
    match: "/approvals",
    title: "表單簽核操作教學",
    summary: "主管先看決策理由與影響，再核准、退回或駁回。",
    steps: [
      "先用狀態分頁切到待我簽核。",
      "查看申請人、原因、日期、目前關卡與系統檢核結果。",
      "若資料不足，請退回補件；若違反底線，請駁回。",
      "核准後系統會推進到下一關並保留簽核軌跡。",
    ],
    emptyTitle: "目前沒有待簽核表單",
    emptyDescription: "代表現在沒有輪到你處理的申請。若員工說已送出，請查看表單追蹤或簽核流程設定。",
    primaryAction: { label: "看表單追蹤", href: "/requests", permissions: ["request:view"] },
  },
  {
    match: "/requests",
    title: "表單追蹤操作教學",
    summary: "像包裹追蹤一樣看每張表單目前在哪一關、誰處理、下一步是什麼。",
    steps: [
      "用狀態篩選查看簽核中、已核准、被退回或已駁回。",
      "點進表單查看時間線與每一關處理紀錄。",
      "若被退回，依退回原因補資料後重新送出。",
    ],
    emptyTitle: "目前沒有表單紀錄",
    emptyDescription: "你尚未送出表單，或目前篩選條件太窄。可清除篩選或建立新申請。",
    primaryAction: { label: "新增申請", href: "/requests/new", permissions: ["request:create"] },
  },
  {
    match: "/clock",
    title: "打卡操作教學",
    summary: "員工只需要選擇上班、下班、外出或返回；系統在背後判斷地點與規則。",
    steps: [
      "確認畫面顯示的今日狀態與目前動作。",
      "按下對應打卡按鈕，允許瀏覽器取得位置。",
      "若超出範圍仍可送出，但會標記異常並進入審核。",
      "如果忘記打卡，請改走補打卡申請。",
    ],
    emptyTitle: "目前沒有打卡紀錄",
    emptyDescription: "今天尚未打卡，或資料尚未同步。請先按今日打卡，忘刷則建立補卡。",
    primaryAction: { label: "補打卡", href: "/punch-corrections", permissions: ["request:create"] },
  },
  {
    match: "/employees",
    title: "員工主檔操作教學",
    summary: "人資先補完整度，再處理任職、出勤、薪資、證照與異動紀錄。",
    steps: [
      "先用搜尋與篩選找到員工。",
      "查看資料完成度，缺身分、聯絡、任職或薪資欄位就先補齊。",
      "員工資料會連動出勤、薪資、報表與權限，修改前請確認角色。",
      "批次匯入前先下載範本並預覽錯誤。",
    ],
    emptyTitle: "目前沒有員工資料",
    emptyDescription: "請新增員工或用 Excel 匯入；沒有員工主檔時，出勤、薪資與報表都無法正式運作。",
    primaryAction: { label: "Excel 匯入", href: "/excel-imports", permissions: ["employee:manage"] },
  },
  {
    match: "/payroll",
    title: "薪資後台操作教學",
    summary: "薪資一定要先清出勤與表單阻擋，再產生草稿、覆核、鎖定與發布。",
    steps: [
      "先從出勤轉薪資檢查補卡、請假、加班與異常是否清空。",
      "產生薪資草稿後，由人資、會計、主管依流程覆核。",
      "薪資鎖定後不可直接修改，需建立調整紀錄。",
      "發布後員工只能查看自己的電子薪資袋。",
    ],
    emptyTitle: "目前沒有薪資資料",
    emptyDescription: "請先建立薪資設定與薪資項目，再從薪資結算流程產生草稿。",
    primaryAction: { label: "薪資結算", href: "/payroll/closing", permissions: ["payroll:manage"] },
  },
  {
    match: "/settings",
    title: "系統設定操作教學",
    summary: "先完成上線必填，再調整進階設定；會影響權限、法規、通知與結薪。",
    steps: [
      "先檢查公司、據點、部門、角色權限、打卡規則與簽核流程。",
      "薪資、法規與通知設定改動前請確認影響範圍。",
      "發布設定前檢查是否低於法規底線。",
    ],
    emptyTitle: "設定尚未完成",
    emptyDescription: "請先完成上線必填設定，否則表單、出勤、薪資與報表可能無法串接。",
    primaryAction: { label: "法規規則庫", href: "/compliance", permissions: ["compliance:view"] },
  },
];

export function getPageGuide(pathname: string) {
  return pageGuides
    .filter((guide) => pathname === guide.match || pathname.startsWith(`${guide.match}/`))
    .sort((a, b) => b.match.length - a.match.length)[0] ?? null;
}
