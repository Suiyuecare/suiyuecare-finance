# Finance 受保護正式發布

`.github/workflows/finance-production-release.yml` 是唯一允許 Finance 正式資料庫套版與 Vercel 正式提升的人工流程。它不接受 push／PR 自動上線，也不把「建置成功」當成「正式可提升」。

## 不可變更的正式目標

發布程式內建不可由輸入覆寫的 catalog，並要求 GitHub Environment variables 與它逐字相同：

- Supabase project ref：`udtlppnrugmtzhigdsxo`
- Vercel organization：`team_LGag47eU8tKbsK6ixAmVa5Uq`
- Vercel project：`prj_nze9Q0MdSzMjYSOV2ynchdwqm1PD`（`suiyuecare-finance`）
- 正式網域：`finance.suiyuecare.com`

候選部署建立後，流程會從 Vercel API 讀回 deployment、project 與 domains JSON，逐項驗證 deployment ID、READY／production target、project、organization、SHA metadata、未提前取得正式 alias，以及正式網域確實屬於該 project。僅有非空 ID 不算通過。

## GitHub Environment 必備設定

Environment `finance-production` 必須設定：

- Required reviewers（至少一位非觸發者）、Prevent self-review。
- Deployment branches 僅允許受保護的 `main`。
- Secret：`SUPABASE_ACCESS_TOKEN`、`FINANCE_PRODUCTION_SUPABASE_URL`、`FINANCE_PRODUCTION_SUPABASE_ANON_KEY`、`VERCEL_TOKEN`。資料庫連線由鎖定版本的 Supabase CLI 透過 Management API 建立短效登入角色，不在 GitHub 長期保存資料庫密碼。
- Variable：`FINANCE_PRODUCTION_SUPABASE_PROJECT_REF`、`FINANCE_PRODUCTION_VERCEL_ORG_ID`、`FINANCE_PRODUCTION_VERCEL_PROJECT_ID`，且值必須等於上方 immutable catalog。

Vercel 的 `main` 自動正式部署必須保持停用。正式 token 只授權該 team/project 的 pull、build、candidate deploy、inspect/API/curl 與 promote；資料庫帳號只授權目標 Supabase project 的 migration 權限。

## 固定順序：候選先完成，資料庫才准改

1. workflow 固定 checkout `main`，不再對 private repository 執行 `git fetch`；`GITHUB_REF`、`GITHUB_REF_NAME`、`GITHUB_SHA`、本機 `HEAD` 與輸入的 40 碼 `candidate_sha` 必須完全相同。
2. 安裝鎖定依賴並跑完整 `release:preflight`。
3. `vercel build --prod --standalone`，驗證 deterministic release manifest。
4. 只建立一次 `--prod --skip-domain` 的 unaliased candidate；讀回 manifest、首頁與 Vercel immutable target JSON。此時仍未更動資料庫。
5. `candidate` job 把 deployment ID／URL、manifest hash、candidate SHA、phase、run ID、release guard、pre/postflight、fingerprint 與完整 migration catalog 寫入同一份 sealed receipt/artifact；`database` 與 `promote` jobs 只下載並核對這份 artifact，不重新 checkout、build 或 deploy。
6. 候選完整封存後，`database` job 才把鎖定版本的 Supabase CLI 連到 immutable project ref；先向 Management API 讀取有效 publishable／anon keys，常數時間比對封存前端使用的 key，並實際確認 Google OAuth 已啟用、探測 REST 讀取與兩支受保護 RPC。接著以正式 Google 身分綁定及 `authenticated` 資料庫角色，在 `data_environment=test` 的單一交易中完整跑過「送件 → 主管退回 → 申請人重送」，確認沒有通知排程後整筆 `ROLLBACK`。這項驗證會在資料庫變更前、變更後與前台提升前各執行一次；任何一次失敗都停止發布。最後才核對正式 ledger 的 120 筆既有基線（筆數、末版與 SHA-256）、schema、RLS 與 exact phase preflight；非 `none` 且 ledger 尚為 `pending` 時才進行 migration ROLLBACK rehearsal 與 apply。
7. 正式套版只把使用者選定的單一 migration 與其 ledger insert 放在同一個 SQL transaction，透過 `supabase db query --linked` 一次提交。交易一開始先取得 release advisory lock 與 migration ledger table lock，再逐筆比較交易內 ledger 是否仍等於已審查快照；若期間有其他 migration，會在第一個正式 statement 前中止。這避免 adopted database 舊檔時間戳與正式 ledger 不同時誤套歷史 migration，也保留來源與 ledger 的原子性。DB apply 後若 job 中斷，重跑會把 ledger 判為 `applied`，只做完整 postflight，不再 mutation；`none` 必須是 v1、v2 都已套用且只做 read-only pre/postflight。
8. `promote` 是獨立 job，只把第 4 步封存的同一 deployment URL 交給 `vercel promote`。最多重試三次，每次仍是同一 immutable URL；資料庫套用後禁止 rebuild、redeploy 或 reapply。
9. 提升後由正式網域重新讀回 deployment ID 與 manifest，必須與封存候選完全一致。若 promotion 已成功但 readback 中斷，重跑 `promote` job 允許該同一 deployment 已持有正式 alias，仍會重新核對 DB postflight 與最終 readback。

