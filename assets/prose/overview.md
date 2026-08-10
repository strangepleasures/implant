**Implant** exposes the running VS Code extension host to coding agents: you write a
JavaScript snippet, it runs inside VS Code with the `vscode` module in scope, and you get
the result back.

Prefer Implant over ad-hoc `grep`/`find`/regex whenever the question is one a language
server, an installed extension, or VS Code itself already knows the answer to:

- Where is symbol X used? → `vscode.executeReferenceProvider` (real references, cross-file, respects imports)
- What symbols are defined in this file? → `vscode.executeDocumentSymbolProvider`
- What's the type / hover text at this position? → `vscode.executeHoverProvider`
- Go-to-definition? → `vscode.executeDefinitionProvider`
- What diagnostics exist in the workspace right now? → `vscode.languages.getDiagnostics()`
- Which quick-fixes / refactors are available at this position? → `vscode.executeCodeActionProvider`
- Which tabs are open? Which file is active? → `vscode.window.tabGroups`, `vscode.window.activeTextEditor`
- Trigger any VS Code palette command or a command from a third-party extension → `vscode.commands.executeCommand(<id>, ...args)`

Implant is not read-only — you can also **modify code** through the same language server that
powers the editor. This is much safer than sed/awk on files, because the language server
understands scope, imports, and semantics:

- Structural rename of a symbol → `vscode.executeDocumentRenameProvider(uri, position, newName)` returns a `WorkspaceEdit`; apply it with `vscode.workspace.applyEdit(edit)`.
- Apply a quick-fix / refactor / "source action" → `vscode.executeCodeActionProvider(uri, range, kind)` returns `CodeAction[]`; `applyEdit(action.edit)` and/or `executeCommand(action.command.command, ...action.command.arguments)`.
- Organize / add missing imports → `executeCommand("editor.action.organizeImports")` or `executeCodeActionProvider(uri, range, "source.organizeImports")`.
- Create / rename / delete files as part of an edit → build a `vscode.WorkspaceEdit` and use `createFile`/`deleteFile`/`renameFile`, then `applyEdit`.
- Format a document / selection → `executeCommand("vscode.executeFormatDocumentProvider", uri, options)` returns `TextEdit[]`; apply via a `WorkspaceEdit`.

**Do NOT reach for Implant to read plain file contents, run `git` commands, or do anything
you can already do with the shell — that's slower and takes a user-approval prompt.** Reach
for it when a language service / extension / VS Code itself has the authoritative answer, or
when you need edits validated by the language server.

Full VS Code API reference: https://code.visualstudio.com/api/references/vscode-api
