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

async function refreshState() {
  const res = await chrome.runtime.sendMessage({ type: 'POPUP_REQUEST_STATE' });
  if (!res?.ok) return;
  const { settings, entries } = res;
  $('#autorunToggle').checked = Boolean(settings.autorun);
  renderEntries(entries || []);
}

function renderEntries(entries) {
  const list = $('#entryList');
  list.innerHTML = '';
  for (const e of entries) {
    const li = document.createElement('li');
    li.className = 'entry';
    li.innerHTML = `
      <div class="meta">
        <span class="name">${escapeHtml(e.name || '未命名')}</span>
        <span>${formatDate(e.createdAt || Date.now())}</span>
      </div>
      <div class="meta">
        <span class="muted">${escapeHtml(e.sourceTitle || '')}</span>
        <span class="muted">${escapeHtml(e.sourceUrl || '')}</span>
      </div>
      <div class="actions">
        <button class="btn" data-action="apply" data-id="${e.id}">套用此範本</button>
        <button class="btn danger" data-action="delete" data-id="${e.id}">刪除</button>
      </div>
    `;
    list.appendChild(li);
  }
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
    await chrome.runtime.sendMessage({ type: 'POPUP_TOGGLE_AUTORUN', autorun: checked });
    setStatus(checked ? '自動套用：開啟' : '自動套用：關閉');
  });

  $('#fillNow').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'POPUP_FILL_NOW' });
    setStatus('已嘗試套用此頁表單');
  });

  $('#capture').addEventListener('click', async () => {
    const name = prompt('請輸入此範本名稱（可留空自動）');
    const res = await chrome.runtime.sendMessage({ type: 'POPUP_CAPTURE', templateName: name });
    if (res?.ok) {
      setStatus('已擷取並儲存範本');
      await refreshState();
    } else {
      setStatus('擷取失敗：' + (res?.error || '未知錯誤'));
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
            try { await chrome.tabs.sendMessage(tab.id, { type: 'FILL_WITH_INDEX', index }); } catch (e) {}
          }
        }
      }
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
}

(async function init() {
  await refreshState();
  wireEvents();
})();
