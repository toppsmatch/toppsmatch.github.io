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
let rebound = false;

function showResults() {
  document.getElementById("quiz").classList.add("hidden");

  const sc = score(answers, BRANDS);
  const sports = answers.sport || [];
  const top = topMatches(sc, sports, BRANDS, 3, maxScore(answers));
  const wcKey = wildcard(sc, top.map(t => t.key), sports, BRANDS);
  lastResults = { top, wcKey };
  submitResult(top[0].key);
  rebound = false;

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
  renderResults();
}

function toggleRebound() {
  if (!lastResults) return;
  rebound = !rebound;
  renderResults();
}

function renderResults() {
  const { top, wcKey } = lastResults;
  // Rebound swaps your #1 and #2 match.
  const order = rebound && top.length > 1 ? [top[1], top[0], ...top.slice(2)] : top;

  let html = "";
  order.forEach((m, i) => {
    const b = BRANDS[m.key];
    if (!b) return;
    const isTop = i === 0;
    const banner = rebound ? "💔 The Rebound" : "⭐ Your Perfect Pull";
    const profile =
      (b.lookingFor ? `<div class="profile-line"><strong>Looking for:</strong> ${esc(b.lookingFor)}</div>` : "") +
      (b.redFlag ? `<div class="profile-line"><strong>Red flag:</strong> ${esc(b.redFlag)}</div>` : "");
    html += `
    <div class="match${isTop ? " top" : ""}">
      ${isTop ? `<div class="match-banner">${banner}</div>` : ""}
      <div class="match-body">
        <div class="match-row">
          <div class="match-id">
            ${b.img ? `<img class="match-img" src="${esc(b.img)}" alt="${esc(b.name)}" loading="lazy">` : ""}
            <div>
              <div class="match-name">${esc(b.name)}</div>
              <div class="match-tier">${esc(b.tier)}</div>
              <span class="match-cat ${catClass(b.cat)}">${esc(b.catLabel)}</span>
            </div>
          </div>
          <div class="score-col">
            <div class="score-num">${m.pct}%</div>
            <div class="score-lbl">match</div>
          </div>
        </div>
        <div class="bar-wrap"><div class="bar" style="width:${m.pct}%"></div></div>
        <div class="match-desc">${esc(b.desc)}</div>
        ${profile}
        <div class="tags">
          <span class="tag price">📦 ${esc(b.price)}</span>
          ${(b.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join("")}
        </div>
      </div>
      ${isTop && top.length > 1 ? `<div class="match-body" style="padding-top:0">
        <button class="btn-rebound" onclick="toggleRebound()">${rebound ? "Take me back 💘" : "Not feeling it? Meet your rebound 💔"}</button>
      </div>` : ""}
    </div>`;
  });

  if (wcKey && BRANDS[wcKey]) {
    const wb = BRANDS[wcKey];
    html += `
    <div class="section-lbl">Venture Outside Your Comfort Zone</div>
    <div class="wildcard">
      <div class="wc-lbl">🃏 Wildcard Pick</div>
      <div class="wc-text">You didn't ask for this — but hear us out. <strong>${esc(wb.name)}</strong> (${esc(wb.price)}) is outside your usual lane. ${esc((wb.desc || "").split(".")[0])}.</div>
    </div>`;
  }

  document.getElementById("resultsContent").innerHTML = html;

  setTimeout(() => {
    document.querySelectorAll(".bar").forEach(el => {
      const w = el.style.width; el.style.width = "0%";
      setTimeout(() => el.style.width = w, 80);
    });
  }, 150);
}

function restart(){
  document.getElementById("reveal").classList.add("hidden");
  document.documentElement.style.overflow = "";
  rebound = false; lastResults = null;
  qIdx = 0;
  Object.keys(answers).forEach(k=>delete answers[k]);
  document.getElementById("results").classList.add("hidden");
  document.getElementById("quiz").classList.remove("hidden");
  renderQ();
}

// Modules load deferred; the intro button stays disabled until handlers exist.
document.getElementById("btnStart").disabled = false;

// Inline onclick handlers in the HTML resolve against window.
Object.assign(window, { startQuiz, pick, goNext, goBack, restart, meetMatch, toggleRebound });
