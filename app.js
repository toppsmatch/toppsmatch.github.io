import { BRANDS, QUESTIONS } from "./data.js";
import { score, topMatches, wildcard, maxScore } from "./scoring.js";

// One tally submission per page load, fire-and-forget; never blocks the reveal.
let submitted = false;
function submitResult(matchKey) {
  if (submitted || !location.protocol.startsWith("http")) return;
  submitted = true;
  fetch("/api/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ match: matchKey }),
  }).catch(() => {});
}

// All brand copy eventually comes from Airtable text typed by the team — escape before innerHTML.
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// ─── STATE ────────────────────────────────────────────────────────────────────
let qIdx = 0;
// answers[id] = string (single) or ordered array (ranked multi)
const answers = {};

// ─── RENDER ───────────────────────────────────────────────────────────────────
function startQuiz(){
  document.getElementById("intro").classList.add("hidden");
  document.getElementById("quiz").classList.remove("hidden");
  renderQ();
}

function renderQ(){
  const q = QUESTIONS[qIdx];
  const pct = Math.round((qIdx / QUESTIONS.length) * 100);
  document.getElementById("qCounter").textContent = `Question ${qIdx+1} of ${QUESTIONS.length}`;
  document.getElementById("qPct").textContent = pct + "%";
  document.getElementById("progFill").style.width = pct + "%";

  const sel = answers[q.id] ?? (q.ranked ? [] : null);
  const isRanked = q.ranked;
  const isMulti = q.ranked; // ranked questions are always multi

  let html = `<div class="q-eyebrow">${esc(q.eyebrow)}</div>
    <div class="q-title">${esc(q.title)}</div>
    <div class="q-hint">${esc(q.hint)}</div>`;

  if (isRanked){
    html += `<div class="rank-tag">🏅 Tap in order of preference — #1 matters most</div>`;
  }

  const gridCls = q.layout === "grid2" ? " grid2" : "";
  html += `<div class="opts${gridCls}">`;

  q.opts.forEach(opt => {
    // q.id and opt.val are slug-normalized by scripts/sync-airtable.mjs, safe for inline handlers.
    const val = opt.val;
    let rankIdx = isRanked ? sel.indexOf(val) : -1;
    const isSel = isRanked ? rankIdx > -1 : sel === val;
    const singleCls = (!isRanked && isSel) ? " single" : "";
    const subHtml = opt.sub ? `<div class="opt-sub">${esc(opt.sub)}</div>` : "";
    const badgeHtml = (isRanked && isSel)
      ? `<div class="rank-badge">${rankIdx+1}</div>` : "";

    html += `<button class="opt${isSel?" sel":""}${singleCls}"
        onclick="pick('${q.id}','${val}',${isRanked})">
      <span class="opt-icon">${esc(opt.icon)}</span>
      <div>
        <div class="opt-label">${esc(opt.label)}</div>
        ${subHtml}
      </div>
      ${badgeHtml}
    </button>`;
  });

  html += `</div>
  <div class="nav">
    <button class="btn-back" ${qIdx===0?"style='display:none'":""} onclick="goBack()">← Back</button>
    <button class="btn-next" id="btnNext" onclick="goNext()" ${answered(q)?"":"disabled"}>
      ${qIdx===QUESTIONS.length-1?"See My Matches 🎯":"Next →"}
    </button>
  </div>`;

  const card = document.getElementById("qCard");
  card.innerHTML = html;
  card.style.animation = "none";
  card.offsetHeight;
  card.style.animation = "";
}

function answered(q){
  const a = answers[q.id];
  if (q.ranked) return (a||[]).length > 0;
  return a !== undefined && a !== null;
}

function pick(id, val, ranked){
  if (ranked){
    if (!answers[id]) answers[id] = [];
    const i = answers[id].indexOf(val);
    if (i > -1) answers[id].splice(i,1);
    else answers[id].push(val);
  } else {
    answers[id] = val;
  }
  renderQ();
}

function goNext(){
  if (qIdx < QUESTIONS.length-1){ qIdx++; renderQ(); }
  else showResults();
}
function goBack(){ if(qIdx>0){ qIdx--; renderQ(); } }

// ─── RESULTS ─────────────────────────────────────────────────────────────────
function catClass(cat){ return cat==="ent"?"cat-ent":cat==="nonsport"?"cat-nonsport":"cat-sport"; }

let lastResults = null;   // { top, wcKey }
// Swipe deck state (Tinder-style results).
let deck = [];            // [{ key, pct, label }]
let deckIdx = 0;
let expanded = false;

