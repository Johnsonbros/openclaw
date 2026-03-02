#!/bin/bash
# Watchdog — automated health check and recovery for OpenClaw Mac gateway
# Runs every 60s via ai.openclaw.watchdog launchd plist.
# Unlike health-check.sh (diagnostic/manual), this script auto-recovers.

LOG_DIR="$HOME/.openclaw/logs"
LOG="$LOG_DIR/watchdog.log"
MAX_LOG_SIZE=5242880  # 5MB

mkdir -p "$LOG_DIR"

# Rotate log if too large
if [ -f "$LOG" ] && [ "$(stat -f%z "$LOG" 2>/dev/null || echo 0)" -gt "$MAX_LOG_SIZE" ]; then
    mv "$LOG" "$LOG.old"
fi

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [watchdog] $1" >> "$LOG"
}

recovered() {
    log "RECOVERED: $1"
}

# ── Docker Desktop ──────────────────────────────────────────────
if ! docker info >/dev/null 2>&1; then
    log "Docker not responding — attempting restart"
    open -a "Docker Desktop" 2>/dev/null || open -a "Docker" 2>/dev/null
    # Wait up to 60s for Docker to come back
    for i in $(seq 1 12); do
        sleep 5
        if docker info >/dev/null 2>&1; then
            recovered "Docker Desktop restarted after ${i}x5s"
            break
        fi
    done
    if ! docker info >/dev/null 2>&1; then
        log "FAIL: Docker still not responding after 60s"
        exit 1  # Bail — nothing else will work without Docker
    fi
fi

# ── Postgres container ──────────────────────────────────────────
if ! docker ps --format '{{.Names}}' | grep -q '^openclaw-postgres$'; then
    log "Postgres container not running — attempting start"
    # Try starting existing container first, then create new one
    if docker start openclaw-postgres >/dev/null 2>&1; then
        recovered "Postgres container started (existing)"
    else
        log "No existing container — creating new openclaw-postgres"
        docker run -d --name openclaw-postgres \
            -e POSTGRES_USER=zeke \
            -e POSTGRES_PASSWORD=zeke_secure_pass_2026 \
            -e POSTGRES_DB=zeke_db \
            -p 5433:5432 \
            --restart unless-stopped \
            postgres:16 >/dev/null 2>&1
        if [ $? -eq 0 ]; then
            recovered "Postgres container created and started"
        else
            log "FAIL: Could not start Postgres container"
        fi
    fi
    # Wait for Postgres to be ready
    for i in $(seq 1 6); do
        sleep 5
        if docker exec openclaw-postgres pg_isready -U zeke >/dev/null 2>&1; then
            break
        fi
    done
fi

# ── Gateway HTTP ────────────────────────────────────────────────
# Use a lockfile to avoid restart-looping: if we kickstarted recently, skip.
GATEWAY_LOCK="$LOG_DIR/.watchdog-gateway-kick"
if ! curl -so /dev/null --connect-timeout 5 http://localhost:18789/ >/dev/null 2>&1; then
    # Check if gateway process is running (it may still be booting)
    if launchctl list ai.openclaw.gateway 2>/dev/null | grep -q '"PID"'; then
        log "Gateway not responding but process is running — waiting for boot"
    elif [ -f "$GATEWAY_LOCK" ] && [ "$(( $(date +%s) - $(stat -f%m "$GATEWAY_LOCK" 2>/dev/null || echo 0) ))" -lt 120 ]; then
        log "Gateway down but kickstarted <2min ago — waiting"
    else
        log "Gateway not responding on :18789 — kickstarting service"
        launchctl kickstart "gui/$(id -u)/ai.openclaw.gateway" 2>/dev/null
        touch "$GATEWAY_LOCK"
    fi
else
    # Gateway is healthy — clean up lockfile
    rm -f "$GATEWAY_LOCK"
fi

# ── Node service ────────────────────────────────────────────────
if ! launchctl list ai.openclaw.node >/dev/null 2>&1; then
    log "Node service not loaded — kickstarting"
    launchctl kickstart "gui/$(id -u)/ai.openclaw.node" 2>/dev/null
    recovered "Node service kickstarted"
fi
