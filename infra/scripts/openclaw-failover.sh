#!/bin/bash
# OpenClaw failover watchdog — runs every 60s via systemd timer on zeke
# If Mac gateway is reachable: ensure local gateway is stopped
# If Mac gateway is down: start local gateway as backup
set -euo pipefail

MAC_HOST="100.82.144.92"
MAC_PORT=18789
LOCK="/tmp/openclaw-failover-active"
LOG="/var/log/openclaw-failover.log"
RESTORE_SCRIPT="/home/ubuntu/.openclaw/workspace/hooks/restore-from-backup.sh"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG"
}

# Rotate log if > 1MB
if [ -f "$LOG" ] && [ "$(stat -c%s "$LOG" 2>/dev/null || echo 0)" -gt 1048576 ]; then
    mv "$LOG" "${LOG}.old"
    log "Log rotated"
fi

if curl -sf --connect-timeout 5 "http://${MAC_HOST}:${MAC_PORT}/" >/dev/null 2>&1; then
    # Mac is up — ensure local gateway is stopped (regardless of who started it)
    if systemctl is-active --quiet openclaw.service; then
        systemctl stop openclaw.service
        rm -f "$LOCK"
        log "Mac is reachable, stopped local gateway"
    elif [ -f "$LOCK" ]; then
        # Lock stale (service already stopped)
        rm -f "$LOCK"
        log "Cleaned stale lock file"
    fi
else
    # Mac is down — start local gateway as backup
    if ! systemctl is-active --quiet openclaw.service; then
        # Restore latest Mac DB backup before starting
        if [ -x "$RESTORE_SCRIPT" ]; then
            log "Restoring Mac DB before failover start..."
            sudo -u ubuntu "$RESTORE_SCRIPT" >> "$LOG" 2>&1 || log "WARN: DB restore failed, starting anyway"
        fi
        systemctl start openclaw.service
        touch "$LOCK"
        log "Mac unreachable, started local failover gateway"
    fi
fi
