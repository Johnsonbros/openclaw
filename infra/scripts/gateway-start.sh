#!/bin/bash
# Gateway startup wrapper — notifies zeke to stop its failover gateway
# before starting the local gateway, preventing dual-gateway conflicts.
# Called by ai.openclaw.gateway launchd plist.

LOG="$HOME/.openclaw/logs/gateway.log"
ZEKE_SSH="ssh -i $HOME/Downloads/ZEKE.pem -o ConnectTimeout=5 -o BatchMode=yes -o StrictHostKeyChecking=no ubuntu@zeke"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [startup] $1" >> "$LOG"
}

# ── Pre-flight: wait for Docker & Postgres ──────────────────────
MAX_WAIT=120  # seconds
WAITED=0
log "Waiting for Docker..."
while ! docker info >/dev/null 2>&1; do
    sleep 5
    WAITED=$((WAITED + 5))
    if [ "$WAITED" -ge "$MAX_WAIT" ]; then
        log "FATAL: Docker not available after ${MAX_WAIT}s — aborting"
        exit 1
    fi
done
log "Docker ready (waited ${WAITED}s)"

log "Waiting for Postgres..."
while ! docker exec openclaw-postgres pg_isready -U zeke >/dev/null 2>&1; do
    sleep 5
    WAITED=$((WAITED + 5))
    if [ "$WAITED" -ge "$MAX_WAIT" ]; then
        log "FATAL: Postgres not ready after ${MAX_WAIT}s — aborting"
        exit 1
    fi
done
log "Postgres ready (total wait ${WAITED}s)"

# Tell zeke to stop its gateway immediately (best-effort, don't block on failure)
if $ZEKE_SSH "sudo systemctl stop openclaw.service 2>/dev/null; rm -f /tmp/openclaw-failover-active" 2>/dev/null; then
    log "Notified zeke to stop failover gateway"
else
    log "WARN: Could not reach zeke to stop failover (may not be running)"
fi

# Start the actual gateway
exec openclaw gateway run --port 18789 --bind lan
