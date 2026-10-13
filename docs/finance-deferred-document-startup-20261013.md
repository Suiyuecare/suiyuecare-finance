# 非帳務角色的單據初始化與續接紀錄

這次只處理登入後不必要的完整單據讀取。正式 Google 身分、既有權限、送件／簽核 API、交易識別碼與後端驗證保持原有規則。通知讀取的後端效能由另一個修正處理。

## 載入與消費者對照

| 消費者 | 單據來源與驗證 |
|---|---|
| 一般員工、課長、部門主管等的工作台、新增申請 | 不啟動三張完整來源；已驗證待辦仍由原本快速簽核通道取得；申請總數顯示待確認 |
| 簽核管理的我的申請、參與紀錄 | 保留原本完整伺服器分頁與搜尋，查詢結果不依賴首次載入的單據陣列 |
| 草稿與送件 | 保留本人草稿專用讀取；正式送件、單號與計算由原後端決定 |
| 申請紀錄列表 | 進入頁面才讀完整 expense_requests，核對所有頁及正式 total 後顯示列表與總數 |
| 開立發票／發票管理／批次已送查詢／收款情形 | 進入相應頁面才讀完整 invoices；未完成時明示待確認，失敗可重試；只重繪查詢區，保留正在填寫的表單 |
| 繳費單辦理與管理列表 | 進入頁面才讀完整 bills；只更新列表，保留單列及批次欄位 |
| 會計、執行長、行政部主任、外部稽核、董事與股東的帳務來源 | 保留完整三來源、分類帳與既有報表完整性驗證 |
| 其他獲准進入報表／管理頁面的角色 | 由實際頁面需求補讀三來源；沒有增加權限或以快取結果代替授權 |
| 人員管理專用前台權限健檢 | 只有既有 member.role.manage 能力才執行；其他角色結果保持未知，仍執行自身身分與部門驗證 |

每個延後來源以 Auth、Finance ID、租戶、環境、角色與權限快照隔離。共用讀取排程維持最多一張大型來源與兩個總讀取；重試沿用同一個進行中的 promise。身分鎖定會中止來源並清除其完整性狀態；舊回應不能寫回新帳號。

未知的來源以 data:null、complete:false、total:null 表示；不以空陣列或零筆表示讀取成功。失敗保留已確認資料，但其完整性保持 false；重繪不自動連續重試。

## 續接與驗收

分支：codex/finance-deferred-startup-20261013；原始 main：dc480d01fb1629b4c436eede0e61c7a0806e2223。

```sh
pnpm test:history-performance
pnpm test:read-latency
pnpm test:dashboard-readiness
pnpm test:employee-reliability
node scripts/check_deferred_document_startup_20261013.cjs
node scripts/check_deferred_document_startup_browser_20261013.cjs /tmp/finance-deferred-startup-browser-20261013
node scripts/check_startup_read_coordination_browser.cjs /tmp/finance-existing-startup-browser-20261013
pnpm release:preflight
```

新增單元案例覆蓋非帳務登入不等待三個阻塞來源、六類帳務角色仍完整讀取、摘要失敗時僅在簽核頁補讀完整來源、列表按需載入、已確認零筆、進行中修改、失敗重試、未知來源及越權頁面、身分／租戶／環境／角色／權限切換與鎖定。

新增瀏覽器案例使用實際 index 與虛構資料，在 Chrome／WebKit 的電腦與手機頁面檢查開頁、總數待確認、繳費／發票欄位保留、重試、身分鎖定及帳務報表。測量值是受控本機傳輸測試，不代表正式員工操作的網路效能；沒有代登入員工帳號。

本分支依主代理整合順序先完成本機 commit，未單獨推送或部署。正式發佈仍須由整合分支完成 CI、建置與前台版本驗證。

## 本機結果（2026-10-13）

- 新增實際 handler 單元回歸：21 項通過，已納入 `test:history-performance`，因此會進入 release:preflight。
- 新增實際 index 瀏覽器回歸：8 項通過（Chrome／WebKit × 課長電腦／手機、會計、執行長）；課長受控啟動約 367–386ms，三類完整來源在啟動時均未被呼叫。完整傳輸若被呼叫會等待 8 秒，此測試不提高 timeout。
- 既有 history-performance、read-latency、dashboard-readiness、employee-reliability 與會計 startup browser 通過；完整帳務來源、分類帳與報表沒有改為延後模式。
- 新增瀏覽器命令已加入 stability-gate 與 protected finance-production-release 的既有 interaction 流程；相關腳本與說明納入來源完整性、Vercel 上傳及發佈 artifact 清單。
- 改動內容的 premium strict 靜態檢查通過，延續原有 DESIGN.md token 與 UX 契約，不改配色、字體或業務權限。
- 全部 release:preflight 要在本機 commit 後執行，因為既有來源門檻要求乾淨工作樹；不能繞過此門檻。結果由主代理整合發佈時再次核對。

## 背景重繪與未儲存收入表單

發票及繳費表單的 builder 只在首次缺少 baseline 時同步建立乾淨基準。背景 buildAll／列表重繪保留既有 baseline，不排入會吸收稍後輸入的 mark-clean callback。既有明確離頁選擇、已確認送件及 `clearIncomeSubmissionFormIfUnchanged` 仍持有 mark-clean 語義；送出期間另有新編輯時不能清空表單。

這項回歸已擴入既有必跑 `test:deferred-startup-browser`，兩個 required browser workflow 都會執行。Chrome／WebKit × 1440／390 分別驗證發票、繳費表單：首次預設乾淨、同幀輸入立即 dirty、背景重繪仍 dirty／不改欄位、真正離頁 dialog 與 Escape 保留、確認後重設可 clean，以及較新編輯不被舊快照清空。與原有啟動／帳務場景合計 16 組通過；168 項收入送件／復原 handler 回歸通過。
