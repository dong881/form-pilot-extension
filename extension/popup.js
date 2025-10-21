import { getDB, setDB, getSettings, setSettings, appendEntry, deleteEntry } from './db.js';

function $(sel) { return document.querySelector(sel); }
function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

function formatDate(ms) {
  const d = new Date(ms);
  return d.toLocaleString();
}

function setStatus(msg) {
  const el = $('#status');
  if (el) el.textContent = msg || '';
}

function showError(msg) {
  setStatus('❌ ' + msg);
  // Auto-hide error after 5 seconds
  setTimeout(() => setStatus(''), 5000);
}

function showSuccess(msg) {
  setStatus('✅ ' + msg);
  // Auto-hide success after 3 seconds
  setTimeout(() => setStatus(''), 3000);
}

let currentEditingEntry = null;

async function openTemplateEditor(entryId) {
  const res = await chrome.runtime.sendMessage({ type: 'POPUP_REQUEST_STATE' });
  if (!res?.ok) return;
  
  const entry = (res.entries || []).find(x => x.id === entryId);
  if (!entry) return;
  
  currentEditingEntry = entry;
  const editor = $('#templateEditor');
  const fieldsContainer = $('#editorFields');
  
  fieldsContainer.innerHTML = `
    <div class="editor-field">
      <label>範本名稱</label>
      <input type="text" id="templateName" value="${escapeHtml(entry.name)}" />
    </div>
  `;
  
  // Add field editors
  for (let i = 0; i < (entry.fields || []).length; i++) {
    const field = entry.fields[i];
    const fieldDiv = document.createElement('div');
    fieldDiv.className = 'editor-field';
    fieldDiv.innerHTML = `
      <label>欄位 ${i + 1}: ${escapeHtml(field.label)} (${field.type})</label>
      <input type="text" data-field-index="${i}" data-field-property="label" value="${escapeHtml(field.label)}" />
      <input type="text" data-field-index="${i}" data-field-property="values" value="${escapeHtml((field.values || []).join(', '))}" placeholder="多個值用逗號分隔" />
    `;
    fieldsContainer.appendChild(fieldDiv);
  }
  
  editor.classList.add('show');
}

function closeTemplateEditor() {
  $('#templateEditor').classList.remove('show');
  currentEditingEntry = null;
}

async function saveTemplate() {
  if (!currentEditingEntry) return;
  
  const name = $('#templateName').value;
  const fieldInputs = $all('#editorFields input[data-field-index]');
  
  // Update entry
  currentEditingEntry.name = name;
  
  // Update fields
  const fieldMap = new Map();
  for (const input of fieldInputs) {
    const index = input.getAttribute('data-field-index');
    const property = input.getAttribute('data-field-property');
    
    if (!fieldMap.has(index)) {
      fieldMap.set(index, {});
    }
    
    const field = fieldMap.get(index);
    if (property === 'values') {
      field.values = input.value.split(',').map(v => v.trim()).filter(Boolean);
    } else {
      field[property] = input.value;
    }
  }
  
  // Update the entry fields
  currentEditingEntry.fields = Array.from(fieldMap.values());
  
  // Save to storage
  await chrome.runtime.sendMessage({ 
    type: 'POPUP_UPDATE_ENTRY', 
    entry: currentEditingEntry 
  });
  
  showSuccess('範本已更新');
  closeTemplateEditor();
  await refreshState();
}

async function refreshState() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'POPUP_REQUEST_STATE' });
    if (!res?.ok) {
      showError('無法連接到擴充元件，請重新載入頁面');
      return;
    }
    const { settings, entries } = res;
    $('#autorunToggle').checked = Boolean(settings.autorun);
    $('#autoNextToggle').checked = Boolean(settings.autoNext);
    renderEntries(entries || []);
  } catch (error) {
    showError('擴充元件發生錯誤，請重新載入頁面後再試');
    console.error('Extension error:', error);
  }
}

function renderEntries(entries) {
  const list = $('#entryList');
  list.innerHTML = '';
  
  if (entries.length === 0) {
    const li = document.createElement('li');
    li.className = 'entry';
    li.innerHTML = `
      <div class="meta">
        <span class="name" style="color: var(--muted); font-style: italic;">尚無範本</span>
        <span class="muted">點擊「擷取此表單為範本」來建立第一個範本</span>
      </div>
    `;
    list.appendChild(li);
    return;
  }
  
  for (const e of entries) {
    const li = document.createElement('li');
    li.className = 'entry';
    
    // Truncate long text to prevent layout issues
    const name = truncateText(escapeHtml(e.name || '未命名'), 30);
    const sourceTitle = truncateText(escapeHtml(e.sourceTitle || ''), 40);
    const sourceUrl = truncateText(escapeHtml(e.sourceUrl || ''), 50);
    const date = formatDate(e.createdAt || Date.now());
    
    li.innerHTML = `
      <div class="meta">
        <span class="name" title="${escapeHtml(e.name || '未命名')}">${name}</span>
        <span class="date">${date}</span>
      </div>
      ${sourceTitle ? `<div class="meta"><span class="muted" title="${escapeHtml(e.sourceTitle || '')}">${sourceTitle}</span></div>` : ''}
      ${sourceUrl ? `<div class="meta"><span class="muted" title="${escapeHtml(e.sourceUrl || '')}">${sourceUrl}</span></div>` : ''}
      <div class="actions">
        <button class="btn" data-action="apply" data-id="${e.id}">套用此範本</button>
        <button class="btn" data-action="edit" data-id="${e.id}">編輯</button>
        <button class="btn danger" data-action="delete" data-id="${e.id}">刪除</button>
      </div>
    `;
    list.appendChild(li);
  }
}

