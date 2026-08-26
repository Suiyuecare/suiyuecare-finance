# Finance 正式發布硬閘門

這份規則的目的不是「讓部署看起來成功」，而是讓不完整、未追蹤、資料庫不相容或曾造成登入／送件事故的版本無法成為正式版。

## 核心原則

1. Git 是唯一可發布來源。本機存在但沒有納入 Git 的畫面、migration、測試或修正，一律視為不存在。
2. `supabase/migrations/` 是唯一可新增或修改正式 schema 的位置。
3. 目前資料庫是接續既有正式資料的 adopted lineage，不是 clean-slate schema；CI 不得用空資料庫 reset 冒充 migration 可發布證明。
4. 前端候選必須在 build 前通過事故根因回歸；build 後必須通過來源、成品及健康契約雜湊驗證。
5. `main` 不再觸發 Vercel 自動正式發布。資料庫 migration、健康檢查及同一候選驗證完成後，才能人工提升已驗證候選。
6. 任一檢查無法證明安全時，一律阻擋；沒有略過參數。
7. Preview 與本機成品固定為離線 demo，不注入任何 Supabase URL／key；只有 Production build 可注入公開 URL 與 anon／publishable key，缺少設定立即中止建置。

## 實際執行鏈

### 1. 來源完整性

    pnpm release:source-integrity

會阻擋：

- 必要來源、migration 或回歸測試不存在、空白或未被 Git 追蹤。
- release scope 中仍有未追蹤或尚未提交的檔案。
- migration 名稱不是 `YYYYMMDDHHMMSS_description.sql`、版本重複或內容為空。
- 在 `supabase/migrations/` 以外新增 schema SQL。
- 修改既有 legacy SQL baseline。既有檔只為歷史基線保留，內容以明確 SHA-256 allowlist 凍結；任何新變更必須新增 migration。
- package release 指令、GitHub workflow 或 Vercel build command 被改成不受控路徑。
- `.vercelignore` 排除 migration、設定或任何 release checker，造成雲端只收到靜態 build 檔。
- Vercel 正式 build 無法證明目前 checkout 與 `VERCEL_GIT_COMMIT_SHA` 相同。

### 2. Adopted migration lineage 契約

    pnpm release:migration-lineage

目前 `supabase/config.toml` 的 `schema_paths = []`，設定中的 `./seed.sql` 也不存在；第一支 migration 又會精確檢查正式環境既有的 9 位人員。因此這個 repository 目前不能宣稱 clean-slate replay，也不能把 `supabase db reset --local` 當作發布證據。

CI 只證明 migration 檔案的 Git 完整性、順序、非空、adopted baseline 假設，以及本次 migration 的受保護 atomic transaction／preflight／postflight 契約。正式 migration 不得自行提交交易，也不得含會脫離原子批次的指令；真正的資料庫發布必須走下方的 remote schema gate，並先核對正式既有 ledger 的筆數、末版與 SHA-256。

### 2-1. 預覽／正式環境硬隔離

    pnpm release:environment-isolation

這個契約不需要 GitHub Repository Variables，也不建立付費 Supabase branch。CI 明確使用 `FINANCE_BUILD_TARGET=preview`，建置器會把 Supabase URL 與 public key 注入為空字串並保留離線測試入口。`VERCEL_ENV=production` 或 `FINANCE_BUILD_TARGET=production` 時，必須同時提供 `FINANCE_SUPABASE_URL` 與 `FINANCE_SUPABASE_ANON_KEY`；未知 target、Preview／Production 衝突、缺少設定、secret／service-role key 都會中止建置。

瀏覽器端另外要求「Production build + 正式 hostname」兩者同時成立，才會初始化 Supabase client、Google 正式登入或任何遠端寫入。

### 3. 事故根因回歸

    pnpm release:root-cause-regressions

build 前固定檢查：

- 正式程式的附件 metadata 只能查寫 `file_attachments.storage_path`；`path` 僅保留為由 `storage_path` 生成、不可寫入的舊分頁讀取相容欄位。
- 簽核快照只能查正式欄位 `raw_actor_user_id`，禁止舊欄位 `raw_user_id`。
- 通知欄位 migration 相容期有安全 fallback，不因唯讀健檢暫時異常誤擋有效送件。
- `notifications.data_environment`／`tenant_id` 必須由受控 migration 建立、回填、加限制並通過 postflight。
- 舊的內建人員資料若尚未完成遠端同步，不得把「Auth 欄位尚未載入」誤判為正式帳號未綁定；送件前必須先完成 canonical identity directory readiness。
- 送件仍必須有有效 Supabase session，最後寫入必須走 `finance_submit_expense_request` 交易。
- 資料庫交易必須以 `auth.uid()` 對應的 Finance 人員為權威，並拒絕真正未綁定、停用或跨租戶簽核人。
- Google 帳號錯選時必須可以切換帳號，不能被舊瀏覽器 session 卡死。
- 小欣／蘇之瑄事故修復、申請人身分及正式組織送件契約全部通過。

### 4. 產生並鎖定候選

    pnpm release:build

