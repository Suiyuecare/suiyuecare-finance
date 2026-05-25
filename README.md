# module-finance

歲悅長照內部財務會計系統。主要入口為 `index.html`，可部署到 Vercel 靜態網站，並透過 Supabase 提供登入、資料庫、附件 JSON 儲存與稽核紀錄。

## 系統邊界

- Finance repo 僅保留財務會計系統功能，登入後直接進入會計工作台。
- 保留範圍：支出申請、收入申請、簽核管理、付款 / 收款、傳票、三表、分類帳、會計科目、會計合規、系統設定、附件上傳下載。
- 不納入範圍：非會計表單、跨系統入口、獨立工具網站與其他營運模組。

## 上線前設定

1. 在 Supabase SQL Editor 執行：
   `supabase/module_finance_production_schema.sql`
2. 接著依序執行：
   `supabase/rls_hardening.sql`
   `supabase/storage_attachments.sql`
   `supabase/accounting_rpc.sql`
   `supabase/compliance_and_drafts.sql`
3. 在 Supabase Authentication 建立員工帳號，Email 需與 `finance_users.email` 一致。
4. 在 `index.html` 填入 `SUPABASE_ANON_KEY`。只能放 anon public key，不能放 service role key。
5. 若要使用 Google 登入，在 Supabase Auth Providers 啟用 Google；Google Cloud OAuth「已授權重新導向 URI」需加入 `https://udtlppnrugmtzhigdsxo.supabase.co/auth/v1/callback`。Supabase Auth URL Configuration 的 Site URL 設為 `https://finance.suiyuecare.com`，Redirect URLs 需加入 `https://finance.suiyuecare.com/`。
6. 若要使用 OpenAI 發票辨識，部署 `supabase/functions/parse-invoice-openai`，並在 Supabase Edge Function secrets 設定 `OPENAI_API_KEY`。
7. 測試快捷登入只允許在 `file://`、`localhost` 或 `127.0.0.1` 使用；正式網址不開放 URL 參數啟用測試帳號。

## 核心資料流

- 費用申請完成簽核後會產生傳票與分類帳分錄。
- 發票經會計開立關卡核准後認列收入與應收帳款。
- 收款需由會計上傳收款證明，再由行政部門主任複核；複核通過後才進入現金流量表。
- 支出入帳、發票收入認列與收款入帳正式環境優先使用 Supabase RPC，以單一交易寫入申請單、傳票與分類帳，避免中途失敗或重複入帳。
- 暫存表單、關帳、憑證封存、年度審核與合規 audit log 正式環境優先保存到 Supabase；未套 migration 時才退回本機瀏覽器暫存。
- 三表與儀表板優先使用 `ledger_entries`，避免申請單與分錄重複計算。
- 前台會訂閱 Supabase Realtime；多人同時作業時，申請、簽核、發票、收款、分類帳與通知會自動同步。
- 儀表板會顯示資料健康提示，優先提醒未連線 Supabase、待收款複核、未附證明、發票收入待入帳等資料缺口。
- 費用報銷支援懶人申報：上傳一張或多張發票/憑據後，用 OpenAI Vision 解析發票號碼、日期、商品、數量、單價與含稅金額，前台產生可編輯明細表，送出時會自動附上 CSV 電子檔與原始照片。

## 設計準則

- 易使用上手：所有主要流程從左側選單進入，儀表板先呈現待辦、資料健康與法人/部門統整。
- 數據資料完整：發票批次、收款附件、簽核附件、傳票、分類帳與 audit log 都要保存。
- 資料統整最強：儀表板、收款情形、三表、分類帳共用同一批資料來源，優先採用已入帳分錄。
- 即時：Supabase Realtime 開啟後，使用者不用重新整理即可看到最新待辦與財務數字。

## 網頁版部署

目前專注在網頁正式版、RWD 與 Finance 單一模組穩定性。正式網址為 `https://finance.suiyuecare.com/`，Vercel build 輸出在 `www/`。
