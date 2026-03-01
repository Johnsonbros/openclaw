#!/bin/bash
# Install all OpenClaw Mac services — copies plists and scripts, loads launchd agents.
# Run once after cloning or updating infra files.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INFRA_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
SCRIPTS_DIR="$HOME/.openclaw/scripts"
LOGS_DIR="$HOME/.openclaw/logs"
UID_NUM="$(id -u)"

echo "=== OpenClaw Mac Services Installer ==="
echo ""

# Create directories
mkdir -p "$LAUNCH_AGENTS" "$SCRIPTS_DIR" "$LOGS_DIR"

# All services to manage
SERVICES=(
    ai.openclaw.gateway
    ai.openclaw.node
    ai.openclaw.db-sync
    ai.openclaw.caffeinate
    ai.openclaw.watchdog
)

# Unload existing services (ignore errors for services not yet installed)
echo "Unloading existing services..."
for svc in "${SERVICES[@]}"; do
    launchctl bootout "gui/$UID_NUM/$svc" 2>/dev/null || true
done

# Copy plists
echo "Installing plists..."
cp "$INFRA_DIR"/launchd/*.plist "$LAUNCH_AGENTS/"

# Copy scripts
echo "Installing scripts..."
cp "$INFRA_DIR"/scripts/gateway-start.sh "$SCRIPTS_DIR/"
cp "$INFRA_DIR"/scripts/watchdog.sh "$SCRIPTS_DIR/"
cp "$INFRA_DIR"/scripts/db-sync.sh "$SCRIPTS_DIR/"
cp "$INFRA_DIR"/scripts/health-check.sh "$SCRIPTS_DIR/"
chmod +x "$SCRIPTS_DIR"/*.sh

# Load all services
echo "Loading services..."
for svc in "${SERVICES[@]}"; do
    launchctl bootstrap "gui/$UID_NUM" "$LAUNCH_AGENTS/$svc.plist"
    echo "  Loaded $svc"
done

echo ""
echo "Done. Verifying..."
echo ""

# Quick verification
for svc in "${SERVICES[@]}"; do
    if launchctl list "$svc" >/dev/null 2>&1; then
        printf "  OK   %s\n" "$svc"
    else
        printf "  FAIL %s\n" "$svc"
    fi
done

echo ""
echo "Logs: $LOGS_DIR/"
echo "Run health-check: ~/.openclaw/scripts/health-check.sh"
