# ZEKE — Johnsonbros OpenClaw Fork

This is the Johnsonbros fork of OpenClaw — ZEKE's home base.
Maintained by ZEKE. Synced from upstream/main.

## Infrastructure Overview

ZEKE runs as a personal AI assistant across two hosts in a primary/failover configuration:

| Host               | Role            | OS             | Access                                 |
| ------------------ | --------------- | -------------- | -------------------------------------- |
| **Mac** (ZEKE-Mac) | Primary gateway | macOS (Darwin) | Tailscale: `nathaniels-macbook-pro`    |
| **zeke** (EC2)     | Failover backup | Ubuntu 24.04   | Tailscale: `zeke` / SSH via `ZEKE.pem` |

### Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Tailscale Mesh                    │
│                                                     │
│  ┌──────────────────────┐  ┌──────────────────────┐ │
│  │   Mac (Primary)      │  │   zeke EC2 (Backup)  │ │
│  │                      │  │                      │ │
│  │  OpenClaw Gateway    │  │  Failover Watchdog   │ │
│  │  (:18789, bind=lan)  │  │  (15s health check)  │ │
│  │                      │  │                      │ │
│  │  OpenClaw Node       │  │  OpenClaw Gateway    │ │
│  │  (localhost connect)  │  │  (disabled, started  │ │
│  │                      │  │   only on failover)  │ │
│  │  PostgreSQL (Docker)  │  │                      │ │
│  │  (:5433)             │  │  PostgreSQL (Docker)  │ │
│  │                      │  │  (:5432)             │ │
│  │  DB Sync (5m push)───│──│──▶ Replica DB        │ │
│  └──────────────────────┘  └──────────────────────┘ │
│                                                     │
│  ┌──────────────────────┐                           │
│  │      Telegram        │◀── Bot API (single       │
│  │      Bot API         │    active instance)       │
│  └──────────────────────┘                           │
└─────────────────────────────────────────────────────┘
```

### Agents

| Agent           | Model             | Role                                        |
| --------------- | ----------------- | ------------------------------------------- |
| **ZEKE** (main) | Claude Opus 4.6   | Primary assistant, full tool access         |
| **Huginn**      | Claude Sonnet 4.5 | Thought raven — analysis & reasoning        |
| **Muninn**      | Claude Sonnet 4.5 | Memory raven — recall & context             |
| **Oden**        | Claude Opus 4.5   | All-seeing architect — planning & oversight |

### Channels

- **Telegram** — Primary messaging interface (bot token via env var)
- **Web** — Control panel UI

### Key Services

**Mac (launchd):**

- `ai.openclaw.gateway` — Gateway server (KeepAlive, port 18789)
- `ai.openclaw.node` — Node host connecting to local gateway
- `ai.openclaw.db-sync` — PostgreSQL sync to zeke every 5 minutes

**zeke (systemd):**

- `openclaw-failover.timer` — 15s health check of Mac gateway
- `openclaw-failover.service` — Starts/stops local gateway based on Mac availability
- `openclaw-update.timer` — Nightly update check at 08:00 UTC

### Failover Behavior

1. Every 15 seconds, zeke's failover watchdog checks `http://100.82.144.92:18789/`
2. If Mac is reachable and zeke's gateway is running → stops zeke's gateway
3. If Mac is unreachable and zeke's gateway is not running → restores latest DB backup, starts zeke's gateway
4. When Mac comes back, zeke automatically shuts down its gateway

### DB Sync

Mac pushes a full `pg_dump` to zeke every 5 minutes. The sync script:

- Validates Docker and container health before dumping
- Checks dump file size (rejects suspiciously small files)
- Gracefully skips if zeke is unreachable
- Logs all activity to `~/.openclaw/logs/db-sync.log`

## File Locations

### Mac

| Path                                         | Purpose                                                    |
| -------------------------------------------- | ---------------------------------------------------------- |
| `~/.openclaw/openclaw.json`                  | Gateway configuration (600 perms)                          |
| `~/.openclaw/.env`                           | All API keys and secrets (600 perms)                       |
| `~/.openclaw/node.json`                      | Node host config                                           |
| `~/.openclaw/agents/`                        | Agent directories (main, huginn, muninn, oden)             |
| `~/.openclaw/scripts/`                       | Operational scripts (gateway-start, db-sync, health-check) |
| `~/.local/lib/qmd/`                          | qmd memory search backend (requires Bun runtime)           |
| `~/.openclaw/logs/`                          | Service and sync logs                                      |
| `~/Library/LaunchAgents/ai.openclaw.*.plist` | launchd service definitions                                |

### zeke (EC2)

| Path                                      | Purpose                        |
| ----------------------------------------- | ------------------------------ |
| `/home/ubuntu/.openclaw/`                 | OpenClaw home directory        |
| `/home/ubuntu/.openclaw/.env`             | API keys (server copy)         |
| `/usr/local/sbin/openclaw-failover.sh`    | Failover watchdog script       |
| `/etc/systemd/system/openclaw-failover.*` | Failover timer + service units |
| `/var/log/openclaw-failover.log`          | Failover activity log          |

## Security

- All secrets stored in `~/.openclaw/.env` (mode 600), referenced via `${ENV_VAR}` in config
- Gateway auth tokens use env var substitution (not hardcoded)
- SSH access to zeke requires `~/Downloads/ZEKE.pem` key
- Tailscale mesh provides encrypted transport between hosts
- Gateway binds to `lan` (Tailscale + local interfaces only)

## Quick Reference

```bash
# Health check (Mac)
~/.openclaw/scripts/health-check.sh

# View gateway logs (Mac)
tail -f ~/.openclaw/logs/gateway.log

# View DB sync logs (Mac)
tail -f ~/.openclaw/logs/db-sync.log

# Check failover status (zeke)
ssh -i ~/Downloads/ZEKE.pem ubuntu@zeke "sudo journalctl -u openclaw-failover -f --no-pager"

# Manual DB sync
~/.openclaw/scripts/db-sync.sh

# Restart gateway (Mac)
launchctl kickstart -k gui/$(id -u)/ai.openclaw.gateway

# Service status (Mac)
launchctl list | grep openclaw
```

## Changelog

- **2026-02-23**: Migrated primary gateway from zeke to Mac. Added failover watchdog, DB sync, health checks. Hardened all configs with env var token references. Installed qmd + Bun for memory backend. Migrated ZEKE personality files and 361 session files from zeke. Changed Telegram dmPolicy to "open". Removed legacy cron jobs (gateway-watchdog, auto-recover) from zeke. Fixed corrupted qmd SQLite indexes. Created Oden AGENT.md.
- **2026-02-17**: Last upstream sync.
