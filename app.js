import { BRANDS, QUESTIONS } from "./data.js?v=1784580713";
import { score, topMatches, wildcard, maxScore } from "./scoring.js?v=1784580713";

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
    html += `<div class="rank-tag">🏅 Tap in order: #1 matters most</div>`;
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
  document.getElementById("revealName").textContent = `You + ${b.name}`;
  document.getElementById("revealPct").textContent = `${top[0].pct}% compatible`;
  document.documentElement.style.overflow = "hidden";
  document.getElementById("reveal").classList.remove("hidden");
  runSpinReveal(b);
}

// Slot-machine reveal: the card whips through other products and eases out to
// land on the match. rotateY is driven by rAF; the face image swaps while the
// card is edge-on (90°/270°) so each half-turn shows a new product, and the
// inner image counter-flips on the "back" half so it never renders mirrored.
function runSpinReveal(b) {
  const reveal = document.getElementById("reveal");
  const card = document.getElementById("spinCard");
  const img = document.getElementById("revealImg");
  const namecard = document.getElementById("spinNamecard");
  reveal.classList.remove("landed");
  img.alt = b.name || "";
  img.style.display = "";
  namecard.style.display = "none";
  namecard.textContent = b.name || "";

  const land = () => {
    card.style.transform = "";
    img.style.transform = "";
    namecard.style.transform = "";
    if (b.img) img.src = b.img;
    else { img.style.display = "none"; img.removeAttribute("src"); namecard.style.display = "flex"; }
    reveal.classList.add("landed");
    spawnConfetti();
    // Pre-render the share card now so the share button can hand a ready blob
    // to navigator.share() inside its tap's transient activation (Safari drops
    // the share sheet if the gesture goes stale while a canvas renders).
    sharePromise = buildShareCard(b, lastResults.top[0].pct).catch(() => null);
  };
  // Faces the spin flashes through: other products, the match itself last.
  const others = Object.values(BRANDS).filter(o => o.img && o.img !== b.img).map(o => o.img);
  for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [others[i], others[j]] = [others[j], others[i]]; }

  // Reduced motion (common iPhone accessibility setting): no 3D spin, but the
  // reveal still cycles a few products with soft opacity crossfades, so the
  // moment reads without motion that triggers vestibular symptoms.
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const calm = others.slice(0, 4);
    if (!calm.length) { land(); return; }
    calm.forEach(src => { new Image().src = src; });
    img.style.transition = "opacity .16s ease";
    let k = -1;
    (function step() {
      img.style.opacity = "0";
      setTimeout(() => {
        k++;
        if (k >= calm.length) { img.style.transition = ""; img.style.opacity = ""; land(); return; }
        img.src = calm[k];
        img.style.display = "";
        namecard.style.display = "none";
        img.style.opacity = "1";
        setTimeout(step, 360);
      }, 170);
    })();
    return;
  }
  const TURNS = 5; // 10 half-turn face swaps
  const faces = others.slice(0, TURNS * 2);
  faces.forEach(src => { new Image().src = src; }); // warm the cache
  faces.push(b.img || null); // null face = the namecard shows at landing
  img.src = faces[0];

  const DUR = 2800, TOTAL = TURNS * 360;
  const ease = t => 1 - Math.pow(1 - t, 3);
  let start = null, lastFace = 0;
  function frame(now) {
    if (start === null) start = now;
    const t = Math.min((now - start) / DUR, 1);
    const deg = ease(t) * TOTAL;
    const face = Math.min(Math.floor((deg + 90) / 180), faces.length - 1);
    if (face !== lastFace) {
      lastFace = face;
      const src = faces[face];
      if (src) { img.src = src; img.style.display = ""; namecard.style.display = "none"; }
      else { img.style.display = "none"; namecard.style.display = "flex"; }
    }
    const m = deg % 360;
    const flip = (m > 90 && m < 270) ? "rotateY(180deg)" : "";
    img.style.transform = flip;
    namecard.style.transform = flip;
    card.style.transform = `rotateY(${deg}deg)`;
    if (t < 1) requestAnimationFrame(frame);
    else land();
  }
  requestAnimationFrame(frame);
}

