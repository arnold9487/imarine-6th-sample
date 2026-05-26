// 高雄港 貨櫃中心壓力 v4 ── 高清底圖 + 互動SVG、拖曳邊界限制、淺色、船面板取代彈窗
"use strict";
const NS = "http://www.w3.org/2000/svg";
const SIZE_LABEL = { S: "小船", M: "中船", L: "大船" };
const SIZE_WEIGHT = { S: 1, M: 2, L: 3 };   // 一律換算成小船單位
const $ = (s, r = document) => r.querySelector(s);
const YEAR = 2025;
const CT_IDS = ["CT1", "CT2", "CT3", "CT4", "CT5", "CT6", "CT7"];
const PRESSURE_STOPS = [
  [165, 180, 252],
  [253, 186, 116],
  [248, 113, 113],
];
const PRESSURE_ALPHA = 0.9;

const S = {
  data: null, zones: null, byCT: {}, zoneEl: {},
  W: 2575, H: 1440, k: 1, kMin: 0.2, tx: 0, ty: 0,
  month: 5, day: 15, hour: 12,
  playing: false, timer: null,
  trendScale: "time",
  activeCT: null, hideT: null, drag: null,
};

const parseD = s => s ? new Date(s) : null;
const pad = (n, w = 2) => String(n).padStart(w, "0");
const fmtDate = d => `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:00`;
const fmtDT = s => { const d = parseD(s); return d ? `${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}` : "—"; };

const mix = (a, b, t) => Math.round(a + (b - a) * t);
// ===== 壓力色：#A5B4FC → #FDBA74 → #F87171 =====
function pressureColor(p) {
  p = Math.max(0, Math.min(1, p));
  const seg = p < 0.5 ? 0 : 1;
  const t = seg === 0 ? p / 0.5 : (p - 0.5) / 0.5;
  const a = PRESSURE_STOPS[seg];
  const b = PRESSURE_STOPS[seg + 1];
  const r = mix(a[0], b[0], t);
  const g = mix(a[1], b[1], t);
  const bl = mix(a[2], b[2], t);
  return `rgba(${r}, ${g}, ${bl}, ${PRESSURE_ALPHA})`;
}

function weightedCountAt(ct, ms) {       // 實際：以實際離泊(occ_end)
  let s = 0;
  for (const v of S.byCT[ct] || []) {
    if (v._a <= ms && ms < v._e) s += SIZE_WEIGHT[v.size] || 1;
  }
  return s;
}
function weightedCountPredicted(ct, ms) {  // 預測：用「預定靠泊 + 預定離泊」純預定模型
  let s = 0;
  for (const v of S.byCT[ct] || []) {
    if (v._aRsv <= ms && ms < v._eRsv) s += SIZE_WEIGHT[v.size] || 1;
  }
  return s;
}
function pressureAt(ct, ms) {
  const t = S.data.terminals[ct];
  return t && t.limit ? weightedCountAt(ct, ms) / t.limit : 0;
}
function predictedPressureAt(ct, ms) {
  const t = S.data.terminals[ct];
  return t && t.limit ? weightedCountPredicted(ct, ms) / t.limit : 0;
}
const FORECAST_MS = 6 * 3600 * 1000;       // 預測偏移：6 小時後
function overallPressureAt(ms) {
  let totalW = 0, totalLimit = 0;
  for (const ct of CT_IDS) {
    const t = S.data.terminals[ct];
    if (!t || !t.limit) continue;
    totalW += weightedCountAt(ct, ms);
    totalLimit += t.limit;
  }
  return totalLimit ? totalW / totalLimit : 0;
}
function overallPredictedAt(ms) {
  let totalW = 0, totalLimit = 0;
  for (const ct of CT_IDS) {
    const t = S.data.terminals[ct];
    if (!t || !t.limit) continue;
    totalW += weightedCountPredicted(ct, ms);
    totalLimit += t.limit;
  }
  return totalLimit ? totalW / totalLimit : 0;
}

