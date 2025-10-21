import { getDB, setDB, getSettings, setSettings, buildFieldIndex, appendEntry, deleteEntry, makeEntryId } from './db.js';

function isFormUrl(url) {
  if (typeof url !== 'string') return false;
  // Support Google Forms
  if (url.startsWith('https://docs.google.com/forms')) return true;
  // Support Taiwan Railway and High Speed Rail
  if (url.includes('railway.gov.tw') || url.includes('thsrc.com.tw')) return true;
  // Support other common form sites
  if (url.includes('forms.gle') || url.includes('typeform.com') || url.includes('survey') || url.includes('form')) return true;
  return false;
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function sendFillToTab(tabId, autoNext = false) {
  const db = await getDB();
  const index = buildFieldIndex(db);
  try {
    const messageType = autoNext ? 'FILL_WITH_AUTO_NEXT' : 'FILL_WITH_INDEX';
    const result = await chrome.tabs.sendMessage(tabId, { type: messageType, index });
    return result;
  } catch (e) {
    // content script may not be ready yet
    return { ok: false, error: '無法連接到此頁面' };
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  if (settings.autorun == null) await setSettings({ autorun: false });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'POPUP_REQUEST_STATE': {
        const [db, settings] = await Promise.all([getDB(), getSettings()]);
        sendResponse({ ok: true, entriesCount: db.entries.length, settings, entries: db.entries });
        break;
      }
      case 'POPUP_TOGGLE_AUTORUN': {
        const settings = await getSettings();
        const newSettings = { ...settings, autorun: Boolean(message.autorun) };
        await setSettings(newSettings);
        sendResponse({ ok: true, settings: newSettings });
        break;
      }
      case 'POPUP_TOGGLE_AUTO_NEXT': {
        const settings = await getSettings();
        const newSettings = { ...settings, autoNext: Boolean(message.autoNext) };
        await setSettings(newSettings);
        sendResponse({ ok: true, settings: newSettings });
        break;
      }
      case 'POPUP_FILL_NOW': {
        const tab = await getActiveTab();
        if (tab?.id) {
          const settings = await getSettings();
          const result = await sendFillToTab(tab.id, settings.autoNext);
          sendResponse(result || { ok: true });
        } else {
          sendResponse({ ok: false, error: '無法取得當前頁面' });
        }
        break;
      }
      case 'POPUP_CAPTURE': {
        const tab = await getActiveTab();
        if (!tab?.id) { sendResponse({ ok: false, error: 'No active tab' }); break; }
        // ask content script to capture
        let capture;
        try {
          capture = await chrome.tabs.sendMessage(tab.id, { type: 'CONTENT_CAPTURE_REQUEST' });
        } catch (e) {
          sendResponse({ ok: false, error: 'Capture failed: content not ready' });
          break;
        }
        const entry = {
          id: makeEntryId(),
          name: String(message.templateName || (capture?.formTitle || '未命名範本')),
          createdAt: Date.now(),
          sourceUrl: tab.url || '',
          sourceTitle: tab.title || '',
          fields: capture?.fields || [],
        };
        await appendEntry(entry);
        sendResponse({ ok: true, entry });
        break;
      }
      case 'POPUP_DELETE_ENTRY': {
        await deleteEntry(message.entryId);
        const db = await getDB();
        sendResponse({ ok: true, entriesCount: db.entries.length });
        break;
      }
      case 'POPUP_UPDATE_ENTRY': {
        const db = await getDB();
        const entryIndex = db.entries.findIndex(e => e.id === message.entry.id);
        if (entryIndex >= 0) {
          db.entries[entryIndex] = message.entry;
          await setDB(db);
        }
        sendResponse({ ok: true });
        break;
      }
      case 'POPUP_IMPORT_DB': {
        const imported = message.payload;
        if (!imported || !Array.isArray(imported.entries)) {
          sendResponse({ ok: false, error: 'Invalid JSON' });
          break;
        }
        // Basic sanitize: ensure ids
        imported.entries = imported.entries.map(e => ({
          id: e.id || makeEntryId(),
          name: String(e.name || '導入範本'),
          createdAt: e.createdAt || Date.now(),
          sourceUrl: String(e.sourceUrl || ''),
          sourceTitle: String(e.sourceTitle || ''),
          fields: Array.isArray(e.fields) ? e.fields : [],
        }));
        await setDB({ entries: imported.entries });
        if (imported.settings) await setSettings(imported.settings);
        const [db, settings] = await Promise.all([getDB(), getSettings()]);
        sendResponse({ ok: true, entriesCount: db.entries.length, settings });
        break;
      }
      case 'POPUP_EXPORT_DB': {
        const [db, settings] = await Promise.all([getDB(), getSettings()]);
        sendResponse({ ok: true, payload: { entries: db.entries, settings } });
        break;
      }
      default:
        sendResponse({ ok: false, error: 'Unknown message' });
    }
  })();
  return true; // keep the channel open for async sendResponse
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && isFormUrl(tab?.url)) {
    const settings = await getSettings();
    if (settings.autorun) {
      await sendFillToTab(tabId, settings.autoNext);
    }
  }
});
