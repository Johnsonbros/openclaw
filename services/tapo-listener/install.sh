#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_NAME="ai.openclaw.tapo-listener"
PLIST_DEST="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"

echo "Installing Tapo Listener service..."

pip3 install -r "$SCRIPT_DIR/requirements.txt"

sed "s|INSTALL_DIR|$SCRIPT_DIR|g" "$SCRIPT_DIR/${PLIST_NAME}.plist" > "$PLIST_DEST"

launchctl unload "$PLIST_DEST" 2>/dev/null || true
launchctl load "$PLIST_DEST"

echo "Tapo Listener service installed and running."
echo "Logs: /tmp/tapo-listener.log"
echo "Test: curl http://localhost:18792/health"
