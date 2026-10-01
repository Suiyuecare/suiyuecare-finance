---
version: alpha
name: "歲悅財務工作台"
description: "以暖色紙面與清楚的會計狀態，支援長照團隊每天快速而可信地完成財務工作。"
colors:
  primary: "#b45309"
  accent: "#ea880c"
  paper: "#fff9f2"
  surface: "#ffffff"
  ink: "#2f2a26"
  muted: "#6e6259"
  line: "#f1cfa8"
  success: "#1a5010"
  danger: "#8a1010"
typography:
  sans:
    fontFamily: '"PingFang TC","Microsoft JhengHei","Noto Sans TC",sans-serif'
  numeric:
    fontFamily: '"PingFang TC","Microsoft JhengHei","Noto Sans TC",sans-serif'
omitted:
  - section: spacing
    reason: "既有表單、清單與報表的間距尚未統一為可生成的全域 token。"
  - section: rounded
    reason: "既有卡片與控制項有多個已發布尺寸；此批先維護共用元件，不臆造全域圓角尺度。"
components:
  primary-button:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
  brand-mark:
    backgroundColor: "{colors.accent}"
  page:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
  muted-text:
    textColor: "{colors.muted}"
  card:
    backgroundColor: "{colors.surface}"
  divider:
    backgroundColor: "{colors.line}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
  success-label:
    textColor: "{colors.success}"
  danger-label:
    textColor: "{colors.danger}"
---

# 歲悅財務工作台設計系統

## Overview

這是需要快速判讀、補件、簽核和查帳的內部工作產品。目標是讓下一個動作像熟悉的手機工具一樣明確、反應即時；畫面仍保有歲悅既有的暖色紙面與橘色識別，不模仿其他品牌外觀。使用者包含申請人、主管、出納、會計和執行長，主要語言為繁體中文，常在桌機處理密集明細，也會用手機查看待辦或送件。

介面的記憶點是溫暖、可信的財務工作區；簽核結果、金額、附件與錯誤回復必須比裝飾更醒目。避免滿頁等寬卡片、僅靠顏色表達狀態、橘色小字配亮橘底，或以動畫掩蓋真正的等待。正式業務及權限以 [README.md](README.md)、[員工可靠性契約](docs/finance-employee-reliability.md) 和各模組伺服器契約為準。

現有 `assets/styles/finance-core.css` 的 `:root` 與共用選擇器是**執行時 token 的唯一來源**；本文件鏡射已接受的語意角色與精確色值，不產生第二份 CSS。改動共用 token 時，同一提交須更新 CSS、本文件和相關畫面驗收。局部品牌橘 `accent` 不自動等於白字按鈕底色。

## Colors

`primary` 是白字主要按鈕與選取頁籤使用的深橘；`accent` 用於識別、圖示與低密度裝飾。紙面 `paper` 和白色 `surface` 以邊線分層，文字以 `ink`／`muted` 維持可讀。成功、警示與危險狀態除顏色外必須有文字或圖示。小字和控制項文字對比至少 4.5:1；有焦點的控制項要有可見外框。

正式金額、暫編金額、核對中與來源失敗使用不同文字狀態；未知值不能以綠色、0 元或已完成造假。圖表亦提供數值與來源文字。

## Typography

繁體中文以既有 `--font-sans` 字族顯示，數字採等寬數字特性以利表格對齊；不以 9px 微字承載重要流程資訊。表單標籤、狀態及操作名稱應短而完整；長單號與姓名保留可查閱全文的方式，不以僅靠 hover 的省略號隱藏。

## Layout

桌面以左側導覽、頁面標題及可掃讀表格為主；手機先呈現目的、金額、目前關卡與下一動作，附屬明細再展開。資料表可以在**表格容器內**橫向捲動，不能讓整頁溢出。窄螢幕的主要觸控目標至少 44px。載入前後保留標題、篩選與操作的穩定位置，避免結果出現時版面跳動。

## Elevation & Depth

以白色表面、暖色邊線和少量陰影分出層次；陰影不表示已送出或已保存。對話框、錯誤與關鍵決策以清楚邊界和焦點順序呈現。報表數字與憑證不加裝飾性陰影，以維持查帳密度。

## Shapes

沿用既有圓角按鈕與卡片；同一類控制項保持一致的高度和外框。附件、傳票與風險標籤的形狀是輔助分類，必須附帶可讀文字。

## Components

主要動作使用深橘底白字，次要動作使用白底深色字；危險動作另以清楚動詞及確認範圍區分。hover、`:focus-visible`、按下、停用、處理中與錯誤狀態應保持相同幾何尺寸，避免按鈕位移。搜尋在中文組字時不執行查詢，清除立即；上傳區分已選檔、保存中、已確認保存與待確認結果。載入中先顯示最後確認的資料和更新標示；失敗保留既有安全資料與重試入口。

導覽與清單優先顯示使用者當下可做的事。圖示不是唯一標籤；狀態徽章保留文字。介面動畫只用於說明狀態轉換，遵守減少動態效果偏好，不以無限旋轉代替長工作的可恢復說明。金額、日期、法人、部門與資料截至時間採一致的繁體中文格式。

## Do's and Don'ts

- **Do:** 先展示已確認且有權檢視的內容，讓背景更新不阻擋輸入。
- **Do:** 讓「已選取、正在保存、已保存、結果待確認」各有真實而可恢復的文案。
- **Don't:** 因為網路逾時就顯示 0 筆、完成或送件失敗。
- **Don't:** 讓暖橘色裝飾搶走流程、金額、證據和下一動作的視覺優先權。
