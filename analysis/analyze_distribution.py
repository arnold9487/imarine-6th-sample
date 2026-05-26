# -*- coding: utf-8 -*-
"""分析各 CT 「每日最大同時在泊艘次（小船等量）」分布
- 排除沒船的日子（可能整修）
- 計算 mean / variance、檢測是否接近 Poisson（mean ≈ variance）
- 三條上限線比較：mean+3σ（常態假設）、Poisson 99.85%、實證 99.85% 百分位
- 輸出 distribution.png（七格子圖）
"""
import sys, os, json, math
sys.stdout.reconfigure(encoding="utf-8")
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from scipy.stats import poisson

ROOT = os.path.dirname(os.path.abspath(__file__))

# ---- 中文字型（Windows 預設黑體）----
for f in ("C:/Windows/Fonts/msjh.ttc", "C:/Windows/Fonts/msyh.ttc"):
    if os.path.exists(f):
        font_manager.fontManager.addfont(f)
        plt.rcParams["font.sans-serif"] = ["Microsoft JhengHei", "Microsoft YaHei", "sans-serif"]
        break
plt.rcParams["axes.unicode_minus"] = False

# ---- 讀資料 ----
DATA_DIR = os.path.normpath(os.path.join(ROOT, "..", "data"))   # 專案根 data/
data = json.load(open(os.path.join(DATA_DIR, "daymax.json"), encoding="utf-8"))
port = json.load(open(os.path.join(DATA_DIR, "port_data.json"), encoding="utf-8"))
CTS = ["CT1", "CT2", "CT3", "CT4", "CT5", "CT6", "CT7"]
NAMES = {ct: port["terminals"][ct]["name_zh"] for ct in CTS}

# ---- 畫圖：3x3 子圖（7 CT + 統計摘要 + 整體說明） ----
fig, axs = plt.subplots(3, 3, figsize=(15, 11))
axs = axs.flatten()

summary_rows = []
plot_data = []   # 先計算所有資料以決定全域 x/y 範圍
for ct in CTS:
    raw = np.array(data[ct], dtype=int)
    nz = raw[raw > 0]
    n = len(nz); mean = nz.mean(); var = nz.var(ddof=0); std = math.sqrt(var)
    upper_norm = int(math.ceil(mean + 3 * std))
    upper_pois = int(poisson.ppf(0.9985, mean)) if mean > 0 else 0
    upper_emp  = int(np.percentile(nz, 99.85))
    summary_rows.append((ct, n, len(raw)-n, mean, var, var/mean if mean else 0,
                        upper_norm, upper_pois, upper_emp))
    plot_data.append({"ct": ct, "raw": raw, "nz": nz, "n": n, "mean": mean, "var": var,
                       "upper_norm": upper_norm, "upper_pois": upper_pois, "upper_emp": upper_emp})

# 全域尺度：x 取所有 nz 最大值 + 上限三條最大值；y 取所有直方圖 bin 計數最大值
x_max = max(max(p["nz"].max(), p["upper_norm"], p["upper_pois"], p["upper_emp"])
            for p in plot_data) + 1
y_max = 0
for p in plot_data:
    bins = np.arange(0.5, x_max + 1.5, 1)
    counts, _ = np.histogram(p["nz"], bins=bins)
    y_max = max(y_max, counts.max())
y_max = int(y_max * 1.08)   # 留一點頂部空間

GLOBAL_BINS = np.arange(0.5, x_max + 1.5, 1)

for i, p in enumerate(plot_data):
    ax = axs[i]; ct = p["ct"]; nz = p["nz"]; mean = p["mean"]; var = p["var"]; n = p["n"]
    ax.hist(nz, bins=GLOBAL_BINS, edgecolor="#444", color="#7ba6dc", alpha=.85, label="實際")
    xs = np.arange(1, int(x_max) + 1)
    pois_pmf = poisson.pmf(xs, mean) * n
    ax.plot(xs, pois_pmf, "o-", color="#d18054", lw=1.4, ms=3, label=f"Poisson(λ={mean:.2f})")
    ax.axvline(p["upper_norm"], color="#d83a2c", linestyle="--", lw=1.4, label=f"μ+3σ={p['upper_norm']}")
    ax.axvline(p["upper_pois"], color="#2f6bdc", linestyle=":",  lw=1.6, label=f"Pois.99.85%={p['upper_pois']}")
    ax.axvline(p["upper_emp"],  color="#16a34a", linestyle="-.", lw=1.2, label=f"實證99.85%={p['upper_emp']}")
    ax.set_title(f"{ct} {NAMES[ct]}\n"
                 f"μ={mean:.2f}  σ²={var:.2f}  σ²/μ={var/mean:.2f} "
                 f"(零日 {len(p['raw'])-n}/{len(p['raw'])})", fontsize=10)
    ax.set_xlabel("每日最大同時在泊艘次（小船等量）"); ax.set_ylabel("天數")
    ax.set_xlim(0.5, x_max + 0.5)
    ax.set_ylim(0, y_max)
    ax.legend(fontsize=7, loc="upper right")
    ax.grid(True, alpha=.3)

# 第 8 格：總表
ax = axs[7]; ax.axis("off")
header = ["CT", "n(非零)", "零日", "μ", "σ²", "σ²/μ", "μ+3σ", "Pois.99.85%", "實證99.85%"]
cell = [[r[0], str(r[1]), str(r[2]),
         f"{r[3]:.2f}", f"{r[4]:.2f}", f"{r[5]:.2f}",
         str(r[6]), str(r[7]), str(r[8])] for r in summary_rows]
tab = ax.table(cellText=cell, colLabels=header, loc="center", cellLoc="center")
tab.auto_set_font_size(False); tab.set_fontsize(9); tab.scale(1, 1.4)
ax.set_title("各上限比較（單位＝小船等量）", fontsize=11)

# 第 9 格：判定建議
ax = axs[8]; ax.axis("off")
notes = ["分布判定建議（σ²/μ 接近 1 ⇒ Poisson）：", ""]
for r in summary_rows:
    ratio = r[5]
    if 0.85 <= ratio <= 1.15: tag = "≈Poisson → 用 Pois.99.85%"
    elif ratio < 0.85: tag = "欠離散(有飽和) → μ+3σ 偏保守，建議 實證99.85%"
    else: tag = "過離散 → μ+3σ 可能不足，建議 Pois.99.85% 或實證99.85%"
    notes.append(f"  {r[0]} (σ²/μ={ratio:.2f}): {tag}")
ax.text(0.02, 0.97, "\n".join(notes), va="top", ha="left", fontsize=10)

plt.suptitle("各貨櫃中心 每日最大同時在泊（小船等量）分布 — 2025 全年・排除無船日",
             fontsize=14, y=0.995)
plt.tight_layout()
out = os.path.join(ROOT, "distribution.png")
plt.savefig(out, dpi=130, bbox_inches="tight")
print("輸出", out)
print("\n=== 統計摘要 ===")
print(f"{'CT':4} {'n':>4} {'零日':>4} {'μ':>6} {'σ²':>6} {'σ²/μ':>6} {'μ+3σ':>5} {'Pois':>5} {'實證':>5}")
for r in summary_rows:
    print(f"{r[0]:4} {r[1]:>4} {r[2]:>4} {r[3]:>6.2f} {r[4]:>6.2f} {r[5]:>6.2f} {r[6]:>5} {r[7]:>5} {r[8]:>5}")
