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

## 目前兩個受控入口：會計明細修正與後續前台發布

此版本只接受以下兩組輸入，`release_phase` 與 `migration_versions` 任何不相符都在建置或資料庫連線前立即拒絕：

| 順序 | `release_phase` | `migration_versions` | 允許的動作 |
|---|---|---|---|
| 1 | `frontend_compat` | `none` | 日常前台發布：建立、驗證並提升新前台；資料庫不得提交變更，只能做唯讀 gate 與整筆回滾 canary |
| 2 | `database_cases_20260908` | `20260908065050` | 已部署 audit 六份全部存在後，只演練及提交這一份會計修正，SQL／ledger／postflight 同交易，再提升封存候選 |

正式資料庫目前受控 lineage 為 v1 `20260826070814`、v2 `20260826155840`、v3 `20260827052447`，以及已採納回版本庫的修復 `20260828015718_repair_admin_ntpc_portal_employee_link_20260828`、`20260831042040_top_level_ceo_self_route`、`20260831043517_expense_submit_derived_status`、`20260901024020_final_accountant_self_post`、`20260901073241_assign_ceo_cashier_and_reassign_pending_cashier`、`20260901081807_allow_formal_cashier_self_disbursement`。其中正式出納固定為李佳泰、總務備援已移除，且三張待放款單保留稽核轉派紀錄。任何其他未審查的 post-baseline migration 仍會 fail closed；採納既有版次不代表流程會再次執行其 SQL。

### Phase 1：`frontend_compat`

1. workflow 固定 checkout protected `main`；`GITHUB_REF`、`GITHUB_REF_NAME`、`GITHUB_SHA`、本機 `HEAD` 與 40 碼 `candidate_sha` 必須完全相同。
2. 跑完整 `release:preflight` 與 production artifact 驗證，只建立一次 `--prod --skip-domain` 的 unaliased candidate。
3. 候選首頁必須恰有一個 `finance-release-contract=expense-submit-resilience-v3-20260827` meta，並實際包含 `submissionAttemptId`；release manifest 的 `source_commit` 必須等於 candidate SHA。
4. sealed receipt v2 同時綁定 release phase、`migration_versions`、deployment ID／URL、manifest hash、首頁 hash、candidate SHA 與 GitHub run ID。下載 artifact 的後續 jobs 逐欄重算，不宣稱或依賴未比較的 artifact digest。
5. 正式資料庫 ledger 必須恰有完整 v1／v2／v3、全部六份 audit 修復、會計明細修正 `20260908065050` 與已審查歷史修復（含 `20260901073241` 正式出納修復）；workflow 以 v3 唯讀 postflight、精確的人員連結檢查、authenticated rollback canary 與 immutable project 檢查證明現況，不會提交任何資料庫變更，`prepare-apply` 不可能出現在此分支。
6. 提升封存的同一 deployment URL 後，從 `finance.suiyuecare.com` 重新讀回 deployment ID、manifest 與首頁；只有 exact candidate SHA、release meta 與 `submissionAttemptId` 全部一致才算 Phase 1 完成。

### 歷史紀錄：`database_v3`（此版本不接受 dispatch）

1. 必須再次使用已在正式網域驗證過的同一 candidate SHA；不得使用不同 source commit。
2. workflow 會先從正式網域讀回 manifest 與首頁，證明 release meta 與 `submissionAttemptId` 均存在。
3. ledger 必須顯示 v3 與所有已審查修復（含 `20260901073241`）都已存在；目前只接受 `applied` recovery 路徑，重跑 v3 或任何已採納修復都會被拒絕。
4. 以 v3 postflight 驗證函式、ACL、RLS、組織簽核語意，以及 `admin.ntpc@suiyuecare.com` 仍連結到指定的在職 employee/company；已離職重複人員必須保持停用。
5. authenticated rollback canary 通過後才可繼續；整段核對不提交正式資料庫變更。
6. `promote` 只處理同 SHA 的封存候選；最終仍須重新讀回 deployment、manifest 與首頁驗證。

### 歷史紀錄：`database_human_accounting`（此版本不接受 dispatch）

