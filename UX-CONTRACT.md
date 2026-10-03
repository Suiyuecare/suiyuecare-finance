# 財務工作台 UX 契約

本文件只定義使用者看見的流程、狀態與回饋；簽核權限、會計科目、交易與資料可見範圍仍由後端契約決定。來源衝突時，先遵守伺服器／資料庫業務契約，再遵守本文件、共用前端元件與既有相鄰流程。量測計畫見 [順暢度改善與驗收](docs/finance-smoothness-plan-20261002.md)。

| 能力 | 目前共用擁有者 | 規則與驗收 |
| --- | --- | --- |
| 簽核搜尋 | `index.html` 的簽核搜尋控制器；歷史結果以後端本人可見 RPC 為權威 | 中文組字不查、連打合併、舊結果不得覆蓋新查詢；清除立即；搜尋失敗不顯示確定 0 筆。單號、姓名、目的與原始金額語意見 [金額搜尋](docs/FINANCE_AMOUNT_SEARCH.md)。 |
| 簽核清單與選取 | `renderApprList`／既有批次選取狀態 | 先顯示目前關卡、風險和下一動作；選取範圍明示本頁或全部，仍以後端授權核對；手機不得省略風險或可執行操作。 |
| 手機常用導覽 | `assets/engines/mobile-ux-engine.js` 從桌面已授權導覽挑選捷徑 | 依職務排序最多四個常用頁，未授權頁面不得出現；完整授權頁面仍可由更多選單進入。職務排序不授予任何權限。 |
| 主要／次要按鈕 | `assets/styles/finance-core.css` 的 `.btn-p`／`.btn-s`／`.btn-g` | 主要橘底白字至少 4.5:1；鍵盤焦點可見，忙碌及停用不冒充成功。色彩來源見 [DESIGN.md](DESIGN.md)。 |
| 背景讀取及即時更新 | `loadRemoteData`、`refreshRemoteData` 與相應 scoped read | 小表變動只更新受影響資料；正式金額及送件前核對仍須完整。刷新可保留最後成功資料但要標示時間；錯誤、未完成與確定空集合須分開。 |
| 單據頁首屏 | `performRemoteDataLoad` 與正式財務來源協調器 | 財務角色進入申請、傳票、繳費單或發票頁時，先讀並呈現該頁已驗證的單據，再接續完整分類帳與公司設定；正式財務數字未完整核對前維持核對中。單據來源失敗仍須繼續完整財務讀取，登入身分切換後不得回填舊單據。 |
| 手機申請清單 | `assets/styles/finance-core.css` 的 `#pg-expenses .mobile-native-card-table` | 手機在清單標籤備妥後改為可逐項閱讀的卡片，保留七個欄位、長用途與金額；375／390px 不應出現 980px 橫向表格，桌面仍用欄位表格。卡片可點擊及鍵盤開啟詳情。 |
| 畫面簡化層 | `assets/engines/workflow-simplification-engine.js` | 只掃描實際變動的表單、清單或詳情區域；通知等無關 DOM 異動不能造成全頁反覆重排；手動刷新仍能完整套用。 |
| 附件保存與檢視 | Storage `file_attachments.storage_path`、`uploadAttachmentToSupabase`、`downloadFileMeta`／檢視器 | 選檔不等於上傳完成；私有附件須在當前登入身分下簽章並核權。晚到預覽不得跨檔案、帳號、租戶或環境顯示；失敗有重試。 |
| 發票檔案匯入 | `setBatchInvoiceUploadFile`、`analyzeBatchInvoiceUpload`、`importBatchCsv` | OCR 與 CSV／Excel 異步讀取只可更新目前選定檔案的最新嘗試；換檔、切換登入身分及重試後的舊結果不得覆蓋明細或提示。 |
| 送件與草稿 | 正式交易 RPC、本人草稿 scoped read | 暫存可恢復；交易逾時只能顯示「結果待確認」，沿同一識別碼查核。不可再建一張替代單。見 [員工可靠性契約](docs/finance-employee-reliability.md) 與 [草稿契約](docs/finance-draft-readiness.md)。 |
| 組織圖閱讀 | `index.html` 的 `orgExplorer*`；`mobile-ux-engine.js` 共用主管關係／人員簽核設定頁籤 | 預設縱向層級列表、點人查看詳情；完整關係圖保留。公司／部門篩選採明確原生 select（平台控制彈出選單），姓名搜尋於已載入人員本地執行，中文組字完成才更新。篩選保留標示為上層主管的上下文，不改寫隸屬；循環關係獨立警告，不畫成有效主管階層。讀取狀態只在本頁記憶體保存，切帳號／租戶／環境清除；不寫入網址或儲存草稿。編輯仍由 `canManageOrgChart` 與 `finance_save_org_chart_versioned_v2` 授權和版本契約控制。以人員 ID 定位編輯，保留唯讀登入信箱遮蔽；驗收見 `scripts/check_org_chart_clarity_browser.cjs`。 |
| 組織圖縮放與下載 | `orgExplorer*` 共用已授權人員模型與 `orgGraph*` 幾何／匯出控制器 | 篩選在列表／完整圖共用；縮放只改顯示。下載完整目前篩選範圍與必要主管上下文，不裁切捲動視窗，不加入登入信箱；PNG 與 SVG 都有範圍及日期，超大圖以明確說明保留 SVG 替代。異常主管關係仍警告，匯出不改寫隸屬、不呼叫寫入。 |
| 報表 | 分類帳、公司設定與報表工作區 | 正式／暫編、資料截至時間與核對中必須可辨。未取得完整正式來源不顯示推估數字。見 [報表契約](docs/finance-reporting-contract.md)。 |

驗收時使用本地虛構角色矩陣覆蓋申請人、主管、出納、會計和執行長；正式站可用匿名與唯讀資料查核，不借用或冒用員工登入。每個改動至少檢查桌面、375／390px 手機、鍵盤、慢網、失敗、重試、切換登入身分及資料更新；本地綠燈與正式部署證據需分別記錄。
