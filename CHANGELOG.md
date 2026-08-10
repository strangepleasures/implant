# Changelog

All notable changes to **Implant** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-08-10

Initial public release.

### Added

- **MCP tool `run_vscode_script`** — runs a JavaScript snippet inside the VS Code extension host with full access to the `vscode.*` API (Find References, Rename, hover, diagnostics, any palette command, any third-party extension command).
- **Approval webview** — every snippet opens a side-pane preview with syntax highlighting and Run / Run + trust session / Deny buttons. Nothing runs without explicit user approval.
- **Local HTTP MCP server** on an ephemeral port, auto-registered via `vscode.lm.registerMcpServerDefinitionProvider` so in-editor MCP clients (Copilot Chat on VS Code ≥ 1.101) auto-discover the tool.
- **Per-session bearer-token authentication.** Port and 32-byte hex secret are written to `.vscode/implant/session.yml` (mode 0600, gitignored, regenerated every activation). Unauthorized requests get `401` and raise a throttled warning notification.
- **CLI-agent path** — `Implant: Install into Workspace` drops a stdio↔HTTP MCP proxy at `.vscode/implant/call.js` and committed MCP configs (`.mcp.json` for Claude Code and generic clients, `.cursor/mcp.json` for Cursor with `type: "stdio"`), so Claude Code / Aider / Cline / Cursor connect automatically.
- **Agent-facing instructions** — the same install command writes `.claude/skills/implant/SKILL.md`, `.cursor/rules/implant.mdc`, and upserts a fenced Implant section into `.github/copilot-instructions.md`. Content is generated from a single source (`src/agent-instructions.ts`) so every surface stays in sync.
- **Palette commands:** `Implant: Install into Workspace`, `Implant: Copy Agent Instructions`.
- **Install prompt** — the first time a workspace folder without Implant setup is opened, a notification offers to install (or "Don't ask for this folder" to suppress permanently).
- **Slow-script notification** — after 10 seconds of execution, a cancellable progress notification appears; clicking Cancel aborts the snippet.
- **Serializer** for return values: `vscode.Uri`, `Range`, `Position`, `Location`, `Selection` unwrap to plain JSON; arrays capped at 500 items, strings at 20 000 chars, cycles and deep nesting handled.

### Settings

- `implant.requireConfirmation` — show the approval webview before each script (default `true`).
- `implant.timeoutMs` — hard execution timeout in ms; `0` disables it (default `0`).
- `implant.port` — bind port; `0` picks an ephemeral one (default `0`).
