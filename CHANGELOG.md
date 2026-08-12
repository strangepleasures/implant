# Changelog

All notable changes to **Implant** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **New MCP tool `terminate_scripts`** — no arguments, returns `{ aborted: N }`. Aborts every running Implant script in the window. Reach for it when a previous `run_vscode_script` call is hanging (waiting on an unresponsive language server, an infinite polling loop, etc.) so the extension host is unstuck before the next call.
- **Per-call `timeoutMs` argument on `run_vscode_script`** — overrides the workspace `implant.timeoutMs` setting for that call only; `0` disables the timeout. Useful when a specific call is expected to be slow (warming a language server) or when a caller wants a hard abort ceiling without changing shared settings.
- **Slow-script notification identifies the script** — the notification title now appends the first `//` comment from the snippet (e.g. `Implant script is still running — Run the registered formatter over the first source file…`), so with several calls queued the user can tell which one is slow. Falls back to the plain title if the snippet has no leading comment.
- **`activateLanguage(langId, timeoutMs?)` sandbox global** — triggers `onLanguage:<id>` activation on every extension registered for the language and polls `executeDocumentSymbolProvider` until it responds. Returns `true` when providers are up, `false` on timeout (default 30 s). Removes most of the boilerplate for warming up a cold language server before a semantic query.

### Changed

- **`SKILL.md` no longer teaches `workspace.saveAll()` after `applyEdit`.** Force-saving can deadlock indefinitely on other extensions' `onWillSaveTextDocument` handlers and overrides the user's own preference about when writes hit disk. Every example script (`format-document.js`, `rename-symbol.js`, `delete-file.js`, `get-code-actions.js`) and the "Editing documents" section of the skill now stop after `applyEdit` and leave the dirty buffer for the user's autosave to persist. Example scripts explicitly state "Buffer is dirty until autosave or Cmd+S persists it" in their return values.
- **Polling loops in example scripts reduced from 40 s to ~10 s** (20 attempts × 500 ms), matching the slow-script notification threshold — the caller decides whether to bump the loop or warm up with `activateLanguage()` before invoking. Docstrings updated to match.
- **Warmup guidance in SKILL.md leads with `activateLanguage(langId)`** as the primary path; the manual `openTextDocument` → `ext.activate()` → poll-symbol-provider sequence is preserved as background for callers that need finer control.
- **`openTextDocument(uri)` needs no cleanup**, and this is now stated explicitly in the SKILL.md critical rules. VS Code garbage-collects the document once your snippet returns and nothing references it — there is no `closeTextDocument` and iterating across many files is safe.
- **CONTRIBUTING.md rewritten** to reflect the current codebase: skill layout under `assets/skills/implant/`, `scripts/package.mjs`, `test/run-examples.ts`, `chat-participant.ts`, `sandbox-helpers.ts`. Removed stale references to the deleted `assets/prose/` tree and `.vscode/{launch,tasks}.json`.

- **`SKILL.md` description rewritten** to explicitly enumerate the capabilities agents should trigger on — find references, definitions, call hierarchies, workspace symbols, diagnostics, semantic renames, multi-file WorkspaceEdits, ast-grep structural search, third-party extension commands — with a "use whenever…" clause covering "where is X called from", cross-file refactors, semantic renames, dead-code checks, and mixed-language repos. Improves how reliably MCP clients pick the skill up when the user's request maps to a language-server feature.
- **`assets/skills/implant/SKILL.md` documents the two new MCP tools** in the "Invoke via the MCP tool `run_vscode_script`" section (`run_vscode_script` args + `terminate_scripts`).
- **Package `description` in `package.json`** clarified to "Give coding agents live programmatic access to the VS Code API and structural search — Find References, Rename, diagnostics, any extension command."

### Removed

- **Dead legacy port-file paths** (`.vscode/implant.port` and `.vscode/implant/port`) — the extension used to unlink both on activation to clean up state from pre-0.1.0 versions. 0.1.0 shipped the current `session.yml` layout, so no released version writes those files and no user should have them lying around.

## [0.2.1] — 2026-08-11

### Added

