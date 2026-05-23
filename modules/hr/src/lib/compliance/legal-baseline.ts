export type LegalDomain = {
  lawName: string;
  systemScope: string;
  baselinePolicy: string;
  implementationAreas: string[];
  sourceUrl: string;
};

export type LegalRuleCatalogItem = {
  code: string;
  lawName: "勞動基準法" | "性別平等工作法" | "公司法" | "民法" | "系統內控";
  article: string;
  title: string;
  minimumRule: string;
  enforcedAt: string[];
  blocking: boolean;
  sourceUrl: string;
};

export const legalBaselinePrinciple =
  "系統所有人資、出勤、假勤、薪資、簽核、個資與公司治理規則，必須以台灣現行法規作為最低基準；公司制度與系統限制只能等於或優於法規，不得低於法規。";

export const legalDomains: LegalDomain[] = [
  {
    lawName: "勞動基準法",
    systemScope: "工時、休息、休假、加班、薪資、出勤異常、離職與勞動條件最低標準。",
    baselinePolicy: "任何班表、加班、扣薪、薪資結算與出勤規則不得低於勞動基準法最低標準。",
    implementationAreas: ["班別管理", "排班防呆", "打卡異常", "請假扣薪", "加班費計算", "薪資結算"],
    sourceUrl: "https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030001",
  },
  {
    lawName: "性別平等工作法",
    systemScope: "性別平等、職場歧視禁止、育嬰留職停薪、家庭照顧、性騷擾防治與申訴處理。",
    baselinePolicy: "假別、留職停薪、申訴、公告與人事異動不得產生性別、婚育或家庭照顧歧視。",
    implementationAreas: ["假別管理", "留職停薪", "申訴紀錄", "公告系統", "員工異動", "教育訓練"],
    sourceUrl: "https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030014",
  },
  {
    lawName: "公司法",
    systemScope: "公司、分支機構、權限治理、主管職責、簽核授權與稽核留痕。",
    baselinePolicy: "多公司、多據點、角色權限與簽核流程需符合公司治理、授權與內控制度，不可讓無權者越權核准。",
    implementationAreas: ["多公司架構", "角色權限", "簽核流程", "稽核紀錄", "報表中心"],
    sourceUrl: "https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=J0080001",
  },
  {
    lawName: "民法",
    systemScope: "契約、代理、意思表示、損害賠償、雇傭關係與資料保存責任。",
    baselinePolicy: "員工文件、申請表單、代理簽核與契約紀錄需保留可追溯資料，避免權責不明。",
    implementationAreas: ["文件附件", "表單申請", "代理簽核", "員工異動", "操作紀錄"],
    sourceUrl: "https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=B0000001",
  },
];

