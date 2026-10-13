# Finance 本次介面一致性契約

範圍：2026-10-12 核准的人員列表／明細與歷史搜尋改善。既有後端業務、權限與單據語義優先於這份前端契約。

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
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
