# 儀表板來源範圍與報表勾稽修正

對應 R-01、R-02、R-03。此變更不重分類、不回填租戶，也不修改任何既有分錄或單據。

## 資料與權限

`20260914001246_finance_dashboard_scope_integrity_v1.sql` 只替換既有 `public.finance_executive_dashboard_v2(date,date,date,date,date,text,text)`。保留 v3、應收計算、函式簽章及既有 authenticated/service_role ACL，新增明確有效身分、Google 驗證、角色、reports 設定及公司／部門完整範圍檢查。匿名、缺身分或未取得完整來源權限的呼叫拒絕；董事／外審仍須符合既有逐張單據可讀範圍。

所有本期、前期、趨勢、來源計數及來源勾稽皆以相同租戶／環境／公司資料集計算。來源單號配對增加公司一致條件。完整來源計數仍涵蓋全部日期，因此完整來源權限也涵蓋全部日期；不能只檢查本期卻揭露未授權歷史計數。缺少公司歸屬或完整權限時明確拒絕，避免顯示可信的假零。

正式資料於 2026-09-14 08:25（臺北時間）僅唯讀核對：4034 筆分類帳、1003 張發票、565 張申請的公司／部門均非空，公司全部存在於 11 個設定單位內。四個可選 Membership 控制介面均不存在，保留現行 fallback；CEO／會計的 reports 權限為 edit。這只證明目前資料及設定相容，不代表已代替每名員工真人驗收。195 筆歷史 NULL tenant 分錄不會自動歸戶，修正後仍排除於正式租戶總額之外。

## 顯示一致性

未連結來源新增件數與絕對金額，正負互抵成零仍顯示待核對。未來單據對本期分錄的配對也計入待核對；正常跨期調整及尚未入帳待辦不因此一律判錯。

損益來源明細共用財報引擎的結帳分錄判斷，排除同一批結帳分錄，避免表上損益與下載來源加總不同。資產負債表仍保留累計及結帳資料。

## 驗證與發布契約

- `check_dashboard_scope_integrity.cjs`：49 項真 PostgreSQL/PGlite 行為檢查，載入原 v2、未改 v3／canonical AR 及真權限 helper。重現跨租戶問題，驗證完整計數、同號跨公司、前期／環境／沖銷、正負未連結、ACL、角色和公司／部門拒絕。13 角色及 4034/1003/565 筆規模使用虛構人員和明細。
- `check_report_reconciliation_sources.cjs`：23 項真函式檢查，涵蓋勾稽警示、相容舊 payload、正常跨期與各種結帳分錄。
- 既有財報 40、runtime 24、workspace boundary 35 及部門匯出回歸通過；1440／390 真 Chrome 報表頁及 PDF 表頭／數字驗證通過。
- `finance_dashboard_scope_postflight.sql`：唯讀、可重複執行，核對 body hash、owner、STABLE、SECURITY DEFINER、空 search_path、ACL、未改 v3 及缺身分拒絕。
- `finance_dashboard_scope_canary.sql`：純唯讀，核對固定 body 後直接執行其來源查詢，與獨立 tenant/env/company 聚合比較；不設定 employee claims、不新增人員／業務資料。正向角色權限由本機真 SQL 回歸驗證。

舊 v2 body MD5：`8de3ece274d222fdf7d7a02949d6475b`；新 body MD5：`84043dbdd33bd3e4152f61727e25b202`。v3 仍為 `36e536eb3ccfc071a8541719022597f1`。

交易演練必須完整回滾至舊 body 與相同資料指紋。正式回復需另建受保護追蹤 migration，採用保存的 `finance_dashboard_v2_pre_scope_20260914.sql` 定義與原 owner／ACL；不得手動刪除 migration ledger 或繞過發布流程。
