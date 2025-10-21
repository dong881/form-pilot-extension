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
  // Support Google Forms
  let items = Array.from(document.querySelectorAll('div[role="listitem"]'));
  
  // Support other form types
  if (items.length === 0) {
    // Try common form field selectors
    items = Array.from(document.querySelectorAll('fieldset, .form-group, .form-field, .question, .field'));
  }
  
  // If still no items, try to find any input containers
  if (items.length === 0) {
    items = Array.from(document.querySelectorAll('div, section, article')).filter(el => {
      const inputs = el.querySelectorAll('input, textarea, select, [role="radio"], [role="checkbox"]');
      return inputs.length > 0;
    });
  }
  
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
  if (item.querySelector('input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="password"]')) return 'text';
  if (item.querySelector('[role="radiogroup"], [role="radio"], input[type="radio"]')) return 'radio';
  if (item.querySelector('[role="group"] [role="checkbox"], [role="checkbox"], input[type="checkbox"]')) return 'checkbox';
  if (item.querySelector('[aria-haspopup="listbox"], [role="combobox"], [role="listbox"], select')) return 'dropdown';
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
  const input = item.querySelector('input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="password"]');
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

// Enhanced auto-next functionality with intelligent button detection
async function findAndClickNextButton() {
  // Get all potential buttons on the page
  const allButtons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]'));
  
  // Keywords that indicate "next" or "continue" actions in multiple languages
  const nextKeywords = [
    'next', 'continue', 'proceed', 'forward', 'advance', 'go',
    '下一步', '繼續', '繼續進行', '前進', '進行', '前往',
    'siguiente', 'continuar', 'proceder', 'avanzar',
    'suivant', 'continuer', 'procéder', 'avancer',
    '次へ', '続行', '進む', '次に',
    '다음', '계속', '진행', '다음으로'
  ];
  
  // Keywords that indicate final submission (should be avoided)
  const submitKeywords = [
    'submit', 'send', 'finish', 'complete', 'done', 'send', 'submit form',
    '送出', '提交', '完成', '結束', '發送', '提交表單',
    'enviar', 'finalizar', 'completar', 'terminar',
    'envoyer', 'terminer', 'compléter', 'finir',
    '送信', '完了', '終了', '提出',
    '제출', '완료', '마침', '보내기'
  ];
  
  // Score buttons based on their text content and attributes
  const scoredButtons = allButtons.map(btn => {
    const text = (btn.textContent || btn.value || btn.getAttribute('aria-label') || '').toLowerCase().trim();
    const type = btn.type || '';
    const className = btn.className || '';
    const id = btn.id || '';
    
    let score = 0;
    
    // Check for next/continue keywords
    for (const keyword of nextKeywords) {
      if (text.includes(keyword.toLowerCase())) {
        score += 10;
      }
    }
    
    // Check for submit keywords (negative score)
    for (const keyword of submitKeywords) {
      if (text.includes(keyword.toLowerCase())) {
        score -= 15;
      }
    }
    
    // Boost score for common next button patterns
    if (className.includes('next') || className.includes('continue') || className.includes('proceed')) {
      score += 5;
    }
    
    if (id.includes('next') || id.includes('continue') || id.includes('proceed')) {
      score += 5;
    }
    
    // Boost for buttons that are not submit type
    if (type !== 'submit') {
      score += 3;
    }
    
    // Boost for buttons with arrow icons or similar visual indicators
    if (btn.querySelector('svg, i, span[class*="arrow"], span[class*="chevron"]')) {
      score += 2;
    }
    
    // Check if button is visible and clickable
    const rect = btn.getBoundingClientRect();
    const isVisible = rect.width > 0 && rect.height > 0 && 
                     getComputedStyle(btn).visibility !== 'hidden' &&
                     getComputedStyle(btn).display !== 'none';
    
    if (!isVisible) {
      score = -100; // Make invisible buttons very unlikely to be selected
    }
    
    // Check if button is disabled
    if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') {
      score = -50;
    }
    
    return { button: btn, score, text };
  });
  
  // Sort by score (highest first) and filter out negative scores
  const validButtons = scoredButtons
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);
  
  // Try clicking the highest scored button
  for (const { button, score, text } of validButtons) {
    try {
      console.log(`Attempting to click button with score ${score}: "${text}"`);
      button.click();
      return true;
    } catch (error) {
      console.log(`Failed to click button: ${error.message}`);
      continue;
    }
  }
  
  return false;
}

// Enhanced form filling with auto-next
async function fillUsingIndexWithAutoNext(index, autoNext = false) {
  const result = await fillUsingIndex(index);
  
  if (autoNext && result.ok) {
    // Wait a bit for form to process
    await new Promise(resolve => setTimeout(resolve, 1000));
    const nextClicked = await findAndClickNextButton();
    if (nextClicked) {
      console.log('Auto-clicked next button');
    }
  }
  
  return result;
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
  let filledCount = 0;
  
  if (items.length === 0) {
    return { ok: false, error: '此網站不支援表單自動填寫，目前主要支援 Google 表單' };
  }
  
  for (const item of items) {
    const title = extractTitleText(item);
    const type = detectType(item);
    if (!title || type === 'unknown') continue;
    const { best, bestScore } = pickBestFieldMatch(title, type, index);
    if (!best || bestScore < 0.2) continue; // Lower threshold for broader matching

    if (type === 'text' || type === 'paragraph') {
      const v = best.values?.[0] || '';
      if (v && setTextValue(item, v)) filledCount++;
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
      if (bestIdx >= 0) {
        options[bestIdx].el.click();
        filledCount++;
      }
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
        const shouldBeChecked = matchScore >= 0.2;
        const isChecked = opt.el.getAttribute('aria-checked') === 'true';
        if (shouldBeChecked && !isChecked) {
          opt.el.click();
          filledCount++;
        }
        if (!shouldBeChecked && isChecked) opt.el.click();
      }
    } else if (type === 'dropdown') {
      const btn = getDropdownButton(item);
      const desired = best.values?.[0] || '';
      if (btn && desired && await openDropdownAndChoose(btn, desired)) {
        filledCount++;
      }
    }
  }
  
  if (filledCount === 0) {
    return { ok: false, error: '未找到匹配的欄位，請確認範本是否適用於此表單' };
  }
  
  return { ok: true, filledCount };
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
      const result = await fillUsingIndex(message.index || {});
      sendResponse(result);
    } else if (message?.type === 'FILL_WITH_AUTO_NEXT') {
      const result = await fillUsingIndexWithAutoNext(message.index || {}, true);
      sendResponse(result);
    } else if (message?.type === 'CONTENT_CAPTURE_REQUEST') {
      const cap = captureFields();
      sendResponse({ ok: true, ...cap });
    } else {
      sendResponse({ ok: false });
    }
  })();
  return true;
});
