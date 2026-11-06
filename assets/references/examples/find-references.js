// All references to the workspace symbol named `greet`, as clickable Markdown — cross-file, semantic (respects scope and imports).

// SYMBOL_NAME is a name, not a position — the language server locates it via
// executeWorkspaceSymbolProvider, so the script is robust across file/symbol
// reorderings (unlike "first-symbol-in-first-file" auto-discovery). Implant
// checks workspace-symbol indexes during warm-up before scripts run.

const SYMBOL_NAME = "greet"; // adjust to a symbol that exists in your workspace

const hits = await vscode.commands.executeCommand("vscode.executeWorkspaceSymbolProvider", SYMBOL_NAME);
const target = hits?.find(h => h.name === SYMBOL_NAME) ?? hits?.[0];
if (!target) return `_No symbol named \`${SYMBOL_NAME}\` in workspace — adjust the constant to a symbol that exists._`;

const uri = target.location.uri;
const pos = target.location.range.start;
await vscode.workspace.openTextDocument(uri);

const refs = await vscode.commands.executeCommand(
  "vscode.executeReferenceProvider",
  uri,
  pos,
);

if (!refs?.length) return `_No references to \`${SYMBOL_NAME}\` (in ${vscode.workspace.asRelativePath(uri)})._`;

const lines = refs.map(r => {
  const rel = vscode.workspace.asRelativePath(r.uri);
  const line = r.range.start.line + 1;
  return `- [${rel}:${line}](vscode://file${r.uri.path}?${line})`;
});

return `## References to \`${SYMBOL_NAME}\` (${refs.length})\n\n${lines.join("\n")}`;
