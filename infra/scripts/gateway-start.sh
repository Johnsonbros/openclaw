#!/bin/bash
# Gateway startup wrapper — notifies zeke to stop its failover gateway
# before starting the local gateway, preventing dual-gateway conflicts.
# Called by ai.openclaw.gateway launchd plist.

LOG="$HOME/.openclaw/logs/gateway.log"
ZEKE_SSH="ssh -i $HOME/Downloads/ZEKE.pem -o ConnectTimeout=5 -o BatchMode=yes -o StrictHostKeyChecking=no ubuntu@zeke"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [startup] $1" >> "$LOG"
}

# Tell zeke to stop its gateway immediately (best-effort, don't block on failure)
if $ZEKE_SSH "sudo systemctl stop openclaw.service 2>/dev/null; rm -f /tmp/openclaw-failover-active" 2>/dev/null; then
    log "Notified zeke to stop failover gateway"
else
    log "WARN: Could not reach zeke to stop failover (may not be running)"
fi

# Start the actual gateway
exec openclaw gateway run --port 18789 --bind lan
