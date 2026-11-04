# Implant

Implant brings your editor's language services, extension commands, and ast-grep
structural search into Copilot Chat and VS Code's agent tools.

Implant runs JavaScript in the VS Code extension host with the full `vscode.*` API
in scope. Review and approve the code in chat before it runs.

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

Install the extension, then invoke **`@implant`** in Copilot Chat or use the
**Implant** tool in a VS Code agent session. Implant shows the code for
approval before it runs.

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
in-chat approval so you can review the exact snippet before it runs.

## Safety notes

- Snippets run in the VS Code extension host with the same privileges as the
  extension itself. There is no sandbox — that is the entire point.
- The `implant.requireConfirmation` setting controls approval. The `@implant`
  participant and native tool both use VS Code's inline chat confirmation with
  Continue/Cancel actions. Disabling confirmation permits model-provided code to
  execute without an additional prompt.
