# 人資付款交接

2026-09-22：本變更從當日 `origin/main` 的 `642266fa9276f9020b526a075ebc7bb578f3f2f3` 建立持久隔離工作樹。原 Finance 工作樹的未提交修改完整保留。這份紀錄描述實作及本機驗收，不能作為正式部署、真實送件或銀行付款證明。

人資已核准的月薪／單獨獎金以固定 obligation ID 交接。接收端先保存不可變來源，再依序核對付款清冊、登錄上傳結果、完成會計項目檢核、登錄放款結果、交還人資原申請人確認，最後由指定會計建立付款結算傳票、實際寫入 Finance 分類帳並結案。系統不會操作兆豐轉帳，也不會由接收成功推定已付款。

## 資料及權限

- 來源、實發金額、事件佐證、重送快取都保存在 `finance_hr_private.finance_hr_*`，全部啟用及強制 RLS，不授權 `anon`、`authenticated` 或 `service_role` 直接讀寫。
- 接收與原申請人確認 RPC 只授權 `service_role`；公開 SQL 包裝是 invoker，具提升權限的程式在專用 finance_hr_private schema，使用空 search path。
- 使用者只透過 `finance_hr_snapshot`／`finance_hr_command`／`finance_hr_voucher_options`／`finance_hr_post_voucher` 存取。必須有有效 Finance 登入身分、相同 tenant，以及經查核的 HR／會計／執行長薪資查看授權。行政主任或一般主管不因參與既有費用簽核就取得薪資權限。
- 不將薪資明細、銀行帳號或文件寫入一般 `expense_requests.form_payload`；不沿用會讓同部門主管與全流程參與人讀取整列的一般費用 RLS。
- HR 原申請人保留原 Auth UUID，與 Finance 登錄人及傳送服務分開；原申請人可在人資系統操作，無須建立 Finance 帳號。
- 回呼僅含流程狀態、來源雜湊與實際處理人，不含金額、員工清冊或佐證內容。

## 啟用前的正式查核資料

本次沒有新增任何正式 route、salary reader、薪資、銀行或會計測試紀錄。

需將 HR 雇主 UUID 與 Finance tenant／法人代碼逐筆核實，並查核每位 HR 原申請人 UUID、Finance 四個實際承辦角色（兆豐上傳、會計項目、出納、傳票）及有效薪資授權。填寫 `verified_by`、`verified_at`、`evidence_reference` 與有效期間。路由預設停用；只有同一雇主及原申請人恰有一個有效查核路由時才收件。人員異動應建立新版路由，舊版只可停用或縮短有效期，不得覆寫歷史角色。

Finance 認得的公司、機構、部門或員工投影並不自動證明 HR 雇傭、法人歸屬或薪資查看資格。正式映射不可由姓名相同、Email 相同或舊系統開戶日期自行推論。

## 介面

| RPC | 身分 | 輸入及結果 |
|---|---|---|
| `finance_hr_intake` | service | `p_event_id uuid, p_envelope jsonb`；回傳 ok、obligationId、financeVersion、status、replayed |
| `finance_hr_snapshot` | authenticated | 無參數；回傳已授權的 obligations，最多 500 筆 |
| `finance_hr_command` | authenticated | `p_obligation_id uuid, p_expected_version integer, p_request_id uuid, p_action text, p_evidence jsonb` |
| `finance_hr_voucher_options` | authenticated | `p_obligation_id uuid`；受限科目清單及已入帳傳票摘要 |
| `finance_hr_post_voucher` | authenticated | `p_obligation_id uuid, p_expected_version integer, p_request_id uuid, p_voucher_date date, p_entries jsonb, p_evidence jsonb`；原子建立傳票、分錄與第 7 版結案 |
| `finance_hr_applicant_confirm` | service | `p_obligation_id, p_expected_version, p_request_id, p_hr_actor_id uuid, p_source_hash text, p_evidence jsonb` |
| `finance_hr_callback_authorize` | authenticated | `p_obligation_id uuid`；檢查登入人是否可要求同步該筆進度 |
| `finance_hr_callback_claim` | service | `p_obligation_id uuid, p_limit integer default 10`；回傳 `[{eventId,leaseId,payload}]`，每義務只租用最早未確認事件 |
| `finance_hr_callback_ack` | service | `p_event_id uuid, p_lease_id uuid, p_success boolean, p_error_code text default null`；回傳 true |

接收 Envelope 是 HR 固定 endpoint 經簽章驗證後提供的完整已核准 outbox payload。Finance Edge 不保存 HR service-role key，也不接受瀏覽器自行提供完整薪資來源。Source hash 採 PostgreSQL `sha256(convert_to(source::jsonb::text,'UTF8'))`；不能直接使用 JavaScript JSON.stringify 雜湊替代。

月薪來源有 `lines[{employeeId,kind: addition|deduction,amountCents,...}]`，總和必須等於 `totalNetCents` 且每人不可負數。獎金來源有 `employees[{employeeId,grossCents,deductionsCents,netCents,...}]`，每人淨額及總額皆要一致，不接受主管提出的未扣款毛額冒充實發。實發合計必須大於零；零元批次應由人資另行確認，不建立銀行付款交接。

