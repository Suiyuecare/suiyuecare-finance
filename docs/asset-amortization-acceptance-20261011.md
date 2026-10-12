# 固定資產／預付費用台帳與逐月攤提

2026-10-11 已唯讀核對正式 `pg_catalog`：沒有既有固定資產、折舊、預付攤提資料表或對應 health RPC。既有報表只有進項憑證的 `fixed_asset` 分類，因此本次新增獨立台帳，不覆寫舊會計資料。

## 工作流程

1. 會計在既有正式分類帳中搜尋資產／預付費用的借方來源。搜尋在後端完整資料執行，支援分頁；不可只搜尋第一頁。
2. 登錄名稱、類型、成本、殘值、開始月份、月數、入帳部門、借方費用及貸方累計折舊／預付資產科目。所有金額使用整數分；同一來源可拆分多項資產，但合計不得超過原分錄成本。沒有原始入帳資料時，須先走既有核准開帳／取得分錄流程，不由台帳自動建立成本。
3. 檢視整張逐月直線法排程。第一月按整月計算，末月補齊分位；系統不代決定是否應資本化、耐用年限、殘值、稅法折舊方法或每日比例。
4. 提出指定月份的方案，畫面顯示兩筆借貸分錄與金額。原成本準備人、方案準備人及同一 Auth 身分都不可自覆核。
5. 另一位具有會計權限的人員確認來源、方法、期間及科目後，覆核入帳或退回。覆核入帳在單一交易完成方案狀態、正式傳票、兩筆分類帳與稽核事件；任何一步失敗全部回滾。
6. 每個資產每月只能入帳一次，不能跳過較早月份。已關帳月份不能提出／入帳；已有攤提入帳的成本及方法不能改寫，需循更正傳票處理。處分、減損、停用與方法變更目前走既有人工調整傳票，這個新增模組不假裝已涵蓋完整資產處分系統。

## 接入

```js
FinanceAssetAmortizationWorkspace.installRuntime({
  rpc: (name, args) => sb.rpc(name, args),
  user: () => S.user,
  tenant: currentTenantId,
  environment: currentEnvironment,
  permissionIdentity: () => JSON.stringify(CURRENT_PERMISSION_SNAPSHOT),
  identityBlocked: () => identityIsBlocked,
  accounts: () => ACCTS
});
const mounted = FinanceAssetAmortizationWorkspace.mount(container, {
  entityId: selectedEntityId,
  period: selectedMonth
});
await mounted.ready;
// 切換身分、法人、月份、頁面或登出時執行。
mounted.dispose();
```

新 engine：`assets/engines/asset-amortization-workspace.js`。公開方法另含 `loadWorkspace`、`searchSources`、`saveAsset`、`preparePlan`、`reviewPlan`、`renderWorkspace`、`toCents`。

新 migration：`20261011135523_finance_asset_amortization_v1.sql`（Supabase CLI 產生），依賴先前 `20261011133831_finance_completion_core_v1.sql`。所有資料表位於 private schema，RLS 開啟且撤銷匿名、一般 authenticated、service_role 的直接權限。僅有有明確身分、法人、環境、部門及來源範圍檢查的公開 RPC。

RPC：

- `finance_asset_workspace_v1(entity, period, environment)`：台帳、排程、本月方案及實際累計已入帳金額。
- `finance_asset_sources_v1(entity, query, offset, limit, environment)`：正式資產借方分錄搜尋及可分配成本。
- `finance_asset_save_v1(id, entity, data, expected_revision, operation_id, reason, environment)`：CAS 台帳異動、來源金額上限、重送回查與不可覆寫稽核事件。
- `finance_asset_prepare_plan_v1(asset_id, period, expected_asset_revision, expected_plan_version, operation_id, reason)`：伺服器計算金額，保留科目／來源指紋，不接受前端偽造分錄。
- `finance_asset_review_plan_v1(plan_id, expected_version, reason, return)`：不同人覆核，重新檢查科目、來源、資產版本、較早月份及正式關帳鎖，再原子過帳。

本 migration 將資產本月排程、已入帳及未完成數納入月結作業，並把台帳及方案納入不可覆寫快照的來源指紋。月結清單只拿摘要，不直接回傳整份台帳；下載來源快照時才依權限提供完整當時資料。

## 已執行本地驗收

`node scripts/test_asset_amortization.cjs`

使用 PGlite 執行實際 migration、既有正式傳票流水號 SQL、分類帳關帳 guard、傳票及分類帳 immutable trigger；全部資料為虛構。

| 類別 | 驗收條件 |
|---|---|
| 成本來源 | 必須同租戶、法人、環境、已入帳未作廢資產借方；成本加總超出來源拒絕 |
| 金額精度 | 190.00 元／3 月 = 63.33、63.33、63.34；100.01 元／3 月 = 33.33、33.33、33.35；保留正確殘值 |
| 驗證 | 拒絕零成本、無效殘值、超範圍或小數月數、null 金額、錯誤科目、無效部門、早於取得月份 |
| 權限 | 一般員工、匿名、跨租戶、被拒法人／部門不得讀写；同人不得覆核自己建立的成本或方案 |
| 重送及競爭 | 相同操作識別碼回原結果，改內容不可共用；舊台帳／方案版本拒絕；已有本月入帳不能再建 |
| 真實過帳 | 覆核確實產生月底正式傳票與兩筆平衡分類帳；失敗時狀態、流水號、傳票與分錄全部回滾 |
| 關帳與歷史 | 已關帳禁止過帳、不可跳月、傳票及分類帳不可直接改寫／刪除 |
| 來源變化 | 提案後科目名稱或來源變更，舊提案不得過帳，需重新提出 |
| 月結連動 | 未入帳方案在月結顯示待處理，真正入帳才改為已入帳；影響快照來源指紋 |
| 搜尋 | 後端回完整符合總數，頁面大小不截斷搜尋範圍 |

`node scripts/check_month_asset_workspace_browser.cjs`

Chrome 使用正式 CSS 與虛構 RPC 回應，驗證 360、390、768、1440 px 沒有水平溢出，來源查詢／選取／登錄可操作，失敗保留表單及同一資產識別碼，重試不以新識別碼重建；放大文字時仍可閱讀。截圖位於 `/tmp/finance-month-asset-browser-20261011`。

## 發布門檻

上述為本地 SQL 與瀏覽器驗證，不代表已上線或會計已完成真實資料核對。正式 migration 須隨整批受保護 release 執行，發布後核對 RPC／trigger 指紋與正式版本；再由會計以正式來源確認成本、方法與科目，另一授權人員覆核。未授權測試者不得替員工操作真實資產入帳。
