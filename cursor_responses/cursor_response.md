# 修復自動下一步和範本填寫問題

## 問題分析

經過代碼分析，發現了兩個主要問題：

### 1. 編輯過的範本無法自動填入
**根本原因**：在 `popup.js` 中，當直接套用範本時，`labelNorm` 和 `valuesNorm` 被設為 `null`，導致相似度匹配失敗。

**修復方案**：
- 在 `popup.js` 中導入 `normalizeText` 函數
- 修正範本套用時的索引建立邏輯，正確計算 `labelNorm` 和 `valuesNorm`

### 2. 自動下一步功能失效
**根本原因**：按鈕檢測邏輯可能存在問題，需要增強按鈕選擇器的覆蓋範圍和調試信息。

**修復方案**：
- 擴展按鈕選擇器，包含更多類型的可點擊元素
- 增加調試日誌，幫助識別按鈕檢測問題
- 改善按鈕點擊前的可見性檢查

## 已實施的修復

### 1. 修復範本填寫問題
```javascript
// 在 popup.js 中修正範本套用邏輯
for (const f of entry.fields || []) {
  const values = Array.isArray(f.values) ? f.values : (f.value != null ? [String(f.value)] : []);
  const label = String(f.label || '');
  const labelNorm = normalizeText(label);  // 正確計算 labelNorm
  const valuesNorm = values.map(v => normalizeText(v));  // 正確計算 valuesNorm
  index[f.type] = index[f.type] || [];
  index[f.type].push({ label, labelNorm, type: f.type, values, valuesNorm });
}
```

### 2. 修復自動下一步功能
```javascript
// 擴展按鈕選擇器
const allButtons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"], a[role="button"], div[role="button"]'));

// 增加調試信息
console.log(`Found ${allButtons.length} total buttons, ${validButtons.length} valid buttons`);
if (validButtons.length > 0) {
  console.log('Top 3 button candidates:', validButtons.slice(0, 3).map(b => ({ text: b.text, score: b.score })));
}

// 改善按鈕點擊檢查
const rect = button.getBoundingClientRect();
if (rect.width > 0 && rect.height > 0) {
  button.click();
  return true;
}
```

### 3. 增加調試功能
- 為範本匹配添加詳細的調試日誌
- 為自動下一步功能添加狀態追蹤
- 改善錯誤處理和用戶反饋

## 預期效果

修復後，以下功能應該正常運作：

1. **編輯過的範本**：現在可以正確進行相似度匹配，自動填入表單欄位
2. **自動下一步**：增強了按鈕檢測能力，應該能夠自動點擊「下一步」按鈕
3. **調試能力**：增加了詳細的日誌輸出，便於排查問題

## 測試建議

1. 建立一個範本並進行編輯
2. 在支援的表單網站上測試範本套用功能
3. 確認自動下一步功能是否正常運作
4. 檢查瀏覽器控制台的調試信息

這些修復應該解決您提到的兩個主要問題。