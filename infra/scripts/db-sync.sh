#!/bin/bash
# Sync Mac's openclaw DB to zeke's postgres (backup replica)
# Runs every 5 minutes via ai.openclaw.db-sync launchd plist
set -euo pipefail

LOG_DIR="$HOME/.openclaw/logs"
LOG_FILE="$LOG_DIR/db-sync.log"
DUMP_FILE="/tmp/openclaw-mac-dump.sql"
ZEKE_SSH="ssh -i $HOME/Downloads/ZEKE.pem -o ConnectTimeout=10 -o BatchMode=yes ubuntu@zeke"
MAX_LOG_SIZE=5242880  # 5MB

mkdir -p "$LOG_DIR"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"
}

# Rotate log if too large
if [ -f "$LOG_FILE" ] && [ "$(stat -f%z "$LOG_FILE" 2>/dev/null || echo 0)" -gt "$MAX_LOG_SIZE" ]; then
    mv "$LOG_FILE" "${LOG_FILE}.old"
    log "Log rotated"
fi

# Check Docker is running
if ! docker info >/dev/null 2>&1; then
    log "ERROR: Docker is not running"
    exit 1
fi

# Check local postgres container is running
if ! docker ps --format '{{.Names}}' | grep -q '^openclaw-postgres$'; then
    log "ERROR: openclaw-postgres container is not running"
    exit 1
fi

# Dump local DB
log "Starting dump..."
if ! docker exec openclaw-postgres pg_dump -U zeke --clean --if-exists zeke_db > "$DUMP_FILE" 2>/dev/null; then
    log "ERROR: pg_dump failed"
    rm -f "$DUMP_FILE"
    exit 1
fi

DUMP_SIZE=$(stat -f%z "$DUMP_FILE" 2>/dev/null || echo 0)
if [ "$DUMP_SIZE" -lt 1000 ]; then
    log "ERROR: Dump file suspiciously small (${DUMP_SIZE} bytes)"
    rm -f "$DUMP_FILE"
    exit 1
fi

# Check zeke is reachable
if ! $ZEKE_SSH "echo ok" >/dev/null 2>&1; then
    log "WARN: zeke unreachable, skipping sync"
    rm -f "$DUMP_FILE"
    exit 0
fi

# Push to zeke
if $ZEKE_SSH "docker exec -i openclaw-postgres-1 psql -U zeke zeke_db" < "$DUMP_FILE" >/dev/null 2>&1; then
    log "OK: Synced to zeke (${DUMP_SIZE} bytes)"
else
    log "ERROR: Failed to restore dump on zeke"
    rm -f "$DUMP_FILE"
    exit 1
fi

rm -f "$DUMP_FILE"
