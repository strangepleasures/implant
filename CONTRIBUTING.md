# Contributing to Implant

This document is for developers hacking on the extension itself. If you just
want to use Implant, see [README.md](./README.md).

## Layout

```
src/
  extension.ts          activation, palette commands, install-into-workspace,
                        install-prompt for new folders, per-workspace session
                        file (port + secret), unauthorized-request notifications,
                        run pipeline (approval + execute + slow-script watch).
  mcp-http-server.ts    minimal streamable-HTTP MCP server: initialize / tools/list /
                        tools/call. Owns the endpoint and the bearer-token check,
                        but delegates actual script execution to extension.ts.
  approval.ts           webview panel that shows the incoming snippet and gathers
                        Run / Trust / Deny.
  executor.ts           vm.Script sandbox with vscode/console/require injected,
                        AbortSignal cancellation, optional hard timeout.
  serialize.ts          walker that turns vscode.* types (Uri, Range, Position,
                        Location, Selection) into plain JSON, with cycle/depth/
                        array/string caps.
  agent-instructions.ts loads the prose sections from assets/prose/ at module
                        load and composes the MCP tool description AND the
                        Claude/Cursor/Copilot/clipboard variants from them.

bin/
  call.js               stdio↔HTTP MCP proxy. Copied into
                        <workspace>/.vscode/implant/call.js by "Install into
                        Workspace" and launched by CLI MCP clients via the
                        workspace .mcp.json.

assets/
  approval.html         template for the approval webview.
  highlight/            highlight.js common bundle + a thin CSS that maps
                        .hljs-* classes to VS Code CSS variables.
  prose/                agent-facing markdown loaded by agent-instructions.ts.
                        Edit these files to change what agents see; no code
                        change needed. Sections: overview, runtime-env,
                        how-to-call, examples, warmup, caveats.
  icon.png              extension icon.
  screenshot.png        marketplace hero image, referenced from README.

.vscode/
  launch.json           F5 launches an Extension Development Host.
  tasks.json            npm: compile task (pre-launch build).

LICENSE                 MIT.
```

## Build

```bash
npm install
npm run compile           # tsc -> out/
# F5 in VS Code to launch an Extension Development Host
```

## Package a .vsix

```bash
npx @vscode/vsce package
code --install-extension implant-<version>.vsix --force
```

## How the pieces fit together

**Agent → HTTP server → auth check → runScript → approval → executor → serialize → response.**

1. `mcp-http-server.ts` accepts `POST /mcp` with a JSON-RPC `tools/call` body.
   - Every request must carry `Authorization: Bearer <secret>` matching the
     current session token. Failures return `401` and fire an
     `onUnauthorized` callback that `extension.ts` throttles into a warning
     notification (so agents scanning ports don't spam you).
   - On success the server hands the script string to a `runScript` callback
     provided by `extension.ts`. The server itself owns nothing beyond the
     wire format and the auth check.
2. `extension.ts::runScript`:
   - `confirmExecution` opens the approval webview via `approval.ts` and awaits
     Run / Trust / Deny.
   - On approval, `executor.ts::execute` compiles the snippet with `vm.Script`,
     wraps it in an async IIFE, injects `vscode` / `console` / `require` etc.,
     and races the returned promise against an `AbortSignal` plus optional
     hard timeout (disabled by default).
   - `serialize.ts` normalizes the return value into JSON-safe objects.
   - `watchForSlowScript` starts a 10-second timer; on fire it opens a
     `withProgress` notification with a Cancel button that flips the abort
     controller. Silent if the script settles first.
3. The server wraps the result in `{ isError, content: [{ type: 'text', text }] }`
   and returns it to the agent.

For CLI MCP clients (Claude Code, Aider, etc.), the pipeline picks up one more
hop at the front: they launch `bin/call.js` as a stdio subprocess (from the
workspace `.mcp.json`), and it reads `.vscode/implant/session.yml` to attach
the bearer token before forwarding the JSON-RPC message over HTTP.

## Agent-facing prose

The prose lives in `assets/prose/*.md`, one file per section (`overview`,
`runtime-env`, `how-to-call`, `examples`, `warmup`, `caveats`). `agent-instructions.ts`
loads them at module load and composes the MCP tool description, Claude skill,
Cursor rules, Copilot fenced block, and clipboard snippet from them. Change
wording in the `.md` and every surface picks it up on next activation — no code
change needed, no rebuild for content-only edits (though the `.md` files must
be present in the .vsix, so a repackage is still needed to ship).

## Things worth knowing before changing behavior

- **The `vscode` module resolver is per-extension.** `require('vscode')` from
  files outside the extension's own directory tree may not resolve. If you need
  to load code from a workspace path, use `vm.runInThisContext` with a wrapper
  that injects `vscode` as a parameter (see the git history for the removed
  startup-scripts feature).
- **The TypeScript / JavaScript language server lazy-loads files.**
  `executeDocumentSymbolProvider` on an unopened file may hang.
  `executeWorkspaceSymbolProvider('')` returns nothing on many providers.
  Prefer opening the doc first, or pass a non-empty query.
- **Sync busy loops freeze the extension host, unrecoverably by default.**
  `implant.timeoutMs` defaults to `0` — no `vm.Script` timeout is set — so a
  snippet like `while (true) {}` blocks the event loop forever. The 10-second
  slow-script notification can't fire either (event loop is blocked). Users who
  care about a hard cap set `implant.timeoutMs` to a positive number; V8's
  watchdog thread will kill the script after that many ms. The primary defense
  is the user-visible approval webview — snippets are supposed to be reviewed
  before they run.
- **`showTextDocument` on `.js` files with the TS language server active** can
  put the language server in a wedged state that blocks all subsequent
  `executeXxxProvider` calls on unrelated files. This is why the approval UI
  is a webview and not a text-document preview.
- **The per-session bearer token is regenerated on every activation.** CLI
  agents that cache config across VS Code reloads must re-read
  `session.yml`; the shipped `bin/call.js` does this on any `401` and retries
  once.

## Filing changes

Small changes: PR with a clear description of user-visible behavior change.
Larger changes: sketch the design in an issue first so we can align on the
tradeoffs before you spend time on it.