function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
function currentDate() { return new Date(YEAR, S.month, S.day, S.hour); }
function currentMs() { return currentDate().getTime(); }
function shipsAt(ct, ms) {
  const out = [];
  for (const v of S.byCT[ct] || []) if (v._a <= ms && ms < v._e) out.push(v);
  return out;
}

async function init() {
  const noCache = { cache: "no-store" };       // 避免瀏覽器快取舊資料(到港目的等新欄位)
  const [zones, data] = await Promise.all([
    fetch("data/zones.json", noCache).then(r => r.json()),
    fetch("data/port_data.json", noCache).then(r => r.json()),
  ]);
  S.zones = zones; S.data = data; S.W = zones.size[0]; S.H = zones.size[1];
  for (const v of data.visits) {
    v._a = parseD(v.arrive).getTime(); v._e = parseD(v.occ_end).getTime();
    // 純預定模型(供預測虛線)：以「預定靠泊 + 預定離泊」為區間；壞資料退回實際
    v._aRsv = v.arrive_reserved ? parseD(v.arrive_reserved).getTime() : v._a;
    const er = v.depart_reserved ? parseD(v.depart_reserved).getTime() : null;
    v._eRsv = (er && er > v._aRsv) ? er : v._e;
    (S.byCT[v.ct] || (S.byCT[v.ct] = [])).push(v);
  }
  const zonesSvg = zones.zones.map(z =>
    `<path id="${z.id}" class="zone ${z.type}" data-type="${z.type}" data-name="${z.name}" d="${z.d}"/>`
  ).join("");
  $("#map-host").innerHTML =
    `<svg id="root" xmlns="${NS}" xmlns:xlink="http://www.w3.org/1999/xlink">
       <defs><filter id="kh-blur" x="-20%" y="-20%" width="140%" height="140%">
         <feGaussianBlur stdDeviation="7"/></filter></defs>
       <g id="viewport">
         <g id="world">
           <image href="高清底圖.png" x="0" y="0" width="${S.W}" height="${S.H}" preserveAspectRatio="none"/>
           <g id="zones">${zonesSvg}</g>
         </g>
         <g id="lenses"></g>
       </g>
     </svg>`;
  S.svg = $("#root"); S.viewport = $("#viewport"); S.world = $("#world"); S.lenses = $("#lenses");
  S.lenses.style.pointerEvents = "none";
  for (const z of zones.zones) S.zoneEl[z.id] = $("#" + z.id);

  fitView();
  bind();
  const trendSelect = $("#trend-scale");
  if (trendSelect) {
    S.trendScale = trendSelect.value;
    trendSelect.addEventListener("change", e => {
      S.trendScale = e.target.value;
      updateTrends();
    });
  }
  syncTimeUI(); render();
  updateTrends();
}

// ====== 視角：拖曳/縮放，邊界 clamp 到圖片邊緣 ======
function recalcMinScale() {
  const r = S.svg.getBoundingClientRect();
  S.kMin = Math.max(r.width / S.W, r.height / S.H);  // 圖片覆蓋整個視窗
}
function clampTransform() {
  const r = S.svg.getBoundingClientRect();
  const vw = r.width, vh = r.height;
  S.k = Math.max(S.kMin, Math.min(6, S.k));
  const sW = S.W * S.k, sH = S.H * S.k;
  if (sW <= vw) S.tx = (vw - sW) / 2;
  else S.tx = Math.max(vw - sW, Math.min(0, S.tx));
  if (sH <= vh) S.ty = (vh - sH) / 2;
  else S.ty = Math.max(vh - sH, Math.min(0, S.ty));
}
function fitView() {
  recalcMinScale();
  const r = S.svg.getBoundingClientRect();
  S.k = Math.max(S.kMin, 1.35 * r.width / S.W);
  S.tx = (r.width - S.W * S.k) / 2;
  S.ty = (r.height - S.H * S.k) / 2;
  applyTransform();
}
function applyTransform() {
  clampTransform();
  S.viewport.setAttribute("transform", `translate(${S.tx} ${S.ty}) scale(${S.k})`);
}
function zoomAt(cx, cy, factor) {
  const nk = Math.max(S.kMin, Math.min(6, S.k * factor));
  S.tx = cx - (cx - S.tx) * (nk / S.k);
  S.ty = cy - (cy - S.ty) * (nk / S.k);
  S.k = nk; applyTransform();
}

