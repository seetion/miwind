@echo off
chcp 65001 >nul
title 生产管理系统 - Turso 云库版 (端口 5174)
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo [错误] 没有检测到 Node.js。
  echo        请先安装 Node.js 18 或以上版本：https://nodejs.org
  echo.
  pause
  exit /b 1
)

cls
echo ============================================================
echo            生产管理系统 - Turso 云库版
echo ------------------------------------------------------------
echo   本地版：npm start   端口 5173   数据在 data\pmc.db
echo   云库版：本窗口       端口 5174   数据在 Turso 云端
echo   两者互不影响，本窗口不会修改本地任何数据。
echo ------------------------------------------------------------
echo   by.柏兴圣  baiwuqi@126.com  seetion@yeah.net
echo ============================================================
echo.

node start-turso.js

echo.
echo ------------------------------------------------------------
echo   云库版已停止。本地版不受影响，可继续用 npm start 启动。
echo ------------------------------------------------------------
pause
