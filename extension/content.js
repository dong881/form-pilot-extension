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
  // First, check if we're on a submit screen - if so, don't auto-continue
  const isSubmit = isSubmitScreen();
  console.log('Submit screen check result:', isSubmit);
  if (isSubmit) {
    console.log('Detected submit screen - stopping auto-continue');
    return false;
  }
  
  // Wait a bit for any dynamic content to load
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Get all potential buttons on the page using valid CSS selectors
  const allButtons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"], a[role="button"], div[role="button"], span[role="button"]'));
  
  // Keywords that indicate "next" or "continue" actions in multiple languages
  const nextKeywords = [
    'next', 'continue', 'proceed', 'forward', 'advance', 'go', 'next page', 'continue to', 'next step', 'continue to next',
    '下一步', '繼續', '繼續進行', '前進', '進行', '前往', '下一頁', '繼續到', '下一步驟', '繼續下一步',
    'siguiente', 'continuar', 'proceder', 'avanzar', 'página siguiente', 'siguiente paso',
    'suivant', 'continuer', 'procéder', 'avancer', 'page suivante', 'étape suivante',
    '次へ', '続行', '進む', '次に', '次のページ', '次のステップ',
    '다음', '계속', '진행', '다음으로', '다음 페이지', '다음 단계'
  ];
  
  // Keywords that indicate "return" or "back" actions (should be avoided when submit buttons are present)
  const returnKeywords = [
    'back', 'return', 'previous', 'go back', 'back to', 'return to',
    '返回', '回到', '上一步', '返回上一步', '回到上一步',
    'volver', 'regresar', 'anterior', 'volver a', 'regresar a',
    'retour', 'retourner', 'précédent', 'retour à', 'retourner à',
    '戻る', '前へ', '戻り', '前のページ', '戻るページ',
    '돌아가기', '이전', '뒤로', '이전 페이지', '돌아가기 페이지'
  ];
  
  // Keywords that indicate final submission (should be avoided)
  const submitKeywords = [
    'submit form', 'final submit', 'send form', 'submit your response', 'submit response',
    '提交表單', '最終提交', '發送表單', '提交您的回應', '提交回應', '提交',
    'enviar formulario', 'enviar respuesta final', 'enviar respuesta',
    'envoyer formulaire', 'envoyer réponse finale', 'envoyer réponse',
    'フォーム送信', '最終送信', '回答を送信', '送信',
    '폼 제출', '최종 제출', '응답 제출', '제출'
  ];
  
  // Score buttons based on their text content and attributes
  const scoredButtons = allButtons.map(btn => {
    const text = (btn.textContent || btn.value || btn.getAttribute('aria-label') || '').toLowerCase().trim();
    const type = btn.type || '';
    const className = btn.className || '';
    const id = btn.id || '';
    
    let score = 0;
    
    // Check for next/continue keywords (exact match gets higher score)
    for (const keyword of nextKeywords) {
      const keywordLower = keyword.toLowerCase();
      if (text === keywordLower) {
        score += 20; // Exact match
      } else if (text.includes(keywordLower)) {
        score += 10; // Partial match
      }
    }
    
    // Check for submit keywords (negative score)
    for (const keyword of submitKeywords) {
      const keywordLower = keyword.toLowerCase();
      if (text === keywordLower) {
        score -= 25; // Exact match gets heavy penalty
      } else if (text.includes(keywordLower)) {
        score -= 15; // Partial match gets penalty
      }
    }
    
    // Check for return/back keywords (negative score, especially when submit buttons are present)
    for (const keyword of returnKeywords) {
      const keywordLower = keyword.toLowerCase();
      if (text === keywordLower) {
        score -= 20; // Exact match gets heavy penalty
      } else if (text.includes(keywordLower)) {
        score -= 10; // Partial match gets penalty
      }
    }
    
    // Boost score for common next button patterns
    if (className.includes('next') || className.includes('continue') || className.includes('proceed')) {
      score += 8;
    }
    
    if (id.includes('next') || id.includes('continue') || id.includes('proceed')) {
      score += 8;
    }
    
    // Boost for buttons that are not submit type
    if (type !== 'submit') {
      score += 5;
    }
    
    // Boost for buttons with arrow icons or similar visual indicators
    if (btn.querySelector('svg, i, span[class*="arrow"], span[class*="chevron"], span[class*="right"]')) {
      score += 3;
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
    
    // Check if button is in viewport
    const isInViewport = rect.top >= 0 && rect.left >= 0 && 
                        rect.bottom <= window.innerHeight && 
                        rect.right <= window.innerWidth;
    
    if (isInViewport) {
      score += 5; // Slight boost for buttons in viewport
    }
    
    return { button: btn, score, text };
  });
  
  // Sort by score (highest first) and filter out negative scores
  const validButtons = scoredButtons
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);
  
  console.log(`Found ${allButtons.length} total buttons, ${validButtons.length} valid buttons`);
  if (validButtons.length > 0) {
    console.log('Top 5 button candidates:', validButtons.slice(0, 5).map(b => ({ text: b.text, score: b.score })));
  }
  
  // Check if we have submit buttons on the page - if so, avoid return buttons
  const hasSubmitButtons = Array.from(document.querySelectorAll('button, input[type="submit"], [role="button"]')).some(btn => {
    const text = (btn.textContent || btn.value || btn.getAttribute('aria-label') || '').toLowerCase().trim();
    return submitKeywords.some(keyword => text.includes(keyword.toLowerCase()));
  });
  
  // Try clicking the highest scored button
  for (const { button, score, text } of validButtons) {
    // If we have submit buttons and this is a return button, skip it
    if (hasSubmitButtons) {
      const isReturnButton = returnKeywords.some(keyword => 
        text.toLowerCase().includes(keyword.toLowerCase())
      );
      if (isReturnButton) {
        console.log(`Skipping return button "${text}" because submit buttons are present`);
        continue;
      }
    }
    
    try {
      console.log(`Attempting to click button with score ${score}: "${text}"`);
      // Ensure the button is still visible and clickable
      const rect = button.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        // Scroll button into view if needed
        button.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Try multiple click methods
        try {
          button.click();
        } catch (e1) {
          try {
            button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          } catch (e2) {
            try {
              button.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
            } catch (e3) {
              console.log(`All click methods failed for button: ${text}`);
              continue;
            }
          }
        }
        
        console.log(`Successfully clicked button: "${text}"`);
        return true;
      } else {
        console.log(`Button is no longer visible, skipping`);
        continue;
      }
    } catch (error) {
      console.log(`Failed to click button: ${error.message}`);
      continue;
    }
  }
  
  console.log('No suitable next button found');
  return false;
}

