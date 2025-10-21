// Fuzzy helpers shared by extension pages (popup/background)
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

export function chooseBestLabelMatch(targetLabel, candidates) {
  const targetNorm = normalizeText(targetLabel);
  let best = null;
  let bestScore = 0;
  for (const c of candidates) {
    const score = computeSimilarity(targetNorm, c.labelNorm || normalizeText(c.label));
    if (score > bestScore) {
      bestScore = score;
      best = { ...c, score };
    }
  }
  return { best, bestScore };
}

export function chooseBestValueMatch(targetValue, optionLabels) {
  const targetNorm = normalizeText(targetValue);
  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < optionLabels.length; i++) {
    const score = computeSimilarity(targetNorm, normalizeText(optionLabels[i]));
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return { bestIdx, bestScore };
}
