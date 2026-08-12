# Implant

Implant lets AI coding assistants read and edit your code with the same intelligence
your editor already has — every language server, every extension command, plus
ast-grep for cross-language structural search and rewrites.

Under the hood, agents send short JavaScript snippets that run inside the VS Code
extension host with the full `vscode.*` API in scope. Nothing runs without the user
approving the exact snippet.

**Explore the code with the tools the editor already has:** Find References,
Go-to-Definition, hover types, workspace diagnostics, git blame, symbol outlines,
and any command a third-party extension registers.

**Modify the code through the same language server that powers the editor:**
structural rename, quick-fixes and refactors, organize imports, safe file
create/rename/delete via `WorkspaceEdit`, formatter output, source actions. Edits
go through the language server — safer than `sed`/`awk` on files because they
respect scope, imports, and semantics.

**Structural search and rewrite with ast-grep:** find and change every occurrence
of a code shape across the workspace at once, in any language ast-grep supports,
without the false hits regex gives you on comments and string literals.

![screenshot](https://github.com/strangepleasures/implant/raw/HEAD/docs/images/screenshot.png)

## Quick start

1. Install the extension.
2. Open your project. Implant will offer to install itself into the workspace —
   this drops portable rule files that teach agents when to reach for Implant.
3. Your agent picks up the tool automatically — MCP-native clients (Copilot Chat
   and others on VS Code ≥ 1.101) discover it via the registry, and CLI agents
   pick it up from the workspace instructions installed in step 2.
4. When an agent invokes the tool, a webview opens beside the editor showing the
   script with syntax highlighting. Click **Run**, **Run + trust session**, or
   **Deny**.

You can also ask Implant directly in Copilot Chat via **`@implant`** — see below.

## `@implant` in Copilot Chat

Type `@implant …` in Copilot Chat with a natural-language request. Implant asks
the language model to translate your ask into a `vscode.*` snippet, shows you
the snippet, runs it through the same approval flow as any other invocation,
and streams the result back into the chat.

Examples of things that aren't one-click in the UI:

- `@implant list every TODO / FIXME / HACK comment across the workspace, grouped by tag, with clickable file:line links.`
- `@implant which exported symbols in src/ have zero references? Those are dead-code candidates.`
- `@implant sort my open tabs by diagnostic count so I know which file to fix first.`
- `@implant give me a bug-report snapshot: VS Code version, active user extensions, open tabs, dirty files, and per-language diagnostic count. Format it as GitHub-ready Markdown.`
- `@implant list the top 20 functions in this workspace by cross-file reference count.`
- `@implant preview what a project-wide rename of \`foo\` → \`bar\` would touch — file count and line count per file, no changes applied.`

Requires GitHub Copilot for the language model. Read-only queries and refactor
dry-runs are the sweet spot; anything that modifies files still opens the
approval webview so you can eyeball the exact snippet before it runs.

## Safety notes

- Snippets run in the VS Code extension host with the same privileges as the
  extension itself. There is no sandbox — that is the entire point.
- The approval webview exists so you can eyeball each snippet before it runs.
  Turn confirmation off only when the agent is already in a tight review loop.
- The HTTP server only binds to `127.0.0.1` and requires a per-session bearer
  token — the token lives in `.vscode/implant/session.yml` (mode `0600`, gitignored,
  regenerated on every activation). Requests without a valid token get `401` and
  raise a warning notification so you notice anything poking at the port.
- Even with the token gate, don't run this on a shared machine: any process
  running as your user can read the session file.
- The `implant.requireConfirmation` workspace setting toggles the approval
  webview. Leaving it on is the default for a reason; the per-session "Trust"
  button on the approval webview is the escape hatch when you're actively
  supervising a run.