- **Bundled `@ast-grep/napi`** — snippets can now `require("@ast-grep/napi")` for structural, AST-aware code search and rewriting without any workspace-level install. Complements the language-server APIs: reach for the LSP for semantic queries (references, rename, hover), reach for ast-grep for pattern-based searches and cross-file rewrites where regex is unsafe. Every platform binary (darwin/linux/win32 across x64 and arm64, plus linux musl variants) ships in a single universal vsix built via `npm run package`. API: <https://ast-grep.github.io/guide/api-usage/js-api>.
- **Sandbox exposes `setImmediate` / `clearImmediate`** — previously the runtime-env prose recommended `await new Promise(r => setImmediate(r))` for yielding between chunks, but the sandbox never provided it, so any snippet following that advice threw `setImmediate is not defined`.
- **Mermaid guidance for diagrams** — `assets/prose/runtime-env.md` and `assets/prose/examples.md` now tell agents to return `` ```mermaid `` fenced blocks for dependency graphs, call graphs, class hierarchies, flowcharts, sequence and state diagrams. VS Code Markdown preview, Copilot Chat, and GitHub-flavored Markdown all render Mermaid natively — no image generation, no attachments.

### Fixed

- **`@implant` no longer emits nested code fences.** Hardened the chat participant's system preamble, added a few-shot User/Assistant demonstration turn showing correctly-formatted replies, and added defensive fence-stripping in two places: `stripCodeFence` on the executed source, and a leading-fence check in `streamLmResponse` that skips the display wrapper when the model produced its own fence. Together these keep execution correct even when the model ignores the instruction, and keep the rendered chat block from breaking.

### Changed

- **`Install into Workspace` consolidated to a single skill** at `.agents/skills/implant/` — the open cross-agent standard from [agentskills.io](https://agentskills.io/home), read natively by Claude Code, Cursor, Copilot / VS Code, Codex, Gemini CLI, Windsurf, OpenCode, Amp, Goose, Roo Code, and others. Structured for progressive disclosure: a lean `SKILL.md` covers when-to-trigger, how-to-invoke, and critical always-apply rules; detailed material (API catalog, runtime environment, recipes, warmup, deeper caveats) lives in `references/*.md` files the agent pulls in only when a task calls for that specific detail. Previously the install wrote three separate files (`.claude/skills/implant/SKILL.md`, `.cursor/rules/implant.mdc`, plus a fenced section in `.github/copilot-instructions.md`), each carrying the full prose. `.mcp.json` and `.cursor/mcp.json` (the MCP connectivity configs) are unchanged.
- **Install prompt is now version-aware.** SKILL.md carries a `version:` field in the YAML frontmatter matching the extension's own version. On activation the extension parses that field from the installed skill and compares it to the current extension version. If the version is older (or the skill is missing while a pre-v0.2.2 layout is detected), a labelled "Update" prompt appears; otherwise the prompt stays silent. Previously the install prompt only fired for workspaces with no prior Implant setup at all, so upgrading the extension left stale skill content in place.
- **Skill assets are shipped as first-class files** at `assets/skills/implant/SKILL.md` and `assets/skills/implant/references/*.md`, rather than assembled from template strings in `agent-instructions.ts`. `Install into Workspace` copies them verbatim (substituting the version in the SKILL.md frontmatter). Single source of truth: the same files the extension ships to end users are the ones the `@implant` chat participant reads at request time.
- **`@implant` uses on-demand reference loading via a language-model tool.** The chat participant registers a `load_implant_reference` tool with the LM and puts only the compact SKILL.md summary in the system prompt. When the model decides it needs deeper detail (say, the ast-grep guidance or the full API catalog), it emits a tool call; the participant loads the matching `references/*.md` from the extension's bundled assets and feeds it back as a tool result. Tool calls are surfaced in chat as `_↓ loaded reference: <path>_` markers. Progressive disclosure end-to-end: the model sees only the SKILL.md summary until it asks for more.
- **Reference tree split by topic.** `references/commands/*.md` — one file per `vscode.execute*Provider` call (signature, return type, when-to-use, minimal example, gotchas). `references/examples/*.md` — one file per worked recipe. `references/topics/*.md` — cross-cutting concerns (ast-grep, mermaid, warmup, workspace-edit). The old flat prose files (`overview.md`, `runtime-env.md`, `examples.md`, `warmup.md`, `caveats.md`) were bundles that forced whole-cloth loading; splitting them per topic means the language model can pull *only* the specific file it needs for a given task. The always-read essentials (runtime primer, critical rules, output-shape guidance, reviewability rules) all migrated into `SKILL.md` proper. `references/how-to-call.md` stays as-is for the "Copy Agent Instructions" clipboard path.
- **Microsoft's `commands.md` redistributed** as `references/vscode-docs-commands.md` (verbatim, CC BY 3.0 US, attribution preserved). Fills in commands our per-command files don't cover (editor commands, notebook commands, workbench commands). Loaded on demand like any other reference.
- **SKILL.md now flags that the API is huge and the docs are scarce**, and promotes exploratory workflows — return unknown values to inspect their shape, enumerate registered commands via `vscode.commands.getCommands(true)`, iterate in small snippets rather than trying to write a perfect one-shot. Same section covers the concrete probes: `getCommands`, `extensions.getExtension`, `tabGroups.all`, `workspace.textDocuments`.
- `.DS_Store` added to `.gitignore`.

## [0.2.0] — 2026-08-10

### Added

- **`@implant` Copilot Chat participant** — ask in natural language, Implant asks the language model to translate the request into a `vscode.*` snippet, runs it through the same approval + slow-script pipeline, and streams the result back into the chat. Requires GitHub Copilot for the language model.

### Fixed

- **MCP registration now surfaces in Copilot Chat.** Added the required `contributes.mcpServerDefinitionProviders` entry in `package.json` matching the `'implant'` id passed to `vscode.lm.registerMcpServerDefinitionProvider`. Without it, VS Code silently ignored the runtime registration and Copilot Chat never discovered the Implant server.
- **stdio proxy retries on transport failure**, not only on `401`. Window reloads rotate both the port and the secret; a stale port caused a connection error rather than an auth error, and the proxy previously gave up. It now reloads `.vscode/implant/session.yml` and retries once on either condition.

### Changed

- **Minimum VS Code version raised to 1.95** (from 1.85) for the chat-participant and language-model APIs.
- Repo hero screenshot moved from `.github/screenshot.png` to `docs/images/screenshot.png`.

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
