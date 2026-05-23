import { getEffectiveRolePermissions, hrRoles, rolePolicies, type DataScope, type HrRole, type Permission } from "@/lib/auth/rbac";

export type PermissionRisk = "一般" | "敏感" | "高敏感";

export type PermissionGroupKey =
  | "home"
  | "requests"
  | "forms"
  | "people"
  | "attendance"
  | "payroll"
  | "governance";

export type PermissionMeta = {
  permission: Permission;
  label: string;
  description: string;
  group: PermissionGroupKey;
  risk: PermissionRisk;
};

export const dataScopeMeta: Record<DataScope, { label: string; description: string; level: number }> = {
  self: {
    label: "本人資料",
    description: "只能查看與送出自己的資料、表單、薪資袋與訓練紀錄。",
    level: 1,
  },
  supervised_clients: {
    label: "服務個案",
    description: "可查看被指派的居服或日照服務個案與服務排班。",
    level: 2,
  },
  team: {
    label: "小組資料",
    description: "可查看自己小組內的人員、出勤與工作紀錄。",
    level: 3,
  },
  department: {
    label: "部門資料",
    description: "可查看管轄部門或據點員工、班表、出勤異常與簽核資料。",
    level: 4,
  },
  company: {
    label: "公司資料",
    description: "可查看同公司範圍內的人資、出勤、薪資前置與法遵資料。",
    level: 5,
  },
  all_companies: {
    label: "全集團資料",
    description: "可跨公司查看完整資料、報表、權限設定與系統管理資訊。",
    level: 6,
  },
};

export const permissionGroupDefinitions: {
  key: PermissionGroupKey;
  label: string;
  description: string;
  permissions: Permission[];
}[] = [
  {
    key: "home",
    label: "入口與公告",
    description: "登入後首頁、公告、組織瀏覽與模組管理入口。",
    permissions: ["dashboard:view", "module:admin", "announcement:view", "announcement:manage", "notification:view", "notification:send", "notification:rules:manage", "organization:view"],
  },
  {
    key: "requests",
    label: "表單與簽核",
    description: "請假、加班、補卡、一般表單、工作日誌與主管簽核。",
    permissions: [
      "leave:view",
      "leave:request",
      "leave:approve",
      "request:create",
      "request:view",
      "request:own:view",
      "request:team:view",
      "request:approve",
      "request:admin",
      "worklog:view",
      "worklog:manage",
    ],
  },
  {
    key: "forms",
    label: "表單類別",
    description: "控制不同角色在表單申請入口能看到、能送出的表單分類。",
    permissions: ["form:attendance:create", "form:change:create", "form:document:create", "form:business:create", "form:general_affairs:create"],
  },
  {
    key: "people",
    label: "員工與組織",
    description: "員工主檔、敏感個資、任職異動、到職流程與組織資料。",
    permissions: ["employee:view", "employee:manage", "employee:sensitive:view", "employee:contact:view", "employee:address:view", "employee:national_id:view", "employee:salary:view", "employee:onboarding:manage"],
  },
  {
    key: "attendance",
    label: "出勤排班",
    description: "打卡、異常審核、班表、居服排班、日照排班與照會服務資料。",
    permissions: ["attendance:view", "attendance:self:punch", "attendance:approve", "attendance:abnormal:review", "attendance:manage", "care_schedule:view", "care_schedule:manage"],
  },
  {
    key: "payroll",
    label: "薪資保險",
    description: "薪資袋、薪資結算、薪資清冊、勞健保與財務交接。",
    permissions: [
      "payroll:self:view",
      "payroll:all:view",
      "payroll:aggregate:view",
      "payroll:individual:view",
      "payroll:manage",
      "payroll:draft:generate",
      "payroll:lock",
      "payroll:payslip:publish",
      "payroll:bank_export",
      "payroll:roster_export",
      "payroll:adjust",
      "insurance:view",
      "insurance:manage",
      "finance_handoff:view",
      "finance_handoff:manage",
    ],
  },
  {
    key: "governance",
    label: "法遵報表",
    description: "法規合規檢核、教育訓練、證照、稽核、報表與系統設定。",
    permissions: ["compliance:view", "compliance:manage", "analytics:view", "analytics:export", "training:view", "training:manage", "system:settings", "system:audit:view", "permission:settings:view", "permission:settings:publish"],
  },
];

