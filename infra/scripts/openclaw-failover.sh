#!/bin/bash
set -euo pipefail
MAC_HOST="100.82.144.92"
MAC_PORT=18789
LOCK="/tmp/openclaw-failover-active"
LOG="/var/log/openclaw-failover.log"
RESTORE_SCRIPT="/home/ubuntu/.openclaw/workspace/hooks/restore-from-backup.sh"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG"
}

if [ -f "$LOG" ] && [ "$(stat -c%s "$LOG" 2>/dev/null || echo 0)" -gt 1048576 ]; then
    mv "$LOG" "${LOG}.old"
    log "Log rotated"
fi

# Get service state: active, activating, inactive, failed, etc.
GW_STATE=$(systemctl is-active openclaw.service 2>/dev/null || true)

if curl -sf --connect-timeout 5 "http://${MAC_HOST}:${MAC_PORT}/" >/dev/null 2>&1; then
    # Mac is up — stop local gateway if it's running or crash-looping
    if [ "$GW_STATE" = "active" ] || [ "$GW_STATE" = "activating" ]; then
        systemctl stop openclaw.service
        rm -f "$LOCK"
        log "Mac is reachable, stopped local gateway (was: $GW_STATE)"
    elif [ -f "$LOCK" ]; then
        rm -f "$LOCK"
        log "Cleaned stale lock file"
    fi
else
    # Mac is down — start local gateway if not already running
    if [ "$GW_STATE" = "inactive" ] || [ "$GW_STATE" = "failed" ]; then
        if [ -x "$RESTORE_SCRIPT" ]; then
            log "Restoring Mac DB before failover start..."
            sudo -u ubuntu "$RESTORE_SCRIPT" >> "$LOG" 2>&1 || log "WARN: DB restore failed, starting anyway"
        fi
        systemctl start openclaw.service
        touch "$LOCK"
        log "Mac unreachable, started local failover gateway"
    fi
fi
