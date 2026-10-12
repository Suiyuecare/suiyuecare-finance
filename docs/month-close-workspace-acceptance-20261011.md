# 月結工作台與不可覆寫來源快照

範圍：正式關帳狀態修正、每法人每月作業狀態、伺服器來源快照、另一人覆核。未修改既有帳款、薪資、分錄、單據或關帳資料；不自動補帳，不替會計確認欠缺的資料。

## 接入

載入 `assets/engines/month-close-workspace.js` 後：

```js
FinanceMonthCloseWorkspace.installRuntime({
  rpc: (name, args) => sb.rpc(name, args),
  user: () => S.user,
  tenant: () => currentTenantId,
  environment: () => currentEnvironment,
  permissionIdentity: () => currentPermissionVersion,
  identityBlocked: () => identityIsBlocked
});
const mounted = FinanceMonthCloseWorkspace.mount(container, {
  entityId: selectedEntityId,
  period: selectedMonth // YYYY-MM
});
await mounted.ready;
// 更換法人、月份、頁面或登出時先銷毀，再重新 mount。
mounted.dispose();
```

工作台要求選定單一法人。前後端都限制會計、行政部主任或執行長，沿用報表頁及法人完整來源權限；不擴大董事、外部查核或一般員工的銀行與薪資權限。薪資仍使用專屬讀者名單。未授權時不應繼續顯示上個身分的資料。

亦提供 `buildWorkspace(raw)`、`renderWorkspace(model)`、`loadWorkspace(scope)`、`prepareSnapshot(scope, model, reason, optionalOperationId)`、`reviewSnapshot(model, reason)`、`readSnapshot(id)`。會計核對欄位沿用報表設定的 `periodChecks[YYYY-MM]`，其編輯仍走既有報表設定介面。工作台不另建第二套銀行對帳或薪資規則。

## 伺服器契約

- `finance_period_close_health(entity?, month?, environment)` 改查 `period_closes`，與關帳過帳鎖同一來源；保留 SECURITY INVOKER 與 RLS，加上明確租戶範圍。`ok` 只在有預期月份且全數真正關帳時為 true；無資料為 `no_activity`，待關帳不是完成。此 API 統計呼叫者可讀範圍，不冒充整個集團完整覆核。
- `finance_month_workspace_v1(entity, month, environment)` 使用既有完整法人調閱權限及 HR 隱私檢查。回傳報表設定、月分類帳試算、銀行匯入／實際配對殘額、薪資應計狀態、正式關帳、原件封存與驗證數，以及最新快照是否仍符合來源。
- `finance_month_snapshot_prepare_v1(entity, month, expected_revision, expected_fingerprint, operation_id, reason, environment)` 在伺服器產生累計分類帳、月科目加總、報表設定及作業事實的快照；不接收前端指定的報表／金額。租戶操作識別碼重送回傳原快照；不同內容禁止共用識別碼。版本及來源必須符合載入時的狀態。
- `finance_month_snapshot_review_v1(id, expected_fingerprint, reason)` 要求不同 Finance 人員且不同 Auth 身分、最新版本、目前完整來源一致。重複同一人同說明覆核安全回查，已完成內容不可改寫。
- `finance_month_snapshot_read_v1(id)` 每次重新驗證公司、部門及原薪資來源的權限。原件薪資來源日後移除，也不能讓被撤權者讀到快照內的歷史薪資分類帳。

快照表及覆核表位於 private schema，RLS 開啟，PUBLIC、anon、authenticated、service_role 均無直接讀寫授權；update/delete 由 trigger 拒絕。僅授權 authenticated 使用有範圍檢查的公開 RPC。

來源指紋涵蓋既有來源指紋、累計分類帳、報表設定、銀行交易與實際配對目標、銀行匯入、正式關帳、薪資來源及封存驗證。其定義為一個時間點的來源一致性，不是永久鎖住後續所有業務資料。資料後續更新，舊快照保留並標示「來源已變動」。

## 不能誤稱完成的情況

1. 沒有薪資應計紀錄，不代表沒有薪資義務；仍顯示需確認是否適用。
2. 交易配對完不代表銀行期末餘額核對完；還需要既有銀行核對紀錄。
3. 有某批憑證封存驗證，不代表涵蓋本期全部檔案，顯示數量供會計核查。
4. 核對清單屬人員確認，不偽裝成機器從憑證證明的事實。
5. 「獨立覆核」僅證明另一名授權人員確認該份不可覆寫來源快照，不自動把報表改成正式，不代表查核簽證或完成法定申報。未完成項目仍顯示。
6. 沒有真實正式資料時，工作台不以測試紀錄或假值補齊。

## 驗收

執行 `node scripts/test_month_close_workspace.cjs`。

| 項目 | 通過條件 |
|---|---|
| 正式關帳來源 | 只在舊關帳表有紀錄不能通過；正式 `period_closes` 已關才顯示通過 |
| 開關帳一致 | 真正關帳後新增分類帳遭拒；會計不能重開；執行長提供新理由可重開，健康結果同步回待關帳 |
| 無資料狀態 | 空月份為 no_activity，無薪資／銀行／封存均清楚指出缺紀錄，不顯示已完成 |
| 權限 | 一般員工、外部查核者、跨租戶、法人被拒、部門被拒及部分來源不可讀均拒絕完整月結 RPC |
| 銀行 | 錯誤的 matched 文字不覆蓋實際未配對金額；其他環境配對不能消除本環境殘額；配對目標變動使快照失效 |
| 快照 | 後端產生帳簿與科目加總；修改／刪除快照或覆核遭拒；相同操作識別碼不產生第二份 |
| 同時修改 | 舊版本、舊來源指紋不可建立或覆核；重讀新資料才可建立下個版本 |
| 獨立覆核 | 準備人不可自覆，另一授權人可覆核，重複覆核可安全回查 |
| 薪資隱私 | 未獲權限的待處理薪資不顯示金額／筆數，不能建立完整快照；已入帳薪資遵循既有 HR scope；撤權後原來源移除也不得讀歷史快照 |
| 前端 | 缺資料不顯示完整；資料與理由 HTML 跳脫；登入身分切換中讀取回應丟棄；連點只送一個請求 |

整頁整合另需瀏覽器驗收：360／390／768／1440 px，長法人與中文說明、200% 放大、鍵盤操作、載入失敗重試、切頁／切身分時銷毀、下載 JSON 中版本與來源指紋對應。正式部署前必須在隔離 PostgreSQL 完整 migration 批次檢查依賴及 RPC 權限，再由會計以真實月份自行確認資料；本文件不把本地測試當成已完成正式月結。