// Confetti loops for as long as the reveal is up (Gus's call, July 17: the
// party doesn't stop). The overlay goes display:none once dismissed, so the
// endless animation costs nothing after Meet Your Match.
function spawnConfetti() {
  const wrap = document.getElementById("confettiWrap");
  const colors = ["#E53C2E", "#FFFFFF", "#DDE0E0", "#F4A9A1", "#3D5170", "#FFFFFF"];
  wrap.innerHTML = Array.from({ length: 28 }, (_, i) => {
    const left = (i * 37) % 100;
    const delay = (i % 7) * 0.35;
    const dur = 2.2 + (i % 5) * 0.4;
    return `<span class="confetti" style="left:${left}%;background:${colors[i % colors.length]};animation-duration:${dur}s;animation-delay:${delay}s"></span>`;
  }).join("");
}

// ─── SHARE CARD (9:16 story image via canvas -> native share sheet) ──────────
let sharePromise = null;

async function shareMatch(btn) {
  if (!lastResults || !sharePromise) return;
  if (btn) btn.disabled = true;
  const m = lastResults.top[0];
  const b = BRANDS[m.key];
  try {
    const blob = await sharePromise;
    if (!blob) return;
    const file = new File([blob], "toppsmatch.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: "ToppsMatch",
        text: `I matched with ${b.name} 💘 ${m.pct}% compatible. Find yours: https://toppsmatch.github.io`,
      });
    } else {
      // Laptop fallback: save the image so it can be posted anywhere.
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "toppsmatch.png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    }
  } catch { /* share sheet dismissed — nothing to do */ }
  if (btn) btn.disabled = false;
}

// Keep in sync with the img[src*=...] white-tile rule in styles.css.
const TILE_SRCS = ["definitive", "diamond_icons", "dynasty_f1", "inception.", "pristine", "royalty_tennis"];

