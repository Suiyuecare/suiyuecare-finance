# 組織圖閱讀改善與驗收

組織圖預設使用縱向可收合主管列表，保留完整圖；桌面與手機共用「主管關係／人員簽核設定」分頁。公司、部門、姓名、職稱與分機均在已載入人員中查找，不增加遠端搜尋等待。個人聯絡資料與簽核資訊改在選取詳情顯示。

## 資料與權限

- 原 `ORG_CHART`、持久版本及未儲存草稿不受瀏覽、展收或篩選影響。
- 篩選包含直屬鏈上下文並標示上層主管；不依同部門推測另一位主管。
- 循環關係保留原始指派資料及異常警告，但不繪製成有效階層。
- 同名人員依人員 ID 定位設定列；調整與儲存仍套用既有權限和原子版本保護。
- 唯讀角色可見聯絡信箱但不顯示登入信箱。切換使用者、租戶或環境重設閱讀狀態。
- 同步狀態收合成可展開摘要；新偵測的警告會自動展開，重新檢查入口保留。

## 驗收證據

本地虛構資料包含 43 人（42 啟用）、多法人／多部門、跨公司主管、同名者、深層主管鏈、缺主管、已停用主管與循環。沒有借用真實員工登入，也沒有寫入正式資料。

- `node scripts/check_org_chart_clarity_browser.cjs --baseline-ref 79d00bf --output <outside-repo>`：原介面 24 項檢查；同組虛構資料桌面／手機 before。
- `pnpm test:org-chart-browser`：Chrome 與 WebKit、1440／900／390／375px，共 680 項檢查。含 44px 點擊目標、鍵盤、組字搜尋、無整頁橫向溢出、主管邊不變、權限及零寫入 RPC。
- `node scripts/check_employee_progress_concerns_browser.cjs`：既有聯絡信箱查閱改驗選取詳情，保留唯讀隱私與員工處理流程驗收。
- `node scripts/check_finance_org_regressions.js`：19 項組織權限、版本、原子更新及送件回歸。
- `node scripts/check_membership_org_expense_submission_contract.js`：19 項正式送件／部門範圍契約。
- 靜態設計稽核：完整舊版單檔程式掃描因長時間未結束而終止；改動區域獨立 snapshot strict audit 為 0 finding。原生選單責任明訂於 UX-CONTRACT.md。

發布由既有受保護 GitHub／Vercel 流程执行，前台 UI 更新不需要資料庫遷移。正式部署狀態以 workflow、release manifest 與實際發布資產為準，以上本地測試不冒充正式帳號登入驗證。
