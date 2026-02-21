# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is OpenClaw?

OpenClaw is a locally-run, single-user personal AI assistant that connects to messaging channels (WhatsApp, Telegram, Slack, Discord, Google Chat, Signal, iMessage, Microsoft Teams, Matrix, WebChat, and more). The Gateway is the WebSocket control plane that orchestrates sessions, channels, tools, and events.

## Build, Test, and Lint Commands

**Runtime:** Node 22+ required. Package manager: pnpm (preferred for builds). Bun supported for running TypeScript directly.

```bash
pnpm install                  # Install dependencies
pnpm build                    # TypeScript build → dist/
pnpm ui:build                 # Build web UI (auto-installs UI deps)
pnpm check                    # Format check + typecheck + lint (run before commits)
pnpm tsgo                     # TypeScript type-checking only
pnpm format                   # Format check (oxfmt)
pnpm format:fix               # Auto-fix formatting
pnpm lint                     # Lint (oxlint --type-aware)
pnpm lint:fix                 # Auto-fix lint issues + format
```

### Running Tests

```bash
pnpm test                     # All unit tests (parallel via scripts/test-parallel.mjs)
pnpm test:fast                # Unit tests only (vitest.unit.config.ts)
pnpm test:coverage            # Unit tests with V8 coverage
pnpm test:e2e                 # E2E tests (vitest.e2e.config.ts)
pnpm test:watch               # Watch mode

# Run a single test file:
pnpm test -- src/path/to/file.test.ts

# Run tests matching a pattern:
pnpm test -- -t "test name pattern"

# Extension tests use vitest.extensions.config.ts
# Gateway tests use vitest.gateway.config.ts
# Live tests (real API keys): OPENCLAW_LIVE_TEST=1 pnpm test:live
```

### Development

```bash
pnpm dev                      # Run CLI via tsx (TypeScript directly)
pnpm openclaw ...             # Run any CLI command in dev mode
pnpm gateway:watch            # Auto-reload gateway on TS changes
pnpm gateway:dev              # Gateway dev mode (skips channels)
```

### Commits

Use the repo's commit script to keep staging scoped:
```bash
scripts/committer "<msg>" <file...>
```

## Architecture Overview

### Monorepo Structure

pnpm workspace with these areas:
- **Root package** (`openclaw`) — main CLI + Gateway + agent runtime
- **`ui/`** — Web UI (Control Panel, WebChat)
- **`packages/`** — compatibility shims (`clawdbot`, `moltbot`)
- **`extensions/`** — channel/feature plugins (each is a workspace package)
- **`apps/`** — native apps: `macos/` (Swift), `ios/` (Swift), `android/` (Kotlin), `shared/` (OpenClawKit)
- **`skills/`** — bundled skills
- **`docs/`** — Mintlify documentation

### Core Source (`src/`) Layout

| Directory | Purpose |
|-----------|---------|
| `gateway/` | WebSocket control plane server (`:18789`), HTTP endpoints, config reload, channel health |
| `agents/` | Pi embedded agent runtime, tool definitions, subagent spawning, model selection |
| `channels/` | Channel plugin system — routing, allowlists, media, auth, actions |
| `telegram/`, `discord/`, `slack/`, `signal/`, `imessage/`, `web/` | Built-in channel implementations |
| `config/` | Zod-validated configuration system (`types.*.ts`, `zod-schema.*.ts`) |
| `sessions/` | Session persistence, send policies, transcript events |
| `providers/` | LLM provider integrations (Anthropic, OpenAI, Google, Copilot, etc.) |
| `media/` | Media pipeline (images, audio, video) |
| `browser/` | Chromium/Chrome browser control via CDP |
| `infra/` | Binary management, TLS, device identity, Tailscale, update checks |
| `plugins/` | Plugin loader, hook runner, registry |
| `plugin-sdk/` | SDK for extension authors (exported as `openclaw/plugin-sdk`) |
| `cli/` | CLI wiring, commands, progress spinners |
| `security/` | SSRF guards, audit |
| `logging/` | Structured subsystem logging |

### Key Architectural Patterns

