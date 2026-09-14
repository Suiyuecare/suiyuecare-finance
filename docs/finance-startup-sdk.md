# 固定同站 Supabase SDK

本次保持既有 `@supabase/supabase-js@2.111.0`、Auth API、同步執行順序與前端來源 HTML 的 CDN 宣告。建置才把該唯一宣告改成同站固定版本；不在部署時下載依賴，也不自動升版。

## 來源與封存

- 官方 npm tarball：<https://registry.npmjs.org/@supabase/supabase-js/-/supabase-js-2.111.0.tgz>。取得後先以 registry 的 `dist.integrity` SHA-512 驗證，再擷取 `package/dist/umd/supabase.js` 與 `package/LICENSE`，不修改官方內容。
- UMD：210,547 bytes，SHA-256 `7396012594aa6d23bb373ebc25d1080bf3672fa847c3713f756520b40fd13453`。原 jsDelivr 回應恰好多 292 bytes 的產生器註解，之後的執行程式與官方 UMD 完全相同。
- `assets/vendor/supabase-js-2.111.0.{umd.js,LICENSE,provenance.json}` 保存官方程式、MIT 授權與來源／完整性記錄；三檔均納入 release source manifest 與受保護候選的 release-tools。
- 產出 `assets/supabase-js-2.111.0-7396012594aa6d23.js`，head preload 與 body 同步 script 必須指向同一檔。主 IIFE 仍在 SDK 之後執行，`window.supabase` 介面不變。
- build/source gate 固定 UMD 與 LICENSE SHA；檔案遺失、字節改變、來源版本漂移或 script 重複均拒絕建置。artifact gate 再把實際輸出字節與固定來源逐一比較。
- 新增兩種內容雜湊檔名的 immutable Cache-Control；不改首頁與 HTML 的 no-store，也不替 release manifest 新增快取。

官方依據：[Supabase JavaScript 安裝](https://supabase.com/docs/reference/javascript/installing)、[2.111.0 LICENSE](https://raw.githubusercontent.com/supabase/supabase-js/v2.111.0/LICENSE)、[Vercel headers 設定](https://vercel.com/docs/project-configuration/vercel-json#headers)。

## 驗證與測量

```sh
node scripts/check_startup_sdk.cjs
FINANCE_BUILD_TARGET=local node scripts/build_www.js
node scripts/check_startup_bundle_browser.cjs
node scripts/check_startup_bundle_browser.cjs --measure
```

Node 測試執行真 UMD 的 `createClient`、`getSession`、Google OAuth URL 產生（`skipBrowserRedirect:true`），禁止任何真網路與 WebSocket；亦測缺檔／竄改拒絕及三種 build target 的順序。真 built browser 驗實際 HTTP SDK hash、單次請求、外部 bootstrap script 為零、Google 按鈕的虛構 DNS 失敗可重試，以及十頁導航。

2026-09-14，390px、150ms RTT、4Mbps、CPU4倍降速、冷快取且服務端 no-store；指標是登入區可見且 `googleLogin` 已可呼叫，不是僅首屏 paint：

| 樣本 | 三次登入就緒秒數 | 判讀 |
|---|---|---|
| 最初整合版／背景工作並行 | 2.612 / 2.358 / **7.996** | 原始證據沒有 resource trace，不能斷定 7.996 秒原因，不能丟棄該樣本 |
| 原 CDN／背景下載尚未結束、有 CDP trace | **3.821** / 2.366 / 2.346 | 第一次 HTML 2.083 秒完成、engine 1.220 秒完成，SDK 3.663 秒才完成；其後主程式長任務僅 118ms，可確認此樣本卡在 CDN DNS／連線／TLS／回應 |
| 原 CDN／其他下載與 PG 工作已停止 | 2.356 / 2.369 / 2.335 | 乾淨基準 |
| 同站固定 SDK／同樣乾淨條件 | 2.348 / 2.355 / 2.363 | SDK 在 0.664–0.717 秒完成；三次皆無外部 bootstrap script，功能及 hash 檢查通過 |

此修改消除登入前對另一個 CDN 的 DNS／TLS／可用性依賴；乾淨樣本的整體中位數沒有顯著加速，不能承諾所有真實設備及網路皆低於三秒。HTML 下載仍約佔兩秒，後續另行評估，不以縮短 timeout 或只換 loading 畫面宣稱加速。

完整樣本與逐資源紀錄保存於 `/tmp/finance-startup-diagnostic-20260914/`，包含原 7.996 秒樣本、`background-network`、`clean-cdn`、`clean-same-origin`。部署後仍需核對實際 manifest、SDK HTTP hash 與 cache headers；本機測試不等於已發布。
