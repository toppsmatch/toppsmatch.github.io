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

// Tie rotation (pending Noah): equal scores used to break by catalog order,
// so identical-profile brands could never surface. With a nonzero seed, ties
// rotate deterministically per quiz run; seed 0 preserves the legacy order.
function tieHash(key, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 2654435761) >>> 0;
  }
  h ^= h >>> 16; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13;
  return h >>> 0;
}

export function topMatches(sc, sports, brands, n = 3, maxPossible = 100, seed = 0) {
  const incAll = sports.includes("multi");
  const relevant = Object.entries(sc).filter(([k]) => {
    if (incAll || sports.length === 0) return true;
    return (brands[k].sport || []).some(sp => sports.includes(sp));
  });
  const sorted = relevant.sort((a, b) =>
    (b[1] - a[1]) || (seed ? tieHash(a[0], seed) - tieHash(b[0], seed) : 0));

  // Coverage guarantee (Gus, July 17): every chosen sport gets at least one
  // representative in the results — rank order, as many as fit in n slots —
  // then the best remaining brands fill what's left. A brand that spans two
  // chosen sports covers both.
  const picks = [];
  const covers = (k, sp) => (brands[k].sport || []).includes(sp);
  for (const sp of sports.filter(s => s !== "multi").slice(0, n)) {
    if (picks.some(([k]) => covers(k, sp))) continue;
    const cand = sorted.find(([k]) => !picks.some(p => p[0] === k) && covers(k, sp));
    if (cand) picks.push(cand);
  }
  for (const entry of sorted) {
    if (picks.length >= n) break;
    if (!picks.some(p => p[0] === entry[0])) picks.push(entry);
  }
  picks.sort((a, b) => b[1] - a[1]);
  return picks.slice(0, n).map(([k, raw]) => ({
    key: k,
    pct: Math.min(99, Math.max(40, Math.round((raw / maxPossible) * 100)))
  }));
}

// Interest adjacency for the wildcard: fans of X plausibly collect Y next.
// Values are quiz sport slugs (Answer Options "Value" column).
const SPORT_AFFINITY = {
  nba: ["college"], nfl: ["college"], baseball: ["college"],
  college: ["nba", "nfl"],
  ufc: ["wwe"], wwe: ["ufc"],
  f1: ["soccer"], soccer: ["f1"], tennis: ["soccer"],
  ent: ["nonsport"], nonsport: ["ent"],
};
// Pop culture is one sport bucket ("ent"), so cross-franchise affinity detects
// the franchise from the brand name + category label (labels alone are
// inconsistent: "Topps Star Wars" is labeled "Entertainment" in Airtable).
const FRANCHISES = [
  ["starwars", /star wars/i],
  ["marvel", /marvel|deadpool|captain america/i],
  ["disney", /disney|pixar|toy story/i],
  ["veefriends", /veefriends/i],
  ["nick", /spongebob|nickelodeon/i],
];
const FRANCHISE_AFFINITY = {
  starwars: ["marvel"], marvel: ["starwars"],
  disney: ["veefriends"], veefriends: ["disney"], nick: ["disney"],
};
function franchiseOf(b) {
  const hay = `${b?.name || ""} ${b?.catLabel || ""}`;
  return FRANCHISES.find(([, re]) => re.test(hay))?.[0];
}

export function wildcard(sc, topKeys, sports, brands) {
  const topSet = new Set(topKeys);
  const sorted = Object.entries(sc).sort((a, b) => b[1] - a[1]);
  const offSport = k => !(brands[k].sport || []).some(sp => sports.includes(sp));

  // Franchise neighbours of the actual top matches (Star Wars -> Marvel...).
  // These share the "ent" sport bucket, so require a different franchise from
  // every top match instead of a different sport.
  const topFr = new Set(topKeys.map(k => franchiseOf(brands[k])).filter(Boolean));
  const frTargets = new Set([...topFr].flatMap(f => FRANCHISE_AFFINITY[f] || []));
  const byFr = sorted.find(([k]) => {
    if (topSet.has(k)) return false;
    const f = franchiseOf(brands[k]);
    return f && frTargets.has(f) && !topFr.has(f);
  });
  if (byFr) return byFr[0];

  // Sport neighbours of the chosen interests (nba -> college, ufc -> wwe...),
  // strongest scorer first; must sit outside the sports they already chose.
  const sportTargets = sports.flatMap(sp => SPORT_AFFINITY[sp] || []).filter(t => !sports.includes(t));
  const bySport = sorted.find(([k]) =>
    !topSet.has(k) && offSport(k) && (brands[k].sport || []).some(sp => sportTargets.includes(sp)));
  if (bySport) return bySport[0];

  // Fallbacks: best brand outside the chosen sports, else best non-top brand.
  const wc = sorted.find(([k]) => !topSet.has(k) && offSport(k));
  return wc?.[0] ?? sorted.find(([k]) => !topSet.has(k))?.[0];
}
