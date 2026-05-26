# -*- coding: utf-8 -*-
"""高雄港 進出港資料清洗 / 整併 -> data/port_data.json

- 讀 進出港數據/*.xml（BIG5、部分有未跳脫 & 而無法嚴格解析）→ 寬鬆 regex 解析
- 依碼頭代號過濾「容器」記錄（CT7 = S1~S5 貨櫃碼頭）
- 以 VISA_NO 配對進港↔出港，整併成「以船為單位」的靠泊紀錄
- 依靠泊時間排序；計算各貨櫃中心壓力上限 = ceil(每日平均靠泊艘次 + 3*母體標準差)
"""
import sys, os, re, glob, json, math
from datetime import datetime, timedelta
from collections import defaultdict
import numpy as np
from scipy.stats import poisson
sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "進出港數據")
OUT_DIR = os.path.normpath(os.path.join(ROOT, "..", "data"))   # 寫入專案根 data/
os.makedirs(OUT_DIR, exist_ok=True)

# ---- 碼頭 -> 貨櫃中心 對應 ----
TERMINALS = {
    "CT1": ("第一貨櫃中心", ["41", "42", "43"]),
    "CT2": ("第二貨櫃中心", ["63", "64", "65", "66", "67"]),
    "CT3": ("第三貨櫃中心", ["68", "69", "70"]),
    "CT4": ("第四貨櫃中心", ["115", "116", "117", "118", "119", "120", "121"]),
    "CT5": ("第五貨櫃中心", ["75", "76", "77", "78", "79", "80", "81"]),
    "CT6": ("第六貨櫃中心（洲際一期）", ["108", "109", "110", "111"]),
    "CT7": ("第七貨櫃中心（洲際二期）", ["S1", "S2", "S3", "S4", "S5"]),
}
BERTH2CT = {}
for ct, (_, bs) in TERMINALS.items():
    for b in bs:
        BERTH2CT[b] = ct

SHIP_RE = re.compile(r"<SHIP>(.*?)</SHIP>", re.S)
AMP_RE = re.compile(r"&(?!amp;|lt;|gt;|quot;|apos;|#)")


def tag(block, name):
    m = re.search(r"<%s>(.*?)</%s>" % (name, name), block, re.S)
    return m.group(1).strip() if m else ""


def parse_berth(w):
    """回傳 (ct, berth_code) 或 None。"""
    if not w:
        return None
    m = re.match(r"#0*(\d+)", w)               # #64碼頭 / #109號碼頭
    if m:
        code = m.group(1)
        return (BERTH2CT.get(code), code) if code in BERTH2CT else None
    m = re.match(r"S([1-5])\s*貨櫃", w)          # S1貨櫃碼頭 ~ S5貨櫃碼頭 = CT7
    if m:
        code = "S" + m.group(1)
        return (BERTH2CT[code], code)
    return None


def pdt(s):
    s = (s or "").strip()
    if len(s) != 12 or not s.isdigit():
        return None
    try:
        return datetime.strptime(s, "%Y%m%d%H%M")
    except ValueError:
        return None


def load_records():
    """回傳 (inbound_list, outbound_list)，每筆為 dict（已過濾容器）。"""
    inb, outb = [], []
    misfiled = []
    for fn in sorted(glob.glob(os.path.join(DATA_DIR, "*.xml"))):
        raw = open(fn, "rb").read().decode("big5", "replace")
        is_in = "<IN_PORT>" in raw[:200] or "_進港" in os.path.basename(fn)
        txt = AMP_RE.sub("&amp;", raw)
        ships = SHIP_RE.findall(txt)
        kept = 0
        west_east = 0
        for b in ships:
            w = tag(b, "WHARF_CODE")
            if re.match(r"[東西]\d", w):
                west_east += 1
            pb = parse_berth(w)
            if not pb:
                continue
            ct, code = pb
            rec = {
                "visa": tag(b, "VISA_NO"),
                "cn": tag(b, "VESSEL_CNAME"),
                "en": tag(b, "VESSEL_ENAME"),
                "type": tag(b, "STA_TYPE"),
                "agent": tag(b, "PBG_NAME"),
                "goal": tag(b, "GOAL_ARRIVAL"),
                "len": tag(b, "LENGTH"),
                "gross": tag(b, "GROSS_TOA"),
                "ct": ct, "berth": code,
                "act": tag(b, "ACT_PORT_DT"),
                "rsv_berth": tag(b, "RESERVE_BERTH_TIME"),
                "rsv_leave": tag(b, "RESERVE_LEAVE_BERTH_TIME"),
                "leave": tag(b, "LEAVE_PORT_DT"),
                "prev": tag(b, "BEFORE_PORT"),
                "next": tag(b, "NEXT_PORT"),
            }
            (inb if is_in else outb).append(rec)
            kept += 1
        # 放錯港偵測：高雄進出港不該大量出現 東/西+數字 碼頭
        if west_east > 50:
            misfiled.append((os.path.basename(fn), west_east))
    return inb, outb, misfiled