// ====== 主渲染：壓力上色 ======
function render() {
  const ms = currentMs();
  for (const z of S.zones.zones) {
    if (z.type !== "ct") continue;
    const el = S.zoneEl[z.id]; if (el) el.style.fill = pressureColor(pressureAt(z.id, ms));
  }
  if (S.activeCT) { buildLens(S.activeCT); fillTooltip(S.activeCT); }
}

// ====== 船舶圖式（已縮一半）======
function shipIcon(size, ang) {
  const f = size === "L" ? 1.4 : size === "M" ? 1.0 : 0.7;
  const L = 30 * f, W = 9 * f;          // 半化
  const col = size === "L" ? "#e0533f" : size === "M" ? "#e0913a" : "#3aa6a0";
  const g = document.createElementNS(NS, "g");
  g.setAttribute("transform", `rotate(${ang})`);
  const hull = document.createElementNS(NS, "path");
  hull.setAttribute("d", `M${-L/2},${-W/2} L${L/2-W*.5},${-W/2} L${L/2},0 L${L/2-W*.5},${W/2} L${-L/2},${W/2} Z`);
  hull.setAttribute("fill", col); hull.setAttribute("stroke", "#0b0b0b");
  hull.setAttribute("stroke-width", "1.2"); hull.setAttribute("vector-effect", "non-scaling-stroke");
  g.appendChild(hull);
  const deck = document.createElementNS(NS, "rect");
  deck.setAttribute("x", -L*.3); deck.setAttribute("y", -W*.26);
  deck.setAttribute("width", L*.46); deck.setAttribute("height", W*.52);
  deck.setAttribute("fill", "#fff"); deck.setAttribute("opacity", ".6"); g.appendChild(deck);
  return g;
}

// ====== 放大鏡（CT 才有）======
function buildLens(ct) {
  S.lenses.textContent = "";
  const z = S.zones.zones.find(x => x.id === ct); if (!z) return;
  const lens = document.createElementNS(NS, "g");
  lens.setAttribute("class", "lens");
  lens.setAttribute("transform",
    `translate(${z.cx} ${z.cy}) scale(1.5) translate(${-z.cx} ${-z.cy})`);
  const shape = S.zoneEl[ct].cloneNode(false);
  shape.removeAttribute("id"); shape.setAttribute("class", "lens-shape");
  shape.style.fill = S.zoneEl[ct].style.fill;
  lens.appendChild(shape);
  // 碼頭 + 船
  const ms = currentMs(); const ships = shipsAt(ct, ms);
  const byB = {}; for (const v of ships) (byB[v.berth] || (byB[v.berth] = [])).push(v);
  const [A, B] = z.quay; const ang = Math.atan2(B[1]-A[1], B[0]-A[0]) * 180 / Math.PI;
  for (const b of z.berths) {
    const dot = document.createElementNS(NS, "circle");
    dot.setAttribute("cx", b.x); dot.setAttribute("cy", b.y); dot.setAttribute("r", 5);  // 半化
    dot.setAttribute("class", "berth-dot"); lens.appendChild(dot);
    const tx = document.createElementNS(NS, "text");
    tx.setAttribute("x", b.x); tx.setAttribute("y", b.y - 9);
    tx.setAttribute("class", "berth-code"); tx.setAttribute("font-size", "11");   // 半化
    tx.textContent = b.code; lens.appendChild(tx);
    for (const v of byB[b.code] || []) {
      const sg = shipIcon(v.size, ang);
      sg.setAttribute("transform", `translate(${b.x} ${b.y}) rotate(${ang})`);
      lens.appendChild(sg);
    }
  }
  S.lenses.appendChild(lens);
  S.world.classList.add("dim");
}

