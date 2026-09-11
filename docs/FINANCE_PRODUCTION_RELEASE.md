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

## 目前兩個受控入口：報表完整性批次、後續前台發布

此版本只接受以下兩組輸入，`release_phase` 與 `migration_versions` 任何不相符都在建置或資料庫連線前立即拒絕：

| 順序 | `release_phase` | `migration_versions` | 允許的動作 |
|---|---|---|---|
| 1 | `frontend_compat` | `none` | 日常前台發布：建立、驗證並提升新前台；資料庫不得提交變更，只能做唯讀 gate 與整筆回滾 canary |
| 2 | `database_reporting_integrity_20260911` | `20260911135457,20260911135514` | 完整 amount search 前置成立後，演練並原子提交應收核對與憑證來源綁定 migration、ledger 及全部 10 份 postflight，再提升封存候選 |

正式資料庫目前受控 lineage 為 v1 `20260826070814`、v2 `20260826155840`、v3 `20260827052447`，以及已採納回版本庫的修復 `20260828015718_repair_admin_ntpc_portal_employee_link_20260828`、`20260831042040_top_level_ceo_self_route`、`20260831043517_expense_submit_derived_status`、`20260901024020_final_accountant_self_post`、`20260901073241_assign_ceo_cashier_and_reassign_pending_cashier`、`20260901081807_allow_formal_cashier_self_disbursement`。其中正式出納固定為李佳泰、總務備援已移除，且三張待放款單保留稽核轉派紀錄。任何其他未審查的 post-baseline migration 仍會 fail closed；採納既有版次不代表流程會再次執行其 SQL。

舊的 audit、cases、utility、reports、amount search phase 只保留歷史 gate／前置相容驗證；此候選不得用它們 dispatch 或 promotion。

### Phase 1：`frontend_compat`

1. workflow 固定 checkout protected `main`；`GITHUB_REF`、`GITHUB_REF_NAME`、`GITHUB_SHA`、本機 `HEAD` 與 40 碼 `candidate_sha` 必須完全相同。
2. 跑完整 `release:preflight` 與 production artifact 驗證，只建立一次 `--prod --skip-domain` 的 unaliased candidate。
3. 候選首頁必須恰有一個 `finance-release-contract=expense-submit-resilience-v3-20260827` meta，並實際包含 `submissionAttemptId`；release manifest 的 `source_commit` 必須等於 candidate SHA。
4. sealed receipt v2 同時綁定 release phase、`migration_versions`、deployment ID／URL、manifest hash、首頁 hash、candidate SHA 與 GitHub run ID。下載 artifact 的後續 jobs 逐欄重算，不宣稱或依賴未比較的 artifact digest。
5. 正式資料庫 ledger 必須恰有完整 v1／v2／v3、全部六份 audit 修復、會計明細修正 `20260908065050`、utility `20260909083825`、reports `20260910064324,20260910064325`、amount search `20260910083000`、reporting integrity `20260911135457,20260911135514` 與已審查歷史修復（含 `20260901073241` 正式出納修復）；workflow 以 v3 唯讀 postflight、精確的人員連結檢查、authenticated rollback canary 與 immutable project 檢查證明現況，不會提交任何資料庫變更，`prepare-apply` 不可能出現在此分支。
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
- `release_phase`：本次報表完整性選 `database_reporting_integrity_20260911`；該版已套用後的前台發布選 `frontend_compat`。
- `migration_versions`：reporting integrity 只能填 `20260911135457,20260911135514`；frontend 只能填 `none`。
- `confirmation`：`PROMOTE FINANCE PRODUCTION`。

任一步失敗即 fail closed。`frontend_compat` 不會提交資料庫變更；reporting integrity 批次已套用時只驗收，不重跑 SQL；audit 六份與全部既有 migration 保持原樣。若提升或 readback 遇到暫時錯誤，應在同一 GitHub Actions run 使用 **Re-run failed jobs**，讓獨立 `promote` job 消費同一 sealed artifact，不重新建置或套版。`candidate` artifact 保留 14 天；超過保留期不得把另一個 deployment 冒充原候選，必須另開完整受審發布。

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


## 歷史紀錄：2026-09-08 會計明細案件修正發布（不接受 dispatch）

`database_audit_20260907` 已封存為歷史 phase，此候選拒絕該 dispatch。歷史固定批次仍保留供 lineage／回歸驗證：

