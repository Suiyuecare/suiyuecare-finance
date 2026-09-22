# 薪資分錄讀取拒絕後的前端完整性

2026-09-22，本機合成資料驗證。

當薪資分錄併入正式分類帳後，未具薪資帳務授權的查詢由資料庫以 `42501` 拒絕整個讀取。既有三表、管理報表、儀表板財務 KPI 與會計師查帳已檢查來源完整性；但分類帳、傳票、內控與備份入口原本仍會直接使用上次的陣列。此次修補這些入口，避免殘留金額、空陣列被呈現成正式零元，或遭匯出。

## 實作

- `index.html` 加共用完整性檢查，使用登入資料範圍、分類帳完整性與權限拒絕狀態。
- 分類帳、傳票或儀表板收到權限拒絕時，清空 `LEDGER`、`VOUCHERS`、已選查帳列、已上傳還原包及正式會計明細快取；關閉並清空查帳／報表對話框，清除報表與稽核快取。
- 拒絕狀態納入報表身分識別，讓先前的非同步讀取不再回填舊快取。分類帳單獨重讀成功仍不足以解除傳票拒絕，須完整來源重讀成功。
- 分類帳、傳票、會計內控顯示明確提示；科目使用狀態呈現「尚未核對」，不顯示「未使用」或零元。
- 分類帳／傳票／三表／內控／稽核 CSV、年度包、備份、報表追溯、關帳、調整、憑證索引與年度覆核入口在完整性未確認時停止。
- 儀表板權限拒絕移除舊成功聚合值，並保留終止錯誤，避免重新繪製造成連續重試。原先對一般暫時性錯誤保留已驗證快照的行為維持。

## 已檢查的來源

- `loadDashboardFinancialSources`、`loadStatementSourcePages`、`performRemoteDataLoad`：42501 不屬於可保留快取的 timeout，不能轉成成功空資料。
- `FinanceReportingWorkspace`：三表、管理報表與匯出檢查完整分類帳；應收及稅額資料各自具有讀取狀態與來源確認。
- `FinanceAuditWorkspace`：先後來源 fingerprint、完整來源重新讀取及逐表筆數核對，讀取拒絕會中止。
- 傳票與分類帳清單、內控、備份及科目使用狀態：此次加共用檢查。
- 資料庫整體拒絕、薪資傳票建立、來源附件、AR 與 SECURITY DEFINER 聚合函式的防護由 Finance bridge migration 負責，前端檢查不取代資料庫權限。

## 驗證

- `node scripts/check_hr_accounting_read_privacy.cjs`：24 項，執行實際 host 函式，合成傳輸／DOM。涵蓋分類帳與傳票 42501、清除舊資料、完整重讀恢復、17 個操作入口、備份建構、聚合拒絕及不循環重試。
- `node scripts/check_dashboard_financial_sources.cjs`：29 項通過。
- `node scripts/check_dashboard_aggregate_loading.cjs`：46 項通過。
- `node scripts/check_reporting_workspace_boundaries.cjs`：35 項通過。
- `node scripts/test_html_render_security.cjs`：通過。
- `node scripts/check_hr_accounting_read_privacy_browser.mjs`：實際本機 index、正式 CSS 與 renderer，合成登入／42501／舊資料；分類帳、傳票、內控在 1440、390、320px 共 9 組無溢出，3 個實際匯出動作均被拒絕，無 page error。測試為了呈現指定頁面移除啟動登入等待遮罩並設定頁籤 class，未新增正式產品測試入口。
- 瀏覽器證據：`/Users/seniorlifepr/Documents/ChatGPT/finance-hr-privacy-evidence-20260922/verification.json`。本次 index SHA256 為 `d9c1f93a768a2addf620dc09f7714e1d228b91e1a54cb3ecbef32ff550169547`。

這些是本機合成驗證，未使用正式員工、薪資、銀行或外部 API。發布與正式 RLS／部署確認由整合流程另行執行。