function showResults() {
  document.getElementById("quiz").classList.add("hidden");

  const sc = score(answers, BRANDS);
  const sports = answers.sport || [];
  const top = topMatches(sc, sports, BRANDS, 3, maxScore(answers));
  const wcKey = wildcard(sc, top.map(t => t.key), sports, BRANDS);
  lastResults = { top, wcKey };
  submitResult(top[0].key);

  // Dating-app reveal moment first, results behind it.
  const b = BRANDS[top[0].key];
  const revealImg = document.getElementById("revealImg");
  if (b.img) { revealImg.src = b.img; revealImg.alt = b.name; revealImg.classList.remove("hidden"); }
  else { revealImg.classList.add("hidden"); revealImg.removeAttribute("src"); revealImg.alt = ""; }
  document.getElementById("revealName").textContent = `You + ${b.name}`;
  document.getElementById("revealPct").textContent = `${top[0].pct}% compatible`;
  spawnConfetti();
  document.documentElement.style.overflow = "hidden";
  document.getElementById("reveal").classList.remove("hidden");
}

let confettiTimer = null;

function spawnConfetti() {
  const wrap = document.getElementById("confettiWrap");
  const colors = ["#E31937", "#f0c040", "#5ccea0", "#a78bfa", "#60a5fa", "#fb923c"];
  wrap.innerHTML = Array.from({ length: 28 }, (_, i) => {
    const left = (i * 37) % 100;
    const delay = (i % 7) * 0.35;
    const dur = 2.2 + (i % 5) * 0.4;
    return `<span class="confetti" style="left:${left}%;background:${colors[i % colors.length]};animation-duration:${dur}s;animation-delay:${delay}s"></span>`;
  }).join("");
  clearTimeout(confettiTimer); confettiTimer = setTimeout(() => { wrap.innerHTML = ""; }, 6000);
}

function meetMatch() {
  document.documentElement.style.overflow = "";
  document.getElementById("reveal").classList.add("hidden");
  document.getElementById("results").classList.remove("hidden");
  buildDeck();
  renderCard();
}

// Build the swipe deck: your ranked matches, then the wildcard as a final card.
function buildDeck() {
  const { top, wcKey } = lastResults;
  const labels = ["⭐ Your Perfect Pull", "💔 The Rebound", "✨ Also Sparked"];
  deck = top.map((m, i) => ({ key: m.key, pct: m.pct, label: labels[i] || "Another Match" }));
  if (wcKey && BRANDS[wcKey]) deck.push({ key: wcKey, pct: null, label: "🃏 Wildcard" });
  deckIdx = 0;
  expanded = false;
}

// Icon set for the action buttons (inline SVG renders identically everywhere,
// unlike ✕/♥ glyphs which vary by platform font).
const ICONS = {
  x: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  heart: `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 21s-7.6-4.9-10-9.5C.6 8.8 2.5 5 6.2 5c2 0 3.6 1.1 4.3 2.7h1c.7-1.6 2.3-2.7 4.3-2.7 3.7 0 5.6 3.8 4.2 6.5C19.6 16.1 12 21 12 21z"/></svg>`,
  up: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 14.5l7-7 7 7"/></svg>`,
};

function cardInner(card) {
  const b = BRANDS[card.key];
  const img = b.img
    ? `<img class="sc-img" src="${esc(b.img)}" alt="${esc(b.name)}" loading="lazy">`
    : `<div class="sc-img sc-img-none">🃏</div>`;
  const pct = card.pct != null
    ? `<div class="sc-pct">${card.pct}% match</div>`
    : `<div class="sc-pct sc-pct-wild">outside your usual lane</div>`;
  const teaser =
    (b.lookingFor ? `<div class="profile-line"><strong>Looking for:</strong> ${esc(b.lookingFor)}</div>` : "") +
    (b.redFlag ? `<div class="profile-line"><strong>Red flag:</strong> ${esc(b.redFlag)}</div>` : "");
  // Detail is ALWAYS in the DOM; .expanded reveals it with a pure-CSS height
  // transition. No re-render on expand/collapse = drags stay smooth.
  return `
    <div class="sc-label">${card.label}</div>
    ${img}
    <div class="sc-name">${esc(b.name)}</div>
    <div class="sc-tier">${esc(b.tier)}</div>
    <div class="sc-cat"><span class="match-cat ${catClass(b.cat)}">${esc(b.catLabel)}</span></div>
    ${pct}
    ${teaser}
    <div class="sc-detail"><div class="sc-detail-in">
      <div class="match-desc">${esc(b.desc)}</div>
      <div class="tags">
        <span class="tag price">📦 ${esc(b.price)}</span>
        ${(b.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join("")}
      </div>
    </div></div>`;
}

function renderCard() {
  const host = document.getElementById("resultsContent");
  if (deckIdx >= deck.length) {
    host.innerHTML = `<div class="swipe-end"><div class="sc-label">That's your lineup 🎴</div><p>Those are your top matches. Run it back below anytime.</p></div>`;
    return;
  }
  const card = deck[deckIdx];
  const more = deckIdx < deck.length - 1;
  const waiting = deck.length - deckIdx - 1;
  const dots = deck.map((_, i) => `<span class="dot${i === deckIdx ? " on" : ""}"></span>`).join("");
  host.innerHTML = `
    <div class="deck">
      ${waiting > 1 ? `<div class="fan fan2"></div>` : ""}
      ${waiting > 0 ? `<div class="fan fan1"></div>` : ""}
      <div class="swipe-card" id="swipeCard">
        <span class="chev chev-l">‹</span><span class="chev chev-r">›</span>
        ${cardInner(card)}
        <div class="swipe-actions">
          <button class="act-btn act-nope" id="scNope" aria-label="Next match"${more ? "" : " disabled"}>${ICONS.x}</button>
          <button class="act-btn act-like" id="scLike" aria-label="Learn more">${ICONS.heart}</button>
        </div>
      </div>
    </div>
    <div class="deck-dots">${dots}</div>`;
  wireCard();
}

