# Finance 本次介面一致性契約

範圍：2026-10-12 核准的人員列表／明細與歷史搜尋改善。既有後端業務、權限與單據語義優先於這份前端契約。

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| 整批表單短編號 | financeBatchNumberParts / Label / Html / SearchQuery | index.html；正式 batch_id 不改號 | BILLB → B2609-003、INVB → I2609-003；TEST 前綴保留；超過 999 不截短；僅 2000–2099 正式格式縮寫，舊格式原樣 | Chromium／WebKit 1440／390、完整編號複製、待辦／出納／歷史與明細、完整後端短號搜尋 |
| 簽核清單欄寬 | approval-worklist-table / approval-worklist-scroll | finance-core.css；renderApprList / renderApprDraftList | 桌機和平板固定欄寬、長單號欄內換行；空間不足只捲動表格；手機沿用 mobile-ux-engine 卡片 | 長批次繳費／發票單號、金額完整、待辦／出納／歷史、Chromium／WebKit 多尺寸 |
| 人員可見範圍 | visiblePersonnelUsers() | index.html 既有資料載入與 canAccessPage('users') | 沿用已授權目錄；不擴張後端讀取範圍 | 真 index 人資／唯讀／撤權瀏覽器檢查 |
| 人員變更 | openEditU / toggleU / deleteUserAccount | index.html reliable RPC、member.role.manage 與原離職交接 guard | UI callback 只觸發一次；新人須新增後交接 | personnel-save 與 workspace 實際 handler 驗收 |
| 身分及登入狀態 | Google health / presentation helpers | index.html normalizeFinanceGoogleLoginHealth | 啟用、綁定、待新帳號驗證、未知與失敗分開顯示 | 六種狀態、未綁定、唯讀與換身分瀏覽器檢查 |
| Select / Listbox | enhanceLongSelects() 與既有 Combo handlers | index.html shouldEnhanceSelect / data-no-search | 科目等查找型欄位保持 Combo；核准的人員公司／權限篩選使用原生 select，接受 OS popup 幾何 | actual index enhancer 排除檢查、native filter 鍵盤與窄螢幕 |
| 人員 Overlay | FinancePersonnelWorkspace native dialog | assets/engines/personnel-workspace.js | 核准的右側明細與更多操作 variant；鎖定、登出及離頁清除，不恢復舊人的 dialog | Tab / Shift+Tab / Esc / 焦點返回、identity lock 前清除 |
| 歷史可見範圍 | 個人單據 summary / detail RPC | finance_personal_document_summary_v1 / finance_personal_document_detail_v1 | 完整後端搜尋；本人申請／實際參與、整批分組及總數保持 | 114 組身分矩陣、完整 payload 比對與後端權限負例 |
| 搜尋排程 | 既有 history runtime 與 request generation | index.html apprSearch / loadApprovalHistoryPage | IME、防抖、Enter、取消與同請求去重；舊回應不得覆蓋 | 搜尋單元、真 composition 事件與 response race 測試 |
| 歷史更新 | renderApprovalHistorySummaries() | 已確認回應的身分／query／page 與 runtime.status | 查詢時可保留同身分上次結果但標示並禁用明細；成功才替換 | loading / error / retry / zero / scroll continuity |
| 身分切換與停權 | setFinanceWorkspaceIdentityBlocked() | 既有 permission epoch 與當前驗證身分 | 清除記憶體人員內容和私人 overlays；不跨身分持久保存 | late result / revoke / logout / lock-unlock 瀏覽器檢查 |
| Scrollbar | 全站 finance-core.css | :root 與共享 overflow baseline | 表格及 drawer 僅允許必要幾何調整 | 窄版、長內容、200% zoom 與 scroll continuity |


所有新增控制元件有可讀名稱、至少 44px 觸控區、可見焦點。窄螢幕與 200% 字體不整頁橫向溢出。不能新增 browser alert／confirm／prompt 作為新的頁面回饋；既有危險操作由原有 workflow 處理，本次不擅自放寬。

