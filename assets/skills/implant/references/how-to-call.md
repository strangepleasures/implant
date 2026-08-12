## How to call it

Implant is exposed as an **MCP server named `implant`**, contributed via the workspace
`.mcp.json`. If you speak MCP (Claude Code, Copilot Chat on VS Code ≥ 1.101, Cursor, etc.),
it appears as a first-class tool — invoke `run_vscode_script` with a single `code`
argument. No shelling out, no curl, no session/port bookkeeping.

If your setup doesn't auto-discover the `.mcp.json` (older CLI agents, custom rigs), add
this server manually to your MCP client config:

```json
{
  "mcpServers": {
    "implant": {
      "command": "node",
      "args": [".vscode/implant/call.js"]
    }
  }
}
```

The `call.js` shipped by "Implant: Install into Workspace" is a stdio↔HTTP MCP proxy —
it reads the per-session port + secret from `.vscode/implant/session.yml` and forwards
requests to the local HTTP server. It handles session rotation on VS Code reload
automatically.

If the tool is missing from your available tools, the workspace hasn't been set up — ask
the user to run **Implant: Install into Workspace** from the palette. If calls suddenly
start failing after a VS Code restart, wait for the extension to re-register (the proxy
retries once on 401).