## 版本與五個會計階段

| Finance 版本 | action | status | stageIndex |
|---|---|---|---|
| 1 | received | awaiting_payment_validation | 0 |
| 2 | bank_batch_validation | pending_bank_upload | 0 |
| 3 | bank_upload | pending_account_check | 1 |
| 4 | accounting_review | pending_cashier | 2 |
| 5 | bank_disbursement | pending_applicant | 3 |
| 6 | applicant_confirmation | pending_voucher | 4 |
| 7 | posted_voucher | closed | 5 |

清冊核對與兆豐上傳是同一承辦階段的兩個獨立動作，避免未核對清冊就宣稱完成上傳。會計項目與出納即使同為執行長，仍分別簽核，不合併、不自動跳關。原申請人確認只能由 HR 確認事件執行，不能使用 Finance 登入人或傳送服務替代。

每一動作必須有 `evidence.kind`、可追溯 `reference` 及原文件 `sha256`。清冊核對、銀行上傳及放款還要提供與核准實發相同的 `totalNetCents`。會計須另行準備銀行清冊並逐筆核對帳號；本頁只核對合計，不產製兆豐銀行匯款檔。文件指紋不代表文件已上傳或取得銀行背書；目前文件由公司既有文管保存，畫面明確說明。銀行動作是具名人員依實際佐證登錄的結果。

`posted_voucher` 還需 `voucherId`。資料庫必須查得同 tenant、同法人、同金額、`request_id = 'hr:' || obligationId`、production、已入帳且未作廢的真實 Finance voucher，才可結案。本版新增專用傳票表單：指定會計選擇正式可用科目、核對借貸、入帳日期及佐證，再明確確認入帳。RPC 會核對現行會計權限、原申請人已確認、未關帳期間、科目有效、每邊金額等於核准實發，才以既有編號器建立 `HRV` 傳票與分類帳，最後呼叫第 7 版結案。任何分錄、結案或回呼保存失敗會整筆回滾，重送不建立第二張傳票。


付款傳票只記錄已放款的實發淨額結算，不自動猜測應發薪資、公司保費或扣繳提列。會計應依已完成的應付薪資提列選擇清償與銀行科目，避免重複認列費用；人員姓名、薪資清冊、銀行帳號及證據原件不寫入一般帳簿摘要。一般沖銷／調整入口不能覆寫或另建同一 HR 來源的傳票；需要更正時應走另行核准的補正流程。

公開傳票、分類帳、金流佐證、來源鏈、入帳鎖及銀行支援報表都加上受限讀取檢查。公司帳簿一旦包含本人無權查看的 HR 薪資入帳，整份查詢會明確拒絕，避免部分總額冒充完整財報；主管儀表板、查帳、應收對帳及傳票附件的 SECURITY DEFINER 入口也加上同一權限檢查。既有一般來源的身分與會計權限檢查仍保留。

`HR_BRIDGE_BROWSER=1 node scripts/test_hr_voucher_posting.mjs` 實際透過表單建立 SQL 傳票與分類帳，再驗證第 7 版回呼、檢視傳票和窄螢幕。另驗證權限／關帳／科目／借貸拒絕、寫入中途失敗全回滾、同交易偽造額外分錄拒絕、普通沖銷拒絕、衍生報表及附件保密，以及發布封存指紋遭修改時拒絕。`node scripts/test_hr_voucher_posting_concurrency.mjs` 在本機原生 PostgreSQL 17.10 驗證相同請求重送與競爭請求，結果僅有一張傳票、兩筆分錄和一筆結案事件。

## 驗證及發布界線

`node scripts/test_hr_private_bridge.mjs` 執行實際 migration 的隔離 PGlite 測試；`HR_BRIDGE_BROWSER=1 node scripts/test_hr_private_bridge.mjs` 增加瀏覽器 → 本機 RPC → 同一實際 SQL 的操作。驗證服務 ACL、跨租戶／薪資保密、來源不可變、重試不重複、版本冲突、具名逐關、原申請人身分、真實已入帳傳票比對、撤權、依序回呼租約與 1280／390／320 寬度。

這些測試使用合成資料，不使用正式銀行或正式登入帳號。Finance 正式發布仍須沿用既有受保護發布流程，將新 migration 納入經查核的 lineage／preflight／postflight，驗證 Edge secrets 與兩端簽章傳送，然後才能啟用正式映射與交接；不能以本機測試取代這些條件。

原生 PostgreSQL 17.10 驗證另以 `node scripts/test_hr_private_bridge_concurrency.mjs` 執行，僅連 loopback 並建立／刪除獨立合成 database，實際觀察兩條連線的鎖等待與 CAS／重送／callback lease。`scripts/finance_hr_bridge_postflight.sql` 是可納入受保護發布鏈的唯讀 ACL／RLS／immutable trigger 驗收。
