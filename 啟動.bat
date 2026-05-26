@echo off
chcp 65001 >nul
REM 啟動本機伺服器並開啟瀏覽器（網頁需透過 http 才能讀取資料檔）
cd /d "%~dp0"
echo 啟動本機伺服器 http://localhost:8123 ...
start "" http://localhost:8123/index.html
python -m http.server 8123
