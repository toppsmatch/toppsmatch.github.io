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

// 400px webp thumb for any product image: card faces and the spin wheel show
// at <=200px, so thumbs (~25KB) are sharper than needed and load instantly —
// full PNGs (~600KB) streamed in mid-animation as ugly partial slivers.
const thumbSrc = src => src.replace(/^img\//, "img/thumbs/").replace(/\.png$/, ".webp");


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

function renderQ(animate = true){
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
  // Replay the entrance animation only when arriving at a question. Re-renders
  // from picking an option keep the card still (Gus, July 20: no blinking).
  if (animate) {
    card.style.animation = "none";
    card.offsetHeight;
    card.style.animation = "";
  }
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
  renderQ(false);
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
  // fresh seed per quiz run: ties rotate between retakes instead of always
  // breaking the same way (pending Noah's sign-off)
  const top = topMatches(sc, sports, BRANDS, 3, maxScore(answers), 1 + Math.floor(Math.random() * 2147483646));
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
  // Mid-spin faces use 400px webp thumbs (~25KB vs ~600KB full PNGs) so the
  // wheel streams full variety on any connection; only the landing is full-res.
  const others = Object.values(BRANDS).filter(o => o.img && o.img !== b.img).map(o => thumbSrc(o.img));
  for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [others[i], others[j]] = [others[j], others[i]]; }

  // Reduced motion (common iPhone accessibility setting): no 3D spin, but the
  // reveal still cycles a few products with soft opacity crossfades, so the
  // moment reads without motion that triggers vestibular symptoms.
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const calm = others.slice(0, 4);
    if (!calm.length) { land(); return; }
    calm.forEach(src => { new Image().src = src; });
    if (b.img) { const i = new Image(); i.src = b.img; i.decode?.().catch(() => {}); } // landing shot decodes during the crossfades
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
  // READY-POOL WHEEL. The old design swapped src through a fixed face list
  // mid-spin and prayed each PNG was decoded in time — on phones it never
  // reliably was (blank flashes, skipped faces, empty stage: pick a browser,
  // pick a failure). The wheel now draws every face from a pool that only
  // contains FULLY DECODED images, filled in the background. By construction
  // it cannot show a blank or half-loaded face. The pool keeps growing while
  // the wheel spins, so variety improves with every half-turn.
  const TURNS = 5; // 10 half-turn face swaps, then the match
  const LAST = TURNS * 2;
  // ready(src, cb): fire cb exactly once when the image is usable. decode()
  // is the ideal signal but hangs/rejects on some engines, so the load event
  // is a fallback — a loaded-but-undecoded face beats an absent one.
  const ready = (src, cb, priority) => {
    const im = new Image();
    if (priority) im.fetchPriority = "high";
    let done = false;
    const fire = () => { if (!done) { done = true; cb(); } };
    im.onload = () => setTimeout(fire, 50); // grace for decode-on-paint
    im.src = src;
    if (im.decode) im.decode().then(fire, () => setTimeout(fire, 120));
  };
  let matchReady = !b.img; // no art: the namecard is always "ready"
  if (b.img) ready(b.img, () => { matchReady = true; }, true); // match first, highest priority
  const pool = [];
  others.slice(0, 24).forEach(src => ready(src, () => pool.push(src)));
  let poolIdx = 0;
  const nextFace = () => pool.length ? pool[poolIdx++ % pool.length] : null;

  const DUR = 2800, TOTAL = TURNS * 360;
  const ease = t => 1 - Math.pow(1 - t, 3);
  let start = null, lastFace = 0;
  function frame(now) {
    if (start === null) start = now;
    const t = Math.min((now - start) / DUR, 1);
    const deg = ease(t) * TOTAL;
    const face = Math.min(Math.floor((deg + 90) / 180), LAST);
    if (face !== lastFace) {
      lastFace = face;
      // final face: the match itself, but only once decoded (else one more
      // pool face fills the beat and land() completes the swap)
      const src = face >= LAST ? (matchReady ? b.img : nextFace()) : nextFace();
      if (face >= LAST && !b.img) { img.style.display = "none"; namecard.style.display = "flex"; }
      else if (src) { img.src = src; img.style.display = ""; namecard.style.display = "none"; }
    }
    const m = deg % 360;
    const flip = (m > 90 && m < 270) ? "rotateY(180deg)" : "";
    img.style.transform = flip;
    namecard.style.transform = flip;
    card.style.transform = `rotateY(${deg}deg)`;
    if (t < 1) requestAnimationFrame(frame);
    else land();
  }
  // start as soon as the first face is decoded (600ms ceiling so a dead
  // network can't hold the stage); hidden until then so an src-less img
  // never paints as an empty white square
  card.style.visibility = "hidden";
  const t0 = performance.now();
  (function waitFirst() {
    if (pool.length || performance.now() - t0 > 600) {
      const first = nextFace() || others[0]; // dead-network fallback: progressive render beats nothing
      if (first) img.src = first;
      card.style.visibility = "";
      requestAnimationFrame(frame);
    } else requestAnimationFrame(waitFirst);
  })();
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
  // Pre-blurred 1080x1920 wall, baked offline at full res (a real Gaussian).
  // Runtime rescale-blur always upscaled a tiny buffer into pixel blocks.
  const wall = await loadImg("img/share-bg.webp?v=2").catch(() => null);

  const W = 1080, H = 1920;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");

  const bg = ctx.createRadialGradient(W / 2, 760, 80, W / 2, 900, 1250);
  bg.addColorStop(0, "#16305e"); bg.addColorStop(.55, "#091F40"); bg.addColorStop(1, "#060f22");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  // the brand-wall collage as a dim texture, already blurred in the asset
  if (wall) {
    ctx.globalAlpha = .2;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(wall, 0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  // sunburst rays radiating from the product, fading out with distance
  ctx.save();
  ctx.translate(W / 2, 840);
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
    if (Math.abs(x - W / 2) < 360 && y > 420 && y < 1260) continue; // keep the middle clean
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
    const fy = 1190;
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
    const box = 680, cx = W / 2, cy = 840;
    const s = Math.min(box / img.naturalWidth, box / img.naturalHeight);
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.6)"; ctx.shadowBlur = 70; ctx.shadowOffsetY = 30;
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
    ctx.restore();
  } else {
    // No product shot: draw the same light name card the reveal shows
    const cw = 520, ch = 600, cx = W / 2, cy = 840;
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
  ctx.fillText(`You + ${b.name}`, W / 2, 1330);

  ctx.fillStyle = "#E7C24F";
  ctx.font = 'italic 56px "Fan Serif", serif';
  ctx.shadowColor = "rgba(231,194,79,.45)"; ctx.shadowBlur = 40;
  ctx.fillText(`${pct}% compatible`, W / 2, 1432);
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
let firstDeckRender = true;
function buildDeck() {
  firstDeckRender = true;
  const { top, wcKey } = lastResults;
  const labels = ["⭐ Your Perfect Pull", "💔 The Rebound", "💡 Also Sparked"];
  deck = top.map((m, i) => ({ key: m.key, pct: m.pct, label: labels[i] || "Another Match" }));
  if (wcKey && BRANDS[wcKey]) deck.push({ key: wcKey, pct: null, label: "🃏 Wildcard" });
  deckIdx = 0;
  expanded = false;
  // pre-decode every deck image so card flips repaint without an iOS decode flash
  deck.forEach(c => {
    const src = BRANDS[c.key]?.img;
    if (src) { const im = new Image(); im.src = thumbSrc(src); im.decode?.().catch(() => {}); }
  });
}

// Icon set for the action buttons (inline SVG renders identically everywhere,
// unlike ✕/♥ glyphs which vary by platform font).
const ICONS = {
  x: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  heart: `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 21s-7.6-4.9-10-9.5C.6 8.8 2.5 5 6.2 5c2 0 3.6 1.1 4.3 2.7h1c.7-1.6 2.3-2.7 4.3-2.7 3.7 0 5.6 3.8 4.2 6.5C19.6 16.1 12 21 12 21z"/></svg>`,
  up: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 14.5l7-7 7 7"/></svg>`,
};

function cardInner(card, deco = false) {
  const b = BRANDS[card.key];
  const img = b.img
    ? `<img class="sc-img" src="${esc(thumbSrc(b.img))}" alt="${esc(b.name)}" loading="eager" decoding="sync">`
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
    <div class="sc-tier">${esc((b.tier || "").split("|")[0].trim())}</div>
    <div class="sc-cat"><span class="match-cat ${catClass(b.cat)}">${esc(b.catLabel)}</span></div>
    ${pct}
    <div class="sc-detail"><div class="sc-detail-in">
      ${teaser}
      <div class="match-desc">${esc(b.desc)}</div>
      <div class="tags">
        <span class="tag price">📦 ${esc(b.price)}</span>
        ${(b.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join("")}
      </div>
    </div></div>${deco ? '<button class="more-toggle" tabindex="-1" aria-hidden="true">Learn more \u25be</button>' : ""}`;
}

function renderCard() {
  const host = document.getElementById("resultsContent");
  if (deckIdx >= deck.length) { renderListView(); return; }
  const card = deck[deckIdx];
  // only the ranked matches count as grey cards in the pile; the wildcard
  // stays invisible until it "randomly" appears after the last real card
  const waiting = deck.slice(deckIdx + 1).filter(c => c.pct != null).length;
  const regular = deck.filter(c => c.pct != null);
  const dots = regular.map((_, i) => `<span class="dot${i === deckIdx ? " on" : ""}"></span>`).join("")
    + (card.pct == null ? `<span class="dot gold on"></span>` : "");
  // Sheets under the top card show the REAL neighbor cards, so a mid-swipe
  // reveal is never blank; past the last card it teases the list view.
  const next = deck[deckIdx + 1];
  // the sheet under the top card is ALWAYS the next card down: the card you
  // return to comes from the bottom of the pile, never from under the top
  const underNext = next
    ? `<div class="fan fan-under fan-next${next.pct == null ? " wild" : ""}">${cardInner(next, true)}</div>`
    : `<div class="fan fan-under fan-next fan-lineup"><div class="fan-lineup-in">Your full lineup ↓</div></div>`;
  host.innerHTML = `
    <div class="deck" id="deckEl">
      <div class="fan fan2"></div>
      <div class="fan fan1"></div>
      ${underNext}
      <div class="swipe-card${card.pct == null ? " wild" : ""}${firstDeckRender ? "" : " no-anim"}" id="swipeCard">
        <button class="chev chev-l" id="chevL" aria-label="Previous match"${deckIdx === 0 ? " disabled" : ""}>‹</button>
        <button class="chev chev-r" id="chevR" aria-label="Next match">›</button>
        ${cardInner(card)}
        <button class="more-toggle" id="scMore">Learn more ▾</button>
      </div>
    </div>
    <div class="deck-dots">${dots}</div>`;
  firstDeckRender = false;
  wireCard();
  requestAnimationFrame(sizeFans);
}

// Sheets mirror the top card's exact box so the stack reads as one deck —
// no sheet ever pokes out below a shorter top card.
function sizeFans() {
  const el = document.getElementById("swipeCard");
  if (!el || expanded || detailAnim) return; // the pile never grows with the front card
  document.querySelectorAll("#deckEl .fan").forEach(f => {
    f.style.top = el.offsetTop + "px";
    f.style.height = el.offsetHeight + "px";
    f.style.bottom = "auto";
    // the under-sheet plays "the next card": match the real card's footprint
    // exactly, or its wildcard frame peeks past the top card's edges
    if (f.classList.contains("fan-under")) f.style.width = el.offsetWidth + "px";
  });
}

// After the last card, everything lands in a classic list view (the original
// pre-swipe results page) so people can compare all their matches at once.
function renderListView() {
  const host = document.getElementById("resultsContent");
  const { top, wcKey } = lastResults;
  const labels = ["⭐ Your Perfect Pull", "💔 The Rebound", "💡 Also Sparked"];
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
            ${b.img ? `<img class="match-img" src="${esc(thumbSrc(b.img))}" alt="${esc(b.name)}" loading="lazy">` : ""}
            <div>
              <div class="match-name">${esc(b.name)}</div>
              <div class="match-tier">${esc((b.tier || "").split("|")[0].trim())}</div>
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

// Expand/collapse is a class toggle, not a re-render — drag handlers stay alive.
let detailAnim = 0; // truthy while the learn-more accordion is in flight
function setExpanded(v) {
  expanded = v;
  const el = document.getElementById("swipeCard");
  if (!el) return;
  el.classList.toggle("expanded", v);
  // Freeze the pile while the accordion runs, both directions: the sheets
  // stay visible and must not change in ANY way. The post-settle re-sync runs
  // with transitions suppressed so even a 1px correction can't animate.
  clearTimeout(detailAnim);
  detailAnim = setTimeout(() => {
    detailAnim = 0;
    const fans = document.querySelectorAll("#deckEl .fan");
    fans.forEach(f => f.style.transition = "none");
    sizeFans();
    requestAnimationFrame(() => fans.forEach(f => f.style.transition = ""));
  }, 420);
  const btn = document.getElementById("scMore");
  if (btn) btn.textContent = v ? "Show less ▴" : "Learn more ▾";
}

// Carousel navigation with deck-physics: going forward the card flies out
// and tucks into the BACK of the pile; going back the previous card rises
// from the pile to the front. flyX < 0 means forward.
let settleNav = null; // hard-finishes the in-flight flip; overlapping flips compound transforms
// Step relative to where the deck ACTUALLY is: a tap that lands mid-flip must
// settle the flip first, then step from the settled index — computing the
// target from a stale deckIdx made rapid taps eat inputs.
function goStep(delta, flyX) {
  if (settleNav) settleNav();
  const t = deckIdx + delta;
  if (t < 0 || t >= deck.length) return;
  goTo(t, flyX);
}
function goTo(i, flyX) {
  if (settleNav) settleNav(); // settle the previous flip's end state FIRST (fresh DOM below)
  const el = document.getElementById("swipeCard");
  const deckEl = document.getElementById("deckEl");
  const land = () => { settleNav = null; deckIdx = i; expanded = false; renderCard(); };
  if (!el || !deckEl || matchMedia("(prefers-reduced-motion: reduce)").matches) { land(); return; }
  if (expanded) setExpanded(false); // details retract as the card leaves
  if (flyX < 0) {
    const fanU = deckEl.querySelector(".fan-under"), fan1 = deckEl.querySelector(".fan1"), fan2 = deckEl.querySelector(".fan2");
    // capture each slot's transform before anything moves
    const underT = fanU ? getComputedStyle(fanU).transform : null;
    const fan1T = fan1 ? getComputedStyle(fan1).transform : null;
    el.style.transition = "transform .2s ease-in";
    el.style.transform = "translateX(-115%) rotate(-10deg)";
    let tuckTimer = 0, landTimer = 0;
    settleNav = () => { clearTimeout(tuckTimer); clearTimeout(landTimer); land(); };
    tuckTimer = setTimeout(() => {
      el.style.zIndex = "-1"; // slip beneath the sheets, fully visible the whole way
      el.style.transition = "transform .3s ease-out";
      // tuck into the back slot (keep in sync with .fan2 in styles.css)
      el.style.transform = innerWidth <= 430
        ? "translate(-27px,20px) rotate(-7deg) scale(.93)"
        : "translate(-52px,32px) rotate(-11deg) scale(.92)";
      // its content clears while it tucks, so the landing matches the empty back sheet
      el.classList.add("tuck-fade");
      // the stack rises one slot to meet it: the under-sheet glides up into the
      // top position, the middle sheet becomes the under-sheet (next card's
      // content fades in on it), and the back sheet steps up to the middle
      if (fanU) {
        fanU.style.transition = "transform .3s ease-out";
        fanU.style.transform = "translate(-50%,0) rotate(0deg) scale(1)";
      }
      if (fan1 && underT) {
        if (deck[i + 1]) {
          fan1.classList.add("fade-content");
          fan1.innerHTML = cardInner(deck[i + 1], true);
          requestAnimationFrame(() => fan1.classList.remove("fade-content"));
        }
        fan1.style.transition = "transform .3s ease-out";
        fan1.style.transform = underT;
      }
      if (fan2 && fan1T) {
        fan2.style.transition = "transform .3s ease-out";
        fan2.style.transform = fan1T;
      }
      landTimer = setTimeout(land, 290);
    }, 190);
  } else {
    // Honest shuffle: the returning card starts exactly where the forward
    // animation tucks cards (bottom of the pile, BENEATH every sheet), pulls
    // out to the left from underneath, then arcs up and lands on top. While
    // it lands, the rest of the stack settles down one slot: top card sinks
    // into the under-sheet position, under-sheet recedes into the middle,
    // middle sheet drops to the back. Fully opaque the whole way.
    const isWild = deck[i].pct == null;
    const ghost = document.createElement("div");
    ghost.className = "fan card-ghost" + (isWild ? " wild" : "");
    ghost.innerHTML = cardInner(deck[i], true);
    el.style.zIndex = "2"; // the dragged card glides home above the traveler
    el.style.transition = "transform .25s ease";
    el.style.transform = "";
    const fanU = deckEl.querySelector(".fan-under"), fan1 = deckEl.querySelector(".fan1"), fan2 = deckEl.querySelector(".fan2");
    const start = fan2 ? getComputedStyle(fan2).transform : "translate(calc(-50% - 52px),32px) rotate(-11deg) scale(.92)";
    ghost.style.cssText = `visibility:visible;z-index:0;top:${el.offsetTop}px;height:${el.offsetHeight}px;bottom:auto;transform:${start}`;
    deckEl.insertBefore(ghost, deckEl.firstElementChild); // DOM-first at z0: painted beneath every sheet
    const safety = setTimeout(land, 1100); // never strand the deck on a missed event
    settleNav = () => { clearTimeout(safety); land(); };
    let phase = 1;
    ghost.addEventListener("transitionend", e => {
      if (e.propertyName !== "transform") return;
      if (phase === 1) {
        phase = 2;
        ghost.style.zIndex = "4"; // fully clear of the pile, safe to rise
        ghost.style.transition = "transform .22s ease-out";
        ghost.style.transform = "translate(-50%,0) rotate(0deg) scale(1)";
        // the stack shifts down one position underneath the landing card
        el.style.transition = "transform .22s ease-out";
        el.style.transform = "translateY(2px) rotate(-.6deg) scale(.985)";
        el.querySelectorAll(".chev").forEach(c => { c.style.transition = "opacity .2s"; c.style.opacity = "0"; });
        if (fanU && fan1) {
          fanU.classList.add("fade-content");
          fanU.style.transition = "transform .22s ease-out";
          fanU.style.transform = getComputedStyle(fan1).transform;
          fan1.style.transition = "transform .22s ease-out";
          if (fan2) fan1.style.transform = getComputedStyle(fan2).transform;
        }
      } else {
        clearTimeout(safety);
        land();
      }
    });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      // out just past the pile's flank, no further: on a phone -175% threw the
      // whole pull-out off-screen and the shuffle read as a card popping in
      ghost.style.transition = "transform .26s ease-in-out";
      ghost.style.transform = "translateX(-118%) translateY(26px) rotate(-9deg) scale(.95)";
    }));
  }
}

let fanRO = null;
function wireCard() {
  const el = document.getElementById("swipeCard");
  if (!el) return;
  const deckEl = document.getElementById("deckEl");
  // sheets track the card's box through expands, image loads, and rotations
  fanRO?.disconnect();
  fanRO = new ResizeObserver(sizeFans);
  fanRO.observe(el);
  document.getElementById("scMore")?.addEventListener("click", () => setExpanded(!expanded));
  document.getElementById("chevL")?.addEventListener("click", () => goStep(-1, 140));
  document.getElementById("chevR")?.addEventListener("click", () => goStep(1, -140));

  let startX = 0, startY = 0, baseX = 0, dx = 0, dragging = false;
  el.addEventListener("pointerdown", e => {
    if (e.target.closest("button")) return; // buttons click normally
    dragging = true; startX = e.clientX; startY = e.clientY; dx = 0;
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
  });
  // iOS Safari: claim horizontal drags before the scroller cancels them.
  let tX = 0, tY = 0, intent = null;
  el.addEventListener("touchstart", e => {
    tX = e.touches[0].clientX; tY = e.touches[0].clientY; intent = null;
  }, { passive: true });
  el.addEventListener("touchmove", e => {
    if (intent === null) {
      const ax = Math.abs(e.touches[0].clientX - tX), ay = Math.abs(e.touches[0].clientY - tY);
      if (ax > 6 || ay > 6) intent = ax > ay ? "h" : "v";
    }
    if (intent === "h") e.preventDefault();
  }, { passive: false });
  const end = e => {
    if (!dragging) return;
    dragging = false;
    const x = baseX + dx;
    el.style.transition = "transform .3s cubic-bezier(.2,.9,.3,1.2), opacity .3s ease";
    if (x < -80) goStep(1, -140);
    else if (x > 80) goStep(-1, 140);
    else {
      el.style.transform = "";
      // A tap (not a drag) anywhere on the card opens the details on touch
      // screens: testers keep tapping the product image expecting more info.
      // Expand only — closing stays on the Show Less button, so a stray tap
      // mid-read can't slam it shut. pointercancel (scroll takeover) is not a tap.
      if (e.type === "pointerup" &&
          Math.abs(dx) < 6 && Math.abs(e.clientY - startY) < 6) setExpanded(!expanded);
    }
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}

// Laptop support: ← → arrow keys page through the deck.
document.addEventListener("keydown", e => {
  if (!["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp"].includes(e.key)) return;
  const el = document.getElementById("swipeCard");
  if (!el || document.getElementById("results").classList.contains("hidden")) return;
  if (e.key === "ArrowLeft") goStep(-1, 140);
  else if (e.key === "ArrowRight") goStep(1, -140);
  else if (e.key === "ArrowDown") { e.preventDefault(); if (!expanded) setExpanded(true); }
  else { e.preventDefault(); if (expanded) setExpanded(false); }
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
