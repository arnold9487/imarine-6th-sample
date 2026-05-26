# -*- coding: utf-8 -*-
"""由 新參考位置.svg 抽出 12 個互動區 + 34 個碼頭 -> data/zones.json

- 用瀏覽器 getPointAtLength 取每條 path 的取樣點（避免手寫貝茲）
- 對於由多條 path 構成的區（如 CT6 = svg_1 + svg_9），按端點距離挑最佳連接順序
  → 輸出為單一連續多邊形 d（svg_9 的轉折線會被納入，不再被跳過）
- JSON 強制 UTF-8 寫入（避免 Windows cp950 預設造成中文亂碼）
"""
import sys, os, re, json
sys.stdout.reconfigure(encoding="utf-8")
import numpy as np

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.normpath(os.path.join(ROOT, "..", "data"))    # 寫入專案根 data/
os.makedirs(OUT_DIR, exist_ok=True)
W, H = 2575, 1440

ZONE_OF = {
    "svg_2":  ("CT7", "第七貨櫃中心（洲際二期）", "ct"),
    "svg_1":  ("CT6", "第六貨櫃中心（洲際一期）", "ct"),
    "svg_9":  ("CT6", "第六貨櫃中心（洲際一期）", "ct"),
    "svg_25": ("CT4", "第四貨櫃中心", "ct"),
    "svg_17": ("CT5", "第五貨櫃中心", "ct"),
    "svg_18": ("CT3", "第三貨櫃中心", "ct"),
    "svg_21": ("CT2", "第二貨櫃中心", "ct"),
    "svg_28": ("CT1", "第一貨櫃中心", "ct"),
    "svg_22": ("LOG", "物流倉儲區", "named"),
    "svg_29": ("ZD", "中島商港區", "named"),
    "svg_10": ("NX", "南星計畫區", "named"),
    "svg_59": ("YB", "油駁基地", "named"),
}
BERTHS = {
    "CT1": ["41", "42", "43"],
    "CT2": ["63", "64", "65", "66", "67"],
    "CT3": ["68", "69", "70"],
    "CT4": ["115", "116", "117", "118", "119", "120", "121"],
    "CT5": ["75", "76", "77", "78", "79", "80", "81"],
    "CT6": ["108", "109", "110", "111"],
    "CT7": ["S1", "S2", "S3", "S4", "S5"],
}
# 依使用者要求，整段反向的 CT（在排序後反轉碼頭順序）
REVERSE = {"CT7", "CT4", "CT3"}

# ---------- 1. 用瀏覽器取每條 path 的取樣點 + 矩形 ----------
def extract_geom():
    from playwright.sync_api import sync_playwright
    inner = re.search(r"<svg[\s\S]*</svg>",
                      open(os.path.join(ROOT, "新參考位置.svg"), encoding="utf-8").read()).group(0)
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page()
        pg.set_content(f"<body>{inner}</body>"); pg.wait_for_timeout(250)
        out = pg.evaluate("""()=>{const O={paths:{},bbox:{},rects:[]};
          document.querySelectorAll('path').forEach(e=>{
            if(!e.id) return;
            const bb=e.getBBox();
            if(bb.x<-100||bb.width<10) return;
            O.bbox[e.id]={x:+bb.x.toFixed(1),y:+bb.y.toFixed(1),w:+bb.width.toFixed(1),h:+bb.height.toFixed(1),cx:+(bb.x+bb.width/2).toFixed(1),cy:+(bb.y+bb.height/2).toFixed(1)};
            const L=e.getTotalLength(); if(L<=0) return;
            const N=Math.max(40, Math.min(220, Math.ceil(L/3)));
            const pts=[];
            for(let i=0;i<=N;i++){const p=e.getPointAtLength(L*i/N); pts.push([+p.x.toFixed(1),+p.y.toFixed(1)]);}
            O.paths[e.id]=pts;});
          document.querySelectorAll('rect').forEach(e=>{const b=e.getBBox();
            O.rects.push({id:e.id,cx:+(b.x+b.width/2).toFixed(1),cy:+(b.y+b.height/2).toFixed(1)});});
          return O;}""")
        b.close()
    return out

# ---------- 2. 多段 polyline 合成一個連續閉合多邊形 ----------
def _dist(p, q): return ((p[0]-q[0])**2 + (p[1]-q[1])**2) ** 0.5

