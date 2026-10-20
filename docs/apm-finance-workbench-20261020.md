# APM 季度獎金 Finance 核對入口交付

## 基線與範圍

基於正式 Finance `1c4aae681c3c929d677400e5672b9a08df07aaeb` 增補，不能用較舊 addon checkout 整站覆蓋正式站。`index.html` 僅增加受既有權限約束的入口、CSS／engine、頁面掛載與清理；不替換其他原有系統功能。

三個工作區：

1. 營收核定：選公司、已核定對照、完整關帳季度，建立帳簿預覽；另一位有權限人員核對後提供 APM。
2. 公司部門對照：貼入 APM 識別摘要，選本地部門與收入科目，說明依據；另一位執行長核定。不是依姓名自動綁定。
3. 更正回執：選已有的原獎金付款與完整沖銷傳票、貼更正摘要、核對全額退款佐證，由另一人建立回執。回執不是付款或 HR 勾稽完成證明。

原付款尚未發生、無完整沖銷傳票時不提供假成功按鈕。現行 Finance canonical bridge 沒有 unpaid cancel／void action，此入口明確標示未付款取消仍不支援；HR 未外送取消由 HR 自己的受控流程處理。

## 參考契約

初次對照：`{"schemaVersion":1,"apmCompanyId":"UUID","apmDepartmentId":"UUID"}`。

更正：`{"schemaVersion":1,"correctionBatchId":"UUID","correctionSourceHash":"64 lowercase hex","originalBatchId":"UUID"}`。

來源 JSON 僅作人工跨系統核對參考；不授予權限、不替代主管／HR／執行長核准，也不跳過 HR 後續 signed source 及 Finance 原款範圍驗證。一般員工不用輸入 UUID。

## 原檔與金額

退款選檔最多 10 MB，只保存 SHA-256 指紋，畫面明確說明不會上傳原檔，原始佐證仍須依既有文管方式保存。營收顯示保留四位小數；退款使用原付款整數 cents，不接受前端自行改金額。

## 後端與環境

依序增量加入：

1. `20261019043031_apm_metrics_verified_snapshots_addon.sql`
2. `20261020011825_apm_correction_receipts.sql`
3. `20261020014611_apm_receipt_evidence_guard.sql`
4. `20261020021355_apm_finance_workbench_ui.sql`
5. `20261020024107_apm_fresh_command_authorization.sql`

workbench 本身無新增 Edge Function 或秘密。既有 APM metrics／correction Edge 由跨系統發行清單另行核對。正式遠端另有 `20261019063423`、`20261019063700` 歷史，不能對舊 addon 執行 `db push --include-all`。必須比對遠端 migration version／hash 後只套用尚未發行的 exact SQL。

正式 MCP 套用時產生的版本與來源檔時間戳不同，依 `finance_production_release_guard.APM_SOURCE_REMOTE_MANIFEST` 顯式封存：

| 來源版本 | 正式遠端版本 |
| --- | --- |
| 20261019043031 | 20261020022748 |
| 20261020011825 | 20261020022750 |
| 20261020014611 | 20261020022751 |
| 20261020021355 | 20261020023444 |
| 20261020024107 | 20261020025210 |

正式 release guard 的 `classify-ledger`／`verify-ledger` 命令皆要求 `<ledger>.apm-sources.txt`，內容必須為 `finance_apm_source_manifest.sql` 從正式 ledger 讀出的五筆 `version:sha256`，按版本排序。原始 UTF-8 `array_to_string(statements, E'\n')` SHA 與本地完整來源檔 SHA 必須完全一致；少一筆、改動、混用本地時間戳、或缺現場證據均拒絕。保留所有原 Finance 基線及 source seal，沒有關閉 gate。

本交付不修改正式付款、退款、傳票或員工薪資資料。五份增量 SQL 由主發行流程套用並唯讀核對 exact source；前端只可在完整驗收與 source commit 後建立未指派正式網域的候選，正式 promotion 由主發行流程另外驗收。

## 可重跑驗收

```sh
pnpm test:apm-bonus-workbench
pnpm test:apm-bonus-workbench-browser
pnpm release:preflight
FINANCE_BUILD_TARGET=preview node scripts/build_www.js
# 本機具備 PostgreSQL server binaries 時，另跑真實鎖等待測試：
PG_TOOLS_PATH=/path/to/postgresql/bin pnpm test:apm-fresh-auth-native
```

SQL 測試是在 PGlite 合成依賴 schema 中執行真實 addon migrations；涵蓋跨租戶、未登入、一般員工、實際雙人核對、自審拒絕、精度、候選範圍、全額沖銷、未付款限制、撤權與重送。不是完整正式 Finance migration replay。

另以 PostgreSQL 17.6、三條真實連線及 READ COMMITTED 驗證 8 個鎖等待期間的角色、部門、預覽覆核人、付款資料讀取權與登入失效案例：解除鎖後重新核權，拒絕時包含回執及重送記錄的整筆交易均回滾。依賴平台 schema 仍是隔離合成資料，不是正式帳號或全站 migration replay。

瀏覽器涵蓋 Chromium／WebKit × 320／390／768／1440：獨立元件實際互動、實際現行 Finance shell 掛載、角色入口與直接導航拒絕、無授權不呼叫 RPC、dirty 離頁保留、未知結果 exact retry、malformed success、撤權清除、舊回應丟棄、橘底白字與橫向溢出。RPC 與帳號為隔離合成資料，不是正式帳號登入證據。

驗收結果與截圖：

- `/Users/seniorlifepr/.codex/tmp/apm-finance-workbench-browser-20261020/verification.json`
- `/Users/seniorlifepr/.codex/tmp/apm-finance-mount-browser-20261020/verification.json`

正式發行前：必須完成 source commit、全量 preflight／artifact integrity，核對 migration／Edge 環境與版本；正式發行後以真實授權會計及執行長只讀登入驗證 SSO、入口與候選範圍，另由授權承辦在真實業務案件執行雙人覆核。不可用合成 browser 或本機 build 冒充正式上線證明。