// ====== CT 資料框 ======
function fillTooltip(ct) {
  const tip = $("#tooltip"); const z = S.zones.zones.find(x => x.id === ct);
  const t = S.data.terminals[ct]; const ms = currentMs(); const ships = shipsAt(ct, ms);
  const n = ships.length, w = weightedCountAt(ct, ms);
  const p = t && t.limit ? w / t.limit : 0;
  const p6 = predictedPressureAt(ct, ms + FORECAST_MS);            // 6h 後預測
  const diff = Math.round((p6 - p) * 100);
  const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "→";
  const trendCol = diff > 0 ? "#d83a2c" : diff < 0 ? "#3aa66a" : "#888";
  const sign = diff > 0 ? "升" : diff < 0 ? "降" : "持平";
  const byB = {}; for (const v of ships) (byB[v.berth] || (byB[v.berth] = [])).push(v);
  let h = `<h3>${z.name}</h3>`
    + `<div class="p-meta">在泊 <b>${n}</b> 艘（${w} 小船等量）/ 上限 ${t ? t.limit : "—"}（${t ? t.limit_method : "—"}）</div>`
    + `<div class="p-meta"><span class="p-pressure" style="color:${pressureColor(p)}">壓力 ${Math.round(p*100)}%</span>　`
    + `<span style="color:${trendCol};font-weight:700">${arrow}</span>　`
    + `<span class="p-pressure" style="color:${pressureColor(p6)}">預測 ${Math.round(p6*100)}%</span>`
    + `<span style="color:${trendCol};font-size:11px"> (${sign}${Math.abs(diff)}%, 6h)</span></div>`;
  for (const b of z.berths) {
    const list = byB[b.code] || [];
    h += `<div class="berth-row"><div class="bcode">${b.code}</div><div class="bships">`;
    if (!list.length) h += `<span class="bempty">（空）</span>`;
    for (const v of list)
      h += `<div><span class="sname" data-id="${v.id}">${v.cn}<span class="badge b-${v.size}">${SIZE_LABEL[v.size]}</span></span>`
        + `<div class="stime">靠泊 ${fmtDT(v.arrive)}　預定離泊 ${fmtDT(v.depart_reserved)}</div></div>`;
    h += `</div></div>`;
  }
  tip.innerHTML = h; tip.hidden = false;
}
// 智能定位（不出畫面，挑空間大的一側）
function placePanel(panel, x, y, avoid) {
  const w = panel.offsetWidth, ht = panel.offsetHeight, gap = 18;
  const vw = innerWidth, vh = innerHeight;
  // 候選 4 個方位（依空間大小排序）
  const cand = [
    {nx: x + gap,         ny: y + gap,         pref: (vw-x) * (vh-y)},
    {nx: x - w - gap,     ny: y + gap,         pref: x * (vh-y)},
    {nx: x + gap,         ny: y - ht - gap,    pref: (vw-x) * y},
    {nx: x - w - gap,     ny: y - ht - gap,    pref: x * y},
  ].sort((a,b)=>b.pref - a.pref);
  // 避開另一個面板
  let chosen = cand[0];
  if (avoid && !avoid.hidden) {
    const a = avoid.getBoundingClientRect();
    for (const c of cand) {
      const r = {l:c.nx, t:c.ny, r:c.nx+w, b:c.ny+ht};
      if (r.r < a.left || r.l > a.right || r.b < a.top || r.t > a.bottom) { chosen = c; break; }
    }
  }
  let nx = Math.max(8, Math.min(chosen.nx, vw - w - 8));
  let ny = Math.max(8, Math.min(chosen.ny, vh - ht - 8));
  panel.style.left = nx + "px"; panel.style.top = ny + "px";
}