const permissionCatalog: Record<Permission, Omit<PermissionMeta, "permission">> = {
  "dashboard:view": { label: "查看首頁", description: "可進入主控台與個人工作流。", group: "home", risk: "一般" },
  "module:admin": { label: "模組管理", description: "可管理跨模組入口與管理功能。", group: "home", risk: "高敏感" },
  "announcement:view": { label: "查看公告", description: "可查看被發布的公司公告與系統公告。", group: "home", risk: "一般" },
  "announcement:manage": { label: "管理公告", description: "可發布、置頂、分眾與停用公告。", group: "home", risk: "敏感" },
  "notification:view": { label: "查看通知", description: "可查看本人或權限範圍內通知紀錄。", group: "home", risk: "一般" },
  "notification:send": { label: "發送通知", description: "可建立手動通知事件並發送站內通知或 Email 佇列。", group: "home", risk: "敏感" },
  "notification:rules:manage": { label: "通知規則", description: "可調整通知類型、管道與收件規則。", group: "home", risk: "敏感" },
  "organization:view": { label: "查看組織", description: "可查看組織架構、部門與職稱資訊。", group: "home", risk: "一般" },
  "employee:view": { label: "查看員工", description: "可查看權限範圍內員工清單與基本任職資料。", group: "people", risk: "敏感" },
  "employee:manage": { label: "維護員工", description: "可新增、編輯員工主檔與任職資訊。", group: "people", risk: "高敏感" },
  "employee:sensitive:view": { label: "敏感個資", description: "可查看身分證、生日、聯絡地址等個資欄位。", group: "people", risk: "高敏感" },
  "employee:contact:view": { label: "員工聯絡資料", description: "可查看手機與 Email 等工作聯絡資訊。", group: "people", risk: "敏感" },
  "employee:address:view": { label: "員工地址", description: "可查看戶籍地址與通訊地址。", group: "people", risk: "高敏感" },
  "employee:national_id:view": { label: "身分證字號", description: "可查看身分證字號與生日等高敏感識別資料。", group: "people", risk: "高敏感" },
  "employee:salary:view": { label: "員工薪資欄位", description: "可在員工主檔查看薪資、投保與銀行資料。", group: "people", risk: "高敏感" },
  "employee:onboarding:manage": { label: "到職異動", description: "可處理到職、離職、復職與留職停薪流程。", group: "people", risk: "敏感" },
  "attendance:view": { label: "查看出勤", description: "可查看權限範圍內出勤紀錄與月曆。", group: "attendance", risk: "一般" },
  "attendance:self:punch": { label: "本人打卡", description: "可進行本人上下班、外出與返回打卡。", group: "attendance", risk: "一般" },
  "attendance:manage": { label: "管理出勤", description: "可調整班表、審核異常、處理出勤資料。", group: "attendance", risk: "敏感" },
  "attendance:approve": { label: "審核出勤", description: "可審核補卡、異常打卡與出勤相關申請。", group: "attendance", risk: "敏感" },
  "attendance:abnormal:review": { label: "處理出勤異常", description: "可覆核遲到、早退、GPS/IP 異常與未打卡。", group: "attendance", risk: "敏感" },
  "leave:view": { label: "查看假勤", description: "可查看本人或管轄範圍假勤資料。", group: "requests", risk: "一般" },
  "leave:request": { label: "申請請假", description: "可送出請假申請。", group: "requests", risk: "一般" },
  "leave:approve": { label: "審核請假", description: "可審核請假單與假勤衝突。", group: "requests", risk: "敏感" },
  "request:create": { label: "建立表單", description: "可建立請假、加班、補卡與其他人資表單。", group: "requests", risk: "一般" },
  "request:view": { label: "查看表單", description: "可查看本人或管轄範圍表單進度。", group: "requests", risk: "一般" },
  "request:own:view": { label: "本人表單", description: "只可查看自己送出的表單與追蹤紀錄。", group: "requests", risk: "一般" },
  "request:team:view": { label: "部門表單", description: "可查看管轄部門或據點的表單狀態。", group: "requests", risk: "敏感" },
  "request:approve": { label: "表單簽核", description: "可在流程關卡中核准、退回或駁回表單。", group: "requests", risk: "敏感" },
  "request:admin": { label: "表單管理", description: "可查看跨部門表單、補件與流程例外。", group: "requests", risk: "高敏感" },
  "form:attendance:create": { label: "假勤類表單", description: "可建立請假、預先加班、加班、忘刷與遠端辦公申請。", group: "forms", risk: "一般" },
  "form:change:create": { label: "異動類表單", description: "可建立職務調動、薪資異動、離職與新進人員表單。", group: "forms", risk: "高敏感" },
  "form:document:create": { label: "文件類表單", description: "可建立文件證明、勞健保證明與在職證明申請。", group: "forms", risk: "敏感" },
  "form:business:create": { label: "業務類表單", description: "可建立內部簽核、會議記錄與異常事件通報。", group: "forms", risk: "敏感" },
  "form:general_affairs:create": { label: "總務類表單", description: "可建立設備請領、文件調閱、公文收件、用印、場地、維修與報廢申請。", group: "forms", risk: "敏感" },
  "worklog:view": { label: "查看日誌", description: "可查看本人或管轄範圍工作日誌。", group: "requests", risk: "一般" },
  "worklog:manage": { label: "管理日誌", description: "可管理部屬工作日誌與追蹤事項。", group: "requests", risk: "敏感" },
  "payroll:self:view": { label: "查看薪資袋", description: "員工只能查看自己的電子薪資袋。", group: "payroll", risk: "高敏感" },
  "payroll:all:view": { label: "查看薪資清冊", description: "可查看公司薪資清冊與薪資單資料。", group: "payroll", risk: "高敏感" },
  "payroll:aggregate:view": { label: "薪資彙總", description: "可查看部門、據點與公司薪資總額，不含個人明細。", group: "payroll", risk: "敏感" },
  "payroll:individual:view": { label: "個人薪資明細", description: "可查看員工個人薪資、銀行帳號與扣款明細。", group: "payroll", risk: "高敏感" },
  "payroll:manage": { label: "薪資結算", description: "可產生草稿、複核、鎖定與發布薪資。", group: "payroll", risk: "高敏感" },
  "payroll:draft:generate": { label: "產生薪資草稿", description: "可由薪資主檔與出勤資料產生薪資草稿。", group: "payroll", risk: "高敏感" },
  "payroll:lock": { label: "鎖定薪資", description: "可鎖定薪資批次，鎖定後需調整紀錄才能修改。", group: "payroll", risk: "高敏感" },
  "payroll:payslip:publish": { label: "發布薪資袋", description: "可發布電子薪資單並通知員工。", group: "payroll", risk: "高敏感" },
  "payroll:bank_export": { label: "銀行轉帳檔", description: "可匯出銀行轉帳檔與完整匯款資料。", group: "payroll", risk: "高敏感" },
  "payroll:roster_export": { label: "薪資清冊匯出", description: "可匯出薪資清冊 Excel / CSV。", group: "payroll", risk: "高敏感" },
  "payroll:adjust": { label: "薪資調整", description: "可建立鎖定後薪資調整紀錄。", group: "payroll", risk: "高敏感" },
  "insurance:view": { label: "查看勞健保", description: "可查看勞保、健保、勞退與眷屬設定。", group: "payroll", risk: "高敏感" },
  "insurance:manage": { label: "維護勞健保", description: "可調整投保級距、費率與勞退提繳設定。", group: "payroll", risk: "高敏感" },
  "compliance:view": { label: "查看法遵", description: "可查看法規合規檢核、警示與封鎖原因。", group: "governance", risk: "敏感" },
  "compliance:manage": { label: "管理法遵", description: "可發布法規規則、檢核設定與封鎖門檻。", group: "governance", risk: "高敏感" },
  "analytics:view": { label: "查看報表", description: "可查看統計圖表、趨勢分析與匯出報表。", group: "governance", risk: "敏感" },
  "analytics:export": { label: "報表匯出", description: "可匯出報表中心資料並留下匯出批次。", group: "governance", risk: "敏感" },
  "finance_handoff:view": { label: "查看財務交接", description: "可查看薪資與會計系統交接狀態。", group: "payroll", risk: "高敏感" },
  "finance_handoff:manage": { label: "管理財務交接", description: "可送出薪資分錄、轉帳清冊與會計交接。", group: "payroll", risk: "高敏感" },
  "care_schedule:view": { label: "查看長照排班", description: "可查看居服、日照與跨據點服務排班。", group: "attendance", risk: "一般" },
  "care_schedule:manage": { label: "管理長照排班", description: "可調整居服員、日照人力與服務個案排班。", group: "attendance", risk: "敏感" },
  "training:view": { label: "查看訓練證照", description: "可查看教育訓練、證照與到期提醒。", group: "governance", risk: "一般" },
  "training:manage": { label: "管理訓練證照", description: "可維護證照附件、有效期限與教育訓練紀錄。", group: "governance", risk: "敏感" },
  "system:settings": { label: "系統設定", description: "可調整權限、流程、薪資、法遵與系統參數。", group: "governance", risk: "高敏感" },
  "system:audit:view": { label: "稽核紀錄", description: "可查看權限、薪資、匯出與敏感資料操作紀錄。", group: "governance", risk: "高敏感" },
  "permission:settings:view": { label: "查看權限設定", description: "可查看角色權限矩陣與資料範圍。", group: "governance", risk: "高敏感" },
  "permission:settings:publish": { label: "發布權限設定", description: "可發布角色權限變更，需理由與二次複核。", group: "governance", risk: "高敏感" },
};

