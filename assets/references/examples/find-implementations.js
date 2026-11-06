// Concrete implementations of the workspace symbol named `Adder`, as clickable Markdown.

// Prefer this over `find-references.js` when you specifically want
// implementations rather than all usages. Returns Location[] | LocationLink[]
// — normalize `.uri`/`.range` vs `.targetUri`/`.targetSelectionRange`.
//
// SYMBOL_NAME is a name, not a position — the language server locates it via
// executeWorkspaceSymbolProvider, so the script is robust across file/symbol
// reorderings. Implant checks workspace-symbol indexes during warm-up before scripts run.

const SYMBOL_NAME = "Adder"; // adjust to a symbol that exists in your workspace

const hits = await vscode.commands.executeCommand("vscode.executeWorkspaceSymbolProvider", SYMBOL_NAME);
const target = hits?.find(h => h.name === SYMBOL_NAME) ?? hits?.[0];
if (!target) return `_No symbol named \`${SYMBOL_NAME}\` in workspace — adjust the constant to a symbol that exists._`;

const uri = target.location.uri;
const pos = target.location.range.start;
await vscode.workspace.openTextDocument(uri);

const results = await vscode.commands.executeCommand(
  "vscode.executeImplementationProvider",
  uri,
  pos,
);

if (!results?.length) return `_No implementations of \`${SYMBOL_NAME}\` (in ${vscode.workspace.asRelativePath(uri)})._`;

const lines = results.map(r => {
  const u = r.targetUri ?? r.uri;
  const range = r.targetSelectionRange ?? r.targetRange ?? r.range;
  const rel = vscode.workspace.asRelativePath(u);
  const line = range.start.line + 1;
  return `- [${rel}:${line}](vscode://file${u.path}?${line})`;
});

return `## Implementations of \`${SYMBOL_NAME}\` (${results.length})\n\n${lines.join("\n")}`;
