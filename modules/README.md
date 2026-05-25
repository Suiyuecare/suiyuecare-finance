# 歲悅集團模組整合

此資料夾用來收斂原本分散的系統模組原始碼，讓 GitHub 逐步回到 `module-finance` 作為集團營運主 repo。

## 目前模組

- `hr/`：Module_HR 可維護原始碼、Supabase migration、public assets 與 scripts。

## 整合原則

1. 不提交 `node_modules`、`.next`、`.git`、`.vercel` 等本機或部署產物。
2. Supabase 以 Finance production project 為主資料庫，HR 的共用核心資料表已同步到同一個 project。
3. Vercel 目前仍以 Finance 靜態網站與 HR Next app 分別部署，Finance 主入口已可導向 HR；完整單一 runtime 需要下一階段架構調整。
4. HR 與 Finance 共用人員、部門、法人、角色與組織圖資料，避免兩邊資料不一致。
