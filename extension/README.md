# Form Pilot：Google 表單自動填寫（Chrome MV3 擴充功能）

一鍵在本機安裝、可離線使用的 Google 表單自動填寫工具。支援模糊搜尋題目標題並自動套用預先儲存的答案；支援勾選多選題的記憶；內建本機資料庫，可匯出/匯入到其他電腦。

## 功能特色
- 模糊匹配：題目標題以 Jaccard/LCS/包含度混合分數計算，選擇最高分答案
- 題型支援：單行文字、長答案、單選、複選、下拉選單
- 一鍵套用：在表單頁面中自動填入最相近的答案
- 範本擷取：將目前已填好的表單擷取為範本並儲存
- 匯入/匯出：透過 JSON 檔在不同電腦間移轉資料庫
- 自動套用：開啟後，載入 Google 表單頁即自動嘗試套用
- 現代 UI：簡潔深色風格的彈出視窗（Popup）

## 安裝方式（開發者模式，一鍵本地套用）
1. 下載或複製本專案到本機。
2. 開啟 Chrome → 進入「擴充功能」頁（`chrome://extensions`）。
3. 右上角開啟「開發人員模式」。
4. 點選「載入未封裝項目」，選擇 `extension/` 目錄。
5. 於任一 Google 表單頁開啟擴充功能彈出視窗，即可使用。

> 若更新程式碼後 UI 沒改變，請在擴充功能頁面按「重新載入」。

## 使用教學
- 套用答案
  - 方式 A：在 Google 表單頁開啟彈出視窗，點按「一鍵填寫」。
  - 方式 B：開啟「自動套用」切換，之後每次載入表單頁會自動嘗試套用。
- 擷取範本
  - 先在表單頁填入你想保存的答案，打開彈出視窗按「擷取此表單為範本」。
- 管理範本
  - 在彈出視窗的「範本」列表可直接「套用此範本」或「刪除」。
- 匯入/匯出
  - 彈出視窗內可匯出整個資料庫為 JSON 檔，或匯入他人提供的 JSON。

## 檔案結構
```
extension/
  ├─ manifest.json        # MV3 設定
  ├─ background.js        # 背景 Service Worker：狀態、匯入/匯出、指令分派
  ├─ content.js           # 內容腳本：解析/填入 Google 表單、擷取
  ├─ db.js                # 本機資料庫與相似度工具
  ├─ fuzzy.js             # 額外相似度工具（可供 UI 使用）
  ├─ popup.html           # 彈出視窗 UI
  ├─ popup.css            # 現代深色風格樣式
  └─ popup.js             # 彈出視窗互動邏輯
```

## 資料庫格式（JSON）
```json
{
  "entries": [
    {
      "id": "uuid",
      "name": "範本名稱",
      "createdAt": 1710000000000,
      "sourceUrl": "https://docs.google.com/forms/...",
      "sourceTitle": "表單標題",
      "fields": [
        { "label": "姓名", "type": "text", "values": ["王小明"] },
        { "label": "心得", "type": "paragraph", "values": ["...長答案..."] },
        { "label": "選擇一項", "type": "radio", "values": ["A"] },
        { "label": "多選題", "type": "checkbox", "values": ["X", "Y"] },
        { "label": "下拉", "type": "dropdown", "values": ["選項2"] }
      ]
    }
  ],
  "settings": { "autorun": true }
}
```

## 隱私與範圍
- 僅在 `docs.google.com/forms` 頁面運作，不會存取其他網站
- 所有資料僅儲存在本機 `chrome.storage.local`，除非手動匯出

## 已知限制與注意事項
- 不同表單的題目描述差異過大時，模糊比對可能不準確
- 下拉選單的清單載入需要短暫時間，偶爾會漏選；再次點擊「一鍵填寫」通常可解決
- 若 Google 表單 DOM 結構大幅改版，可能需要更新擴充功能的選擇器

## 開發筆記
- 相似度分數：`score = 0.5*Jaccard + 0.3*LCS + 0.2*包含度`，阈值約 0.35
- 內容腳本盡量使用 role/aria 選擇器以降低脆弱性
- 資料庫與設定儲存在 `chrome.storage.local`，可搭配 JSON 匯出/匯入

## 授權
MIT
