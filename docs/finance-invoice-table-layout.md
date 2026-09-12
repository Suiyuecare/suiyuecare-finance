# 發票與會計明細表格一致性

本次調整介面呈現。日期、品項、來源檔案、數量、稅額、科目、簽核範圍與人工覆核保存契約保持原有規則。以下記錄本機驗證；正式發布以受保護流程及對應的 production manifest 為準。

## 問題與修正

- 泛用手機表格轉換使用 descendant `thead th`／`tbody tr`，把內層品項套上外層「發票日期」等標籤。表頭與資料列改為只讀該 table 自己的 `tHead`／`tBodies`，財務明細退出卡片轉換。
- 手機引擎另將新增申請與發票輸入表轉成逐筆卡片，後載入 CSS 又蓋掉原本橫向捲動規則。移除該掛載、樣式及過時的進階試算表模式切換。
- 已入帳明細過去另產手機卡片並隱藏正式表格；現在各寬度共用原正式會計表格。
- 發票核對直接按列提供既有品項、數量與含稅金額編輯欄位；原 input ID、action-row scope、人工覆核 collector 與科目控制不變。
- 只有表格容器實際溢位時，才顯示「左右滑動查看完整欄位」。表格保留鍵盤水平捲動與手機至少 44px 點按區。

## 驗證

```sh
NODE_PATH=/Users/seniorlifepr/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules \
  node scripts/check_invoice_table_layout_browser.cjs
```

測試使用實際本機 index、引擎與 CSS。虛構兩張發票各兩筆品項，合計 1,995；不登入真實帳號、不存取業務 API。1440／390 分別驗新增申請、費用明細、開立發票明細、已入帳明細、申請簽核彈窗與發票簽核彈窗。

驗證真正表頭、逐格日期與稅額、來源檔案、元件內水平捲動、無整頁橫向溢出、只在溢位時提示、44px 點按區，以及執行真正 collector 後的人工權威紀錄與金額。另確認 employee 不新增可編輯科目／發票欄位，正式入帳表維持唯讀。

Before 比較需先保留原始四檔於 `/tmp/finance-table-baseline-20260913/`，再加 `--before`；找不到原始檔即失敗，不以新程式假造舊畫面。完整等資料前後證據位於 `/tmp/finance-table-layout-20260913/`，含 browser evidence JSON 與桌機／手機截圖。
