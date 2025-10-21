import { getDB, setDB, getSettings, setSettings, buildFieldIndex, appendEntry, deleteEntry, makeEntryId } from './db.js';

function isGoogleFormUrl(url) {
  return typeof url === 'string' && url.startsWith('https://docs.google.com/forms');
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function sendFillToTab(tabId) {
  const db = await getDB();
  const index = buildFieldIndex(db);
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'FILL_WITH_INDEX', index });
  } catch (e) {
    // content script may not be ready yet
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
      case 'POPUP_FILL_NOW': {
        const tab = await getActiveTab();
        if (tab?.id) await sendFillToTab(tab.id);
        sendResponse({ ok: true });
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
  if (changeInfo.status === 'complete' && isGoogleFormUrl(tab?.url)) {
    const settings = await getSettings();
    if (settings.autorun) {
      await sendFillToTab(tabId);
    }
  }
});
