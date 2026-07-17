// Live tally board. ?demo=1 runs a scripted feed so the finale never depends on wifi.
import { BRANDS } from "./data.js?v=1784319738";

const DEMO = new URLSearchParams(location.search).get("demo") === "1";
const boardEl = document.getElementById("board");
const totalEl = document.getElementById("total");

function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// Keyed, in-place updates: bars grow via the CSS width transition instead of the
// whole board rebuilding (and visibly flashing on the projector) every poll.
function render(counts, total) {
  totalEl.textContent = total ? `${total} match${total === 1 ? "" : "es"} made 💘` : "Waiting for matches…";
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);

  if (!entries.length) {
    boardEl.innerHTML = `<div class="empty">Scan the QR code to make the first match…</div>`;
    return;
  }
  boardEl.querySelector(".empty")?.remove();

  const max = Math.max(1, ...entries.map(([, n]) => n));
  const keep = new Set(entries.map(([k]) => k));
  [...boardEl.querySelectorAll(".row")].forEach(r => { if (!keep.has(r.dataset.key)) r.remove(); });

  entries.forEach(([k, n], i) => {
    let row = boardEl.querySelector(`[data-key="${CSS.escape(k)}"]`);
    const isNew = !row;
    if (isNew) {
      row = document.createElement("div");
      row.className = "row";
      row.dataset.key = k;
      row.innerHTML = `
        <div class="row-name">${esc(BRANDS[k]?.name ?? k)}</div>
        <div class="row-bar"><div class="row-fill" style="width:0%"></div></div>
        <div class="row-n"></div>`;
    }
    if (boardEl.children[i] !== row) boardEl.insertBefore(row, boardEl.children[i] ?? null);
    if (isNew) void row.offsetWidth; // flush layout so the 0% -> n% width transition animates
    row.querySelector(".row-fill").style.width = `${(n / max) * 100}%`;
    row.querySelector(".row-n").textContent = n;
  });
}

let failures = 0;
function warnIfStale() {
  if (++failures === 3) console.warn("tally polling failing — switch to ?demo=1 if this persists");
}
async function poll() {
  try {
    const r = await fetch("/api/tally");
    if (!r.ok) { warnIfStale(); return; }
    const { counts = {}, total = 0 } = await r.json();
    failures = 0;
    render(counts, total);
  } catch { warnIfStale(); }
}
async function loop() { await poll(); setTimeout(loop, 3000); }

function demo() {
  const feed = ["chrome", "bowman_chrome", "heritage", "chrome_nfl", "gpk", "f1_chrome",
    "chrome", "star_wars", "bowman", "chrome_nba", "heritage", "ufc_chrome",
    "chrome", "topps_now", "merlin", "bowman_chrome", "chrome_nfl", "disney"];
  const counts = {};
  let total = 0, i = 0;
  render(counts, 0);
  setInterval(() => { // loops forever: the fallback must outlast any outage
    const k = feed[i++ % feed.length];
    counts[k] = (counts[k] || 0) + 1;
    total++;
    render(counts, total);
  }, 1200);
}

if (DEMO) demo();
else { render({}, 0); loop(); }