驗收使用隔離的虛構身份與單據，測試允許／禁止角色、系統帳號、執行長、長姓名／信箱、空結果、錯誤／停權、切換身份、輸入競速、快速返回與捲動保留。正式帳號 Google 登入與真人實機試用不由模擬測試冒充。

人員與單據搜尋含私人資訊，條件只存在本次已授權的記憶體畫面，不寫入 URL、analytics 或跨身分持久快取。

## 整批表單短編號（2026-10-15）

短編號僅為已授權資料的顯示別名，不能作為資料庫、簽核、附件、下載或稽核識別碼。`invoiceGroupNo`／`billGroupNo` 保持完整號。清單與明細使用同一 formatter；明細另顯示可換行的完整編號。短號按鈕沿用 `copyExpenseInvoiceNumber` 的完整號複製能力，具明確 accessible name、44px 高度及 live status；失敗顯示可手動複製的完整值。

本機搜尋同時索引短號與原號。我的申請／歷史的分頁搜尋只將完全符合短號格式的查詢，依目前 tenant 轉成完整號交由既有 scoped RPC；輸入及 runtime query 保持使用者所填內容。不能在已載入的第一頁自行過濾，也不改環境、權限或來源分組。一般文字、金額、完整號及舊批次格式維持既有搜尋。

## 通知讀取與歷史（2026-10-13）

通知的授權來源仍是 `public.notifications` 既有 tenant／environment 與 SELECT／UPDATE RLS。`loadFinanceNotifications()` 只讀所有未讀通知，每批 400 筆並核對 exact count；不能把失敗或未讀完的集合說成 0。`loadFinanceNotificationHistory()` 使用 created_at／id 游標每頁 40 筆，通知中心的「載入更多通知」保留所有歷史入口，不要求首屏取得全歷史總數。未讀 badge 與歷史列表狀態分開。

沿用 `financeNotificationState()` 身分隔離、既有通知按鈕與 `.finance-notification-status` 回饋；不新增配色或 overlay。「所有可見通知標為已讀」作用於目前後端授權可見的全部未讀通知，成功後回查，不能只更新已載入頁或樂觀清零。跨身分、撤權、登入鎖定立即清除快取；遲到回應不得回填。

驗收：`check_notification_paged_read_20261013.cjs`、既有 `check_employee_auth_notifications.cjs` 與 actual DOM browser 驗收；包含超過 1,000／2,500 筆、游標、篩選、未讀 exact count、錯誤保留、清空、已讀更新、跨帳號及撤權。

通知快取與通知跳單的身分邊界包含正式權限快照；同一帳號變更範圍後不得重用快取或套用舊回應。Realtime 只更新未讀通知與目前開啟的通知頁，並讓其他通知分頁重新查核；新增／填寫表單不因通知事件重建。

## 繳費單批次查詢（2026-10-13）

「我申請的」及「曾參與單據」沿用個人單據 summary／detail RPC。繳費單只以正式 `batch_id` 分組，不以單號、時間或相同姓名推測同批。先逐張套用既有本人申請／實際參與權限，再合併同租戶、環境、公司、部門、申請人、狀態、關卡與完整簽核快照相同的來源。不同流程階段分開顯示，不改原單號或簽核業務。

摘要顯示一筆整批、張數與已授權子單合計；「查看明細」重新確認每張子單權限，完整取得來源數、來源識別碼及批次範圍後才開啟。批次狀態或權限變更時提示重新搜尋，不以舊摘要開啟局部明細。既有發票分組維持不變。依據：`20261013091000_finance_personal_bill_batch_history_v1.sql`；驗收：繳費單批次 SQL／瀏覽器測試。

## 繳費單申請附件（2026-10-13）

新增申請的附件入口固定放在明細下方，不藏在 CSV／Excel 匯入工具中。檔案列表、檔案限制、移除、PDF／圖片本機預覽沿用 `FinanceEmployeeFormUX`；不另設預覽或上傳元件。Office 原檔透過既有 `fileToAttachment({directUpload:true})` 與 `uploadAttachmentsToSupabase()` 上傳，不依賴辨識或 FileReader 成功才能送件。

