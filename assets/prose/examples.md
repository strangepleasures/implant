## Recipes

Find all references to the identifier under the cursor:

```js
const ed = vscode.window.activeTextEditor;
return await vscode.commands.executeCommand(
  "vscode.executeReferenceProvider",
  ed.document.uri,
  ed.selection.active,
);
```

List the top-level symbols in a specific file (open it first so the language server indexes it):

```js
const uri = vscode.Uri.file("/abs/path/to/file.ts");
await vscode.workspace.openTextDocument(uri);
return await vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", uri);
```

Get every diagnostic currently reported in the workspace:

```js
return vscode.languages.getDiagnostics().map(([uri, diags]) => ({
  uri: uri.toString(),
  diagnostics: diags.map(d => ({
    message: d.message,
    severity: ["Error","Warning","Info","Hint"][d.severity],
    line: d.range.start.line + 1,
  })),
})).filter(x => x.diagnostics.length);
```

Invoke a third-party extension's command (whatever it registered — check `vscode.commands.getCommands(true)`):

```js
return await vscode.commands.executeCommand("git.commitStaged");
```

Hover text at a position:

```js
const hovers = await vscode.commands.executeCommand(
  "vscode.executeHoverProvider",
  vscode.Uri.file("/abs/path/file.ts"),
  new vscode.Position(42, 8),
);
return hovers.flatMap(h => h.contents.map(c => typeof c === "string" ? c : c.value));
```

Available quick-fixes / refactors at a position:

```js
return await vscode.commands.executeCommand(
  "vscode.executeCodeActionProvider",
  vscode.Uri.file("/abs/path/file.ts"),
  new vscode.Range(10, 0, 10, 20),
);
```

Structural rename of the symbol at a position, applied via the language server (safer than
find-and-replace — respects scope, imports, and cross-file references):

```js
// Rename the symbol at line 42 col 8 in file.ts to "newName", apply, and persist.
const uri = vscode.Uri.file("/abs/path/file.ts");
await vscode.workspace.openTextDocument(uri);
const edit = await vscode.commands.executeCommand(
  "vscode.executeDocumentRenameProvider",
  uri,
  new vscode.Position(42, 8),
  "newName",
);
if (!edit) return { ok: false, reason: "no rename edit produced" };
const applied = await vscode.workspace.applyEdit(edit);
if (!applied) return { ok: false, reason: "applyEdit rejected" };
await vscode.workspace.saveAll(false);
return { ok: true, filesTouched: edit.entries().map(([u]) => u.fsPath) };
```

Delete a file safely as part of a workspace edit (undo-able via VS Code's undo stack):

```js
const edit = new vscode.WorkspaceEdit();
edit.deleteFile(vscode.Uri.file("/abs/path/old.ts"), { ignoreIfNotExists: true });
const applied = await vscode.workspace.applyEdit(edit);
await vscode.workspace.saveAll(false);
return { ok: applied };
```

Draw a Mermaid dependency graph of the modules under `src/` — nodes are files,
edges are relative imports. Two things this example gets right that a naïve version
usually misses: (1) glob covers TS *and* JS variants, not just `.js`; (2) relative
import specifiers don't include the file extension, so try each candidate
(`+ '.ts'`, `+ '/index.ts'`, …) until one matches a real file:

````js
// Mermaid dep graph of TS/JS modules under src/.
const path = require("path");
const files = await vscode.workspace.findFiles("src/**/*.{ts,tsx,js,jsx}", "**/node_modules/**");
const paths = new Set(files.map(f => f.fsPath));
const CANDIDATES = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.js"];

function resolveImport(fromFile, spec) {
  if (!spec.startsWith(".")) return null; // skip npm/bare specifiers
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const ext of CANDIDATES) if (paths.has(base + ext)) return base + ext;
  return null;
}

const edges = [];
for (const f of files) {
  const text = (await vscode.workspace.openTextDocument(f)).getText();
  for (const m of text.matchAll(/^\s*import\s+.*?\s+from\s+['"]([^'"]+)['"]/gm)) {
    const target = resolveImport(f.fsPath, m[1]);
    if (target) edges.push([f.fsPath, target]);
  }
}

const label = p => path.basename(p).replace(/\W/g, "_");
const lines = ["```mermaid", "flowchart LR"];
for (const [from, to] of edges) lines.push(`  ${label(from)} --> ${label(to)}`);
lines.push("```");
return lines.join("\n");
````