1. ledger 必須逐筆符合上述已採納 lineage，且 `20260902054834` 尚未套用或已完整套用；其他狀態一律拒絕。
2. 先在回滾交易中演練 migration，再以鎖定 ledger 的單一交易同時套用 SQL 與寫入 migration 紀錄。
3. 套用後以唯讀 canary 驗證人工修改的未稅、稅額、含稅、借方科目與貸方科目不會被過期 AI 結果覆蓋，並確認兩個同步 trigger 都存在。
4. 資料庫驗收通過後才提升同一份封存前台候選；正式網域仍須重新讀回相同 deployment、manifest 與前端合約。

v3 會重新解析正式直屬主管與唯一部門主管，只有可稽核的同一人情形才能跳關；補件時已完成的歷史簽核人與已移除的舊金額關卡保持不可變。新送件必須帶穩定 `submissionAttemptId`；缺少該欄位的舊分頁一律以 `55000` 要求重新整理。同一申請單、登入申請人、attempt 與 SHA-256 payload 必須一致，不同 attempt 或 payload 一律 fail closed。

## ROLLBACK rehearsal 的真實邊界

正式 migration 來源禁止自行出現 `BEGIN`／`COMMIT`／`ROLLBACK`，也禁止 `CREATE/DROP INDEX CONCURRENTLY`、`REINDEX CONCURRENTLY`、`VACUUM`、`ALTER SYSTEM`、`CLUSTER` 等會脫離原子批次的指令。release guard 在正式 apply payload 外加唯一的 `BEGIN`／`COMMIT`，並在同一交易寫入 migration statements 與 ledger；演練時則只加 `BEGIN`／`ROLLBACK`，比較前後 catalog／ACL／RLS／政策／函式／關鍵資料與 ledger 指紋。

這是 live DB 上單一 `REPEATABLE READ` 交易與 savepoint 內的 rollback rehearsal；migration 暫時套入 savepoint 後、尚未回滾前，會先以 `authenticated` 角色完整跑過送件、同一 attempt 冪等回放（v3 已安裝時）、u5／A1100 偽造部門主管 self-skip 的 42501 負向案例、主管退回，以及實際 10 參數補件 RPC 的偽造未來簽核人 42501、成功補件與同 key replay。另以徐靖雯正式 UUID／Finance 帳號／B1302／E5 驗證組織解析、舊頁拒絕與公開送件，再由 `service_role` 實際探測通知 claim worker；全部都在同一交易回滾。接著確認測試單、通知與 operation cache 等關聯資料沒有殘留，再比較前後指紋，因此一般通知新增不會造成假失敗。本次 audit 會在同一交易演練固定六份 migration 的相容性；它仍不是 production clone 或 shadow database，無法取代外部副作用與完整資料量的 shadow rehearsal。workflow 拒絕任意合併或拆分批次，文件與執行結果不得宣稱「live rollback 等同 atomic clone」。

## 操作

在 GitHub Actions 手動選擇 `Finance Protected Production Release`，輸入：

- `candidate_sha`：當下 protected `main` 的完整 SHA。
- `release_phase`：本次會計明細修正選 `database_cases_20260908`；該修正套用後的前台上線選 `frontend_compat`。
- `migration_versions`：database cases 只能填 `20260908065050`；frontend 只能填 `none`。
- `confirmation`：`PROMOTE FINANCE PRODUCTION`。

任一步失敗即 fail closed。`frontend_compat` 不會提交資料庫變更；database cases 已套用時只驗收，不重跑 SQL；audit 六份與全部既有 migration 保持原樣。若提升或 readback 遇到暫時錯誤，應在同一 GitHub Actions run 使用 **Re-run failed jobs**，讓獨立 `promote` job 消費同一 sealed artifact，不重新建置或套版。`candidate` artifact 保留 14 天；超過保留期不得把另一個 deployment 冒充原候選，必須另開完整受審發布。

若整個 workflow 被人為選擇「Re-run all jobs」，會建立新的候選；這不等同原 candidate 的復原路徑。DB ledger 已套用時仍會阻止重複 mutation，但操作上應一律優先使用 **Re-run failed jobs** 續跑原 `promote` job。

