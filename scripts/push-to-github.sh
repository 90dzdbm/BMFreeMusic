#!/usr/bin/env bash
# ==========================================================================
# push-to-github.sh —— 把仓库推送到 GitHub
#
# 两种授权方式，任选其一：
#
#   A. 部署密钥（推荐）
#      1) 把 bmfm_deploy.pub 的内容加到
#         https://github.com/90dzdbm/BMFreeMusic/settings/keys
#         勾选 "Allow write access"
#      2) 运行：bash scripts/push-to-github.sh
#
#   B. Personal Access Token
#      运行：GITHUB_TOKEN=ghp_xxxx bash scripts/push-to-github.sh
# ==========================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

REPO="90dzdbm/BMFreeMusic"
KEY="${BMFM_DEPLOY_KEY:-$HOME/.ssh/bmfm_deploy}"
BRANCH="main"

say() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }
ok()  { printf '\033[32m  ✓ %s\033[0m\n' "$1"; }
bad() { printf '\033[31m  ✗ %s\033[0m\n' "$1"; }

# ---------- 选择授权方式 ----------
if [ -n "${GITHUB_TOKEN:-}" ]; then
  say "使用 Personal Access Token"
  REMOTE="https://${GITHUB_TOKEN}@github.com/${REPO}.git"
else
  say "使用部署密钥"
  if [ ! -f "$KEY" ]; then
    bad "找不到私钥：$KEY"
    echo "   用 ssh-keygen 生成，或设置 BMFM_DEPLOY_KEY 指向私钥路径"
    exit 1
  fi
  chmod 600 "$KEY" 2>/dev/null || true
  export GIT_SSH_COMMAND="ssh -i \"$KEY\" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15"

  printf '  测试 SSH 授权… '
  if ssh -i "$KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new \
        -o ConnectTimeout=15 -T git@github.com >/tmp/_bmfm_ssh.txt 2>&1; then
    printf '\n'
    ok "授权通过"
  else
    printf '\n'
    if grep -qi "successfully authenticated" /tmp/_bmfm_ssh.txt; then
      ok "授权通过"
    else
      bad "授权失败，公钥还没加到仓库"
      echo
      echo "   把下面这一行加到 https://github.com/${REPO}/settings/keys"
      echo "   记得勾选 Allow write access："
      echo
      cat "${KEY}.pub"
      echo
      exit 1
    fi
  fi
  REMOTE="git@github.com:${REPO}.git"
fi

# ---------- 配置远端 ----------
say "配置 remote"
git remote remove origin 2>/dev/null || true
git remote add origin "$REMOTE"
ok "origin -> $(echo "$REMOTE" | sed 's#//[^@]*@#//***@#')"

# ---------- 推送 ----------
say "推送 main 分支"
git branch -M "$BRANCH"
if git push -u origin "$BRANCH" --force; then
  ok "main 已推送"
else
  bad "推送失败"
  exit 1
fi

# ---------- 打 tag ----------
say "打 tag v1.0.0"
git tag -d v1.0.0 2>/dev/null || true
git tag -a v1.0.0 -m "BM Free Music v1.0.0"
git push origin v1.0.0 --force
ok "tag 已推送"

# ---------- 收尾 ----------
say "完成"
echo "  仓库：https://github.com/${REPO}"
echo "  发行：https://github.com/${REPO}/releases/new"
echo
echo "  下一步（在网页上操作）："
echo "    1. 打开上面的发行页面，选择 tag v1.0.0"
echo "    2. 标题填：BM Free Music v1.0.0"
echo "    3. 说明直接粘贴 Releases/release-notes.md 的内容"
echo "    4. 上传 Releases/ 里的两个文件："
echo "         BMFreeMusic-1.0.0.apk"
echo "         BMFreeMusic-1.0.0-source.zip"
echo "       （SHA256SUMS.txt 也一并传上）"
echo "    5. 点 Publish release"
echo