流程固定為：

1. 再執行一次來源完整性、adopted migration lineage 與事故回歸。
2. 執行 `scripts/build_www.js`。
3. 產生 `www/release-manifest.json`。
4. 驗證來源 manifest、完整 artifact manifest、root-cause checker SHA-256 與 Git commit。
5. 對 build 後的登入、附件去重及勞務費稅額行為再跑一次回歸。

`release-manifest.json` 不含金鑰或個資，只保存：

- build target 與 runtime mode（Production Supabase 或離線 demo）
- source commit
- source manifest SHA-256
- artifact manifest SHA-256
- root-cause contract SHA-256
- migration-lineage contract SHA-256
- 每個成品檔案的路徑、大小及 SHA-256

任何來源或成品在測試後被換掉，重新驗證都會失敗。

### 5. 正式發布採兩階段

`vercel.json` 已設定：

    git.deploymentEnabled.main = false

因此合併 `main` 不會直接把新版推到正式網域。正式發布順序必須是：

1. GitHub 的 `Finance Release Gate` 全綠。
2. 保存該次 `finance-candidate-<commit>` artifact 與 release manifest。
3. 由受保護的資料庫程序執行 remote schema gate：只讀比對 migration ledger、必要 relation／column／function、RLS／ACL、Auth 綁定與本次 migration SHA-256。
4. release guard 在無 transaction-control、無 pipeline-incompatible 指令的同一份 migration 外層加入 `BEGIN`／`ROLLBACK` 完整演練；內建 preflight、DDL／DML 與 postflight 必須全部成功，且 rollback 後 schema 與資料不可改變。
5. 在維護／受控窗口把同一份 migration 與 ledger insert 包在單一 `BEGIN`／`COMMIT`，交易內先取得 release advisory lock 與 migration ledger table lock，再逐筆比對已審查 ledger；由鎖定版本的 Supabase CLI 透過 Management API 的短效登入角色一次提交。不得保存長效資料庫密碼，也不得讓 adopted lineage 中未選定的舊 migration 被順帶重跑。完成後再次執行 postflight 與正式 schema／Auth／簽核人／附件健康檢查。
6. 以小欣、蘇之瑄及指定角色跑登入、建立、送件、逐關簽核、已簽核歷史測試。
7. 只提升第 2 步的同一候選；禁止重新 build 後直接上線。
8. 上線後監看錯誤；健康檢查失敗立即回滾前一個已驗證 artifact。

本 repository 內的 `Finance Protected Production Release` workflow 會建立未綁正式網域的候選、用受保護憑證連到 immutable Supabase project、執行 exact migration 與 postflight，最後只提升同一份封存候選。一般 push／PR workflow 仍不具備正式 migration 或 Vercel promote 權限。

## 後續必要工程：建立 clean-slate baseline

目前的 legacy SQL 是歷史檔案，不能直接假設拼接後等於正式 schema；現有 migration 又包含正式資料的精確 preflight，因此不能用它們硬湊空資料庫重播。後續需另立專案完成：

1. 從已驗證的正式 schema 產生不含個資與營運資料的 squash baseline。
2. 建立最小、匿名且可重現的 seed fixture，涵蓋租戶、角色、組織、簽核與附件契約。
3. 在隔離資料庫從 baseline + seed + 後續 migration 完整重播。
4. 與正式 schema 指紋比對並經人工核准後，再把 CI 升級為 clean-slate replay。

在這項工程完成前，發布依據是「受控 remote schema gate + rollback 演練 + 正式 postflight」，不可聲稱已完成空資料庫重建驗證。

## 發布前必要人工設定

- 將 GitHub `Finance Release Gate / release-gate` 設成 `main` 的 required check。
- 禁止未經 PR 直接推 `main`，並限制管理員略過 required check。
- Vercel 保持 `main` 自動 deployment 關閉。
- 正式提升只允許指定管理者或受保護 workflow 執行。
- 若上述任一平台設定尚未完成，不可宣稱已建立完整發布硬閘門。

## 本次事故對應的阻擋點

| 事故 | 之後在哪一關被攔下 |
|---|---|
| 正式前端仍查 `file_attachments.path` | build 前 root-cause regression |
| `notifications` 欄位未隨程式上線 | migration 追蹤、adopted-lineage 契約、remote schema gate 與正式 postflight |
| 本機修好了但沒有進 Git | source-integrity 的 untracked／dirty gate |
| embedded users 尚未同步就誤判簽核人沒 Auth | root-cause regression + server transaction guard |
| 蘇之瑄 Google 登入成功但入口權限缺漏 | identity／portal access migration + persona E2E |
| Vercel 只看靜態 HTML build 成功 | verified build command + main auto-deploy disabled |

## 官方依據

- Supabase CLI local development and migration replay: https://supabase.com/docs/guides/local-development/cli-workflows
- Supabase database reset: https://supabase.com/docs/reference/cli/supabase-db-reset
- Vercel Git deployment configuration: https://vercel.com/docs/project-configuration/git-configuration
- Vercel staged deployment guidance: https://vercel.com/docs/deployments/overview