function loadImg(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function buildShareCard(b, pct) {
  await Promise.all([
    document.fonts.load('90px "Fan Impact"'),
    document.fonts.load('800 54px "Fan Sans"'),
    document.fonts.load('italic 44px "Fan Serif"'),
  ]).catch(() => {});
  const img = b.img ? await loadImg(b.img).catch(() => null) : null;
  // The share card is 9:16, so it uses the portrait wall (no crop needed).
  const wall = await loadImg("img/brand-wall-mobile.webp").catch(() => null);

  const W = 1080, H = 1920;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");

  const bg = ctx.createRadialGradient(W / 2, 760, 80, W / 2, 900, 1250);
  bg.addColorStop(0, "#16305e"); bg.addColorStop(.55, "#091F40"); bg.addColorStop(1, "#060f22");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  // the brand-wall collage as a dim texture. Blur via three smoothed
  // downscale/upscale passes — ctx.filter isn't reliable on Safari, and a
  // single tiny round-trip (the old 108px hack) upscales into pixel blocks.
  if (wall) {
    const pass = (src, w, h) => {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const cc = c.getContext("2d");
      cc.imageSmoothingQuality = "high";
      cc.drawImage(src, 0, 0, w, h);
      return c;
    };
    const crop = document.createElement("canvas");
    crop.width = W; crop.height = H;
    const cx2 = crop.getContext("2d");
    const s = Math.max(W / wall.naturalWidth, H / wall.naturalHeight);
    const ww = wall.naturalWidth * s, wh = wall.naturalHeight * s;
    cx2.drawImage(wall, (W - ww) / 2, (H - wh) / 2, ww, wh);
    const soft = pass(pass(pass(crop, 270, 480), 135, 240), 270, 480);
    ctx.globalAlpha = .2;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(soft, 0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  // sunburst rays radiating from the product, fading out with distance
  ctx.save();
  ctx.translate(W / 2, 940);
  const iceRay = ctx.createRadialGradient(0, 0, 70, 0, 0, 900);
  iceRay.addColorStop(0, "rgba(185,196,217,.32)"); iceRay.addColorStop(1, "rgba(185,196,217,0)");
  const whiteRay = ctx.createRadialGradient(0, 0, 70, 0, 0, 900);
  whiteRay.addColorStop(0, "rgba(255,255,255,.17)"); whiteRay.addColorStop(1, "rgba(255,255,255,0)");
  for (let i = 0; i < 24; i++) {
    const a0 = i * Math.PI / 12 + .12, a1 = a0 + Math.PI / 22;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 900, a0, a1); ctx.closePath();
    ctx.fillStyle = i % 2 ? iceRay : whiteRay;
    ctx.fill();
  }
  ctx.restore();

  // scattered confetti, deterministic so every card looks composed
  const colors = ["#E53C2E", "#FFFFFF", "#E7C24F", "#3D5170", "#F4A9A1"];
  for (let i = 0; i < 90; i++) {
    const x = (i * 397.31) % W, y = (i * 211.7 + 137) % H;
    if (Math.abs(x - W / 2) < 360 && y > 460 && y < 1360) continue; // keep the middle clean
    ctx.save();
    ctx.translate(x, y); ctx.rotate((i * 47) % 360 * Math.PI / 180);
    ctx.globalAlpha = .22 + (i % 4) * .1;
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(-5, -9, 10, 18);
    ctx.restore();
  }

  // Top: eyebrow only. The big TOPPSMATCH wordmark moved to the bottom CTA
  // cluster so it stops twinning with the hero title (Gus, July 20).
  ctx.textAlign = "center";
  ctx.fillStyle = "#B9C4D9";
  ctx.font = '700 26px "Fan Sans", sans-serif';
  drawSpaced(ctx, "TOPPS × FANATICS COLLECTIBLES", W / 2, 150, 8);

  // hero title with a heart-and-arrow on either side, shrunk to fit
  let titleSize = 126, heartSize = 84, gap = 36;
  const fitTitle = () => {
    ctx.font = `${titleSize}px "Fan Impact", sans-serif`;
    const tw = ctx.measureText("IT'S A MATCH!").width;
    ctx.font = `${heartSize}px serif`;
    const hw = ctx.measureText("💘").width;
    return { tw, hw, total: tw + 2 * (hw + gap) };
  };
  let dims = fitTitle();
  while (dims.total > W - 60 && titleSize > 80) { titleSize -= 4; heartSize -= 2; dims = fitTitle(); }
  ctx.fillStyle = "#E53C2E";
  ctx.font = `${titleSize}px "Fan Impact", sans-serif`;
  ctx.shadowColor = "rgba(229,60,46,.5)"; ctx.shadowBlur = 60;
  ctx.fillText("IT'S A MATCH!", W / 2, 360);
  ctx.shadowBlur = 0;
  ctx.font = `${heartSize}px serif`;
  ctx.fillText("💘", W / 2 - dims.tw / 2 - gap - dims.hw / 2, 352);
  ctx.fillText("💘", W / 2 + dims.tw / 2 + gap + dims.hw / 2, 352);

  // spotlight pool under the product
  {
    const fy = 1290;
    const floor = ctx.createRadialGradient(W / 2, fy, 10, W / 2, fy, 330);
    floor.addColorStop(0, "rgba(200,215,245,.26)");
    floor.addColorStop(.5, "rgba(255,255,255,.06)");
    floor.addColorStop(1, "rgba(255,255,255,0)");
    ctx.save();
    ctx.translate(W / 2, fy); ctx.scale(1, .22); ctx.translate(-W / 2, -fy);
    ctx.fillStyle = floor;
    ctx.fillRect(W / 2 - 340, fy - 340, 680, 680);
    ctx.restore();
  }

  if (img) {
    const box = 680, cx = W / 2, cy = 940;
    const s = Math.min(box / img.naturalWidth, box / img.naturalHeight);
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    if (TILE_SRCS.some(t => b.img.includes(t))) {
      ctx.save();
      roundRect(ctx, cx - w / 2 - 24, cy - h / 2 - 24, w + 48, h + 48, 28);
      ctx.shadowColor = "rgba(0,0,0,.55)"; ctx.shadowBlur = 70; ctx.shadowOffsetY = 30;
      ctx.fillStyle = "#fff"; ctx.fill();
      ctx.restore();
      ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
    } else {
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.6)"; ctx.shadowBlur = 70; ctx.shadowOffsetY = 30;
      ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
      ctx.restore();
    }
  } else {
    // No product shot: draw the same light name card the reveal shows
    const cw = 520, ch = 600, cx = W / 2, cy = 940;
    ctx.save();
    roundRect(ctx, cx - cw / 2, cy - ch / 2, cw, ch, 40);
    ctx.shadowColor = "rgba(0,0,0,.55)"; ctx.shadowBlur = 70; ctx.shadowOffsetY = 30;
    const tile = ctx.createLinearGradient(cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2);
    tile.addColorStop(0, "#F4F6FA"); tile.addColorStop(1, "#DDE0E0");
    ctx.fillStyle = tile; ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#091F40";
    ctx.font = '64px "Fan Impact", sans-serif';
    const words = (b.name || "").toUpperCase().split(" ");
    const lines = [];
    let line = "";
    for (const wd of words) {
      const tryLine = line ? line + " " + wd : wd;
      if (ctx.measureText(tryLine).width > cw - 90 && line) { lines.push(line); line = wd; }
      else line = tryLine;
    }
    if (line) lines.push(line);
    lines.slice(0, 4).forEach((l, i) => ctx.fillText(l, cx, cy - (lines.length - 1) * 40 + i * 80 + 20));
  }

  ctx.fillStyle = "#fff";
  let nameSize = 56;
  ctx.font = `800 ${nameSize}px "Fan Sans", sans-serif`;
  while (ctx.measureText(`You + ${b.name}`).width > W - 100 && nameSize > 34) {
    nameSize -= 2;
    ctx.font = `800 ${nameSize}px "Fan Sans", sans-serif`;
  }
  ctx.fillText(`You + ${b.name}`, W / 2, 1430);

  ctx.fillStyle = "#E7C24F";
  ctx.font = 'italic 56px "Fan Serif", serif';
  ctx.shadowColor = "rgba(231,194,79,.45)"; ctx.shadowBlur = 40;
  ctx.fillText(`${pct}% compatible`, W / 2, 1532);
  ctx.shadowBlur = 0;

  // CTA cluster: small wordmark, invitation line, then the link
  ctx.font = '46px "Fan Impact", sans-serif';
  const mw = ctx.measureText("TOPPS").width + ctx.measureText("MATCH").width;
  ctx.textAlign = "left";
  ctx.fillStyle = "#fff"; ctx.fillText("TOPPS", (W - mw) / 2, 1706);
  ctx.fillStyle = "#E53C2E"; ctx.fillText("MATCH", (W - mw) / 2 + ctx.measureText("TOPPS").width, 1706);
  ctx.textAlign = "center";

  ctx.fillStyle = "#B9C4D9";
  ctx.font = '600 34px "Fan Sans", sans-serif';
  ctx.fillText("Find yours in two minutes", W / 2, 1768);

  ctx.fillStyle = "#fff";
  ctx.font = '700 32px "Fan Sans", sans-serif';
  drawSpaced(ctx, "TOPPSMATCH.GITHUB.IO", W / 2, 1836, 10);

  return new Promise(res => cv.toBlob(res, "image/png"));
}

// canvas has no letter-spacing; draw char by char around the center
function drawSpaced(ctx, text, cx, y, gap) {
  const widths = [...text].map(c => ctx.measureText(c).width);
  const total = widths.reduce((a, w) => a + w, 0) + gap * (text.length - 1);
  let x = cx - total / 2;
  const align = ctx.textAlign; ctx.textAlign = "left";
  [...text].forEach((c, i) => { ctx.fillText(c, x, y); x += widths[i] + gap; });
  ctx.textAlign = align;
}

function meetMatch() {
  document.documentElement.style.overflow = "";
  document.getElementById("reveal").classList.add("hidden");
  document.getElementById("results").classList.remove("hidden");
  // Results are card-first on a small screen: hide the page/results headers.
  document.body.classList.add("in-results");
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
  if (deckIdx >= deck.length) { renderListView(); return; }
  const card = deck[deckIdx];
  const waiting = deck.length - deckIdx - 1;
  const dots = deck.map((_, i) => `<span class="dot${i === deckIdx ? " on" : ""}"></span>`).join("");
  host.innerHTML = `
    <div class="deck">
      ${waiting > 1 ? `<div class="fan fan2"></div>` : ""}
      ${waiting > 0 ? `<div class="fan fan1"></div>` : ""}
      <div class="swipe-card${card.pct == null ? " wild" : ""}" id="swipeCard">
        <span class="chev chev-l">‹</span><span class="chev chev-r">›</span>
        ${cardInner(card)}
        <div class="swipe-actions">
          <button class="act-btn act-nope" id="scNope" aria-label="${waiting ? "Next match" : "See the full list"}">${ICONS.x}</button>
          <button class="act-btn act-like" id="scLike" aria-label="Learn more">${ICONS.heart}</button>
        </div>
      </div>
    </div>
    <div class="deck-dots">${dots}</div>`;
  wireCard();
}

// After the last card, everything lands in a classic list view (the original
// pre-swipe results page) so people can compare all their matches at once.
function renderListView() {
  const host = document.getElementById("resultsContent");
  const { top, wcKey } = lastResults;
  const labels = ["⭐ Your Perfect Pull", "💔 The Rebound", "✨ Also Sparked"];
  let html = `<div class="list-head"><span>Your full lineup</span><button class="btn-mini" id="swipeAgain">↺ Swipe again</button></div>`;
  top.forEach((m, i) => {
    const b = BRANDS[m.key];
    if (!b) return;
    const profile =
      (b.lookingFor ? `<div class="profile-line"><strong>Looking for:</strong> ${esc(b.lookingFor)}</div>` : "") +
      (b.redFlag ? `<div class="profile-line"><strong>Red flag:</strong> ${esc(b.redFlag)}</div>` : "");
    html += `
    <div class="match${i === 0 ? " top" : ""}">
      <div class="match-banner${i === 0 ? "" : " alt"}">${labels[i] || "Another Match"}</div>
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
    </div>`;
  });
  if (wcKey && BRANDS[wcKey]) {
    const wb = BRANDS[wcKey];
    html += `
    <div class="section-lbl">Venture Outside Your Comfort Zone</div>
    <div class="wildcard">
      <div class="wc-lbl">🃏 Wildcard Pick</div>
      <div class="wc-text">You didn't ask for this, but hear us out. <strong>${esc(wb.name)}</strong> (${esc(wb.price)}) is outside your usual lane. ${esc((wb.desc || "").split(".")[0])}.</div>
    </div>`;
  }
  host.innerHTML = html;
  document.getElementById("swipeAgain")?.addEventListener("click", () => { buildDeck(); renderCard(); });
  setTimeout(() => {
    document.querySelectorAll(".bar").forEach(el => {
      const w = el.style.width; el.style.width = "0%";
      setTimeout(() => el.style.width = w, 80);
    });
  }, 150);
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

// Side glows: a hint of Lava Red (left) and steel blue (right) rests on the
// card edges at all times; dragging deepens the side you're heading toward.
function setGlow(el, x) {
  if (x === 0) { el.style.boxShadow = ""; return; } // CSS resting state
  const b = Math.min(0.9, 0.5 + Math.max(0, x) / 140);
  const r = Math.min(0.9, 0.5 + Math.max(0, -x) / 140);
  const bs = 22 + Math.min(18, Math.max(0, x) / 6);
  const rs = 22 + Math.min(18, Math.max(0, -x) / 6);
  el.style.boxShadow = `0 16px 38px rgba(0,0,0,.4), -12px 0 ${rs}px -12px rgba(229,60,46,${r}), 12px 0 ${bs}px -12px rgba(157,177,212,${b})`;
}

function wireCard() {
  const el = document.getElementById("swipeCard");
  if (!el) return;
  document.getElementById("scLike")?.addEventListener("click", () => setExpanded(!expanded));
  document.getElementById("scNope")?.addEventListener("click", () => flingNext(el));

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
      else if (x < -80) { flingNext(el); } // past the last card -> list view
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
  if (expanded) {
    if (e.key === "ArrowLeft") collapseCard();
    else flingNext(el);
  } else {
    if (e.key === "ArrowRight") acceptCard();
    else flingNext(el);
  }
});

function restart(){
  document.getElementById("reveal").classList.add("hidden");
  document.documentElement.style.overflow = "";
  document.body.classList.remove("in-results");
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
Object.assign(window, { startQuiz, pick, goNext, goBack, restart, meetMatch, shareMatch });
