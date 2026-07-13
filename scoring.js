// Pure scoring engine for ToppsMatch. No DOM, no globals — testable in Node.
// Weights owned by Noah; change them here and the tests pin the mechanics.
export function rankWeight(i) { return [1.0, 0.65, 0.40, 0.20][i] ?? 0.15; }

export function score(answers, brands) {
  const sc = {};
  Object.keys(brands).forEach(k => sc[k] = 0);

  const sports   = answers.sport    || [];
  const budget   = answers.budget;
  const identity = answers.identity || [];
  const risk     = answers.risk;
  const exp      = answers.exp;
  const vibe     = answers.vibe     || [];

  Object.entries(brands).forEach(([key, b]) => {
    sports.forEach((sp, i) => {
      const w = rankWeight(i);
      const hit = b.sport.includes(sp) || (sp === "multi") || sports.includes("multi");
      if (hit) sc[key] += 38 * w;
    });
    if ((b.budget || []).includes(budget)) sc[key] += 26;
    identity.forEach((id, i) => {
      if ((b.identity || []).includes(id)) sc[key] += 13 * rankWeight(i);
    });
    if ((b.risk || []).includes(risk)) sc[key] += 12;
    vibe.forEach((v, i) => {
      if ((b.vibe || []).includes(v)) sc[key] += 10 * rankWeight(i);
    });
    if (exp === "new" && (b.budget || []).includes("entry")) sc[key] += 6;
  });

  return sc;
}

export function topMatches(sc, sports, brands, n = 3) {
  const incAll = sports.includes("multi");
  const relevant = Object.entries(sc).filter(([k]) => {
    if (incAll || sports.length === 0) return true;
    return brands[k].sport.some(sp => sports.includes(sp));
  });
  const sorted = relevant.sort((a, b) => b[1] - a[1]);
  const max = sorted[0]?.[1] || 1;
  return sorted.slice(0, n).map(([k, raw]) => ({
    key: k,
    pct: Math.min(98, Math.max(52, Math.round(52 + (raw / max) * 44)))
  }));
}

export function wildcard(sc, topKeys, sports, brands) {
  const topSet = new Set(topKeys);
  const sorted = Object.entries(sc).sort((a, b) => b[1] - a[1]);
  const wc = sorted.find(([k]) => {
    if (topSet.has(k)) return false;
    return !brands[k].sport.some(sp => sports.includes(sp));
  });
  return wc?.[0] ?? sorted.find(([k]) => !topSet.has(k))?.[0];
}