此文件與 workflow 只建立程式內的 gate；若 GitHub Environment required reviewers、branch restriction 或最小權限 secrets 尚未由平台管理者設定，不得宣稱平台層硬閘門已啟用。


## 2026-09-08 audit repair release

The `database_audit_20260907` phase accepts only the complete ordered batch
`20260907154404,20260907154739,20260907154742,20260907154743,20260907154758,20260907154759`.
It requires the entire previously reviewed production ledger. A partial batch is
rejected. The sealed candidate is built before mutation. The database job runs
all six migrations, read-only audit postflight, and authenticated canary inside a
rollback rehearsal, comparing schema, privileges, triggers and affected data
fingerprints before and after. Formal apply commits all six migrations and their
ledger rows in one transaction; its final audit postflight must pass before COMMIT.
Promotion consumes the same candidate, repeats read-only gates and verifies the
production domain's manifest. An already applied batch is verified without reapply.

Subsequent `frontend_compat` releases require the entire audit batch and run the
additional audit postflight. The historical v3/human phases remain recorded for
lineage compatibility; they cannot install any audit migration individually.

Local PGlite fixtures are isolated behavior tests. They do not replace the live
rollback rehearsal or authenticated staff browser acceptance. Google OAuth
acceptance needs an authorized user's interactive session; never simulate a
real login by injecting a production token or rewriting an identity.

For this candidate, `validate-target` also rejects archived `database_v3` and
`database_human_accounting` dispatches. Their code remains only for historical
lineage tests; the current UI offers audit-batch or fully compatible frontend releases.


## 2026-09-08 會計明細案件修正發布

`database_audit_20260907` 已封存為歷史 phase，此候選拒絕該 dispatch。歷史固定批次仍保留供 lineage／回歸驗證：

| 歷史 `release_phase` | `migration_versions` |
|---|---|
| `database_audit_20260907` | `20260907154404,20260907154739,20260907154742,20260907154743,20260907154758,20260907154759` |

目前 `database_cases_20260908` 只接受 `20260908065050_finance_finalize_accounting_lines_atomic_v1.sql`。必須先有完整歷史 authority chain、人工會計 authority 與 audit 六份；不完整或不認得的 ledger 均停止。已部署的 migration 不修改、不重新執行，不對歷史營運單回填或自動核准。

候選前台、migration、postflight 與 canary 先封存於同一 artifact。資料庫 job 先跑既有唯讀 gate 與真正 authenticated 送件／退回／補件 canary，再把新 migration 套入 `REPEATABLE READ` 交易的 savepoint。新 domain postflight、原 canary 與新增 authenticated finalization canary 全部在回滾前執行；回滾後逐一確認測試資料不存在並比較指紋。

`scripts/finance_cases_20260908_fingerprint.sql` 保留原 audit 的 schema、ACL、RLS、trigger、ledger 與資料雜湊，額外納入 `application_accounting_lines`，確保會計明細也完整還原。這仍是正式資料庫上的可回滾演練，不是 production clone。

正式 apply 在取得 advisory lock、鎖定 ledger 並重新確認 exact ledger 後，只執行新一份 SQL。新 migration ledger 紀錄與 `finance_finalize_accounting_lines_postflight.sql` 都在同一交易，任何失敗禁止 COMMIT。成功後再次跑完整唯讀 postflight、既有 authenticated canary 與新 finalization canary；後者明確驗證 form payload、application accounting lines 與入帳結果一致並完全回滾。

promotion job 重新驗證同一 candidate receipt、DB postflight、兩種 authenticated canary，才可提升原 deployment URL。已套用 case migration 時走唯讀驗收與回滾 canary，不再執行 migration。後續 `frontend_compat` 也要求這份 migration，避免新前台繞過資料庫修正。

本次固定 `test:database-cases` 執行入帳科目顯示、附件下載檔名、採購付款真 handler／SQL guard、finalize 真 SQL 與發布交易回歸。實際瀏覽器下載測試需要 `agent-browser` 與 `openssl`，封存來源但不混入純 Node CI suite。