單張及整批共用同一套 `submitBillCore()`：檔案只上傳一次，所有同批子單的 `applicant_submit.files` 保存相同授權附件參照，再交由既有 `finance_submit_bill_batch` 交易保存及 claim。上傳失敗不呼叫建單 RPC，原表單與原檔保留；明確建單失敗只清理本次新上傳檔案。未知結果保留既有 operation key 與附件參照，依既有回查機制確認，不另建單。

附件選擇納入離頁 dirty 判斷；登入恢復僅保存檔名／大小／格式，不把原始檔寫入 sessionStorage。重開後缺原始內容的附件逐項顯示，必須重新選取或由使用者移除後才能送出。跨帳號清除附件及訊息，上傳每一檔之前與之後確認原身分和權限快照，避免將原檔交給新帳號。

驗收：`check_bill_form_attachments_20261013.cjs`（實際 submit／idempotency／recovery／upload coordinator）及 `check_bill_form_attachments_browser_20261013.cjs`（實際 index 與共享元件，Chromium／WebKit，1440／390px）。使用虛構本機 transport，不冒充正式使用者登入或正式 Storage 寫入驗收。


## 原申請人抽單入口（2026-10-13）

所有本人送出的支出、繳費單、發票及衍生收款紀錄，在「我的申請／過往單據」列表保留「抽單」入口。入口只重新讀取完整明細並將焦點帶到既有抽單區，不直接修改單據；已結束、收付款、入帳、電子勞報已邀請等不符既有條件者保留停用按鈕並說明原因。

Canonical owner 是 `requestApplicantWithdrawButtonHtml`／`incomeApplicantWithdrawButtonHtml` 與既有 withdrawal RPC。一般員工無需取得管理頁權限。個人歷史仍禁止核准、駁回及編輯；抽單唯一窄例外須核對原申請人穩定識別碼、租戶／環境、權限快照、完整來源指紋與版本。同批繳費／發票以正式 batch_id 做針對性 exact-count 查詢，不要求載入整張管理資料表；來源範圍與任一版本不一致則不啟用。後端原子交易仍確認全部同批單據，不能部分抽單。

查看明細立即呈現已授權資料；批次抽單確認在背景進行，只更新抽單區，不阻擋閱讀、不重刷明細或改變捲動。關閉、換帳號或撤權後的舊回應不啟用操作。沿用原有危險操作確認、idempotency、送件不明回查與完成後重新讀取，保留原單、附件及稽核。

驗收包含所有既有支出種類及電子勞報、本人／非本人／撤權、單張及 4／95 張批次、部分批次、舊版本、資料讀取失敗、背景延遲、已收付／已開票／已邀請限制，以及桌機與手機的實際點擊。


## 覆核手續費資訊（2026-10-16）

`requestBankFeeReviewHtml` 是一般明細表及發票分組明細的共同手續費摘要，固定顯示負擔方與已存公司手續費，包含 0 元。以正式 `fee_bearer`、`bank_fee_amount` 為準；缺值顯示未填／待確認，不以目前費率改寫舊單。原人事試算與已存值不一致時顯示核對提示，不自動補加費用。電子勞報顯示由獨立付款流程確認；預支已撥款後提示最後核銷不重複加計。

沿用 `finance-core.css` 品牌、字體 token；手續費放在品項表外，不成為可編輯本金列。原申請負擔選項統一為「己方支出／對方支出」，覆核摘要不新增無法保存的下拉框。依據：`private.finance_finalize_accounting_patch_v1` 鎖定已存手續費、`expenseApprovalTransactionPatch` 既有可修改範圍。新申請及總務明確重新填寫匯款資料才依法人費率計算；其他讀取、保存、簽核與入帳保留既定費用。

驗收：`check_bank_fee_review.cjs`、`check_fee_review_browser.cjs`，涵蓋人事與一般發票、己方／對方、0 元／多筆費用、缺值／矛盾資料、兩種詳情入口、桌機與手機及 Chromium／WebKit；使用虛構資料，不執行正式付款或入帳。
