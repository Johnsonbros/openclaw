# Design: native MCP forwarding in the OpenClaw ACP layer

Status: proposal (not implemented)
Related: `HCP_POWER_TOOLS_INTEGRATION.md`

## Problem

OpenClaw's ACP surface accepts `mcpServers` on `session/new` and `session/load`
but drops them:

- `src/acp/translator.ts:146-148` (`newSession`) and `:177-179` (`loadSession`)
  log `ignoring N MCP servers` and discard the list.
- `src/acp/translator.ts:132-135` (`initialize`) advertises
  `mcpCapabilities: { http: false, sse: false }`, i.e. it tells clients it
  cannot consume HTTP/SSE MCP servers.

There is currently **no MCP client runtime** anywhere in `src/` — the
`@modelcontextprotocol/sdk` package is not a dependency, and `mcpServers` is
referenced only in `src/acp/client.ts` and `src/acp/translator.ts`. So
"forwarding" is not a translator tweak; it requires OpenClaw's agent runtime to
act as an MCP client and expose the discovered tools to the model.

## Goal

When an ACP client supplies MCP servers for a session (e.g. the HCP Power Tools
server at `/api/mcp/rpc`), OpenClaw connects to them, lists their tools, and
makes those tools callable by the session's model — scoped to that session and
torn down with it.

## Scope decision

Support **HTTP (Streamable HTTP)** MCP servers first (that is what HCP Power
Tools exposes). `stdio` MCP servers are out of scope for a gateway (no local
process model per remote session); `sse` can follow HTTP.

## Proposed changes

1. **Dependency**
   - Add `@modelcontextprotocol/sdk` to `package.json` dependencies (exact
     version per repo policy; keep `pnpm-lock.yaml` + Bun in sync).

2. **New module: `src/acp/mcp/session-mcp.ts`**
   - `class SessionMcpManager` keyed by ACP `sessionId`.
   - `attach(sessionId, servers: McpServerConfig[])`: for each HTTP server,
     create a `Client` + `StreamableHTTPClientTransport` (forwarding
     `headers`, e.g. `Authorization`), `connect()`, then `listTools()`.
   - Maintain `sessionId -> { client, tools }[]` and a flat tool index
     `toolName -> client` (namespace collisions resolved by prefixing the
     server name, e.g. `hcp-power-tools__hcp_list_jobs`).
   - `callTool(sessionId, name, args)`: route to the owning client.
   - `detach(sessionId)`: close all clients for the session.

3. **Capability advertisement — `src/acp/translator.ts:initialize`**
   - Flip to `mcpCapabilities: { http: true, sse: false }` **only after** the
     runtime actually consumes HTTP servers. Do not flip the flag before the
     consumer works — it would advertise a capability that fails.

4. **Wire into session lifecycle — `src/acp/translator.ts`**
   - `newSession` / `loadSession`: replace the `ignoring N MCP servers` log with
     `await this.sessionMcp.attach(session.sessionId, params.mcpServers)`.
   - On session close/cleanup (see `closeAcpRuntimeForSession` usage in
     `src/gateway/server-methods/sessions.ts`): call `detach`.

5. **Expose tools to the model**
   - This is the load-bearing integration point. The gateway agent runtime
     (`src/gateway/server-methods/agent.ts`, `chat.ts`, `server.impl.ts`) needs
     to accept an extra, per-session tool set and:
       - include the MCP tool schemas in the model's tool list, and
       - dispatch model tool-calls whose name is in the MCP index through
         `SessionMcpManager.callTool`, returning the result as a tool result.
   - Exact hook depends on how the runtime currently assembles tools/commands;
     `sendAvailableCommands` (translator) is the analogous existing path for
     commands and is a reasonable place to model the plumbing on.

6. **Config gate**
   - Add `acp.mcpForwarding` (default `false`). While false, keep today's
     drop-and-log behavior and keep `http:false` advertised. This lets the
     feature land dark and be enabled per-deployment once verified.

## Tests

- `src/acp/mcp/session-mcp.test.ts`: attach against an in-memory MCP server
  (SDK `InMemoryTransport`), assert tools are listed and `callTool` routes
  correctly; assert `detach` closes clients.
- `src/acp/translator.*.test.ts`: with the flag on, `newSession` attaches; with
  it off, servers are ignored (current behavior preserved).
- Namespace-collision test (two servers exposing the same tool name).

## Risks / notes

- **Capability honesty:** never advertise `http:true` without a working
  consumer (step 5). Half-implementing breaks ACP clients that trust the flag.
- **Auth forwarding:** the `Authorization` header carrying the tenant MCP token
  must be forwarded verbatim and never logged.
- **Blast radius:** step 5 touches the core agent runtime; land behind the flag
  and verify on a real gateway with a live MCP server before enabling.
- **Not verifiable in CI-only envs:** end-to-end needs a running gateway + model
  + MCP server; include a live/e2e test per `docs/testing.md` conventions.

## Alternative that needs no OpenClaw core change

Configure the HCP Power Tools MCP server directly on the agent backend that
OpenClaw drives (see `HCP_POWER_TOOLS_INTEGRATION.md`). This delivers the same
user outcome today; native forwarding is a convenience layer, not a
prerequisite.