def size_of(length):
    try:
        L = float(length)
    except (TypeError, ValueError):
        L = 0.0
    if L <= 0:
        return "M"           # 未知 -> 視為中船(佔1碼頭)
    if L < 150:
        return "S"
    if L < 300:
        return "M"
    return "L"


def main():
    inb, outb, misfiled = load_records()
    if misfiled:
        print("⚠️ 疑似放錯港的檔案(大量東/西碼頭):", misfiled)

    visits = {}  # visa -> merged dict

    # 先進港（提供 碼頭/靠泊/識別）；同 visa 以「有實際靠泊時間」者優先
    for r in inb:
        v = r["visa"]
        if not v:
            continue
        cur = visits.get(v)
        better = cur is None or (r["act"] and not cur.get("act"))
        if better:
            base = dict(cur) if cur else {}
            base.update(r)
            visits[v] = base

    # 再出港（補 實際離泊 / 次一港；若進港沒有此 visa 也建檔）
    for r in outb:
        v = r["visa"]
        if not v:
            continue
        cur = visits.get(v)
        if cur is None:
            visits[v] = r
        else:
            if r["leave"] and not cur.get("leave"):
                cur["leave"] = r["leave"]
            if r["next"] and not cur.get("next"):
                cur["next"] = r["next"]
            for k in ("cn", "en", "len", "type", "agent", "gross", "goal"):
                if not cur.get(k) and r.get(k):
                    cur[k] = r[k]

    # 整理成輸出記錄
    out_visits = []
    drop_no_arrive = 0
    for v, r in visits.items():
        arrive = pdt(r.get("act")) or pdt(r.get("rsv_berth"))
        arrive_rsv = pdt(r.get("rsv_berth")) or arrive          # 純預定靠泊
        if not arrive:
            drop_no_arrive += 1
            continue
        end = pdt(r.get("leave")) or pdt(r.get("rsv_leave")) or (arrive + timedelta(days=1))
        if end <= arrive:
            end = arrive + timedelta(hours=12)
        # 在泊時長上限：剔除壞的預定離泊(遠未來)造成的「佔住數月」假象
        if end > arrive + timedelta(hours=72):
            end = arrive + timedelta(hours=72)
        dep_rsv = pdt(r.get("rsv_leave"))
        dep_act = pdt(r.get("leave"))
        out_visits.append({
            "id": v,
            "cn": r.get("cn") or "(無中文船名)",
            "en": r.get("en") or "",
            "ct": r["ct"], "berth": r["berth"],
            "len": (float(r["len"]) if _isnum(r.get("len")) else None),
            "size": size_of(r.get("len")),
            "arrive": arrive.isoformat(timespec="minutes"),
            "arrive_reserved": arrive_rsv.isoformat(timespec="minutes") if arrive_rsv else None,
            "depart_reserved": dep_rsv.isoformat(timespec="minutes") if dep_rsv else None,
            "depart_actual": dep_act.isoformat(timespec="minutes") if dep_act else None,
            "occ_end": end.isoformat(timespec="minutes"),
            "type": r.get("type") or "",
            "agent": r.get("agent") or "",
            "goal": r.get("goal") or "",
            "gross": (float(r["gross"]) if _isnum(r.get("gross")) else None),
            "prev": r.get("prev") or "",
            "next": r.get("next") or "",
        })

    out_visits.sort(key=lambda x: x["arrive"])

    # ---- 各 CT 壓力上限：「每日最大同時在泊艘次（小船等量）」mean + 3σ ----
    # 船型權重：大船=3、中船=2、小船=1（一律換成小船單位後再計算）
    # 排除「沒船的日子」（可能碼頭整修），只用非零日做平均/標準差
    SIZE_W = {"S": 1, "M": 2, "L": 3}
    all_dates = [datetime.fromisoformat(x["arrive"]).date() for x in out_visits]
    dmin, dmax = min(all_dates), max(all_dates)
    ndays = (dmax - dmin).days + 1

    by_ct = defaultdict(list)
    for x in out_visits:
        by_ct[x["ct"]].append((
            datetime.fromisoformat(x["arrive"]).timestamp(),
            datetime.fromisoformat(x["occ_end"]).timestamp(),
            SIZE_W.get(x["size"], 1),
        ))

    def day_max_series(events_all):
        """每天的『最大同時在泊（小船等量）』，sweep-line。"""
        out = []
        for i in range(ndays):
            d = dmin + timedelta(days=i)
            ds = datetime.combine(d, datetime.min.time()).timestamp()
            de = ds + 86400
            evts = []
            for a, e, w in events_all:
                s2 = max(a, ds); e2 = min(e, de)
                if s2 < e2:
                    evts.append((s2, +w)); evts.append((e2, -w))
            evts.sort(key=lambda x: (x[0], -x[1]))   # 同時刻先處理離泊(-)
            cur = mx = 0
            for _, dlt in evts:
                cur += dlt
                if cur > mx: mx = cur
            out.append(mx)
        return out

    terminals_out = {}
    day_max_per_ct = {}
    for ct, (name, berths) in TERMINALS.items():
        series = day_max_series(by_ct.get(ct, []))
        day_max_per_ct[ct] = series
        nonzero = [v for v in series if v > 0]
        if nonzero:
            n = len(nonzero)
            mean = sum(nonzero) / n
            var = sum((v - mean) ** 2 for v in nonzero) / n
            std = math.sqrt(var)
        else:
            n = 0; mean = std = var = 0
        # ---- 自動挑上限演算法（依離散程度）----
        ratio = (var / mean) if mean > 0 else 0
        if mean > 0 and 0.85 <= ratio <= 1.15:
            limit = max(1, int(math.ceil(poisson.ppf(0.9985, mean))))
            method = "Poisson 99.85%"
        elif nonzero:
            limit = max(1, int(math.ceil(np.percentile(nonzero, 99.85))))
            method = "實證 99.85%"
        else:
            limit = 1; method = "n/a"
        terminals_out[ct] = {
            "name_zh": name, "berths": berths, "limit": limit, "limit_method": method,
            "daily_mean_nz": round(mean, 3), "daily_std_nz": round(std, 3),
            "daily_var_nz": round(var, 3), "var_over_mean": round(ratio, 3),
            "nonzero_days": len(nonzero), "total_days": ndays,
            "visits": sum(1 for x in out_visits if x["ct"] == ct),
            "weighted_visits": sum(SIZE_W.get(x["size"], 1) for x in out_visits if x["ct"] == ct),
        }
    # 把每日最大同時在泊系列也存起來（給分布分析用）
    daymax_dump = {ct: day_max_per_ct[ct] for ct in TERMINALS}
    daymax_dump["_range"] = [dmin.isoformat(), dmax.isoformat()]

    result = {
        "meta": {
            "range": [dmin.isoformat(), dmax.isoformat()],
            "days": ndays,
            "generated": datetime.now().isoformat(timespec="seconds"),
            "total_visits": len(out_visits),
        },
        "terminals": terminals_out,
        "visits": out_visits,
    }
    out_path = os.path.join(OUT_DIR, "port_data.json")
    json.dump(result, open(out_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    # 額外輸出每日最大同時在泊系列(供分布分析)
    json.dump(daymax_dump, open(os.path.join(OUT_DIR, "daymax.json"), "w", encoding="utf-8"),
              ensure_ascii=False)

    # ---- 報告（中文）----
    print(f"進港記錄(容器) {len(inb)}　出港記錄(容器) {len(outb)}")
    print(f"整併後 visit {len(visits)}　有效(含靠泊時間) {len(out_visits)}　無靠泊丟棄 {drop_no_arrive}")
    print(f"時間範圍 {dmin} ~ {dmax}（{ndays} 天）")
    print("各貨櫃中心：（單位＝小船等量；L=3、M=2、S=1）")
    for ct, t in terminals_out.items():
        print(f"  {ct} {t['name_zh']:14} visits={t['visits']:5} σ²/μ={t['var_over_mean']:.2f} "
              f"非零日{t['nonzero_days']:3}/{t['total_days']} 上限={t['limit']:3} ({t['limit_method']})")
    print("輸出:", out_path, "+ data/daymax.json")


def _isnum(s):
    try:
        float(s); return True
    except (TypeError, ValueError):
        return False


if __name__ == "__main__":
    main()
