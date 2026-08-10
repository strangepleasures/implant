## Warming things up

VS Code and its extensions load things lazily. If a snippet fails with "command not found"
or hangs on an `executeXxxProvider` call, the responsible piece isn't loaded yet — warm it
up and retry once before reporting failure.

**Third-party extension commands.** Extensions activate on specific events (opening a
file of a certain language, running one of their commands, etc.). Until then, the commands
they register aren't in `vscode.commands`:

```js
// Ensure an extension is active, then invoke one of its commands.
const ext = vscode.extensions.getExtension("eamodio.gitlens");
if (!ext) return { error: "gitlens is not installed" };
if (!ext.isActive) await ext.activate();
return await vscode.commands.executeCommand("gitlens.showQuickCommitDetails");
```

**Language servers.** The TS/JS, Python, Rust, etc. servers only index a file after it's
been opened by VS Code. `executeDocumentSymbolProvider` / `executeReferenceProvider` /
`executeHoverProvider` on an unopened file may hang or return nothing:

```js
const uri = vscode.Uri.file("/abs/path/to/file.ts");
await vscode.workspace.openTextDocument(uri); // triggers language server indexing
return await vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", uri);
```

**Workspace symbol search.** `executeWorkspaceSymbolProvider("")` returns nothing on many
providers — pass a non-empty prefix.

Rule of thumb: warm up → retry once → if it still fails, the extension/server may not
exist or may be genuinely broken.
