@echo off
chcp 65001 >nul
title BM Free Music
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [x] 没有找到 Node.js
  echo       请先安装 Node.js 18 或更高版本：https://nodejs.org/
  echo.
  pause
  exit /b 1
)

echo.
echo   BM Free Music - 正在启动...
echo.

node server/index.js
if errorlevel 1 (
  echo.
  echo   服务异常退出。按任意键关闭窗口。
  pause >nul
)