// ====== 互動 ======
function enterCT(ct, x, y) {
  clearTimeout(S.hideT); $("#nametag").hidden = true;
  if (S.activeCT !== ct) { S.activeCT = ct; buildLens(ct); fillTooltip(ct); }
  placePanel($("#tooltip"), x, y, $("#ship-panel"));
}
function leaveCT() {
  S.hideT = setTimeout(() => {
    S.activeCT = null; S.lenses.textContent = "";
    S.world.classList.remove("dim");
    $("#tooltip").hidden = true;
    $("#ship-panel").hidden = true;       // CT 視窗關閉時，船面板同步關閉
  }, 160);
}
function showName(name, x, y) {
  const n = $("#nametag"); n.textContent = name; n.hidden = false;
  n.style.left = (x + 14) + "px"; n.style.top = (y - 10) + "px";
}

// ====== 船舶詳情面板（取代彈窗，與 CT 框並存）======
function openShipPanel(id, x, y) {
  const v = S.data.visits.find(x => x.id === id); if (!v) return;
  const t = S.data.terminals[v.ct];
  const rows = [["貨櫃中心", t ? t.name_zh : v.ct], ["靠泊碼頭", v.berth],
    ["船種", v.type || "—"], ["船型", `${SIZE_LABEL[v.size]}（${v.len ? v.len + " m" : "不明"}）`],
    ["到港目的", v.goal || "—"],
    ["總噸", v.gross ? v.gross.toLocaleString() : "—"], ["港口代理", v.agent || "—"],
    ["靠泊時間", fmtDT(v.arrive)], ["預定離泊", fmtDT(v.depart_reserved)],
    ["前一港", v.prev || "—"], ["次一港", v.next || "—"], ["簽證編號", v.id]];
  const p = $("#ship-panel");
  p.innerHTML = `<button class="panel-close" id="ship-close" aria-label="關閉">×</button>`
    + `<h3>${v.cn}</h3><div class="en">${v.en || ""}</div><dl class="kv">`
    + rows.map(([k, x]) => `<dt>${k}</dt><dd>${x}</dd>`).join("") + `</dl>`;
  p.hidden = false;
  placePanel(p, x, y, $("#tooltip"));
  $("#ship-close").addEventListener("click", () => p.hidden = true, { once: true });
}

// ====== 時間 UI ======
function syncTimeUI() {
  const maxDay = daysInMonth(YEAR, S.month);
  if (S.day > maxDay) S.day = maxDay;
  $("#month").value = S.month;
  $("#day").max = String(maxDay); $("#day").value = S.day;
  $("#hour").value = S.hour;
  const mLabel = $("#month-label");
  if (mLabel) mLabel.textContent = String(S.month + 1);
  $("#day-label").textContent = String(S.day);
  $("#hour-label").textContent = pad(S.hour);
  $("#cur-date").textContent = fmtDate(currentDate());
  updateTrends();
}

function trendSpec(scale) {
  if (scale === "month") {
    return { count: 12, xLabel: "月份(月)", xTicks: [0, 5, 11], xLabels: ["1", "6", "12"] };
  }
  if (scale === "day") {
    const days = daysInMonth(YEAR, S.month);
    const mid = Math.max(0, Math.floor((days - 1) / 2));
    return { count: days, xLabel: "日期(日)", xTicks: [0, mid, days - 1], xLabels: ["1", String(mid + 1), String(days)] };
  }
  return { count: 24, xLabel: "時間(時)", xTicks: [0, 6, 12, 18, 23], xLabels: ["0", "6", "12", "18", "23"] };
}

function trendMaxIndex(spec) {
  let idx = 0;
  if (S.trendScale === "month") idx = S.month;
  else if (S.trendScale === "day") idx = S.day - 1;
  else idx = S.hour;
  return Math.max(0, Math.min(spec.count - 1, idx));
}

