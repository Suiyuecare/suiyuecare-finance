# 歲悅財務 App 打包與送審 Runbook

最後更新：2026-05-23

## 目前專案狀態

- Capacitor App ID：`com.suiyuecare.finance`
- App 名稱：`歲悅財務`
- Web 目錄：`www`
- 正式網址：`https://finance.suiyuecare.com/`
- 隱私權政策：`https://finance.suiyuecare.com/privacy.html`
- OAuth App 回跳：`com.suiyuecare.finance://oauth-callback`

## 本次已完成

- 已加入 `privacy.html`，並納入 `pnpm build` 輸出。
- 已在登入頁與模組入口加入隱私權政策連結。
- 已補 iOS 相機/相簿權限用途文字。
- 已補 Android CAMERA 權限與 optional camera feature。
- 已同步 Capacitor iOS / Android 專案。
- 已產生送審資料草稿：`docs/app_store_review_notes.md`。
- 已產生手機截圖草稿：`docs/app-store-screenshots/`。

## iOS 打包前置

這台電腦目前只有 Xcode Command Line Tools，尚未安裝完整 Xcode。需要先從 Mac App Store 安裝 Xcode，安裝後執行：

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -runFirstLaunch
```

完成後在專案根目錄執行：

```bash
pnpm cap:sync
pnpm exec cap open ios
```

在 Xcode 中：

1. 選擇 Team：歲悅長照集團 Apple Developer 組織帳號。
2. 確認 Bundle Identifier：`com.suiyuecare.finance`。
3. 確認 Signing & Capabilities 可正常簽章。
4. 選擇 Any iOS Device。
5. Product > Archive。
6. Distribute App > App Store Connect > Upload。

## Android 打包前置

這台電腦目前沒有 Java Runtime。需要安裝 JDK 17 或 Android Studio 內建 JDK。

建議安裝 Android Studio，並確認：

```bash
java -version
```

完成後在專案根目錄執行：

```bash
pnpm cap:sync
cd android
./gradlew bundleRelease
```

輸出檔通常會在：

```text
android/app/build/outputs/bundle/release/app-release.aab
```

正式上架前需要設定 release signing key。第一次上架建議使用 Google Play App Signing，並妥善備份 upload key。

## Google / Supabase OAuth 必填

Supabase Auth URL Configuration：

```text
Site URL: https://finance.suiyuecare.com
Redirect URLs:
https://finance.suiyuecare.com/
com.suiyuecare.finance://oauth-callback
```

Google Cloud OAuth Authorized redirect URI：

```text
https://udtlppnrugmtzhigdsxo.supabase.co/auth/v1/callback
```

## 送審前真機測試

至少測以下流程：

1. Google 登入可完成並回到 App。
2. 以一般員工建立費用報銷。
3. 使用相機拍照上傳憑據。
4. 可上傳存摺封面或附件。
5. 可送出簽核。
6. 主管帳號可看到待簽核。
7. 主管可下載申請附件。
8. 主管可上傳本關附件並核准。
9. 下一關可看到前一關備註與附件。
10. 正式資料與測試資料不混用。

## 截圖素材

目前草稿截圖位置：

```text
docs/app-store-screenshots/01-login.png
docs/app-store-screenshots/02-module-hub.png
docs/app-store-screenshots/03-dashboard.png
docs/app-store-screenshots/04-new-application.png
docs/app-store-screenshots/05-expense-form.png
docs/app-store-screenshots/06-approval-management.png
```

正式送審時，建議以真機或模擬器重新截圖，避免測試資料或本機模式字樣出現在正式商店截圖。
