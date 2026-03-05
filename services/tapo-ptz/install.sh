#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_NAME="ai.openclaw.tapo-ptz"
PLIST_DEST="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"

echo "Installing Tapo PTZ service..."

# Install Python deps
pip3 install -r "$SCRIPT_DIR/requirements.txt"

# Generate plist with correct paths
sed "s|INSTALL_DIR|$SCRIPT_DIR|g" "$SCRIPT_DIR/${PLIST_NAME}.plist" > "$PLIST_DEST"

# Load service
launchctl unload "$PLIST_DEST" 2>/dev/null || true
launchctl load "$PLIST_DEST"

echo "Tapo PTZ service installed and running."
echo "Logs: /tmp/tapo-ptz.log"
echo "Test: curl http://localhost:18790/health"