function seriesFor(ct, spec, maxIndex) {
  // actual(實線): 過去到 now，用實際時間
  // predicted(虛線): 從圖最左端到 now+6h 全程都畫，用純預定時間
  //   - 過去段(i ≤ now): 預定模型給的歷史壓力，與實際有差(自然不重疊) → 「不消失」
  //   - 未來 1~6h: 動態預測；時間每跨一小時就追上 +1h 點，後續仍可隨新預訂變化
  //   - 超過 +6h: 不畫
  const nowMs = currentMs();
  const horizon = 6 * 3600 * 1000;
  const actual = [], predicted = [];
  for (let i = 0; i < spec.count; i++) {
    let d;
    if (S.trendScale === "month") d = new Date(YEAR, i, 15, 12);
    else if (S.trendScale === "day") d = new Date(YEAR, S.month, i + 1, 12);
    else d = new Date(YEAR, S.month, S.day, i);
    const ms = d.getTime();
    actual.push(ms <= nowMs ? (ct === "ALL" ? overallPressureAt(ms) : pressureAt(ct, ms)) : null);
    predicted.push(ms <= nowMs + horizon ? (ct === "ALL" ? overallPredictedAt(ms) : predictedPressureAt(ct, ms)) : null);
  }
  return { actual, predicted };
}

function drawSpark(svg, seriesObj, spec, maxIndex) {
  const actual = seriesObj.actual, predicted = seriesObj.predicted;
  const vb = svg.viewBox.baseVal;
  const w = vb && vb.width ? vb.width : 320;
  const h = vb && vb.height ? vb.height : 180;
  const padL = 46, padR = 12, padT = 14, padB = 34;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const N = actual.length;
  const toX = i => padL + (N <= 1 ? 0 : (i / (N - 1)) * innerW);
  const toY = v => padT + (1 - Math.max(0, Math.min(1, v))) * innerH;

  const grid = svg.querySelector(".grid");
  const axis = svg.querySelector(".axis");
  // 實線：明確排除 .predicted，否則會被先插入的預測線搶到
  const line = svg.querySelector(".line:not(.predicted)");
  let linePred = svg.querySelector(".line.predicted");
  if (!linePred) {
    linePred = document.createElementNS(NS, "polyline");
    linePred.setAttribute("class", "line predicted"); linePred.setAttribute("fill", "none");
    line.parentNode.insertBefore(linePred, line);   // 預測線繪於實線之下
  }
  const points = svg.querySelector(".points");
  if (!grid || !axis || !line || !points) return;
  grid.textContent = ""; axis.textContent = ""; points.textContent = "";

  const yGridCount = 5;
  for (let i = 0; i <= yGridCount; i++) {
    const t = i / yGridCount;
    const y = toY(t);
    const ln = document.createElementNS(NS, "line");
    ln.setAttribute("x1", padL);
    ln.setAttribute("x2", w - padR);
    ln.setAttribute("y1", y);
    ln.setAttribute("y2", y);
    grid.appendChild(ln);
    if (i % 2 === 0) {
      const tx = document.createElementNS(NS, "text");
      tx.setAttribute("x", padL - 10);
      tx.setAttribute("y", y + 3);
      tx.setAttribute("text-anchor", "end");
      tx.textContent = String(Math.round(t * 100));
      axis.appendChild(tx);
    }
  }

  const xLine = document.createElementNS(NS, "line");
  xLine.setAttribute("x1", padL);
  xLine.setAttribute("x2", w - padR);
  xLine.setAttribute("y1", padT + innerH);
  xLine.setAttribute("y2", padT + innerH);
  axis.appendChild(xLine);

  const yLine = document.createElementNS(NS, "line");
  yLine.setAttribute("x1", padL);
  yLine.setAttribute("x2", padL);
  yLine.setAttribute("y1", padT);
  yLine.setAttribute("y2", padT + innerH);
  axis.appendChild(yLine);

  // X 網格：均勻分布(不依資料索引取整，避免 24/30/12 不整除產生不均)
  const xGridCount = 8;
  for (let i = 0; i <= xGridCount; i++) {
    const x = padL + innerW * (i / xGridCount);
    const gl = document.createElementNS(NS, "line");
    gl.setAttribute("x1", x); gl.setAttribute("x2", x);
    gl.setAttribute("y1", padT); gl.setAttribute("y2", padT + innerH);
    grid.appendChild(gl);
  }

  for (let i = 0; i < spec.xTicks.length; i++) {
    const idx = spec.xTicks[i];
    const x = toX(idx);
    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", x);
    t.setAttribute("y", h - 14);
    t.setAttribute("text-anchor", "middle");
    t.textContent = spec.xLabels[i] || "";
    axis.appendChild(t);
  }

  // 實線（actual，只畫到目前時間）
  const last = Math.max(0, Math.min(maxIndex, N - 1));
  const pts = [];
  for (let i = 0; i <= last; i++) {
    const v = actual[i]; if (v == null) break;
    pts.push(`${toX(i)},${toY(v)}`);
  }
  line.setAttribute("points", pts.join(" "));

  // 預測線（淡紅虛線，從圖左端到 now+6h 都畫；與實線各自獨立、不必重疊）
  const predPts = [];
  for (let i = 0; i < N; i++) {
    const v = predicted[i]; if (v == null) continue;
    predPts.push(`${toX(i)},${toY(v)}`);
  }
  linePred.setAttribute("points", predPts.join(" "));

  const samples = [0, Math.floor(last / 2), last].filter((v, i, a) => v >= 0 && a.indexOf(v) === i);
  for (const i of samples) {
    const v = actual[i]; if (v == null) continue;
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", toX(i)); c.setAttribute("cy", toY(v));
    c.setAttribute("r", "2.5");
    points.appendChild(c);
  }

  const yLabel = svg.querySelector(".axis-label.y");
  const xLabel = svg.querySelector(".axis-label.x");
  if (yLabel) {
    const cy = padT + innerH / 2;
    yLabel.setAttribute("x", 12);
    yLabel.setAttribute("y", cy);
    yLabel.setAttribute("text-anchor", "middle");
    yLabel.setAttribute("transform", `rotate(-90 12 ${cy})`);
    yLabel.textContent = "壓力(%)";
  }
  if (xLabel) {
    xLabel.setAttribute("x", w - 4);
    xLabel.setAttribute("y", h - 2);
    xLabel.setAttribute("text-anchor", "end");
    xLabel.textContent = spec.xLabel;
  }
}