// Function to detect if we're on a submit screen
function isSubmitScreen() {
  // Check for common submit screen indicators
  const submitIndicators = [
    // Text content indicators - be more specific
    'submit form', 'final submit', 'send form', 'submit your response',
    '提交表單', '最終提交', '發送表單', '提交您的回應',
    'enviar formulario', 'enviar respuesta final',
    'envoyer formulaire', 'envoyer réponse finale',
    'フォーム送信', '最終送信', '回答を送信',
    '폼 제출', '최종 제출', '응답 제출',
    // Page title indicators
    'review', 'confirmation', 'summary', 'final', 'submit',
    '檢閱', '確認', '摘要', '最終', '提交',
    'revisar', 'confirmación', 'resumen', 'final', 'enviar',
    'réviser', 'confirmation', 'résumé', 'final', 'envoyer',
    '確認', '要約', '最終', '送信',
    '검토', '확인', '요약', '최종', '제출'
  ];
  
  // Check page title
  const pageTitle = document.title.toLowerCase();
  for (const indicator of submitIndicators) {
    if (pageTitle.includes(indicator.toLowerCase())) {
      return true;
    }
  }
  
  // Check for submit buttons that are the primary action
  const submitButtons = Array.from(document.querySelectorAll('button[type="submit"], input[type="submit"]'));
  const primaryButtons = submitButtons.filter(btn => {
    const text = (btn.textContent || btn.value || btn.getAttribute('aria-label') || '').toLowerCase().trim();
    const style = getComputedStyle(btn);
    const rect = btn.getBoundingClientRect();
    
    // Check if it's a primary button (usually styled differently)
    const isPrimary = style.backgroundColor !== 'rgba(0, 0, 0, 0)' && 
                     style.backgroundColor !== 'transparent' &&
                     style.backgroundColor !== 'rgb(255, 255, 255)' &&
                     rect.width > 0 && rect.height > 0;
    
    // Check if text contains submit keywords (be more specific)
    const hasSubmitText = submitIndicators.some(indicator => 
      text.includes(indicator.toLowerCase())
    );
    
    return isPrimary && hasSubmitText;
  });
  
  // If we have primary submit buttons, we're likely on a submit screen
  if (primaryButtons.length > 0) {
    return true;
  }
  
  // Removed form completion check using document.body.textContent.toLowerCase()
  // as it would match the entire form content and cause false positives
  
  // Additional check: Look for continue/next buttons vs submit buttons
  const allButtons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]'));
  const continueButtons = allButtons.filter(btn => {
    const text = (btn.textContent || btn.value || btn.getAttribute('aria-label') || '').toLowerCase().trim();
    return text.includes('continue') || text.includes('next') || text.includes('proceed') ||
           text.includes('繼續') || text.includes('下一步') || text.includes('進行') ||
           text.includes('continuar') || text.includes('siguiente') || text.includes('proceder') ||
           text.includes('continuer') || text.includes('suivant') || text.includes('procéder') ||
           text.includes('続行') || text.includes('次へ') || text.includes('進む') ||
           text.includes('계속') || text.includes('다음') || text.includes('진행');
  });
  
  const submitButtonsText = allButtons.filter(btn => {
    const text = (btn.textContent || btn.value || btn.getAttribute('aria-label') || '').toLowerCase().trim();
    return text.includes('submit') || text.includes('send') || text.includes('finish') ||
           text.includes('送出') || text.includes('提交') || text.includes('完成') ||
           text.includes('enviar') || text.includes('finalizar') || text.includes('completar') ||
           text.includes('envoyer') || text.includes('terminer') || text.includes('compléter') ||
           text.includes('送信') || text.includes('完了') || text.includes('終了') ||
           text.includes('제출') || text.includes('완료') || text.includes('마침');
  });
  
  console.log(`Button analysis: ${continueButtons.length} continue buttons, ${submitButtonsText.length} submit buttons`);
  console.log('Continue buttons:', continueButtons.map(btn => btn.textContent || btn.value || btn.getAttribute('aria-label')));
  console.log('Submit buttons:', submitButtonsText.map(btn => btn.textContent || btn.value || btn.getAttribute('aria-label')));
  
  // If we have submit buttons, we're on a submit screen and should stop
  if (submitButtonsText.length > 0) {
    console.log('Found submit buttons - this is a submit screen, stopping auto-continue');
    return true;
  }
  
  // If we have more continue/next buttons than submit buttons, it's likely not a submit screen
  if (continueButtons.length > submitButtonsText.length) {
    console.log('More continue buttons than submit buttons - not a submit screen');
    return false;
  }
  
  return false;
}

