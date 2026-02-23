#!/bin/bash
# OpenClaw gateway health check — verifies all critical services are running
# Run manually or via cron for monitoring
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ERRORS=0

check() {
    local name="$1"
    local cmd="$2"
    if eval "$cmd" >/dev/null 2>&1; then
        printf "${GREEN}OK${NC}  %s\n" "$name"
    else
        printf "${RED}FAIL${NC}  %s\n" "$name"
        ERRORS=$((ERRORS + 1))
    fi
}

warn() {
    local name="$1"
    local cmd="$2"
    if eval "$cmd" >/dev/null 2>&1; then
        printf "${GREEN}OK${NC}  %s\n" "$name"
    else
        printf "${YELLOW}WARN${NC}  %s\n" "$name"
    fi
}

echo "=== OpenClaw Health Check ($(date '+%Y-%m-%d %H:%M:%S')) ==="
echo ""

# Gateway
check "Gateway HTTP" "curl -sf --connect-timeout 5 http://localhost:18789/"
check "Gateway launchd" "launchctl list ai.openclaw.gateway 2>/dev/null | grep -q ai.openclaw.gateway"

# Node
check "Node launchd" "launchctl list ai.openclaw.node 2>/dev/null | grep -q ai.openclaw.node"

# Docker & PostgreSQL
check "Docker running" "docker info"
check "Postgres container" "docker ps --format '{{.Names}}' | grep -q '^openclaw-postgres$'"
check "Postgres responds" "docker exec openclaw-postgres pg_isready -U zeke"

# DB sync
check "DB sync plist loaded" "launchctl list ai.openclaw.db-sync 2>/dev/null"
warn "Zeke reachable (SSH)" "ssh -i $HOME/Downloads/ZEKE.pem -o ConnectTimeout=5 -o BatchMode=yes ubuntu@zeke 'echo ok'"

# Tailscale
check "Tailscale up" "tailscale status"
warn "Gateway on Tailscale IP" "curl -sf --connect-timeout 5 http://100.82.144.92:18789/"

# Disk & memory
DISK_PCT=$(df -h / | awk 'NR==2 {print $5}' | tr -d '%')
if [ "$DISK_PCT" -gt 90 ]; then
    printf "${RED}FAIL${NC}  Disk usage: %s%%\n" "$DISK_PCT"
    ERRORS=$((ERRORS + 1))
elif [ "$DISK_PCT" -gt 80 ]; then
    printf "${YELLOW}WARN${NC}  Disk usage: %s%%\n" "$DISK_PCT"
else
    printf "${GREEN}OK${NC}  Disk usage: %s%%\n" "$DISK_PCT"
fi

echo ""
if [ "$ERRORS" -gt 0 ]; then
    printf "${RED}%d check(s) failed${NC}\n" "$ERRORS"
    exit 1
else
    printf "${GREEN}All checks passed${NC}\n"
    exit 0
fi