export const legalRuleCatalog: LegalRuleCatalogItem[] = [
  {
    code: "LSA_MINIMUM_STANDARD",
    lawName: "勞動基準法",
    article: "第 1 條",
    title: "勞動條件不得低於最低標準",
    minimumRule: "公司制度、班表、薪資、假勤與扣款規則不得低於勞基法最低標準。",
    enforcedAt: ["系統設定", "表單送出", "排班發布", "薪資結算"],
    blocking: true,
    sourceUrl: "https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030001",
  },
  {
    code: "LSA_ATTENDANCE_RECORD",
    lawName: "勞動基準法",
    article: "第 30 條",
    title: "出勤紀錄需逐日記載至分鐘",
    minimumRule: "打卡、補卡與出勤異常必須保留分鐘級紀錄，不能只留日結摘要。",
    enforcedAt: ["員工打卡", "補打卡", "出勤報表", "薪資結算"],
    blocking: true,
    sourceUrl: "https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030001",
  },
  {
    code: "LSA_OVERTIME_LIMIT",
    lawName: "勞動基準法",
    article: "第 32 條",
    title: "每日與每月加班上限",
    minimumRule: "正常工時加延長工時每日不得超過 12 小時；一般每月延長工時不得超過 46 小時，例外需勞資程序。",
    enforcedAt: ["加班申請", "排班防呆", "薪資結算"],
    blocking: true,
    sourceUrl: "https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030001",
  },
  {
    code: "LSA_WEEKLY_NORMAL_HOURS",
    lawName: "勞動基準法",
    article: "第 30 條",
    title: "正常工時每日八小時、每週四十小時",
    minimumRule: "排班與出勤計算不得讓一般正常工時超過每日 8 小時、每週 40 小時；超出部分必須進入合法加班與補償流程。",
    enforcedAt: ["班別管理", "排班發布", "出勤異常", "薪資結算"],
    blocking: true,
    sourceUrl: "https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030001",
  },
  {
    code: "LSA_SHIFT_REST_INTERVAL",
    lawName: "勞動基準法",
    article: "第 34 條",
    title: "輪班換班至少十一小時休息",
    minimumRule: "輪班制換班時至少應有連續 11 小時休息；例外縮短不得低於 8 小時且需合法程序。",
    enforcedAt: ["班別管理", "排班月曆", "換班代班", "排班防呆"],
    blocking: true,
    sourceUrl: "https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030001",
  },
  {
    code: "LSA_REST_DAY",
    lawName: "勞動基準法",
    article: "第 36 條",
    title: "例假與休息日",
    minimumRule: "每七日應有例假與休息日；彈性制度需保留合法程序紀錄。",
    enforcedAt: ["排班月曆", "長照居服排班", "日照排班"],
    blocking: true,
    sourceUrl: "https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030001",
  },
  {
    code: "LSA_SPECIAL_LEAVE",
    lawName: "勞動基準法",
    article: "第 38 條、第 39 條",
    title: "特休與休假工資",
    minimumRule: "特休、例假、休息日與國定假日工資應照給；未休特休應記載並依規則發給工資。",
    enforcedAt: ["假別管理", "年度假勤統計", "薪資結算"],
    blocking: true,
    sourceUrl: "https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030001",
  },
  {
    code: "LSA_MINIMUM_WAGE_2026",
    lawName: "勞動基準法",
    article: "第 21 條、最低工資法",
    title: "2026 最低工資",
    minimumRule: "自 2026-01-01 起，月薪不得低於 29,500 元；時薪不得低於 196 元，薪資主檔與結薪需阻擋低於底線的設定。",
    enforcedAt: ["員工薪資設定", "薪資結算", "薪資項目", "報表中心"],
    blocking: true,
    sourceUrl: "https://www.mol.gov.tw/1607/28162/28166/28180/28182/28188/29022/?cprint=pt",
  },
  {
    code: "GEEA_SEXUAL_HARASSMENT",
    lawName: "性別平等工作法",
    article: "第 13 條",
    title: "性騷擾防治與申訴管道",
    minimumRule: "需依員工人數建立申訴管道或防治措施、調查流程、通知與保密紀錄。",
    enforcedAt: ["系統設定", "公告通知", "教育訓練", "文件附件"],
    blocking: true,
    sourceUrl: "https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030014",
  },
  {
    code: "GEEA_MENSTRUAL_LEAVE",
    lawName: "性別平等工作法",
    article: "第 14 條",
    title: "生理假",
    minimumRule: "生理假每月一日，薪資不得低於半薪底線，且不得設為不利處分。",
    enforcedAt: ["假別管理", "請假申請", "薪資結算"],
    blocking: true,
    sourceUrl: "https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030014",
  },
  {
    code: "GEEA_PRENATAL_PATERNITY_LEAVE",
    lawName: "性別平等工作法",
    article: "第 15 條",
    title: "產檢假與陪產檢及陪產假",
    minimumRule: "產檢假 7 日、陪產檢及陪產假 7 日，期間薪資照給，不得低於全薪或造成不利處分。",
    enforcedAt: ["假別管理", "請假申請", "薪資結算", "員工異動"],
    blocking: true,
    sourceUrl: "https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030014",
  },
  {
    code: "GEEA_FAMILY_CARE",
    lawName: "性別平等工作法",
    article: "第 20 條、第 21 條",
    title: "家庭照顧假與不得不利處分",
    minimumRule: "家庭照顧假全年七日；依法請求時不得拒絕，也不得影響全勤、考績或為其他不利處分。",
    enforcedAt: ["假別管理", "請假申請", "員工異動", "留任追蹤"],
    blocking: true,
    sourceUrl: "https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030014",
  },
];

export const complianceGuardrails = [
  "法規為最低標準，公司制度可以更優，但不得更差。",
  "涉及薪資、工時、休假、加班、離職、育嬰、家庭照顧、性騷擾申訴、個資與簽核授權的功能，都必須有規則版本與稽核紀錄。",
  "所有法規公式不得寫死在頁面元件中，應集中在 service 或設定資料表，方便法規更新後調整。",
  "當公司設定低於法規時，系統應阻擋儲存或標示高風險，不只顯示提醒。",
  "一般員工不得看到他人個資與薪資資料；主管、人資、會計與高階主管依角色與範圍授權。",
];