**Gateway as control plane:** Single WebSocket server managing all sessions, channels, and tools. Clients (CLI, macOS app, WebChat, mobile nodes) connect via WS.

**Embedded agent:** The Pi agent runs in-process within the Gateway (not a separate service). It handles streaming, tool execution, and block-based output.

**Channel plugins:** Each messaging platform implements a plugin adapter interface with setup, messaging, threading, directory, group management, actions, heartbeat, and media capabilities.

**Configuration:** JSON5/JSONC config validated at runtime with Zod schemas. Config sections: `gateway`, `channels`, `agents`, `models`, `session`, `sandbox`, `skills`, `plugins`.

**Sessions:** File-based JSON storage in `~/.openclaw/workspace/sessions/`. Session keys follow patterns like `main`, `agent:<id>:main`, `<channel>:<peer>`.

**Plugin SDK:** Extensions use `openclaw/plugin-sdk` export. Plugin-only deps go in the extension's `package.json`, not root. Use `devDependencies` or `peerDependencies` for `openclaw` (not `workspace:*` in `dependencies`).

## Coding Conventions

- **Language:** TypeScript (ESM, strict). Avoid `any`; never add `@ts-nocheck`.
- **Formatting/linting:** oxfmt + oxlint. Run `pnpm check` before commits.
- **Tests:** Colocated `*.test.ts` files. E2E in `*.e2e.test.ts`. Vitest with V8 coverage (70% threshold for lines/functions/statements, 55% branches).
- **File size:** Aim for under ~500 LOC; split when it improves clarity.
- **Naming:** Product name is **OpenClaw**; CLI/package/paths use `openclaw`.
- **No prototype mutation** for sharing class behavior — use explicit inheritance/composition.
- **CLI progress:** Use `src/cli/progress.ts` (not hand-rolled spinners).
- **Status tables:** Use `src/terminal/table.ts` for ANSI-safe wrapping.
- **Colors:** Use shared palette from `src/terminal/palette.ts` (no hardcoded colors).
- **Dependencies:** Any dep with `pnpm.patchedDependencies` must use exact version (no `^`/`~`). Patching deps requires explicit approval. Never update the Carbon dependency.
- **Tool schemas:** Avoid `Type.Union` in tool input schemas (no `anyOf`/`oneOf`/`allOf`). Avoid raw `format` property names.

## Channel Work

When refactoring shared channel logic (routing, allowlists, pairing, command gating, onboarding), consider **all** built-in + extension channels:
- Core: `src/telegram`, `src/discord`, `src/slack`, `src/signal`, `src/imessage`, `src/web`, `src/channels`, `src/routing`
- Extensions: `extensions/*` (msteams, matrix, zalo, zalouser, voice-call, etc.)

When adding channels/extensions/apps, update `.github/labeler.yml` and create matching GitHub labels.

## Version Locations

Version must be updated in all of these (except `appcast.xml`):
- `package.json` (CLI)
- `apps/android/app/build.gradle.kts` (versionName/versionCode)
- `apps/ios/Sources/Info.plist` + `apps/ios/Tests/Info.plist`
- `apps/macos/Sources/OpenClaw/Resources/Info.plist`
- `docs/install/updating.md` (pinned npm version)

## Docs

- Hosted on Mintlify at docs.openclaw.ai.
- Internal doc links: root-relative, no `.md`/`.mdx` extension (e.g., `[Config](/configuration)`).
- Anchors: root-relative paths (e.g., `[Hooks](/configuration#hooks)`). Avoid em dashes and apostrophes in headings (they break Mintlify anchors).
- README uses absolute URLs (`https://docs.openclaw.ai/...`).
- Docs content must be generic: no personal device names/hostnames; use placeholders.
- `docs/zh-CN/**` is generated — do not edit unless explicitly asked.

## Multi-Agent Safety

- Do not create/apply/drop `git stash` entries unless explicitly requested.
- Do not switch branches or modify `git worktree` checkouts unless explicitly requested.
- When committing, scope to your changes only. When seeing unrecognized files, keep going.
- When pushing, `git pull --rebase` is OK but never discard other agents' work.