function updateTrends() {
  if (!S.data) return;
  const spec = trendSpec(S.trendScale || "time");
  const maxIndex = trendMaxIndex(spec);
  document.querySelectorAll(".spark").forEach(svg => {
    const ct = svg.dataset.ct || "ALL";
    const series = seriesFor(ct, spec, maxIndex);
    drawSpark(svg, series, spec, maxIndex);
  });
}
function stepTime(target, step) {
  if (target === "hour") {
    S.hour += step;
    while (S.hour < 0)  { S.hour += 24; stepTime("day", -1); return; }
    while (S.hour > 23) { S.hour -= 24; stepTime("day",  1); return; }
  } else if (target === "day") {
    S.day += step;
    while (S.day < 1) { S.month = (S.month + 11) % 12; S.day = daysInMonth(YEAR, S.month) + S.day; }
    let m = daysInMonth(YEAR, S.month);
    while (S.day > m) { S.day -= m; S.month = (S.month + 1) % 12; m = daysInMonth(YEAR, S.month); }
  } else if (target === "month") {
    S.month = (S.month + step + 12) % 12;
  }
  syncTimeUI(); render();
}

// ====== 事件 ======
function bind() {
  const host = $("#map-host");
  host.addEventListener("pointerdown", e => {
    S.drag = { x: e.clientX, y: e.clientY, tx: S.tx, ty: S.ty };
    host.classList.add("grabbing"); host.setPointerCapture(e.pointerId);
  });
  host.addEventListener("pointermove", e => {
    if (S.drag) {
      S.tx = S.drag.tx + (e.clientX - S.drag.x);
      S.ty = S.drag.ty + (e.clientY - S.drag.y); applyTransform();
      if (S.activeCT) leaveCT(); $("#nametag").hidden = true; return;
    }
    const zEl = e.target.closest(".zone");
    if (!zEl) { if (S.activeCT) leaveCT(); $("#nametag").hidden = true; return; }
    if (zEl.dataset.type === "ct") enterCT(zEl.id, e.clientX, e.clientY);
    else { if (S.activeCT) leaveCT(); showName(zEl.dataset.name, e.clientX, e.clientY); }
  });
  const endDrag = () => { if (S.drag) { host.classList.remove("grabbing"); S.drag = null; } };
  host.addEventListener("pointerup", endDrag);
  host.addEventListener("pointercancel", endDrag);
  host.addEventListener("pointerleave", () => { if (!S.drag) { leaveCT(); $("#nametag").hidden = true; } });
  host.addEventListener("wheel", e => {
    e.preventDefault();
    const r = S.svg.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0014));
  }, { passive: false });

  // CT 資料框互動
  const tip = $("#tooltip");
  tip.addEventListener("mouseenter", () => clearTimeout(S.hideT));
  tip.addEventListener("mouseleave", leaveCT);
  tip.addEventListener("click", e => {
    const s = e.target.closest(".sname");
    if (s) openShipPanel(s.dataset.id, e.clientX, e.clientY);
  });

  // 時間軸
  $("#month").addEventListener("input", e => { S.month = +e.target.value; syncTimeUI(); render(); });
  $("#day").addEventListener("input", e => { S.day = +e.target.value; syncTimeUI(); render(); });
  $("#hour").addEventListener("input", e => { S.hour = +e.target.value; syncTimeUI(); render(); });
  document.querySelectorAll(".step-btn").forEach(b => {
    b.addEventListener("click", () => stepTime(b.dataset.target, +b.dataset.step));
  });
  $("#play").addEventListener("click", togglePlay);
  $("#speed").addEventListener("change", () => { if (S.playing) { stopPlay(); startPlay(); } });
  $("#reset-view").addEventListener("click", fitView);

  // 面板摺疊
  const hud = document.querySelector(".hud-tr");
  const hudToggle = $("#hud-collapse");
  if (hud && hudToggle) {
    hudToggle.addEventListener("click", () => {
      const next = !hud.classList.contains("is-collapsed");
      hud.classList.toggle("is-collapsed", next);
      hudToggle.textContent = next ? "‹" : "›";
      hudToggle.setAttribute("aria-expanded", String(!next));
    });
  }
  const infoPanel = $("#info-panel");
  const infoToggle = $("#info-toggle");
  if (infoPanel && infoToggle) {
    document.body.classList.toggle("info-collapsed", infoPanel.classList.contains("is-collapsed"));
    infoToggle.addEventListener("click", () => {
      const next = !infoPanel.classList.contains("is-collapsed");
      infoPanel.classList.toggle("is-collapsed", next);
      infoToggle.textContent = next ? "❯" : "❮";
      infoToggle.setAttribute("aria-expanded", String(!next));
      document.body.classList.toggle("info-collapsed", next);
    });
  }

  // 關閉船面板：ESC
  document.addEventListener("keydown", e => { if (e.key === "Escape") $("#ship-panel").hidden = true; });
  addEventListener("resize", () => { recalcMinScale(); applyTransform(); });
}

// ====== 播放（每 tick 推進一小時） ======
function startPlay() {
  S.playing = true; $("#play").textContent = "⏸";
  S.timer = setInterval(() => stepTime("hour", 1), +$("#speed").value);
}
function stopPlay() { S.playing = false; $("#play").textContent = "▶"; clearInterval(S.timer); }
function togglePlay() { S.playing ? stopPlay() : startPlay(); }

init();
