# 簽核搜尋受保護發布（2026-09-14）

本次改善簽核歷史搜尋的欄位投影與查詢成本，並與尚待發布的儀表板範圍、Google 身分比對修正一起發布。資料庫 migration 只調整函式，不新增營運資料、不借用員工登入身分。前端功能驗證及實際效能證據由相應測試保存；完成本機測試不代表已上線。

## 固定版本與允許狀態

GitHub Actions `finance-production-release.yml` 僅接受目前的 `frontend_compat` 及 `database_approval_search_20260914`。歷史 phase 保留供精確版本的測試、相容檢查使用，不能發布目前的新前端。

新 phase 的 `migration_versions` 必須完整且依序為：

```text
20260914001246,20260914001252,20260914091205
```

| 已套用的本批版本 | 動作 |
| --- | --- |
| 三版皆未套用 | 同一交易套用三版、寫入三筆 ledger、完成全部 18 份 postflight 才 COMMIT |
| 僅前兩版完整套用 | 同一交易只套用 `20260914091205`、新增一筆 ledger、完成全部 18 份 postflight 才 COMMIT |
| 三版皆已套用 | 唯讀相容驗證後，繼續核對及提升同一個已封存的 candidate；不再執行 migration |
| 前兩版只存在其中一版、搜尋版孤立存在、未知版本或缺少前置版本 | 拒絕發布，不自動修補 ledger |

操作介面始終傳完整三版，不由操作者自由挑選 SQL 或略過任一已知前置版本。唯讀前置檢查依已驗 ledger 選用 15 份或 17 份舊契約；新相容檢查固定執行 18 份。

## 回滾與權限證明

- rehearsal 先鎖定發布工作與 migration ledger，在交易內比對取得的完整 ledger，才建立指紋並開啟 savepoint。
- 只在 savepoint 內執行缺少的固定 migration、完整 18 份 postflight，以及儀表板範圍、Google 身分比對、簽核搜尋三份唯讀 canary。
- 回滾 savepoint 後執行三份 rollback-check，再比較完整 schema／資料指紋；外層交易也以 ROLLBACK 結束。
- apply 在同一個交易內再次鎖定、比對完整 ledger，執行缺少的 SQL、記錄每份原文及版本，全部 postflight 通過才 COMMIT。任一步失敗不留下前段 migration 或 ledger。
- 沿用 `finance_statement_source_fingerprint.sql`；它涵蓋 public/private/auth 全部函式定義、owner、security definer、search_path、ACL，以及既有資料表／來源／會計／組織／身分資料指紋。新私有搜尋 helper 不會漏出檢查。
- 本 phase 的三份 canary 皆為純 SQL、repeatable read read only、單一 ROLLBACK；不能設定真人 claims，也不寫營運資料。新 canary 唯一結果必須完整符合 `readonly_approval_search_v1`、`ok=true`、`rolled_back=true`、`participant_scope_preserved=true`。
- 提升前再執行 18 份 postflight 與三份唯讀 canary；candidate SHA、Vercel project/team、成品及 release-tools 指紋維持原有檢查，不重建另一份成品。

## 本機與 CI

`pnpm test:approval-search-20260914` 執行真前端 handler、真 PostgreSQL 搜尋函式、protected release batch 測試；已加入既有 `release:preflight`。PGlite 測試包含三版／一版兩種 pending 狀態、部分安裝拒絕、每份 DDL／postflight／canary 失敗回滾、晚到 ledger 變動、重跑拒絕及唯讀恢復。

`check_approval_tab_colors_browser.cjs` 與擴充的 `check_approval_history_browser.cjs` 使用既有 agent-browser CLI 作本機實際 DOM 驗證，測試來源列入封存。CI 及 candidate 繼續執行既有固定 Playwright 三套 DOM 門檻；沒有將 CI 尚未安裝的 agent-browser 假列為通過。

## 2026-09-14 驗證紀錄

- 真前端搜尋 handler 26 項、既有載入 31 項、實際瀏覽器搜尋 18 項通過；中文字組字、連續輸入、過期回應、逾時及分頁均包含在內。
- 新 PostgreSQL 搜尋測試 144 項、受保護發布 batch 259 項通過。48 組粗篩開關完整結果比對、422 組原正規化相容測試通過。
- 桌面與手機六個頁籤均驗證橘底白字；文字對比 4.55:1、數字徽章 5.82:1，沒有水平溢位。
- 正式資料僅用交易內函式演練並回滾。原「自費」搜尋超過 8 秒逾時；候選版本「自費」2,934 ms（7 筆）、部門 2,702 ms（20 筆）、單號 2,468 ms（1 筆）、取自實際單據的已知金額 2,908 ms（1 筆）。金額格式其他樣本為 2,111–2,196 ms。這些是單次資料庫耗時，不含網路與畫面渲染，不能視為所有使用者都低於 3 秒的保證。
- 主管空白查詢的完整首批 50 筆與原結果逐欄相等，總數仍是 737 筆；另一員工原本無歷史資料的結果亦相等。正式函式 source hash 及新 helper 不存在皆確認已還原，沒有提交本次資料庫變更。
- 正式發布仍需有效 VERCEL_TOKEN；本機檢查與交易演練不代表已上線。

## 發布前提與操作

先合併經 CI 驗證的 exact main SHA，再由既有受保護流程發布。VERCEL_TOKEN 必須是可存取指定 Finance team/project 的有效受保護設定；若驗證失敗，先由有權限的人修正設定，不改 workflow、不跳過 candidate 封存、不改用不受保護發布。

```sh
gh workflow run finance-production-release.yml \
  --repo Suiyuecare/suiyuecare-finance --ref main \
  -f candidate_sha=<經核對的完整 main SHA> \
  -f release_phase=database_approval_search_20260914 \
  -f migration_versions=20260914001246,20260914001252,20260914091205 \
  -f 'confirmation=PROMOTE FINANCE PRODUCTION'
```

發布後必須核對正式 `release-manifest.json` 的 source_commit／成品 hash 與相同 candidate，並保存匿名唯讀頁面驗證。若只有 CI 或 rehearsal 成功，狀態仍是未發布。
