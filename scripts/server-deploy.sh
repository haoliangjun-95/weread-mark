#!/usr/bin/env bash
# 服务器端自动部署：由 crontab 每 5 分钟调用（见 README 部署章节）。
# 逻辑：fetch 远端 main，与本地 HEAD 比对，有新提交才 reset + 安装依赖 + 构建。
# 失败保护：构建失败不影响现有 dist，nginx 继续服务旧版本。
set -euo pipefail

APP_DIR="/www/wwwroot/weread-mark"
BRANCH="main"
LOG_FILE="/www/wwwlogs/weread-deploy.log"
LOCK_FILE="/tmp/weread-deploy.lock"
SITE_URL="https://weread.haoliangjun.com/"

log() {
  echo "[$(date '+%F %T')] $*"
}

# 日志超 5MB 截断保留尾部，避免无限增长
truncate_log() {
  if [[ -f "$LOG_FILE" ]] && (( $(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0) > 5 * 1024 * 1024 )); then
    tail -c 1048576 "$LOG_FILE" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE"
  fi
}

main() {
  # 防并发：上一次部署未完成时跳过本轮
  exec 9>"$LOCK_FILE"
  flock -n 9 || { log "上一次部署仍在进行，跳过本轮"; exit 0; }

  cd "$APP_DIR"

  # 拉取远端引用（不合并），网络失败仅告警退出
  if ! git fetch origin "$BRANCH" 2>&1 | while IFS= read -r line; do log "git: $line"; done; then
    log "git fetch 失败（网络异常？），本轮跳过"
    exit 0
  fi

  LOCAL=$(git rev-parse HEAD)
  REMOTE=$(git rev-parse "origin/$BRANCH")
  if [[ "$LOCAL" == "$REMOTE" ]]; then
    exit 0  # 无新提交，静默退出
  fi

  log "发现新提交 $LOCAL → $REMOTE，开始部署"

  # .env 含服务器本地配置（备案号等），reset 前备份、reset 后恢复
  if [[ -f .env ]]; then
    cp .env /tmp/weread-env-backup
  fi

  git reset --hard "$REMOTE"

  if [[ -f /tmp/weread-env-backup ]]; then
    cp /tmp/weread-env-backup .env
  fi

  if ! npm ci --no-audit --no-fund; then
    log "npm ci 失败，保留现有 dist 继续服务，等待下轮重试"
    exit 1
  fi
  if ! npm run build; then
    log "构建失败，保留现有 dist 继续服务，等待下轮重试"
    exit 1
  fi

  log "构建完成 $REMOTE，新版本已上线"

  if ! curl -sf -o /dev/null "$SITE_URL"; then
    log "警告：部署后站点健康检查失败，请人工检查"
  fi
}

truncate_log
main "$@"
