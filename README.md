# 高雄港 · 貨櫃中心壓力狀態

互動式網頁，將 2025 全年高雄港進出港資料視覺化成 7 個貨櫃中心 (CT1~CT7) 的**在泊壓力動態地圖**：時間滑桿可看任一時刻的壓力變化、實線/預測虛線雙線顯示實際 vs 預定排程、滑鼠懸浮各貨櫃中心看碼頭級在泊船艘明細、點船名彈出該船完整資料。

> 競賽用展示作品

---

## 線上展示

可直接從 GitHub Pages 開啟 [附上連結](https://arnold9487.github.io/imarine-6th-sample/)。若伺服器渲染有問題，請見下方「本機執行」。

---

## 專案結構

```
imarine/
├─ index.html              ← 網站入口
├─ css/styles.css          ← 樣式
├─ js/app.js               ← 互動邏輯（拖曳縮放、壓力色、預測線、資料框…）
├─ data/                   ← 網站讀取的 JSON 資料
│   ├─ port_data.json      ← 8863 筆船舶靠泊紀錄 + 各 CT 壓力上限
│   ├─ zones.json          ← 12 個圍地的形狀 + 34 個碼頭位置
│   └─ daymax.json         ← 各 CT 每日最大同時在泊（給分析用）
├─ 高清底圖.png            ← 網站背景圖（2575×1440）
├─ 啟動.bat                ← 本機一鍵啟動（自動開伺服器+瀏覽器）
│
├─ build/                  ← 資料管線（不參與網站運行）
│   ├─ build_data.py       ← 進出港 XML → port_data.json + daymax.json
│   ├─ build_zones.py      ← 新參考位置.svg → zones.json
│   ├─ 進出港數據/          ← 26 個 BIG5 XML 原始檔（2024/12 ~ 2026/01）
│   ├─ 新參考位置.svg       ← 12 個圍地與碼頭的座標標記
│   ├─ 貨櫃碼頭代號.md      ← CT1~CT7 各自對應的碼頭代號
│   └─ 進出港資料對照.md    ← XML 欄位對照
│
├─ analysis/               ← 統計分析（不參與網站運行）
│   ├─ analyze_distribution.py  ← 產生分布圖、做正態/Poisson 判定
│   └─ distribution.png    ← 各 CT 每日最大同時在泊分布
│
├─ requirements.txt        ← Python 依賴
└─ .gitignore
```

---

## 本機執行（最常用：雙擊就動）

**直接雙擊 `啟動.bat`** → 自動啟動本機 HTTP 伺服器，並打開瀏覽器到 `http://localhost:8123/index.html`。

> ⚠️ **不能直接雙擊 `index.html`**：瀏覽器在 `file://` 協定下會因為 CORS 政策阻擋 `fetch()` 讀取 JSON。`啟動.bat` 會用 Python 啟動一個簡單 HTTP 伺服器繞過這個限制。

### 如果線上版開不起來怎麼辦

那就把這個專案下載下來自己跑：

1. 從 GitHub Repo 點 **Code → Download ZIP**，或 `git clone`
2. 必下載清單（網站運行只需要這些）：
   - `index.html`
   - `css/` 整個資料夾
   - `js/` 整個資料夾
   - `data/` 整個資料夾
   - `高清底圖.png`
   - **`啟動.bat`**（很重要！直接打開 html 不會動）
3. 確保 Python 在 PATH 上（Windows 已內建或從 [python.org](https://python.org) 裝；`python --version` 能跑就行）
4. **雙擊 `啟動.bat`** 即可

> `build/` 和 `analysis/` 兩個資料夾與網站運行**無關**，下載時可以省略。它們只在你想重新生成資料或看分析時才需要。

---

## 重建資料（進階）

只在原始 XML 有更新、或你想調整參數時需要。

### 環境設置

```bash
# 1. 建虛擬環境
python -m venv .venv

# 2. 啟動虛擬環境
.venv\Scripts\activate     # Windows
# source .venv/bin/activate  # macOS/Linux

# 3. 裝套件
pip install -r requirements.txt

# 4. build_zones 需要瀏覽器引擎（取 SVG 幾何）
playwright install chromium
```

### 跑管線

```bash
python build/build_data.py        # XML → data/port_data.json + data/daymax.json
python build/build_zones.py       # 新參考位置.svg → data/zones.json
python analysis/analyze_distribution.py   # 產生 analysis/distribution.png 與統計
```

---

## 主要功能

| 功能 | 說明 |
|---|---|
| 拖曳縮放 | 全螢幕地圖；拖曳平移、滾輪縮放；自動限制邊界避免拖出圖外 |
| 時間軸 | 月/日/時三層滑桿 + 步進鈕；播放鍵按小時推進；速度三檔可調 |
| 壓力色 | 綠 → 黃 → 紅（HSL 色相 120→0），依「當下在泊小船等量 / CT 上限」 |
| 預測虛線 | 用「預定靠泊 + 預定離泊」純預定模型，畫到 now+6h，與實線並存 |
| 懸浮放大 | 滑鼠移到 CT 上，該區放大 1.5×、周圍模糊、顯示碼頭與在泊船圖式 |
| 智能資料框 | 列出該 CT 各碼頭目前停的船、靠泊與預定離泊時間；不出畫面 |
| 點船彈窗 | 點船名 → 另一個浮動面板，含完整船舶資料；與 CT 框並存 |
| 壓力指數圖 | 左側 7 張 sparkline（時/日/月切換），紅實線=實際、紅虛線=6h 預測 |

---

## 主要設計決策

- **船型權重**：小船=1、中船=2、大船=3 小船等量（依船長 <150 / 150-300 / ≥300 m 分級）
- **壓力上限**：以「每日最大同時在泊艘次（小船等量）」為樣本，**自動挑**：
  - σ²/μ ∈ [0.85, 1.15] → Poisson 99.85% 分位數
  - 其他（飽和或過離散）→ 實證 99.85% 分位數
  - 並排除「沒船的日子」（可能整修）
- **預測模型 vs 實際模型**：
  - 實際：用 `ACT_PORT_DT` 靠泊 + `LEAVE_PORT_DT` 離泊
  - 預測：用 `RESERVE_BERTH_TIME` 預定靠泊 + `RESERVE_LEAVE_BERTH_TIME` 預定離泊
  - 兩線各自獨立，自然不重疊
- **CT7 = S1~S5 貨櫃碼頭**（不是原代號表的 201-205；資料驗證後修正）

---

## 致謝

資料來源：高雄港務局公開的進出港 XML（BIG5 編碼）。底圖與圍地座標由作者手繪標定。
