#!/usr/bin/env bash
#
# AI 启智课 · 数据库每日备份
#
# 部署在服务器上：/home/ubuntu/aiq-api/scripts/backup-db.sh，由 ubuntu 的 crontab 调用。
# **服务器上的这份是唯一权威副本**，要改就在服务器上直接改（见 HANDOFF §3.1）。
# 开发机若留有旧副本，不要再同步回来。
#
# 只碰 aiq_course。这台机器上还跑着 301.group 的库，任何不带库名的
# mysqldump / DROP 都是事故，所以下面每一处库名都写死。
#
set -euo pipefail

# 备份里含用户邮箱、密码哈希和作品：收窄 umask，别让本机其他用户读到
umask 077

DB=aiq_course
DIR=/home/ubuntu/backups/aiq
KEEP_DAYS=14
STAMP=$(date +%F_%H%M)
TARGET="$DIR/${DB}_${STAMP}.sql.gz"
TMP="$TARGET.part"

mkdir -p "$DIR"

# 先写 .part，校验全过才改名成正式文件：中途失败不会留下一个和正常备份
# 同名的半成品——灾难恢复时最容易误选的就是那种文件。
trap 'rm -f "$TMP"' EXIT

# --single-transaction：InnoDB 下拿一致性快照且不锁表，
#   老师正上课时也照备不误。少了它 mysqldump 会 LOCK TABLES，把线上写请求卡住。
# 走 sudo 是图省事——这台机器 sudo 免密，用 root 的 socket 认证就不必再存一份
# 数据库密码到磁盘上（.env 里那份是给应用用的，能少一处泄露面就少一处）。
sudo mysqldump --single-transaction --quick --default-character-set=utf8mb4 "$DB" \
  | gzip > "$TMP"

# 备份文件是空的最坑：cron 不会报错，等真要用的时候才发现 14 天全是 0 字节。
# 这里当场验一次能不能解开、里面有没有建表语句，坏了就以非 0 退出，
# 让 cron 发信出来（MAILTO 见 crontab）。
if ! gzip -t "$TMP" 2>/dev/null; then
  echo "备份文件损坏：$TMP" >&2
  exit 1
fi
if ! zcat "$TMP" | grep -q 'CREATE TABLE'; then
  echo "备份内容可疑：没有 CREATE TABLE，可能导了个空库" >&2
  exit 1
fi

mv "$TMP" "$TARGET"

# 只清理本目录、且只匹配本库的文件名。不用 `find "$DIR" -mtime +14 -delete`
# 这种写法——哪天 DIR 被改错一个字符，删的就是别人的备份。
find "$DIR" -maxdepth 1 -name "${DB}_*.sql.gz" -mtime "+$KEEP_DAYS" -delete

echo "$(date '+%F %T') 备份完成：$TARGET ($(du -h "$TARGET" | cut -f1))"
