# Finance 稽核修復與驗收紀錄

本次依 2026-09-07 稽核的 20 項問題實作修正。基準為正式站當時的
`1f39c0a9d1ea9b1bcf1c9af29410df017b45b3b3`；使用獨立 worktree，原工作目錄的未提交內容保留。

## 修復對照

| 問題 | 修正後行為 | 主要回歸 |
|---|---|---|
| A01 Google 改信箱後不能寫入 | Google 驗證信箱與 Auth UUID 共用一致規則；UUID 不同仍拒絕 | auth recovery regressions |
| A02 重新驗證後遺失表單 | 九種申請、明細、人工值與未離焦欄位完整還原，核對成功才清備份 | auth recovery regressions、browser |
| A03 員工呼叫管理員同步 | 零參數本人修復，只補缺少的合法一般員工資料；組織變動同交易同步版本 | current identity runtime SQL |
| A04 換帳號後顯示舊工作區 | UUID 改變立即遮蔽並鎖定舊頁與視窗，停止資料請求及 Realtime | auth recovery regressions、browser |
| A05 切換仍指定舊信箱 | 明確切換時清除舊 Portal 帳號、角色及範圍提示 | auth recovery regressions |
| W01 採購送件契約不一致 | 付款資料及最終憑據欄位與後端受控允許清單一致 | procurement human event contract |
| W02 人工金額改完不能入帳 | 以更正流程保留人工值、獨立覆核及實際金流差額；檢核前不取傳票號 | expense accounting corrections |
| W03 50 筆歷史上限誤判 | 新人工操作依值與事件識別，不依畫面歷史陣列長度判定 | procurement human event contract |
| W04 通知無法開正確單據 | 保存單據類型，依租戶及環境補讀後開正確頁；成功才標已讀 | receipt notification UI |
| W05 收款後端缺少 CEO 覆核 | 後端驗證本人職權、待覆核狀態、附件、金額及資料版本 | receipt atomic workflow |
| W06 收款兩次寫入部分成功 | 整批收款、收入與現金分錄、狀態及稽核同交易；操作識別支援安全重試 | receipt atomic workflow |
| O01 改名稱刪其他法人 | 完整保留多法人與繼承範圍，編輯時明確處理集合 | finance org regressions |
| O02 發布撤銷出納兼任 | 保留獨立財務控制角色，組織發布只更新其管理範圍 | finance org regressions |
| O03 已發布版本偏離主檔 | 依現行有效任職整理新版本；人員、主管及本人修復同步版本，保留歷史 | org regressions、identity SQL |
| O04 主管日期未生效 | 按臺灣日期邊界解析任職與例外，新送單使用當下有效主管 | finance org regressions |
| O05 草稿失敗仍送審 | 儲存失敗即停止，成功後才以已儲存版本驗證及送審 | finance org regressions |
| O06 多人編輯互相覆蓋 | 主管圖帶預期版本；衝突停止，不用背景刷新版本掩蓋舊內容 | finance org regressions |
| O07 讀取失敗顯示成功 | 區分讀取失敗、不同步及有效資料來源 | finance org regressions |
| S01 人資匿名與冒用身分 | 封閉匿名入口及直接改寫，後端解析本人與角色；保留合法 HR-only 本人使用 | attendance identity boundary |
| S02 文字被當成 HTML | 申請說明、申請人、銀行資訊、附件與通知文字轉義；識別碼安全傳入事件 | HTML render security、notification UI |

## 一併改善

- 已完整認列的歷史發票支援三種合法分錄格式，本期收款不因原期關帳而被誤擋；未認列仍檢核原期，缺漏或不符金額的分錄仍拒絕。
- 正式事件以最小資訊暫存，依 Auth UUID／租戶／環境隔離；重新登入或上線後重送。姓名、信箱、表單、附件與憑證不進入此暫存。
- 已付款的退回限制在操作前說明，會計金額異動導向可追溯更正流程。
- 登入切帳號按鈕至少 44px；390px 寬度實測無水平溢出。
- 新增簽核、收款、通知與診斷領域模組，並將實際失敗分支加入固定版本的 CI 回歸。
- 維持現行合法人資及主管授權；直接維護紀錄與正式審核紀錄分開表達，未擅自引入新的雙人覆核政策。

## 驗收方式與界線

`pnpm test:audit-remediation` 執行 Node 與 PGlite 隔離案例；
`node scripts/check_finance_auth_recovery_browser.cjs` 執行實際瀏覽器 DOM、重載與換帳號鎖定案例；
`node scripts/check_finance_approval_runtime_browser.cjs` 驗證實際主程式與通知、更正、收款引擎的連接、手機畫面和更正視窗身分鎖定。
PGlite 使用匿名 fixtures，不能代表正式完整 schema 或真人 Google OAuth 驗收。
新選取的 File bytes 若未上傳，跨整頁重載需重新選取，畫面會明示；不誤稱檔案內容已恢復。

正式發布必須先通過完整舊版契約，再以固定六份 migration 在交易中演練、驗收及完整 rollback；
正式套用將六份 SQL、ledger 及 postflight 一起提交，最後驗證相同前台 artifact 與正式網域。
本文的最終發布 SHA、CI 與正式驗收結果於發布後補記。
