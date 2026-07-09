# Connecting OpenClaw to HCP Power Tools (MCP)

This note explains how this OpenClaw deployment reaches a Housecall Pro account
through the **HCP Power Tools** MCP server (repo: `Johnsonbros/HCP_Power_Tools`).

## How the pieces fit

OpenClaw is a messaging gateway that bridges chat channels to an **agent
backend** over ACP. The MCP client is the *agent backend*, not the OpenClaw
gateway itself — OpenClaw's ACP translator currently does not forward
`mcpServers` to the agent (`src/acp/translator.ts` logs `ignoring N MCP servers`).

So the integration is configured where the agent runtime loads MCP servers:

```
chat channel ─▶ OpenClaw gateway ─▶ ACP agent backend ─▶ HCP Power Tools MCP server ─▶ Housecall Pro
                                     (MCP client here)      /api/mcp/rpc
```

## Configure the agent backend

In HCP Power Tools, each tenant generates an MCP token and endpoint from the
dashboard (MCP Server panel). Then register that endpoint with the MCP-capable
agent backend OpenClaw drives (e.g. Claude Code), using its standard MCP config:

```jsonc
{
  "mcpServers": {
    "hcp-power-tools": {
      "type": "http",
      "url": "https://<hub-host>/api/mcp/rpc",
      "headers": { "Authorization": "Bearer hcp_mcp_..." }
    }
  }
}
```

Once connected, the assistant reached through OpenClaw can query live Housecall
Pro data (jobs, customers, estimates, invoices) and the tenant price book, and
read the tenant's living hourly rate.

## Available MCP tools

`hcp_list_jobs`, `hcp_get_job`, `hcp_list_customers`, `hcp_get_customer`,
`hcp_list_estimates`, `hcp_get_estimate`, `hcp_list_invoices`, `hcp_get_invoice`,
`pricebook_list_items`, `pricebook_get_item`, `hr_get_living_rate`.

## Optional future work: native forwarding

If you want OpenClaw to forward MCP servers to the ACP agent itself (instead of
configuring them on the agent), that requires changing the ACP translator
(`src/acp/translator.ts`) to pass `params.mcpServers` through to the agent's
`session/new` call rather than dropping them. That is a deliberate code change,
not covered here.