def merge_polylines(parts):
    """parts: list of point lists. 回傳合成的點列(尚未閉合, 之後加 Z)。"""
    parts = [list(p) for p in parts if p]
    if not parts: return []
    if len(parts) == 1: return parts[0]
    # 暴力(<=4 段時可接受)：枚舉每段的方向與順序，挑「最大相鄰段間距」最小者
    from itertools import permutations, product
    n = len(parts); best = None; best_gap = 1e18
    for order in permutations(range(n)):
        for flip in product([0, 1], repeat=n):
            seq = []
            for i, idx in enumerate(order):
                seq.append(parts[idx][::-1] if flip[i] else parts[idx])
            # 評分：相鄰段端點距離最大值 + 收尾(末→首)距離
            gaps = [_dist(seq[i-1][-1], seq[i][0]) for i in range(1, n)]
            gaps.append(_dist(seq[-1][-1], seq[0][0]))   # 閉合
            g = max(gaps)
            if g < best_gap:
                best_gap = g; best = [pt for s in seq for pt in s]
    return best

def points_to_d(pts):
    if len(pts) < 3: return ""
    head = f"M{pts[0][0]},{pts[0][1]}"
    body = " L" + " L".join(f"{x},{y}" for x, y in pts[1:])
    return head + body + " Z"

# ---------- 3. 建 zones ----------
G = extract_geom()
zones = {}
zid_to_eids = {}
for eid, (zid, name, ztype) in ZONE_OF.items():
    if eid not in G["paths"]:
        continue
    zid_to_eids.setdefault(zid, []).append(eid)
    zones.setdefault(zid, {"id": zid, "name": name, "type": ztype})

for zid, z in zones.items():
    eids = zid_to_eids[zid]
    parts = [G["paths"][e] for e in eids]
    merged = merge_polylines(parts)
    z["d"] = points_to_d(merged)
    xs = [p[0] for p in merged]; ys = [p[1] for p in merged]
    z["bbox"] = [round(min(xs), 1), round(min(ys), 1), round(max(xs), 1), round(max(ys), 1)]
    z["cx"] = round((min(xs)+max(xs))/2, 1); z["cy"] = round((min(ys)+max(ys))/2, 1)

# ---------- 4. 碼頭：容量限制配對 + PCA 排序 ----------
ct_centers = {zid: (z["cx"], z["cy"]) for zid, z in zones.items() if z["type"] == "ct"}
caps = {zid: len(BERTHS[zid]) for zid in ct_centers}
by_ct = {zid: [] for zid in ct_centers}
pairs = []
for ri, r in enumerate(G["rects"]):
    for zid, (cx, cy) in ct_centers.items():
        pairs.append(((r["cx"]-cx)**2 + (r["cy"]-cy)**2, ri, zid))
pairs.sort()
done = set()
for _, ri, zid in pairs:
    if ri in done: continue
    if len(by_ct[zid]) >= caps[zid]: continue
    by_ct[zid].append(G["rects"][ri]); done.add(ri)

def sort_by_traversal(rects):
    """貪心最近鄰遍歷：從 PCA 主軸最遠端起點，每步取最近未訪節點。
    處理 L/U 型佈局時比純 PCA 投影正確（如 CT5 75-76-77-78-79-81-80）。"""
    P = np.array([[r["cx"], r["cy"]] for r in rects], float)
    c = P.mean(0); _, _, vt = np.linalg.svd(P - c); dvec = vt[0]
    t = (P - c) @ dvec
    start = int(np.argmin(t))
    n = len(rects); used = [False]*n; order = [start]; used[start] = True
    cur = start
    for _ in range(n - 1):
        best, bd = -1, 1e18
        for j in range(n):
            if used[j]: continue
            d = (P[cur, 0]-P[j, 0])**2 + (P[cur, 1]-P[j, 1])**2
            if d < bd: bd, best = d, j
        order.append(best); used[best] = True; cur = best
    return [rects[i] for i in order], c, dvec, t

for ct, rs in by_ct.items():
    codes = BERTHS[ct]
    if len(rs) != len(codes):
        print(f"⚠ {ct} 預期 {len(codes)} 碼頭，實得 {len(rs)}")
    rs_sorted, c, dvec, t = sort_by_traversal(rs)
    if ct in REVERSE:
        rs_sorted = list(reversed(rs_sorted))
    zones[ct]["berths"] = [{"code": code, "x": round(r["cx"], 1), "y": round(r["cy"], 1)}
                            for code, r in zip(codes, rs_sorted)]
    A = c + dvec*t.min(); B = c + dvec*t.max()
    zones[ct]["quay"] = [[round(float(A[0]), 1), round(float(A[1]), 1)],
                         [round(float(B[0]), 1), round(float(B[1]), 1)]]

# ---------- 5. 輸出（強制 UTF-8）----------
out = {"size": [W, H], "zones": list(zones.values())}
with open(os.path.join(OUT_DIR, "zones.json"), "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
print("輸出 data/zones.json (UTF-8)")
for z in out["zones"]:
    extra = f" 碼頭{len(z.get('berths', []))}" if z["type"] == "ct" else ""
    pcnt = z["d"].count("L") + 1
    src = ",".join(zid_to_eids[z["id"]])
    print(f"  {z['id']:4} {z['name']:20} 點數{pcnt:3} 來源{src}{extra}")
