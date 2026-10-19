#!/bin/sh
set -eu
: "${BACKUP_RECIPIENT:?Set an age public recipient}"
: "${BACKUP_DIR:?Set a backup directory on a separate disk or host mount}"
command -v age >/dev/null
tmp=$(mktemp -d /tmp/mangumi-backup.XXXXXX)
case "$tmp" in /tmp/mangumi-backup.*) ;; *) exit 1;; esac
trap 'rm -rf -- "$tmp"' EXIT HUP INT TERM
docker compose --env-file ../../.env exec -T db sh -c 'export MYSQL_PWD="$MARIADB_ROOT_PASSWORD"; exec mariadb-dump -uroot --single-transaction --routines --events mangumi' > "$tmp/database.sql"
docker compose --env-file ../../.env exec -T api tar -C /data/uploads -czf - . > "$tmp/uploads.tar.gz"
mkdir -p "$BACKUP_DIR"
tar -C "$tmp" -czf - database.sql uploads.tar.gz | age -r "$BACKUP_RECIPIENT" -o "$BACKUP_DIR/mangumi-$(date -u +%Y%m%dT%H%M%SZ).tar.gz.age"
