@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title 推送到 GitHub - BM Free Music

cd /d "%~dp0.."

set REPO=90dzdbm/BMFreeMusic
if not defined BMFM_DEPLOY_KEY set BMFM_DEPLOY_KEY=%USERPROFILE%\.ssh\bmfm_deploy

echo.
echo   ============================================
echo    推送 BM Free Music 到 GitHub
echo   ============================================
echo.

if defined GITHUB_TOKEN (
  echo   [方式] Personal Access Token
  set REMOTE=https://!GITHUB_TOKEN!@github.com/!REPO!.git
) else (
  echo   [方式] 部署密钥
  if not exist "%BMFM_DEPLOY_KEY%" (
    echo   [x] 找不到私钥: %BMFM_DEPLOY_KEY%
    echo       先运行 ssh-keygen 生成，或设置 BMFM_DEPLOY_KEY
    pause
    exit /b 1
  )

  echo   [1/3] 测试 SSH 授权...
  ssh -i "%BMFM_DEPLOY_KEY%" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -T git@github.com 2>&1 | findstr /i "successfully authenticated" >nul
  if errorlevel 1 (
    echo.
    echo   [x] 授权失败：公钥还没加到仓库。
    echo.
    echo       打开 https://github.com/%REPO%/settings/keys
    echo       点 Add deploy key，把下面这一行粘进去，勾选 Allow write access：
    echo.
    type "%BMFM_DEPLOY_KEY%.pub"
    echo.
    pause
    exit /b 1
  )
  echo       ✓ 授权通过
  set REMOTE=git@github.com:%REPO%.git
)

echo   [2/3] 配置 remote 并推送...
git remote remove origin 2>nul
git remote add origin %REMOTE%
git branch -M main
git push -u origin main --force
if errorlevel 1 (
  echo   [x] 推送失败
  pause
  exit /b 1
)
echo       ✓ main 已推送

echo   [3/3] 打 tag v1.0.0...
git tag -d v1.0.0 2>nul
git tag -a v1.0.0 -m "BM Free Music v1.0.0"
git push origin v1.0.0 --force
echo       ✓ tag 已推送

echo.
echo   ============================================
echo    完成！
echo   ============================================
echo.
echo    仓库: https://github.com/%REPO%
echo    发版: https://github.com/%REPO%/releases/new
echo.
echo    接下来在网页上：
echo      1. 打开上面的发版页面，tag 选 v1.0.0
echo      2. 标题填 BM Free Music v1.0.0
echo      3. 说明粘 Releases\release-notes.md 的内容
echo      4. 上传 Releases\ 里的 .apk 和 -source.zip
echo.
pause
