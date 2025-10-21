// Content script for Google Forms autofill

function normalizeText(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s\u00A0]+/g, ' ')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .trim();
}

function tokenize(str) {
  const norm = normalizeText(str);
  return new Set(norm.split(' ').filter(Boolean));
}

function jaccardSimilarity(aSet, bSet) {
  let inter = 0;
  for (const t of aSet) if (bSet.has(t)) inter++;
  const union = aSet.size + bSet.size - inter;
  return union === 0 ? 0 : inter / union;
}

function lcsRatio(a, b) {
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

function containsRatio(a, b) {
  const s1 = normalizeText(a);
  const s2 = normalizeText(b);
  if (!s1 || !s2) return 0;
  const longStr = s1.length >= s2.length ? s1 : s2;
  const shortStr = s1.length < s2.length ? s1 : s2;
  const idx = longStr.indexOf(shortStr);
  if (idx === -1) return 0;
  return shortStr.length / longStr.length;
}

function computeSimilarity(a, b) {
  const jac = jaccardSimilarity(tokenize(a), tokenize(b));
  const lcs = lcsRatio(a, b);
  const cont = containsRatio(a, b);
  return 0.5 * jac + 0.3 * lcs + 0.2 * cont;
}

function dispatchInputEvents(el) {
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function getQuestionItems() {
  const items = Array.from(document.querySelectorAll('div[role="listitem"]'));
  return items;
}

function extractTitleText(item) {
  // Prefer heading role
  const heading = item.querySelector('[role="heading"]');
  if (heading && heading.textContent?.trim()) return heading.textContent.trim();
  // Fallback: label-like spans/divs
  const candidates = item.querySelectorAll('div,span,label');
  for (const c of candidates) {
    const text = c.textContent?.trim();
    if (text && text.length > 0 && text.length < 300) {
      // Heuristic: must not be an option label or helper text
      if (!c.closest('[role="radio"]') && !c.closest('[role="checkbox"]') && !c.closest('[role="option"]')) {
        return text;
      }
    }
  }
  return '';
}

function detectType(item) {
  if (item.querySelector('textarea')) return 'paragraph';
  if (item.querySelector('input[type="text"], input[type="email"], input[type="tel"], input[type="url"]')) return 'text';
  if (item.querySelector('[role="radiogroup"], [role="radio"]')) return 'radio';
  if (item.querySelector('[role="group"] [role="checkbox"], [role="checkbox"]')) return 'checkbox';
  if (item.querySelector('[aria-haspopup="listbox"], [role="combobox"], [role="listbox"]')) return 'dropdown';
  return 'unknown';
}

function getRadioOptions(item) {
  const nodes = Array.from(item.querySelectorAll('[role="radio"]'));
  return nodes.map(n => ({ el: n, label: (n.getAttribute('aria-label') || n.textContent || '').trim() }));
}

function getCheckboxOptions(item) {
  const nodes = Array.from(item.querySelectorAll('[role="checkbox"]'));
  return nodes.map(n => ({ el: n, label: (n.getAttribute('aria-label') || n.textContent || '').trim() }));
}

function getDropdownButton(item) {
  return item.querySelector('[role="button"][aria-haspopup="listbox"], [role="combobox"]');
}

async function openDropdownAndChoose(btn, desiredLabel) {
  if (!btn) return false;
  btn.click();
  // wait for listbox
  const maxWaitMs = 2000;
  const start = performance.now();
  let listbox;
  while (performance.now() - start < maxWaitMs) {
    listbox = document.querySelector('[role="listbox"]');
    if (listbox) break;
    await new Promise(r => setTimeout(r, 50));
  }
  if (!listbox) return false;
  const options = Array.from(listbox.querySelectorAll('[role="option"]'));
  const labels = options.map(o => (o.getAttribute('aria-label') || o.textContent || '').trim());
  // choose best fuzzy match
  const targetNorm = normalizeText(desiredLabel);
  let bestIdx = -1, bestScore = 0;
  for (let i = 0; i < labels.length; i++) {
    const sc = computeSimilarity(targetNorm, normalizeText(labels[i]));
    if (sc > bestScore) { bestScore = sc; bestIdx = i; }
  }
  if (bestIdx >= 0) {
    options[bestIdx].click();
    return true;
  }
  // no match -> close
  document.body.click();
  return false;
}

function setTextValue(item, value) {
  const input = item.querySelector('input[type="text"], input[type="email"], input[type="tel"], input[type="url"]');
  if (input) {
    input.focus();
    input.value = value;
    dispatchInputEvents(input);
    return true;
  }
  const ta = item.querySelector('textarea');
  if (ta) {
    ta.focus();
    ta.value = value;
    dispatchInputEvents(ta);
    return true;
  }
  return false;
}

function pickBestFieldMatch(questionTitle, type, index) {
  const candidates = (index[type] || []);
  const qn = normalizeText(questionTitle);
  let best = null;
  let bestScore = 0;
  for (const c of candidates) {
    const sc = computeSimilarity(qn, c.labelNorm || normalizeText(c.label));
    if (sc > bestScore) { best = c; bestScore = sc; }
  }
  return { best, bestScore };
}

async function fillUsingIndex(index) {
  const items = getQuestionItems();
  for (const item of items) {
    const title = extractTitleText(item);
    const type = detectType(item);
    if (!title || type === 'unknown') continue;
    const { best, bestScore } = pickBestFieldMatch(title, type, index);
    if (!best || bestScore < 0.35) continue; // threshold to avoid poor matches

    if (type === 'text' || type === 'paragraph') {
      const v = best.values?.[0] || '';
      if (v) setTextValue(item, v);
    } else if (type === 'radio') {
      const options = getRadioOptions(item);
      if (!options.length) continue;
      const desired = best.values?.[0] || '';
      if (!desired) continue;
      const labels = options.map(o => o.label);
      // choose best
      let bestIdx = -1, bestSc = 0;
      const target = normalizeText(desired);
      for (let i = 0; i < labels.length; i++) {
        const sc = computeSimilarity(target, normalizeText(labels[i]));
        if (sc > bestSc) { bestSc = sc; bestIdx = i; }
      }
      if (bestIdx >= 0) options[bestIdx].el.click();
    } else if (type === 'checkbox') {
      const options = getCheckboxOptions(item);
      if (!options.length) continue;
      const desiredValues = (best.values || []).map(v => normalizeText(v));
      // check/uncheck accordingly
      for (const opt of options) {
        const labelN = normalizeText(opt.label);
        // find best similarity to any desired
        let matchScore = 0;
        for (const dv of desiredValues) {
          const sc = computeSimilarity(dv, labelN);
          if (sc > matchScore) matchScore = sc;
        }
        const shouldBeChecked = matchScore >= 0.35;
        const isChecked = opt.el.getAttribute('aria-checked') === 'true';
        if (shouldBeChecked && !isChecked) opt.el.click();
        if (!shouldBeChecked && isChecked) opt.el.click();
      }
    } else if (type === 'dropdown') {
      const btn = getDropdownButton(item);
      const desired = best.values?.[0] || '';
      if (btn && desired) await openDropdownAndChoose(btn, desired);
    }
  }
  return { ok: true };
}

function captureFields() {
  const items = getQuestionItems();
  /** @type {{label:string,type:string,values:string[] }[]} */
  const fields = [];
  for (const item of items) {
    const title = extractTitleText(item);
    const type = detectType(item);
    if (!title || type === 'unknown') continue;

    if (type === 'text' || type === 'paragraph') {
      const el = item.querySelector(type === 'text' ? 'input[type="text"], input[type="email"], input[type="tel"], input[type="url"]' : 'textarea');
      const v = el?.value?.trim();
      if (v) fields.push({ label: title, type, values: [v] });
    } else if (type === 'radio') {
      const selected = item.querySelector('[role="radio"][aria-checked="true"]');
      const label = (selected?.getAttribute('aria-label') || selected?.textContent || '').trim();
      if (label) fields.push({ label: title, type, values: [label] });
    } else if (type === 'checkbox') {
      const checked = Array.from(item.querySelectorAll('[role="checkbox"][aria-checked="true"]'));
      const labels = checked.map(n => (n.getAttribute('aria-label') || n.textContent || '').trim()).filter(Boolean);
      if (labels.length) fields.push({ label: title, type, values: labels });
    } else if (type === 'dropdown') {
      const button = getDropdownButton(item);
      const val = (button?.getAttribute('aria-label') || button?.textContent || '').trim();
      if (val) fields.push({ label: title, type, values: [val] });
    }
  }
  return { formTitle: document.title, fields };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === 'FILL_WITH_INDEX') {
      await fillUsingIndex(message.index || {});
      sendResponse({ ok: true });
    } else if (message?.type === 'CONTENT_CAPTURE_REQUEST') {
      const cap = captureFields();
      sendResponse({ ok: true, ...cap });
    } else {
      sendResponse({ ok: false });
    }
  })();
  return true;
});
