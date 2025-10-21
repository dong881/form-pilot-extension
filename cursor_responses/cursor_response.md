# 擴充功能載入問題修復

## 問題描述
無法載入擴充功能，錯誤訊息：
```
Could not load icon 'icon-16.png' specified in 'icons'.
無法載入資訊清單。
```

## 問題分析
擴充功能的 `manifest.json` 檔案中指定了 PNG 圖示檔案（icon-16.png, icon-32.png, icon-48.png, icon-128.png），但這些檔案不存在。只有 SVG 格式的圖示檔案（icon.svg）。

## 解決方案
1. **檢查現有檔案**：確認只有 `icon.svg` 檔案存在
2. **生成 PNG 圖示**：使用 Node.js 和 canvas 套件將 SVG 轉換為所需尺寸的 PNG 檔案
3. **驗證檔案**：確認所有必要的檔案都已正確生成

## 執行的修復步驟
1. 創建了 Node.js 轉換腳本 `convert_icons.js`
2. 安裝了 canvas 套件來處理圖像轉換
3. 成功生成了以下 PNG 檔案：
   - `icon-16.png` (16x16 像素)
   - `icon-32.png` (32x32 像素) 
   - `icon-48.png` (48x48 像素)
   - `icon-128.png` (128x128 像素)
4. 清理了臨時檔案

## 結果
擴充功能現在應該可以正常載入，因為所有在 `manifest.json` 中引用的圖示檔案都已存在。錯誤訊息應該不再出現。

## 檔案結構
```
extension/
├── manifest.json
├── icon.svg (原始 SVG 圖示)
├── icon-16.png (新生成)
├── icon-32.png (新生成)
├── icon-48.png (新生成)
├── icon-128.png (新生成)
├── background.js
├── content.js
├── popup.html
├── popup.js
├── popup.css
├── db.js
└── fuzzy.js
```