const riskWeight: Record<PermissionRisk, number> = {
  一般: 1,
  敏感: 2,
  高敏感: 3,
};

export function getPermissionMeta(permission: Permission): PermissionMeta {
  return {
    permission,
    ...permissionCatalog[permission],
  };
}

export function getRolePermissionGroups(role: HrRole) {
  const effectivePermissions = getEffectiveRolePermissions(role);

  return permissionGroupDefinitions.map((group) => {
    const permissions = group.permissions.map(getPermissionMeta);
    const granted = permissions.filter((permission) => effectivePermissions.includes(permission.permission));

    return {
      ...group,
      permissions,
      granted,
      denied: permissions.filter((permission) => !effectivePermissions.includes(permission.permission)),
      grantedCount: granted.length,
      totalCount: permissions.length,
    };
  });
}

export function getRolePermissionSummary(role: HrRole) {
  const policy = rolePolicies[role];
  const permissions = getEffectiveRolePermissions(role).map(getPermissionMeta);
  const highRiskCount = permissions.filter((permission) => permission.risk === "高敏感").length;
  const sensitiveCount = permissions.filter((permission) => riskWeight[permission.risk] >= riskWeight["敏感"]).length;

  return {
    role,
    label: policy.label,
    description: policy.description,
    dataScope: policy.dataScope,
    dataScopeMeta: dataScopeMeta[policy.dataScope],
    totalPermissions: permissions.length,
    sensitiveCount,
    highRiskCount,
    permissions,
  };
}

export function getMissingPermissions(role: HrRole, requiredPermissions: Permission[]) {
  const granted = new Set(getEffectiveRolePermissions(role));
  return requiredPermissions.filter((permission) => !granted.has(permission)).map(getPermissionMeta);
}

export function getAllRolePermissionSummaries() {
  return hrRoles.map(getRolePermissionSummary);
}