function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

function escapeHtml(str) {
  return ('' + (str || ''))
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function wireEvents() {
  $('#autorunToggle').addEventListener('change', async (e) => {
    const checked = e.target.checked;
    try {
      await chrome.runtime.sendMessage({ type: 'POPUP_TOGGLE_AUTORUN', autorun: checked });
      showSuccess(checked ? '自動套用：開啟' : '自動套用：關閉');
    } catch (error) {
      showError('設定失敗，請重新載入頁面');
    }
  });

  $('#autoNextToggle').addEventListener('change', async (e) => {
    const checked = e.target.checked;
    try {
      await chrome.runtime.sendMessage({ type: 'POPUP_TOGGLE_AUTO_NEXT', autoNext: checked });
      showSuccess(checked ? '自動下一步：開啟' : '自動下一步：關閉');
    } catch (error) {
      showError('設定失敗，請重新載入頁面');
    }
  });

  $('#fillNow').addEventListener('click', async () => {
    try {
      const result = await chrome.runtime.sendMessage({ type: 'POPUP_FILL_NOW' });
      if (result?.ok) {
        showSuccess(`成功填寫 ${result.filledCount || 0} 個欄位`);
      } else {
        showError(result?.error || '填寫失敗');
      }
    } catch (error) {
      showError('套用失敗，請確認此網站支援表單自動填寫');
    }
  });

  $('#capture').addEventListener('click', async () => {
    const name = prompt('請輸入此範本名稱（可留空自動）');
    try {
      const res = await chrome.runtime.sendMessage({ type: 'POPUP_CAPTURE', templateName: name });
      if (res?.ok) {
        showSuccess('已擷取並儲存範本');
        await refreshState();
      } else {
        showError('擷取失敗：' + (res?.error || '未知錯誤'));
      }
    } catch (error) {
      showError('擷取失敗，請確認此網站支援表單擷取功能');
    }
  });

  $('#entryList').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const action = btn.getAttribute('data-action');
    if (action === 'apply') {
      // Applying a specific entry: build a minimal index and send to content
      const res = await chrome.runtime.sendMessage({ type: 'POPUP_REQUEST_STATE' });
      if (res?.ok) {
        const entry = (res.entries || []).find(x => x.id === id);
        if (entry) {
          const index = { text: [], paragraph: [], radio: [], checkbox: [], dropdown: [] };
          for (const f of entry.fields || []) {
            const values = Array.isArray(f.values) ? f.values : (f.value != null ? [String(f.value)] : []);
            index[f.type] = index[f.type] || [];
            index[f.type].push({ label: String(f.label || ''), labelNorm: null, type: f.type, values, valuesNorm: null });
          }
          // send directly to current tab content script
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.id) {
            try { 
              const settings = await chrome.runtime.sendMessage({ type: 'POPUP_REQUEST_STATE' });
              const messageType = settings?.settings?.autoNext ? 'FILL_WITH_AUTO_NEXT' : 'FILL_WITH_INDEX';
              const result = await chrome.tabs.sendMessage(tab.id, { type: messageType, index });
              if (result?.ok) {
                showSuccess(`成功填寫 ${result.filledCount || 0} 個欄位`);
              } else {
                showError(result?.error || '填寫失敗');
              }
            } catch (e) {
              showError('無法連接到此頁面，請重新載入頁面後再試');
            }
          }
        }
      }
    } else if (action === 'edit') {
      await openTemplateEditor(id);
    } else if (action === 'delete') {
      if (!confirm('確定要刪除此範本嗎？')) return;
      await chrome.runtime.sendMessage({ type: 'POPUP_DELETE_ENTRY', entryId: id });
      setStatus('已刪除範本');
      await refreshState();
    }
  });

  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await chrome.runtime.sendMessage({ type: 'POPUP_IMPORT_DB', payload: json });
      if (res?.ok) {
        setStatus('已匯入資料庫');
        await refreshState();
      } else {
        setStatus('匯入失敗：' + (res?.error || '未知錯誤'));
      }
    } catch (err) {
      setStatus('匯入失敗：JSON 解析錯誤');
    } finally {
      e.target.value = '';
    }
  });

  $('#exportBtn').addEventListener('click', async () => {
    const res = await chrome.runtime.sendMessage({ type: 'POPUP_EXPORT_DB' });
    if (!res?.ok) return;
    const blob = new Blob([JSON.stringify(res.payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'form-pilot-db.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  // Template editor events
  $('#saveTemplate').addEventListener('click', saveTemplate);
  $('#cancelEdit').addEventListener('click', closeTemplateEditor);
  
  // Close editor when clicking outside
  $('#templateEditor').addEventListener('click', (e) => {
    if (e.target === $('#templateEditor')) {
      closeTemplateEditor();
    }
  });
}

(async function init() {
  await refreshState();
  wireEvents();
})();
