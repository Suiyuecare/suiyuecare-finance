# 歲悅財務 App 上架審核資料

最後更新：2026-05-23

## App 基本資料

- App 名稱：歲悅長照集團財務管理系統 V3
- 短名稱：歲悅財務
- Bundle ID / Package Name：`com.suiyuecare.finance`
- 官方網址：https://finance.suiyuecare.com/
- 隱私權政策：https://finance.suiyuecare.com/privacy.html
- 類別建議：Business / Productivity
- 主要使用者：歲悅長照集團授權員工、主管、行政、人資、總務、會計與執行長。

## App Store / Google Play 簡短描述

歲悅長照集團財務管理系統整合支出申請、簽核、附件上傳、會計科目、傳票、報表與內部稽核流程，協助員工以手機或電腦完成發票憑據上傳、申請送簽與進度追蹤。

## App Store / Google Play 完整描述

歲悅長照集團財務管理系統 V3 是企業內部財務與會計申請平台，提供員工、主管與會計人員一致的線上作業流程。

主要功能包含：

- 支援費用報銷、付款申請、預支申請、零用金申請、差旅申請、採購申請、退費申請與人事費用申請。
- 員工可拍攝或上傳發票、收據、存摺封面與申請附件，並將經費明細整理成可下載檔案。
- 主管可依簽核流程查看申請內容、下載附件、留下意見、核准、退回或加簽。
- 會計可確認金額、會計科目、傳票、付款與入帳狀態，降低重複入帳與資料遺漏。
- 系統支援 Google 登入、角色權限、附件歸檔、月結鎖帳、傳票沖銷調整與稽核紀錄。
- 財務報表依正式分類帳資料產生，支援公司別、部門/專案與稅務資料追溯。

本 App 僅供歲悅長照集團授權人員使用，非公開消費型服務。未經授權者無法登入或存取資料。

## 審核帳號備註

請在送審前建立一組審核測試帳號，並填入 App Store Connect / Google Play Console。

建議帳號：

- Email：`reviewer@suiyuecare.com`
- 角色：一般組員或測試審核角色
- 資料環境：測試資料
- 測試用途：新增費用報銷、上傳憑據、查看我的申請。

如果審核員需要測主管簽核，建議另建：

- Email：`reviewer.manager@suiyuecare.com`
- 角色：課長或部門主管
- 資料環境：測試資料

## App Review Notes

This app is an internal finance and accounting workflow system for Suiyue Care Group employees only. Users must sign in with an authorized company account. The reviewer may use the provided test account to access the test data environment.

Suggested test path:

1. Sign in with the provided reviewer account.
2. Enter the Accounting module.
3. Open New Application.
4. Create an expense reimbursement request.
5. Upload a receipt image or PDF.
6. Review the generated detail table and submit the request.
7. Open Approval Management to view the submitted request.

Camera and file access are used only for uploading receipts, invoices, passbook covers, payroll sheets, and approval attachments. The app does not access photos or camera in the background.

## iOS 權限用途文字

- Camera：用於拍攝發票、收據、存摺封面與簽核附件，協助完成財務申請與會計憑證歸檔。
- Photo Library：用於選取並上傳發票、收據、存摺封面、薪資表與其他財務申請附件。
- Photo Library Add：用於下載或保存系統產生的經費明細、簽核附件與報表檔案。

## Google Play Data Safety 草稿

### 是否收集資料

是。本 App 會依照公司內部財務流程收集使用者帳號資料、財務申請資料、附件與操作紀錄。

### 資料類型

- 個人資訊：姓名、電子郵件、公司別、部門、角色權限。
- 財務資訊：申請金額、付款資料、銀行、分行、帳號、會計科目、傳票與報表資料。
- 照片與影片：發票、收據、存摺封面、簽核附件影像。
- 檔案與文件：PDF、Word、Excel、薪資表、人事費用表、勞務報酬單等。
- App 活動：登入、送出、簽核、退回、下載、入帳、設定異動與 audit log。

### 使用目的

- App functionality：提供財務申請、簽核、附件保存、付款與會計入帳功能。
- Analytics / Security：追蹤系統異常、權限使用與稽核紀錄。
- Compliance：符合法令、會計、稅務與公司治理要求。

### 是否分享資料

不出售資料。資料僅於完成服務所需時由 Google OAuth、Supabase、OpenAI API、Vercel 等服務處理，並受公司授權與安全控管。

### 是否加密傳輸

是。正式服務使用 HTTPS 與雲端服務安全機制。

### 是否可刪除資料

帳號可申請停用或更正；但財務、會計、稅務與稽核保存資料可能須依公司制度與法令保存，無法立即刪除。

## 上架前必檢

- `https://finance.suiyuecare.com/privacy.html` 可公開開啟。
- Supabase Redirect URLs 包含 `https://finance.suiyuecare.com/` 與 `com.suiyuecare.finance://oauth-callback`。
- Google Cloud OAuth Redirect URI 包含 `https://udtlppnrugmtzhigdsxo.supabase.co/auth/v1/callback`。
- 真機測試 Google 登入、拍照、上傳、下載、簽核流程。
- App Store Connect / Google Play Console 已填入測試帳號。
- 截圖包含登入、模組入口、儀表板、新增申請、簽核管理、申請詳情。