| 歷史 `release_phase` | `migration_versions` |
|---|---|
| `database_audit_20260907` | `20260907154404,20260907154739,20260907154742,20260907154743,20260907154758,20260907154759` |

歷史 `database_cases_20260908` 契約只接受 `20260908065050_finance_finalize_accounting_lines_atomic_v1.sql`。必須先有完整歷史 authority chain、人工會計 authority 與 audit 六份；不完整或不認得的 ledger 均停止。已部署的 migration 不修改、不重新執行，不對歷史營運單回填或自動核准。

候選前台、migration、postflight 與 canary 先封存於同一 artifact。資料庫 job 先跑既有唯讀 gate 與真正 authenticated 送件／退回／補件 canary，再把新 migration 套入 `REPEATABLE READ` 交易的 savepoint。新 domain postflight、原 canary 與新增 authenticated finalization canary 全部在回滾前執行；回滾後逐一確認測試資料不存在並比較指紋。

`scripts/finance_cases_20260908_fingerprint.sql` 保留原 audit 的 schema、ACL、RLS、trigger、ledger 與資料雜湊，額外納入 `application_accounting_lines`，確保會計明細也完整還原。這仍是正式資料庫上的可回滾演練，不是 production clone。

正式 apply 在取得 advisory lock、鎖定 ledger 並重新確認 exact ledger 後，只執行新一份 SQL。新 migration ledger 紀錄與 `finance_finalize_accounting_lines_postflight.sql` 都在同一交易，任何失敗禁止 COMMIT。成功後再次跑完整唯讀 postflight、既有 authenticated canary 與新 finalization canary；後者明確驗證 form payload、application accounting lines 與入帳結果一致並完全回滾。

promotion job 重新驗證同一 candidate receipt、DB postflight、兩種 authenticated canary，才可提升原 deployment URL。已套用 case migration 時走唯讀驗收與回滾 canary，不再執行 migration。後續 `frontend_compat` 也要求這份 migration，避免新前台繞過資料庫修正。

本次固定 `test:database-cases` 執行入帳科目顯示、附件下載檔名、採購付款真 handler／SQL guard、finalize 真 SQL 與發布交易回歸。實際瀏覽器下載測試需要 `agent-browser` 與 `openssl`，封存來源但不混入純 Node CI suite。


## 歷史批次：2026-09-10 完整報表與 canonical AR 發布

固定兩份 migration 為 `20260910064324_finance_canonical_receivables_v1.sql` 與 `20260910064325_finance_reporting_profiles_v1.sql`。單份、倒序、混入其他版本、缺少任一既有 authority/audit/cases/utility 前置，或只套了一份的 partial ledger，都直接拒絕。整批已 applied 的重試僅跑驗證，不再次執行 migration。

1. 封存一次建立的 unaliased candidate、所有新舊 gate／canary、migration catalog、首頁與 manifest；後续 job 只能讀同一 artifact。
2. 跑既有 `database_utility_tax_20260909` 前置後，在同一 `REPEATABLE READ` 交易先取得指紋、savepoint、兩份 migration、完整七份新舊檢查（v3、audit 合併、finalize、utility、人工會計 authority、AR、profile）、五個 authenticated canary core，再回滾 savepoint、五個 rollback check、比較同一 snapshot 的前後指紋，最後整筆 rollback。首次安裝回滾後新增表已不存在，guard 只對固定七張新增表延後解析查詢，既有表的殘留檢查與完整指紋仍保留。
3. `finance_reports_20260910_fingerprint.sql` 保留所有既有 schema／函式 ACL／RLS／trigger 與帳務內容雜湊，並涵蓋 AR、報表設定及修訂稽核、收款、催收、銀行與通知相關表。新增表不存在時記錄 absent；存在時雜湊完整列內容，等筆數更改也會被偵測。只輸出單一總指紋，不回傳業務資料。
4. Apply 以 advisory lock 加 migration ledger table lock，再核對 captured ledger，於同一交易依序套兩份 migration、存精確原 SQL 到 ledger、執行與演練相同的完整七份新舊檢查，最後才 commit。任一舊或新契約失敗都會回滾兩份 migration 與 ledger，不能延到 commit 後才驗證。已 applied 的恢復與 `frontend_compat` 也使用同一份檢查清單，以唯讀交易執行並禁止重套 migration。
5. Apply 後以及 promotion 前，再跑完整新舊 postflight、既有送件／退回／重送、finalize、utility 三個 canary、AR 與 profile 兩個新 canary、人工會計 authority 檢查。Standalone canary 必須純 SQL，不能含 psql `\set`；postflight 仍保留首行 `\set ON_ERROR_STOP on`，由 guard 檢查並移除後執行。
6. 新 canary JSON 接受 CLI row array／boundary wrapper／stringified jsonb，但必須恰一個正確 marker、固定四欄完全相符且所有旗標為 boolean true；空白、重複 marker、缺欄／多欄、false、一個字串 `true` 均拒絕。一般 manifest 仍限 JSON object。
7. 所有檢查完成後才 promote 封存的同一 deployment；禁止重新 build 或以新 deployment 取代原 candidate。失敗以同一 run 的 Re-run failed jobs 續行。