// Expand/collapse is a class toggle, not a re-render — the drag handlers stay
// alive, so you can swipe in and out of the detail view as much as you want.
function setExpanded(v) {
  expanded = v;
  const el = document.getElementById("swipeCard");
  const like = document.getElementById("scLike");
  if (!el) return;
  el.classList.toggle("expanded", v);
  if (like) {
    like.innerHTML = v ? ICONS.up : ICONS.heart;
    like.setAttribute("aria-label", v ? "Close details" : "Learn more");
  }
}
function acceptCard() { setExpanded(true); }
function collapseCard() { setExpanded(false); }
function advanceCard() { deckIdx++; expanded = false; renderCard(); }

function flingNext(el) {
  el.style.transition = "transform .3s ease, opacity .3s ease";
  el.style.transform = "translateX(-140%) rotate(-18deg)";
  el.style.opacity = "0";
  setTimeout(advanceCard, 260);
}

// Side glows: a hint of red (left) and green (right) rests on the card edges at
// all times; dragging deepens the side you're heading toward.
function setGlow(el, x) {
  if (x === 0) { el.style.boxShadow = ""; return; } // CSS resting state
  const g = Math.min(0.8, 0.35 + Math.max(0, x) / 140);
  const r = Math.min(0.8, 0.35 + Math.max(0, -x) / 140);
  const gs = 22 + Math.min(18, Math.max(0, x) / 6);
  const rs = 22 + Math.min(18, Math.max(0, -x) / 6);
  el.style.boxShadow = `0 12px 34px rgba(0,0,0,.4), -12px 0 ${rs}px -12px rgba(227,25,55,${r}), 12px 0 ${gs}px -12px rgba(92,206,160,${g})`;
}

function wireCard() {
  const el = document.getElementById("swipeCard");
  if (!el) return;
  const more = deckIdx < deck.length - 1;
  document.getElementById("scLike")?.addEventListener("click", () => setExpanded(!expanded));
  document.getElementById("scNope")?.addEventListener("click", () => { if (more) flingNext(el); });

  let startX = 0, baseX = 0, dx = 0, dragging = false;
  el.addEventListener("pointerdown", e => {
    if (e.target.closest("button")) return; // let buttons click normally
    dragging = true; startX = e.clientX; dx = 0;
    // Pick up from wherever the card currently is (mid-snap-back re-grabs
    // shouldn't jump) — read the live transform as the new base.
    const t = getComputedStyle(el).transform;
    baseX = t && t !== "none" ? new DOMMatrixReadOnly(t).m41 : 0;
    try { el.setPointerCapture(e.pointerId); } catch {}
    el.style.transition = "none";
  });
  el.addEventListener("pointermove", e => {
    if (!dragging) return;
    dx = e.clientX - startX;
    const x = baseX + dx;
    el.style.transform = `translateX(${x}px) rotate(${x / 22}deg)`;
    setGlow(el, x);
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    const x = baseX + dx;
    el.style.transition = "transform .3s cubic-bezier(.2,.9,.3,1.2), opacity .3s ease";
    setGlow(el, 0);
    if (!expanded) {
      if (x > 80) { el.style.transform = ""; setExpanded(true); }
      else if (x < -80 && more) { flingNext(el); }
      else { el.style.transform = ""; }
    } else {
      // Swipe back out of the detail view.
      if (x < -80) { el.style.transform = ""; setExpanded(false); }
      else { el.style.transform = ""; }
    }
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}

// Laptop support: ← → arrow keys drive the deck whenever a card is on screen.
document.addEventListener("keydown", e => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const el = document.getElementById("swipeCard");
  if (!el || document.getElementById("results").classList.contains("hidden")) return;
  const more = deckIdx < deck.length - 1;
  if (expanded) {
    if (e.key === "ArrowLeft") collapseCard();
    else if (more) flingNext(el);
  } else {
    if (e.key === "ArrowRight") acceptCard();
    else if (more) flingNext(el);
  }
});

function restart(){
  document.getElementById("reveal").classList.add("hidden");
  document.documentElement.style.overflow = "";
  lastResults = null; deck = []; deckIdx = 0; expanded = false;
  qIdx = 0;
  Object.keys(answers).forEach(k=>delete answers[k]);
  document.getElementById("results").classList.add("hidden");
  document.getElementById("quiz").classList.remove("hidden");
  renderQ();
}

// Modules load deferred; the intro button stays disabled until handlers exist.
document.getElementById("btnStart").disabled = false;

// Inline onclick handlers in the HTML resolve against window.
Object.assign(window, { startQuiz, pick, goNext, goBack, restart, meetMatch });
