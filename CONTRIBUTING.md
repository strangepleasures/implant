# Contributing to Implant

This document is for developers hacking on the extension itself. If you just
want to use Implant, see [README.md](./README.md).

## Layout

```
src/
  extension.ts          activation, palette commands, install-into-workspace,
                        install-prompt for new folders, per-workspace session
                        file (port + secret), unauthorized-request notifications,
                        run pipeline (approval + execute + slow-script watch),
                        terminate_scripts abort registry.
  mcp-http-server.ts    minimal streamable-HTTP MCP server: initialize / tools/list /
                        tools/call. Exposes run_vscode_script and
                        terminate_scripts. Owns the endpoint and the bearer-token
                        check, delegates execution + abort to extension.ts.
  approval.ts           webview panel that shows the incoming snippet and gathers
                        Run / Trust / Deny.
  executor.ts           vm.Script sandbox with vscode/astGrep/activateLanguage/
                        console/require injected, AbortSignal cancellation,
                        optional hard timeout. Registers dynamic ast-grep
                        languages (Python/Go/Rust/Java/C/C++) at module load.
  sandbox-helpers.ts    activateLanguage(langId, timeoutMs?) — kicks
                        onLanguage:<id> activation events and polls
                        executeDocumentSymbolProvider until it responds. Exposed
                        as a sandbox global.
  serialize.ts          walker that turns vscode.* types (Uri, Range, Position,
                        Location, Selection) into plain JSON, with cycle/depth/
                        array/string caps.
  agent-instructions.ts loads the SKILL.md + references/ subtree from
                        assets/skills/implant/ at module load and exposes them
                        to chat-participant.ts and the install-into-workspace
                        command.
  chat-participant.ts   @implant Copilot Chat participant. Feeds SKILL.md as the
                        system prompt, gates load_implant_reference, and
                        executes the returned snippet through the same executor
                        the MCP tool uses.

bin/
  call.js               stdio↔HTTP MCP proxy. Copied into
                        <workspace>/.vscode/implant/call.js by "Install into
                        Workspace" and launched by CLI MCP clients via the
                        workspace .mcp.json.

assets/
  approval.html         template for the approval webview.
  highlight/            highlight.js common bundle + a thin CSS that maps
                        .hljs-* classes to VS Code CSS variables.
  skills/implant/       agent-facing skill payload. SKILL.md is the primer
                        loaded by every surface (MCP tool description, chat
                        system prompt, on-disk skill copy); references/ holds
                        runnable snippets (examples/*.js) and topical prose
                        (topics/*.md, plus the bundled vscode/ast-grep type
                        references) served on demand via
                        load_implant_reference.
  icon.png              extension icon.

scripts/
  package.mjs           builds one universal .vsix that carries every
                        @ast-grep/napi platform binary. `npm run package`.
  refresh-types.mjs     regenerates the vendored vscode/ast-grep type
                        references shipped under assets/skills/implant/references.

test/
  run-examples.ts       end-to-end runner: copies test/fixtures/test-projects/*
                        into a temp dir, launches VS Code with an isolated
                        --user-data-dir, executes each examples/*.js against
                        it, and exact-matches the return value against
                        test/expected/<name>.{md,json}. Missing expected file
                        → skipped.

docs/
  images/
    screenshot.png      marketplace / repo hero image, referenced by README's
                        absolute URL. Excluded from the .vsix via .vscodeignore.

LICENSE                 MIT.
```

## Build

```bash
npm install
npm run compile           # tsc -> out/
npm test                  # runs test/run-examples.ts against a fixture workspace
# F5 in VS Code to launch an Extension Development Host
```

## Package a .vsix

For local install (uses whatever `@ast-grep/napi` binary `npm install` fetched for your
current OS/arch):

```bash
npx @vscode/vsce package
code --install-extension implant-<version>.vsix --force
```

### Publishing to the marketplace

`@ast-grep/napi` ships one ~7 MB native binary per platform. A plain `vsce package`
from the working tree only picks up the host platform's binary, so the resulting vsix
wouldn't run for anyone else. To ship one universal vsix that works everywhere:

```bash
npm run package
```

`scripts/package.mjs` compiles once, force-installs every `@ast-grep/napi-<platform>`
sub-package via `npm install --no-save --os=X --cpu=Y --libc=Z`, packages a single
`implant-<version>.vsix`, then restores the host-native `@ast-grep` install so the
working tree is ready for local dev again. The universal vsix is ~15–20 MB — bigger
than a per-platform build, but publishing is a single command:

```bash
npx @vscode/vsce publish --packagePath implant-<version>.vsix
```

Platforms bundled: `darwin-arm64`, `darwin-x64`, `linux-{arm64,x64}-{gnu,musl}`,
`win32-{arm64,x64}-msvc`. 32-bit Windows is intentionally excluded — VS Code dropped
`ia32` support in 1.35 (2019).

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

## Agent-facing skill

The agent-facing payload lives under `assets/skills/implant/`. `SKILL.md` is the
primer — the same body is served as the MCP tool description, the on-disk skill
file written by "Install into Workspace", and the `@implant` chat participant's
system prompt. `references/` holds runnable JS snippets under `examples/` and
prose under `topics/` (plus the bundled vscode/ast-grep type declarations),
served on demand via the `load_implant_reference` tool. Edit any of these files
and every surface picks up the change on next activation — no code change, but a
rebuild + reinstall is still needed to ship the updated `.md`/`.js` inside the
.vsix. See the memory note "Ship VSIX after coding task" for the packaging step.

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
