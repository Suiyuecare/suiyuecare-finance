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

## 固定兩個受控入口：日常前台發布與既有 v3 復原

此版本只接受以下兩組輸入，`release_phase` 與 `migration_versions` 任何不相符都在建置或資料庫連線前立即拒絕：

| 順序 | `release_phase` | `migration_versions` | 允許的動作 |
|---|---|---|---|
| 1 | `frontend_compat` | `none` | 日常前台發布：建立、驗證並提升新前台；資料庫不得提交變更，只能做唯讀 gate 與整筆回滾 canary |
| 2 | `database_v3` | `20260827052447` | v3 復原入口：目前正式庫已完成 v3，只允許核對既有狀態並執行 postflight，不會重新套版 |

正式資料庫目前受控 lineage 為 v1 `20260826070814`、v2 `20260826155840`、v3 `20260827052447`，以及已採納回版本庫的修復 `20260828015718_repair_admin_ntpc_portal_employee_link_20260828`、`20260831042040_top_level_ceo_self_route`、`20260831043517_expense_submit_derived_status`、`20260901024020_final_accountant_self_post`、`20260901073241_assign_ceo_cashier_and_reassign_pending_cashier`。最後一筆指定李佳泰為正式出納、移除總務備援，並以稽核紀錄轉派三張待放款單。任何其他未審查的 post-baseline migration 仍會 fail closed；採納修復不代表流程會再次執行該 SQL。

### Phase 1：`frontend_compat`

1. workflow 固定 checkout protected `main`；`GITHUB_REF`、`GITHUB_REF_NAME`、`GITHUB_SHA`、本機 `HEAD` 與 40 碼 `candidate_sha` 必須完全相同。
2. 跑完整 `release:preflight` 與 production artifact 驗證，只建立一次 `--prod --skip-domain` 的 unaliased candidate。
3. 候選首頁必須恰有一個 `finance-release-contract=expense-submit-resilience-v3-20260827` meta，並實際包含 `submissionAttemptId`；release manifest 的 `source_commit` 必須等於 candidate SHA。
4. sealed receipt v2 同時綁定 release phase、`migration_versions`、deployment ID／URL、manifest hash、首頁 hash、candidate SHA 與 GitHub run ID。下載 artifact 的後續 jobs 逐欄重算，不宣稱或依賴未比較的 artifact digest。
5. 正式資料庫 ledger 必須恰有完整 v1／v2／v3 與上列全部已審查修復（含 `20260901073241` 正式出納修復）；workflow 以 v3 唯讀 postflight、精確的人員連結檢查、authenticated rollback canary 與 immutable project 檢查證明現況，不會提交任何資料庫變更，`prepare-apply` 不可能出現在此分支。
6. 提升封存的同一 deployment URL 後，從 `finance.suiyuecare.com` 重新讀回 deployment ID、manifest 與首頁；只有 exact candidate SHA、release meta 與 `submissionAttemptId` 全部一致才算 Phase 1 完成。

### Phase 2：`database_v3`（既有版次復原／核對）

1. 必須再次使用已在正式網域驗證過的同一 candidate SHA；不得使用不同 source commit。
2. workflow 會先從正式網域讀回 manifest 與首頁，證明 release meta 與 `submissionAttemptId` 均存在。
3. ledger 必須顯示 v3 與所有已審查修復（含 `20260901073241`）都已存在；目前只接受 `applied` recovery 路徑，重跑 v3 或任何已採納修復都會被拒絕。
4. 以 v3 postflight 驗證函式、ACL、RLS、組織簽核語意，以及 `admin.ntpc@suiyuecare.com` 仍連結到指定的在職 employee/company；已離職重複人員必須保持停用。
5. authenticated rollback canary 通過後才可繼續；整段核對不提交正式資料庫變更。
6. `promote` 只處理同 SHA 的封存候選；最終仍須重新讀回 deployment、manifest 與首頁驗證。

v3 會重新解析正式直屬主管與唯一部門主管，只有可稽核的同一人情形才能跳關；補件時已完成的歷史簽核人與已移除的舊金額關卡保持不可變。新送件必須帶穩定 `submissionAttemptId`；缺少該欄位的舊分頁一律以 `55000` 要求重新整理。同一申請單、登入申請人、attempt 與 SHA-256 payload 必須一致，不同 attempt 或 payload 一律 fail closed。

## ROLLBACK rehearsal 的真實邊界

正式 migration 來源禁止自行出現 `BEGIN`／`COMMIT`／`ROLLBACK`，也禁止 `CREATE/DROP INDEX CONCURRENTLY`、`REINDEX CONCURRENTLY`、`VACUUM`、`ALTER SYSTEM`、`CLUSTER` 等會脫離原子批次的指令。release guard 在正式 apply payload 外加唯一的 `BEGIN`／`COMMIT`，並在同一交易寫入 migration statements 與 ledger；演練時則只加 `BEGIN`／`ROLLBACK`，比較前後 catalog／ACL／RLS／政策／函式／關鍵資料與 ledger 指紋。

這是 live DB 上單一 `REPEATABLE READ` 交易與 savepoint 內的 rollback rehearsal；migration 暫時套入 savepoint 後、尚未回滾前，會先以 `authenticated` 角色完整跑過送件、同一 attempt 冪等回放（v3 已安裝時）、u5／A1100 偽造部門主管 self-skip 的 42501 負向案例、主管退回，以及實際 10 參數補件 RPC 的偽造未來簽核人 42501、成功補件與同 key replay。另以徐靖雯正式 UUID／Finance 帳號／B1302／E5 驗證組織解析、舊頁拒絕與公開送件，再由 `service_role` 實際探測通知 claim worker；全部都在同一交易回滾。接著確認測試單、通知與 operation cache 等關聯資料沒有殘留，再比較前後指紋，因此一般通知新增不會造成假失敗。它仍不是 production clone、不是 shadow database，也不是多支 migration 的原子相容性證明；無法取代外部副作用與完整資料量的 shadow rehearsal。因此 workflow 明確禁止合併 phase，文件與執行結果都不得宣稱「live rollback 等同 atomic clone」。

## 操作

在 GitHub Actions 手動選擇 `Finance Protected Production Release`，輸入：

- `candidate_sha`：當下 protected `main` 的完整 SHA。
- `release_phase`：一般前台上線選 `frontend_compat`；只有既有 v3 發布復原需要才選 `database_v3`。
- `migration_versions`：`frontend_compat` 僅能填 `none`；`database_v3` 僅能填 `20260827052447`。
- `confirmation`：`PROMOTE FINANCE PRODUCTION`。

任一步失敗即 fail closed。`frontend_compat` 不會變更資料庫；目前的 `database_v3` 也只核對已套用狀態，不會重跑 v3 或任何已採納修復。若提升或 readback 遇到暫時錯誤，應在同一 GitHub Actions run 使用 **Re-run failed jobs**，讓獨立 `promote` job 消費同一 sealed artifact，不重新建置或套版。`candidate` artifact 保留 14 天；超過保留期不得把另一個 deployment 冒充原候選，必須另開完整受審發布。

若整個 workflow 被人為選擇「Re-run all jobs」，會建立新的候選；這不等同原 candidate 的復原路徑。DB ledger 已套用時仍會阻止重複 mutation，但操作上應一律優先使用 **Re-run failed jobs** 續跑原 `promote` job。

此文件與 workflow 只建立程式內的 gate；若 GitHub Environment required reviewers、branch restriction 或最小權限 secrets 尚未由平台管理者設定，不得宣稱平台層硬閘門已啟用。
