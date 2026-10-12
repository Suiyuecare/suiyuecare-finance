# Finance 隔離還原演練

## 已實作

`node scripts/finance_restore_rehearsal.mjs` 建立標示 synthetic 的 SQL＋Storage 原檔備份輸入，還原至全新本機 PGlite 目錄。演練執行真實 PostgreSQL SQL、關閉後重新打開持久資料庫，逐表比對筆數／完整 row hash／金額總計，Storage 原檔逐一讀回 hash，並切換 authenticated 身分執行已還原的 RLS 查詢（會計、申請人、停權帳號）。設定與 Auth 身分映射也要有筆數及 hash 證据。

成功才寫 `evidence.json`，包含 RPO（指定恢復時點與最後納入交易的差距）、RTO（實際執行耗時）、筆數、金額、原檔、允許／拒絕查詢結果。失敗只保留 `FAILED.txt`，不得有成功證明。所有證據固定 `productionRecoveryProven:false`。

`node scripts/check_finance_restore_rehearsal.mjs` 有 9 項驗收：正常還原、獨立 manifest hash 不符、Storage 損壞、漏檔、身分表漏列、金額不符、權限資料遭修改（即使外層檔案 hash 已更新）、未列拒絕案例、嘗試覆寫來源。均須封閉式失敗。

## 匯入離線備份

```sh
node scripts/finance_restore_rehearsal.mjs \
  --input /absolute/path/to/offline-backup \
  --manifest-sha256 '<由另一可信管道取得的 manifest SHA-256>' \
  --as-of '2026-10-11T08:00:00Z' \
  --output /absolute/path/to/new-isolated-restore
```

輸入 schema 可參考 synthetic generator：`database.sql`（PGlite 相容 SQL）、`storage-index.json`、每個 `storage/<bucket>/<path>` 原始 bytes、`manifest.json`。manifest 列出每檔大小/hash、每表主鍵/筆數/rows hash/金額 cents sum、一致性時點、最後交易時點、允許及拒絕存取案例。

必須涵蓋 `auth.users`、`public.finance_users`、`public.system_settings`、`public.vouchers`、`public.ledger_entries`。實際備份必須另外列出完整業務表、必要 SQL functions、RLS policies 與其他依賴，不能只備這五張表。工具不接受資料庫 URL；輸出不能是來源或其子／母目錄；symlink、路徑穿越、重複檔案、未列檔案均拒絕。

SQL 是可信備份輸入，會在新隔離 PGlite 引擎執行。工具不連正式 Supabase，不覆寫線上資料，不抓取秘密、不恢復 Google OAuth provider 設定、不寄信、不呼叫 webhook。

## 尚待正式外部演練

此工具證明本機隔離還原與校驗可執行，不能代替正式 PITR 或災難復原承諾。仍需另用獨立 Supabase staging project，在授權管理員控制下：

1. 從正式備份機制取得一致資料庫 snapshot 與 Storage 原檔 snapshot，獨立保存 manifest hash。
2. 還原完整 SQL schema/data、RLS、Auth identities、Storage buckets/policies、必要環境設定及獨立測試 OAuth callback；停用郵件、排程、付款、外部 webhook。
3. 使用固定 canary 帳號重新登入，驗證停權與不同部門的讀寫拒絕、附件下載、原單與傳票查詢一致。
4. 按實際備份涵蓋交易與恢復時刻量 RPO/RTO；記錄遺失範圍、故障點與處理時間；不要用 synthetic 60 秒 RPO 或本機執行秒數宣稱正式 SLA。
5. 演練完成後依資料保存規則回收隔離資料，保留非敏感校驗證據。

正式備份範圍、保留期限、還原目標與每季演練排程仍須由管理者確定；本次工具沒有建立或變更正式自動備份方案。
