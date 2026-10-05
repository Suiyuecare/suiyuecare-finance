# 採購憑據與最終金額結算修復

## 已確認原因

2026-10-05 唯讀核對單號 20260805002：預估金額有值，actual_amount 為 NULL、actual_files 為空；最後總務憑據關已有一般核准紀錄，流程已到會計最後關。先前總務付款關的發票 PDF 及 Excel 仍有附件登記與 Storage 物件。

程式與離線資料庫測試確認，一般／整批核准 RPC 可在採購專用關卡跳過付款資料、實際金額及憑據驗證；一般核准紀錄無法單獨證明當時使用者點的是哪一個入口。退回總務後，一般中間補件 UI 也可能蓋過專用實際金額表單。

## 修正

- 前端單張、modal、整批及共用交易入口拒絕以一般 approve/add_sign 代替採購資料送出。
- 資料庫同步封住三個採購專用角色的相同旁路；原權限、退回、拒絕及專用送出守門條件保留。
- 退回總務仍顯示實際金額表單。總務可明確勾選同單本人先前上傳的發票憑據；畫面依附件登錄逐檔核對上傳者，避免把會計退回時混入同一關卡的附件誤認為總務憑據。伺服器仍核對附件登記與儲存物件；不複製檔案、不推算金額。
- 最後會計關缺少結算資料時，直接顯示補正指引與既有退回操作。
- 修改工作副本，只有成功保存後才更新畫面；逾時仍沿用原送件識別碼回查，保留附件。

## 本單處理方式

1. 目前會計開啟原單，使用「退回上一關」。
2. 原總務開啟同單，依憑據填入最終實際支出，勾選沿用原發票 PDF；需要時補新憑據。
3. 送回會計核對金額、科目及憑據，再完成結單。

這次部署不代替員工簽核、不更改實際金額、不建立傳票、不重開出納付款。

## 驗收與發布

- `pnpm test:procurement-closeout`：實際前端函式、舊版旁路重現、修補後資料庫驗證、權限與附件歸屬、混合批次原子回滾。
- `pnpm test:procurement-closeout-browser`：虛構總務、會計、無權限員工，桌機與手機的實際詳情／modal 流程；禁止外網與正式業務寫入。
- `pnpm release:preflight`、GitHub Release Gate、Protected Production Release。
- DB 補丁為 `20261005035438_procurement_specialized_action_guard_v1.sql`，套用前嚴格比對既有函式雜湊，套用後核對 ACL、owner、search_path 與原 direct UPDATE guard。
- 正式驗收以 release-manifest.json 與發布 commit 一致為準；單據業務狀態仍由員工完成上述補正後確認。

正式資料庫已透過 Supabase migration 服務套用，依服務回傳 ledger 版本 20261005035438 對齊檔名。Postflight 確認函式雜湊、owner、ACL、search_path 符合預期，direct UPDATE guard 未變；未修改單據資料。
