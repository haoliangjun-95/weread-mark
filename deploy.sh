#!/usr/bin/env bash
# 一键部署：同步本地代码到服务器并构建，更新线上站点
# 用法：./deploy.sh
set -euo pipefail

SERVER="root@110.42.234.144"
REMOTE_DIR="/www/wwwroot/weread-mark"

echo "==> 同步代码到 ${SERVER}:${REMOTE_DIR}（保留服务器 .env，排除 node_modules/dist）"
rsync -az --delete \
  --exclude node_modules \
  --exclude dist \
  --exclude .env \
  --exclude .env.tauri \
  --exclude .git \
  --exclude src-tauri/target \
  ./ "${SERVER}:${REMOTE_DIR}/"

echo "==> 服务器安装依赖并构建"
ssh "${SERVER}" "cd ${REMOTE_DIR} && npm ci --no-audit --no-fund && npm run build"

echo "==> 线上验证"
sleep 2
STATUS=$(curl -s -o /dev/null -w '%{http_code}' https://weread.haoliangjun.com/)
SW_CACHE=$(curl -sI https://weread.haoliangjun.com/sw.js | grep -i cache-control | tr -d '\r')
echo "    首页状态: ${STATUS}"
echo "    sw.js 缓存头: ${SW_CACHE:-未获取到}"

if [ "${STATUS}" = "200" ]; then
  echo "==> 部署成功 ✅  https://weread.haoliangjun.com"
else
  echo "==> 首页返回 ${STATUS}，请检查服务器日志：tail -50 /www/wwwlogs/weread.haoliangjun.com.error.log" >&2
  exit 1
fi
