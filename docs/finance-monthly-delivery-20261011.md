# 每月事務所交付包（2026-10-11）

## 使用範圍

正式會計帳號在「財務報表 → 月結與交付」選擇單一法人、月份，執行「核對並下載月交包」。報表的期初、銀行、稅務與結帳檢查尚未確認，或來源有缺件時，不提供完整標示；可另外下載明確標示未完整的「待補核對包」。下載不會寄給事務所、不會代申報、不會產生新付款或傳票。

公司、月份、環境、來源版本、筆數、每個檔案的 SHA-256 與大小記錄於 `manifest.json`，清單本身另有 `manifest.sha256`。伺服器保存不可直接讀寫的下載回執。回執不是備份、已寄送證明、Storage 封存證明或會計師簽證。

## 包內資料

- `reports/financial-statements.csv`：同一伺服器快照計算的報表及覆核事項；保留原報表的暫編標示。
- `accounting/ledger.json`：截至月底的正式分類帳，包含期初所需的以前期間分錄。
- `accounting/vouchers.json`：當月傳票；`accounting/sources.json` 包含本月及跨期關聯來源單與報表設定。
- `originals/`：依權限下載的原始附件 bytes；`originals/index.json` 對照中文原檔名、MIME、單號與原始 Storage 路徑。
- `labor/`：原勞報 gateway 的完整清單、付款明細、未完成名單、簽署 JSON、簽名 PNG、身分／銀行證明與付款憑證；新增 `forms/<statement-id>.pdf`。
- `missing.csv`：未覆核、缺原件或未完成付款的明確清單。

勞報 PDF 由既有不可變簽署 JSON 與 SHA-256 核對後的簽名 PNG 產製，包含課程、毛額、扣稅、補充保費、實付、銀行資料、簽署時間與原件 hash。首版 PDF 為高解析度中文圖像頁，長文自動分頁；文字不可搜尋，不宣稱新增數位簽章。原始 JSON、PNG 一起保存供核對。系統絕不代造簽名。

勞報服務只支援 production。測試環境的交付包不呼叫正式勞報 gateway，清楚記錄 `not_applicable_test_environment`；不得把 test 包作為正式公司月交資料。

## 伺服器保護

`finance_monthly_delivery_snapshot_v1(entity, period, environment)`：

1. 綁定 Auth 的啟用會計身分、公司及報表權限；沿用完整公司 audit scope、HR accounting scope，另核對未入帳傳票的部門 scope。
2. tenant、公司與環境條件套用於每類資料。任一來源或附件未授權時整包拒絕，不以省略方式產生錯誤完整結果。
3. 遞迴讀取 `files`／`attachments`／憑據欄位及步驟附件。僅檔名、外部連結或找不到附件 metadata 都列為待補；不任意抓外部 URL。
4. 以既有勞報付款、預計付款、尚未邀請三個分頁 RPC 產生必要文件、原件 hash 與 pending 清單；簽署、簽名、身分／銀行證明與付款證據均納入要求。
5. 回傳 `requiredFiles`、`missing` 與含勞報來源的 `sourceFingerprint`。產製前後重新核對版本。

`finance_monthly_delivery_receipt_v1(...)`：

- 對照現時 source fingerprint、來源筆數、schema、檔名與清單 hash。
- 由伺服器推導的缺件不可被 client `missing=[]` 消除；所有必要原件需匹配路徑、已知 hash／大小，否則只能明列缺件的核對包。
- request UUID 僅可重播完全相同的操作人與內容，不能覆用於他人或新內容。
- client 下載 bytes 的完整性由瀏覽器重新 hash 驗證；回執不宣稱伺服器另存／重新讀回整個 ZIP。

## Runtime 介面

`FinanceMonthlyDeliveryWorkspace.install(runtime)` 只安裝一次；`view()` 產生共用 panel；`build({entityId,period},{allowIncomplete:false})` 回傳 `{blob,manifest,receipt,missing}`；`invalidate()` 於登出、切身分／權限／環境／公司／月份時停止進行中產製並清除結果。

| Adapter | 契約 |
| --- | --- |
| `identity()` | 穩定字串，涵蓋員工、租戶、權限版次、環境。任何改變都使產製中止。 |
| `environment()` / `scope()` | 目前資料環境及選定單公司、月份。切 scope 時呼叫 invalidate。 |
| `rpc(name,args)` | Supabase `{data,error}` 或原始 RPC JSON。不可 fallback 成快取資料。 |
| `reportSheets(snapshot)` | 只能由 snapshot rows/profile 算報表，回 `{sheets:[{name,rows}],missing:[]}`；原 engine warnings 都列為 missing，不可把草稿偽裝已覆核。 |
| `ensurePdf()` | 使用現有 `ensureFinanceDocumentLibrary('pdf')`。 |
| `laborExport(entity,period)` | 以目前帳號 JWT 呼叫既有 `/export/month`，回 Blob／Uint8Array；不使用 service-role。 |
| `downloadAttachment(meta)` | 以原 metadata bucket/path 及目前身分讀取；不得用未驗證外部 URL。 |
| `saveDownload(blob,name)` | 確認身分未改變後才觸發下載。 |
| `onProgress(text)` | 可選；顯示附件核對及版本核對進度。 |

安全上限：每類 SQL 陣列 25,000 筆、ZIP 2,000 檔與 96 MiB。超限明確失敗，不能宣稱完整或靜默截斷。若正式月份超限，需另做後端分批背景封存，不調高上限來掩蓋記憶體風險。

## 本地驗收與外部驗收界線

- `node scripts/check_monthly_delivery.cjs`：14 項真實 PGlite SQL／ZIP 契約；公司、角色、HR、傳票、附件拒絕權限，跨期來源、必要原件、後端待補、勞報來源變更、重播與 ACL。
- `node scripts/check_monthly_delivery_browser.cjs`：18 項真實 Chromium＋pdf-lib＋ZIP 檢查；1440／390 寬、3 頁中文長文 PDF、所有檔案 hash、JSON/簽名保留、缺件阻擋、切身分中止、竄改簽名拒絕、test 環境不讀正式勞報。
- PDF 已透過 Poppler 渲染檢查首／末頁，金額 1,000、所得稅 100、補充保費 21.1、實付 878.9 與虛構簽名皆可見，無文字裁切。

以上使用虛構資料、隔離 RPC 與 Storage，未替任何員工登入、未寄送正式資料、未驗證實際公司月包。正式上線後仍須授權會計選一個已結月份，核對原始附件下載、Gateway 存取、缺件清單與線下事務所接收需求。自動測試不等於這項外部驗收。