// Enhanced form filling with auto-next
async function fillUsingIndexWithAutoNext(index, autoNext = false) {
  const result = await fillUsingIndex(index);
  
  if (autoNext && result.ok) {
    console.log('Auto-next enabled, attempting to find and click next button...');
    // Wait a bit for form to process and any validation to complete
    await new Promise(resolve => setTimeout(resolve, 1500));
    const nextClicked = await findAndClickNextButton();
    if (nextClicked) {
      console.log('Auto-clicked next button successfully');
    } else {
      console.log('No suitable next button found or auto-click failed');
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
    if (sc > bestScore) { 
      best = c; 
      bestScore = sc; 
    }
  }
  
  // If no good match found, try partial matching
  if (!best || bestScore < 0.15) {
    for (const c of candidates) {
      const labelNorm = c.labelNorm || normalizeText(c.label);
      // Check if question title contains any significant words from the label
      const qnWords = qn.split(' ').filter(w => w.length > 2);
      const labelWords = labelNorm.split(' ').filter(w => w.length > 2);
      
      let wordMatches = 0;
      for (const qw of qnWords) {
        for (const lw of labelWords) {
          if (qw.includes(lw) || lw.includes(qw)) {
            wordMatches++;
            break;
          }
        }
      }
      
      const partialScore = wordMatches / Math.max(qnWords.length, labelWords.length);
      if (partialScore > 0.3 && partialScore > bestScore) {
        best = c;
        bestScore = partialScore;
      }
    }
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
    console.log(`Field "${title}" (${type}): best match score = ${bestScore ? bestScore.toFixed(3) : 'none'}`);
    if (!best || bestScore < 0.15) continue; // Even lower threshold for broader matching

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
    const totalFields = items.length;
    const supportedFields = items.filter(item => {
      const title = extractTitleText(item);
      const type = detectType(item);
      return title && type !== 'unknown';
    }).length;
    
    if (supportedFields === 0) {
      return { ok: false, error: '此表單沒有可識別的欄位，請確認是否為支援的表單類型' };
    } else if (totalFields > 0) {
      return { ok: false, error: `找到 ${supportedFields} 個欄位但無匹配的範本資料，請檢查範本是否適用於此表單` };
    } else {
      return { ok: false, error: '未找到匹配的欄位，請確認範本是否適用於此表單' };
    }
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
