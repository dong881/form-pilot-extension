已為你建立 Chrome MV3 擴充功能「Form Pilot」：
- 支援在 Google 表單以模糊搜尋自動填寫（單行文字、長答案、單選、複選、下拉）
- 可擷取目前表單成為範本並儲存到本機資料庫
- 內建 JSON 匯入與匯出，可跨電腦移轉
- 提供現代、簡潔的深色系 Popup 介面與「自動套用」開關

安裝方式：在 Chrome 的「擴充功能」→ 開發人員模式 → 載入未封裝項目，選擇 `extension/` 目錄。

檔案位置：
- `extension/manifest.json`、`background.js`、`content.js`、`db.js`、`popup.*`
- 使用說明與細節見 `extension/README.md`

如需加上更多匹配規則或特定欄位的強制映射（例如將「手機」視為「電話」），我可以再擴充對應表與自訂規則。