## 三種 migration phase

`migration_versions` 只接受以下三值；重複版本、未知版本、混合版本、非 exact ledger 一律失敗：

- `20260826070814`：expand／相容階段。只套 v1；建立 `file_attachments.path` 為 `storage_path` 的唯讀 generated compatibility alias，舊分頁或獨立快取的舊前端仍可讀取附件 metadata。完成後提升已驗證的新前端。
- `20260826155840`：contract／權威路由階段。執行前與正式交易前一刻都必須證明正式網域仍在跑與本次 candidate SHA、manifest 完全相同的相容前端，且 v1 ledger、notification tenant policy、三張表的 enabled+forced RLS、Portal invariant、generated alias 全部正確；套 v2 後保留不可寫入的 generated alias 作為防呆，並驗證 authoritative route RPC／ACL。
- `none`：純前端階段。local 相對正式 ledger 的 pending migration 必須是 0；完整 v1、RLS、v2 authority baseline 都要通過，且完全跳過 dry-run、rehearsal、db push。

禁止在同一個 live release 輸入 `20260826070814,20260826155840`。正確做法是用同一個 candidate SHA 先跑 v1，成功提升相容前端後，再跑 v2。這避免在舊前端仍服務時先裝不相容的 route authority。

## ROLLBACK rehearsal 的真實邊界

正式 migration 來源禁止自行出現 `BEGIN`／`COMMIT`／`ROLLBACK`，也禁止 `CREATE/DROP INDEX CONCURRENTLY`、`REINDEX CONCURRENTLY`、`VACUUM`、`ALTER SYSTEM`、`CLUSTER` 等會脫離原子批次的指令。release guard 在正式 apply payload 外加唯一的 `BEGIN`／`COMMIT`，並在同一交易寫入 migration statements 與 ledger；演練時則只加 `BEGIN`／`ROLLBACK`，比較前後 catalog／ACL／RLS／政策／函式／關鍵資料與 ledger 指紋。

這是 live DB 上單一 `REPEATABLE READ` 交易與 savepoint 內的 rollback rehearsal；migration 暫時套入 savepoint 後、尚未回滾前，會先以 `authenticated` 角色完整跑過送件、主管退回及申請人重送，證明新 schema 的實際流程可用；接著回滾 migration 與測試單、確認所有關聯資料都沒有殘留，再在同一份 snapshot 比對前後指紋，因此一般通知新增不會造成假失敗。它仍不是 production clone、不是 shadow database，也不是兩支 migration 的原子相容性證明；無法取代外部副作用與完整資料量的 shadow rehearsal。因此 workflow 明確禁止 v1+v2 合併套用，文件與執行結果都不得宣稱「live rollback 等同 atomic clone」。

## 操作

在 GitHub Actions 手動選擇 `Finance Protected Production Release`，輸入：

- `candidate_sha`：當下 protected `main` 的完整 SHA。
- `migration_versions`：上述三個 exact phase 值之一。
- `confirmation`：`PROMOTE FINANCE PRODUCTION`。

任一步失敗即 fail closed。候選若在資料庫變更前失敗，正式資料與網域完全不動；資料庫成功後若提升或 readback 遇到暫時錯誤，應在同一 GitHub Actions run 使用 **Re-run failed jobs**，讓獨立 `promote` job 消費同一 sealed artifact，不重新建置或套版。`candidate` artifact 保留 14 天；超過保留期不得把另一個 deployment 冒充原候選，必須另開一個完整受審發布。三次提升皆失敗時保留 deployment ID／URL／manifest hash／receipt 進行事故處置。

若整個 workflow 被人為選擇「Re-run all jobs」，會建立新的候選；這不等同原 candidate 的復原路徑。DB ledger 已套用時仍會阻止重複 mutation，但操作上應一律優先使用 **Re-run failed jobs** 續跑原 `promote` job。

此文件與 workflow 只建立程式內的 gate；若 GitHub Environment required reviewers、branch restriction 或最小權限 secrets 尚未由平台管理者設定，不得宣稱平台層硬閘門已啟用。
