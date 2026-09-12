# 簽核紀錄、登入讀取與明細呈現

本次範圍為簽核分類、歷史查詢、登入重複讀取，以及發票／申請／會計明細表格。發布狀態須以 protected workflow 結果及正式站 release manifest 的 exact commit 為準。

## 使用者可見修正

- 簽核分類依「待辦、申請、查詢」排列，保留六個原有清單與篩選規則。簽核紀錄分別標示「本人已處理」及「曾列入流程」，不把受指派誤稱為完成簽核。
- 歷史查詢沒有搜尋條件時，先取得該頁群組，再載入完整來源；完整筆數仍由全部可見群組計算。搜尋先套用條件再分頁，維持完整批次、金額搜尋及原有排序。
- 修正無法從頁面呼叫的重試入口。同步例外、逾時、取消及延遲回應均有明確處理；錯誤不當成零筆，也不讓舊搜尋或舊登入身分的回應覆蓋新畫面。
- 組織診斷只在相同身分、公司、環境與權限版本下合併自動讀取。人工刷新與本人資料修復後必須重新查核；失敗與相容性備援不能視為新鮮的正式結果。
- 大型財務資料保留單一路徑依序讀取，小型設定讀取另一路並行，總並行數上限為二。所有原有來源與完整性檢查保留。
- 發票、申請與會計明細統一表格，修正巢狀表格標籤錯置。手機可在表格容器內左右滑動，並顯示溢位提示；科目、金額與人工覆核保存規則維持原有契約。

## 測試與證據界線

`pnpm test:history-performance` 執行實際前端函式、PGlite 真 SQL 及發布交易回歸；已串入 `release:preflight`。`pnpm test:approval-performance-browser` 使用實際本機 HTML／引擎搭配虛構身分與來源，依序檢查分類、歷史錯誤恢復、登入協調與明細表格，需要 agent-browser 及 Playwright 瀏覽器 runtime。

桌機 1440 與手機 390 驗證包括正確表頭與逐格資料、44px 觸控區、鍵盤操作、無整頁橫向溢出、真人工覆核 collector、只讀角色與正式入帳唯讀。歷史回歸包含全部分頁、完整批次、金額搜尋、逾時重試、錯誤保留已確認紀錄，以及不同身分／租戶／環境隔離。

本機固定每次讀取 60ms 的登入管線比較：組織診斷 18→6 次、通知 2→1 次；首個完整來源頁面呈現約 1368→1058ms。這是受控管線延遲模型，不是正式員工 OAuth 登入、可寫權限就緒時間或實際網路測速。

PGlite 匿名資料比較舊新真 RPC 的完整 JSON 相等。正式資料只讀比較只回傳筆數、批次完整度、位元組及 hash，不回傳人員或單據內容；此診斷等價 SELECT 並不代表正式函式已部署。正式查詢仍會傳送每頁完整批次，不能承諾任何網路環境均即時完成。

## 受保護發布

唯一新增 migration：`20260912164807_finance_approval_history_page_first_v1.sql`，由固定 phase `database_history_performance_20260913` 發布。其前置檢查鎖定舊函式 body MD5 `08f88c03990425a076e88d49fa016ad0`、owner、SECURITY DEFINER、STABLE、空 search_path 與 ACL。新 body MD5 為 `53f526628bded4241c3bbe61de6efcd3`，不新增角色權限。

所有舊 migration 必須完整存在。候選建置封存後，先驗完整回滾演練、舊新 canaries 與 chained postflights；migration、ledger 及 postflight 同交易提交，再獨立驗證及提升 exact candidate。前台相容性發布必須已安裝本 migration。既有 employee reliability fingerprint 用於驗證演練後函式、角色、資料與 migration ledger 復原。

正式驗收應核對 deployment manifest 與全部靜態資源 hash、1440／390 匿名登入頁、資料庫新函式 postflight，以及相同範圍的匿名只讀歷史摘要。虛構瀏覽器測試與回滾 canary 不等於每位員工本人逐一操作正式單据。
