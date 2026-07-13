// Pure scoring engine for ToppsMatch. No DOM, no globals — testable in Node.
// Weights owned by Noah; change them here and the tests pin the mechanics.
//
// Design (the hierarchy of question values):
//   Sport is the spine. It far outweighs the other answers, your #1 sport counts
//   most, and a product's PRIMARY sport (first in its list) scores much higher than
//   a sport it merely also includes. Budget / identity / risk / vibe are tuners that
//   pick the best product WITHIN the sports you like; they can't override sport.
export function rankWeight(i) { return [1.0, 0.65, 0.40, 0.20][i] ?? 0.15; }

// Points a hypothetical perfect brand could earn for these answers. Used to turn raw
// points into an honest compatibility % (each brand vs. perfect), instead of the old
// bug that normalized to the top match and therefore always showed 96%.
export function maxScore(answers) {
  let m = 0;
  if ((answers.sport || []).length) m += 50; // primary hit on your #1 sport
  if (answers.budget) m += 14;
  if ((answers.identity || []).length) m += 8;
  if (answers.risk) m += 7;
  if ((answers.vibe || []).length) m += 7;
  if (answers.exp === "new") m += 4;
  return m || 1;
}

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
    const bsport = b.sport || [];
    // Sport: dominant, ranked, and primary-aware.
    sports.forEach((sp, i) => {
      const w = rankWeight(i);
      const multi = sp === "multi" || sports.includes("multi");
      if (bsport.includes(sp) || multi) {
        const primary = multi || bsport[0] === sp;
        sc[key] += (primary ? 50 : 20) * w;
      }
    });
    // Everything below is a within-sport tuner; kept small so it can't beat sport.
    if ((b.budget || []).includes(budget)) sc[key] += 14;
    identity.forEach((id, i) => {
      if ((b.identity || []).includes(id)) sc[key] += 8 * rankWeight(i);
    });
    if ((b.risk || []).includes(risk)) sc[key] += 7;
    vibe.forEach((v, i) => {
      if ((b.vibe || []).includes(v)) sc[key] += 7 * rankWeight(i);
    });
    if (exp === "new" && (b.budget || []).includes("entry")) sc[key] += 4;
  });

  return sc;
}

export function topMatches(sc, sports, brands, n = 3, maxPossible = 100) {
  const incAll = sports.includes("multi");
  const relevant = Object.entries(sc).filter(([k]) => {
    if (incAll || sports.length === 0) return true;
    return (brands[k].sport || []).some(sp => sports.includes(sp));
  });
  const sorted = relevant.sort((a, b) => b[1] - a[1]);
  return sorted.slice(0, n).map(([k, raw]) => ({
    key: k,
    pct: Math.min(99, Math.max(40, Math.round((raw / maxPossible) * 100)))
  }));
}

export function wildcard(sc, topKeys, sports, brands) {
  const topSet = new Set(topKeys);
  const sorted = Object.entries(sc).sort((a, b) => b[1] - a[1]);
  const wc = sorted.find(([k]) => {
    if (topSet.has(k)) return false;
    return !(brands[k].sport || []).some(sp => sports.includes(sp));
  });
  return wc?.[0] ?? sorted.find(([k]) => !topSet.has(k))?.[0];
}
