// DB utilities for Form Pilot (MV3)
export const DB_KEY = 'formPilot.db';
export const SETTINGS_KEY = 'formPilot.settings';

export async function getDB() {
  const result = await chrome.storage.local.get(DB_KEY);
  const db = result[DB_KEY];
  if (db && Array.isArray(db.entries)) return db;
  return { entries: [] };
}

export async function setDB(db) {
  await chrome.storage.local.set({ [DB_KEY]: db });
}

export async function getSettings() {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  const settings = result[SETTINGS_KEY];
  if (settings && typeof settings.autorun === 'boolean') return settings;
  return { autorun: false };
}

export async function setSettings(settings) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

export function makeEntryId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'entry_' + Date.now() + '_' + Math.random().toString(36).slice(2);
}

export async function appendEntry(entry) {
  const db = await getDB();
  db.entries.push(entry);
  await setDB(db);
}

export async function deleteEntry(entryId) {
  const db = await getDB();
  db.entries = db.entries.filter(e => e.id !== entryId);
  await setDB(db);
}

export function normalizeText(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s\u00A0]+/g, ' ')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .trim();
}

export function tokenize(str) {
  const norm = normalizeText(str);
  return new Set(norm.split(' ').filter(Boolean));
}

export function jaccardSimilarity(aSet, bSet) {
  let inter = 0;
  for (const t of aSet) if (bSet.has(t)) inter++;
  const union = aSet.size + bSet.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function lcsRatio(a, b) {
  const s1 = normalizeText(a);
  const s2 = normalizeText(b);
  const n = s1.length;
  const m = s2.length;
  if (!n || !m) return 0;
  const dp = new Array(n + 1).fill(null).map(() => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = s1[i - 1] === s2[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const lcs = dp[n][m];
  return lcs / Math.max(n, m);
}

export function containsRatio(a, b) {
  const s1 = normalizeText(a);
  const s2 = normalizeText(b);
  if (!s1 || !s2) return 0;
  const longStr = s1.length >= s2.length ? s1 : s2;
  const shortStr = s1.length < s2.length ? s1 : s2;
  const idx = longStr.indexOf(shortStr);
  if (idx === -1) return 0;
  return shortStr.length / longStr.length;
}

export function computeSimilarity(a, b) {
  const jac = jaccardSimilarity(tokenize(a), tokenize(b));
  const lcs = lcsRatio(a, b);
  const cont = containsRatio(a, b);
  return 0.5 * jac + 0.3 * lcs + 0.2 * cont;
}

// Build a type-indexed field index for quick lookups in content script
export function buildFieldIndex(db) {
  /** @type {Record<string, Array<{label:string,labelNorm:string,type:string,values:string[],valuesNorm:string[] }>>} */
  const byType = { text: [], paragraph: [], radio: [], checkbox: [], dropdown: [] };
  for (const entry of db.entries || []) {
    for (const f of entry.fields || []) {
      const label = String(f.label || '');
      const labelNorm = normalizeText(label);
      const type = f.type;
      const values = Array.isArray(f.values) ? f.values.map(v => String(v)) : (f.value != null ? [String(f.value)] : []);
      const valuesNorm = values.map(v => normalizeText(v));
      if (!byType[type]) byType[type] = [];
      byType[type].push({ label, labelNorm, type, values, valuesNorm });
    }
  }
  return byType;
}