`pnpm test:financial-reporting` 包含實際財務計算／分頁函式、管理分析、稅務底稿、profile 與 AR 真 SQL 行為、兩份批次原子交易、五個 canary 失敗注入與指紋驗證。`pnpm test:financial-reporting-browser` 是另行執行的真瀏覽器／下載驗收，須安裝其瀏覽器 runtime，不能把純 Node CI 視為完成視覺或真人 UAT。


## 2026-09-10 金額搜尋固定批次

本次新候選只允許 `database_amount_search_20260910=20260910083000` 或 `frontend_compat=none`。唯一新 migration 是 `20260910083000_finance_history_amount_search.sql`；完整 authority／audit／cases／utility／reports 都是前置，缺少任一版、未知遠端版次或混入其他待套版次均拒絕。歷史 reports phase 只保留前置查核與回歸，不可用來提升新候選。

1. 完成固定 preflight、來源及產物檢查，建立並封存唯一候選；正式 alias 尚未變更。
2. 新版未套用時，先執行完整 reports 唯讀檢查。再於同一交易與 savepoint 演練原 migration、8 份 postflight，以及 workflow／finalize／utility／receivables／profiles／amount search 共 6 份真正 authenticated canary core；回滾後逐份執行殘留檢查與完整指紋比對。
3. `finance_amount_search_fingerprint.sql` 保留 reports 全部 schema、ACL、RLS、trigger 與財務資料指紋，另加 `approval_step_actor_snapshots` 及發票 trigger 可能觸及的收入規則、結案、簽核瓶頸與通知指派表之完整列雜湊；即使資料筆數不變，參與人內容改動也會被發現。
4. 正式套用在 advisory lock 與 ledger lock 內重查精確前置，將 migration 原 SQL、版次 ledger 和全部 8 份 postflight 一起提交。任一舊或新 postflight 失敗，SQL 與 ledger 一起回滾。新 postflight 不取代既有權限與會計檢查。
5. 若該版已 applied，重試只執行完整唯讀 postflight、6 份 rollback-only canary 與來源驗證，不重新套版。`frontend_compat` 也要求該版存在。只有上述驗證通過才提升先前封存的同一 deployment；不重建候選。

8 份 postflight 依序為 production DB、audit combined、finalize accounting、utility tax、human accounting、canonical receivables、reporting profiles、amount search。後三者的實際檔案為 `finance_canonical_receivables_postflight.sql`、`finance_reporting_profiles_postflight.sql`、`finance_amount_search_postflight.sql`；全部來自同一封存來源。獨立 canary 必須是 Supabase CLI 可直接執行的純 SQL，保留 BEGIN／ROLLBACK 與固定 markers，不得含 psql 命令。

`pnpm test:amount-search` 執行文件搜尋、應收搜尋、真 PostgreSQL 歷史 RPC 和受保護發布回歸；`pnpm test:amount-search-browser` 是另外執行的桌機／手機真瀏覽器驗收。純 Node 與匿名 PostgreSQL fixture 的通過不等於正式資料庫演練或真人帳號 UAT。

## 2026-09-11 報表完整性批次

兩份 migration 必須依序一次套用，不接受部分已安裝。套用前在同一回滾交易執行八份 authenticated canary（原有六份，加上應收核對權限與憑證來源綁定），並比較完整 catalog、ACL、設定版次及資料指紋。正式 apply 以 advisory lock 與 migration ledger lock 保護，兩份 SQL、兩筆 ledger 及十份 postflight 全部成功才 COMMIT。既有原始單據與報表分類不回填、不自動認證。

資料庫驗收與提升前都再次執行兩份新 canary，要求唯一且精確的回滾成功結果；任一失敗都停止提升。已套用批次重試僅跑唯讀十份 postflight 與完整回滾 canary，不重跑 migration。
