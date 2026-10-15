---
version: alpha
name: "歲悅 Finance"
description: "供內部員工辦理申請、簽核與帳務的繁體中文工作介面"
colors:
  primary: "#ea880c"
  primaryText: "#5c3800"
  background: "#fdf8f2"
  surface: "#ffffff"
  warm: "#f8f0e4"
  success: "#2a6010"
  warning: "#7a4500"
  danger: "#8a1010"
typography:
  sans:
    fontFamily: '"PingFang TC", "Microsoft JhengHei", "Noto Sans TC", sans-serif'
  mono:
    fontFamily: '"PingFang TC", "Microsoft JhengHei", "Noto Sans TC", sans-serif'
rounded:
  DEFAULT: "12px"
  control: "10px"
  badge: "6px"
spacing:
  controlTarget: "44px"
components:
  personnelList: {}
  personnelDetail: {}
  historyList: {}
---

# 歲悅 Finance 設計依據

## Overview

2026-10-12 使用者核准人員管理「精簡列表＋右側明細」示意。這份文件記錄已核准的介面方向與現有 token 來源，不重新定義未改動的財務流程。

主要讀者是人資、主管與會計；常見任務是找人、核對登入帳號、調整同一人的資料、查找本人申請或曾參與的單據。介面採繁體中文，日期遵循既有臺灣業務時區。

Runtime token owner 是 `assets/styles/finance-core.css` 的 `:root`。本文件鏡映這些值；新的人員樣式透過 `var(--br)`、`var(--font-sans)` 等延伸，不能另建全站配色。

## Colors

主操作保留亮橘色；白底列表配細邊線，避免大量深色框與同列重複大色塊。綠色表示已完成或啟用，黃色表示等待與需核對，紅色表示危險操作或失敗。每一種狀態都有文字，不能只靠顏色。

## Typography

沿用現有 `--font-sans`。姓名及重點使用適度字重，次要文字仍須清楚可讀。登入信箱、部門代碼在寬版保持完整；窄版優先換成卡片，再按語義換行。數字沿用 tabular-nums，不另換不支援中文的字體。

2026-10-15 核准整批表單短號：繳費批次 `B2609-003`、發票批次 `I2609-003`。清單短號維持同一行及原有字體，以點狀底線表示可複製完整編號；明細另列可換行的完整編號。樣式 owner 為 `finance-core.css` 的 `.finance-batch-*`，使用既有品牌與字體 token，不改其他單號或列表欄寬。

## Layout

人員列表五欄：人員／職稱、公司／部門、系統權限、帳號狀態、操作。登入信箱附在人員格；完整法人、組織聯絡信箱、分機與來源放在明細。聯絡與登入信箱不同時，列表保留差異提示。

搜尋、公司與權限篩選只提供一套；條件變更從第一頁重新顯示。每頁最多 20 個帳號，具名人員和系統帳號分開計數。手機使用卡片，不能把整張桌機表格縮小塞入畫面。

歷史搜尋保留輸入、頁碼和捲動位置。正在更新的舊結果必須清楚標示並禁止開啟舊明細；收到符合目前查詢與身分的完整回應後才替換結果。

## Elevation & Depth

一般列表靠留白與邊线分組。右側明細與更多操作屬原生 dialog top layer，陰影只服務於遮罩層級；不能依靠任意 z-index 穿過卡片。

## Shapes

控制元件保持既有圓角語言；操作觸控區至少 44px。部門代碼為小型標籤，整個代碼不得拆行。

## Components

新元件 owner：`assets/engines/personnel-workspace.js` 與 `assets/styles/personnel-workspace.css`。它們透過 callback 接入原有人員編輯、登入檢查、啟用、交接及刪除。登入驗證與權限的來源仍為現有後端與頁面 guard。

每列主操作只有編輯與更多。管理工具集中收合但入口可見；重要異常摘要仍可見。危險操作與主要安全操作分開；不以縮減畫面為理由刪掉業務能力。

## Do's and Don'ts

- 啟用狀態和 Google 綁定狀態分開；啟用不代表已驗證能登入。
- 職稱與系統權限分開，不能用名稱推定權限。
- 新人接替職務須新增人員後交接，保留原人員識別碼及過往簽核歷史。
- 不新增持久的私人搜尋結果快取；登入或權限變更立即清除舊身分畫面。
- 不把搜尋錯誤當成 0 筆、不把未取得的附件當作已保存。
