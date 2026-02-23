# ZEKE Infrastructure

Operational scripts and service definitions for running OpenClaw in a Mac-primary / EC2-failover configuration.

## Directory Structure

```
infra/
├── README.md              # This file
├── scripts/
│   ├── db-sync.sh         # PostgreSQL Mac → zeke replication (5min interval)
│   ├── health-check.sh    # Mac gateway health verification
│   └── openclaw-failover.sh  # zeke failover watchdog
├── launchd/
│   ├── ai.openclaw.gateway.plist   # Mac gateway service
│   ├── ai.openclaw.node.plist      # Mac node host service
│   └── ai.openclaw.db-sync.plist   # Mac DB sync timer
└── systemd/
    ├── openclaw-failover.service   # zeke failover oneshot
    └── openclaw-failover.timer     # zeke 60s health check timer
```

## Setup

### Prerequisites

- **Mac**: Docker Desktop, Node.js 22+, Tailscale, OpenClaw (`npm install -g openclaw@latest`)
- **zeke**: Docker, Tailscale, systemd, SSH access via `ZEKE.pem`

### Mac Setup

1. Start PostgreSQL container:
   ```bash
   docker run -d --name openclaw-postgres \
     -e POSTGRES_USER=zeke \
     -e POSTGRES_PASSWORD=zeke_secure_pass_2026 \
     -e POSTGRES_DB=zeke_db \
     -p 5433:5432 \
     --restart unless-stopped \
     postgres:16
   ```

2. Copy service plists to `~/Library/LaunchAgents/`:
   ```bash
   cp infra/launchd/*.plist ~/Library/LaunchAgents/
   ```

3. Copy scripts to `~/.openclaw/scripts/`:
   ```bash
   mkdir -p ~/.openclaw/scripts
   cp infra/scripts/db-sync.sh infra/scripts/health-check.sh ~/.openclaw/scripts/
   chmod +x ~/.openclaw/scripts/*.sh
   ```

4. Load services:
   ```bash
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.openclaw.gateway.plist
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.openclaw.node.plist
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.openclaw.db-sync.plist
   ```

### zeke Setup

1. Install failover script (root-owned to prevent privilege escalation):
   ```bash
   scp infra/scripts/openclaw-failover.sh ubuntu@zeke:/tmp/
   ssh ubuntu@zeke "sudo mv /tmp/openclaw-failover.sh /usr/local/sbin/ && sudo chown root:root /usr/local/sbin/openclaw-failover.sh && sudo chmod 755 /usr/local/sbin/openclaw-failover.sh"
   ```

2. Install systemd units:
   ```bash
   scp infra/systemd/openclaw-failover.* ubuntu@zeke:/tmp/
   ssh ubuntu@zeke "sudo mv /tmp/openclaw-failover.* /etc/systemd/system/ && sudo systemctl daemon-reload"
   ssh ubuntu@zeke "sudo systemctl enable --now openclaw-failover.timer"
   ```

3. Disable the gateway from auto-starting (failover script manages it):
   ```bash
   ssh ubuntu@zeke "sudo systemctl disable openclaw.service"
   ```

## Operations

### Health Check
```bash
~/.openclaw/scripts/health-check.sh
```

Verifies: gateway HTTP, launchd services, Docker, PostgreSQL, DB sync, Tailscale connectivity, disk usage.

### Viewing Logs

| Log | Command |
|-----|---------|
| Gateway (Mac) | `tail -f ~/.openclaw/logs/gateway.log` |
| DB Sync (Mac) | `tail -f ~/.openclaw/logs/db-sync.log` |
| Failover (zeke) | `ssh ubuntu@zeke "tail -f /var/log/openclaw-failover.log"` |

### Restarting Services

```bash
# Restart gateway
launchctl kickstart -k gui/$(id -u)/ai.openclaw.gateway

# Restart node
launchctl kickstart -k gui/$(id -u)/ai.openclaw.node

# Force DB sync now
~/.openclaw/scripts/db-sync.sh
```
