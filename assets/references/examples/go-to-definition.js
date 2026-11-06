// Go-to-definition targets for the workspace symbol named `greet`, as clickable Markdown.

// Providers may return Location[] OR LocationLink[]. LocationLink has
// `targetUri` / `targetRange` / `targetSelectionRange`; Location has
// `uri` / `range`. Normalize before consuming. Multiple definitions are
// possible (overloads, ambient + concrete); don't assume `[0]`.
//
// SYMBOL_NAME is a name, not a position — the language server locates it via
// executeWorkspaceSymbolProvider, so the script is robust across file/symbol
// reorderings. Implant checks workspace-symbol indexes during warm-up before scripts run.

const SYMBOL_NAME = "greet"; // adjust to a symbol that exists in your workspace

const hits = await vscode.commands.executeCommand("vscode.executeWorkspaceSymbolProvider", SYMBOL_NAME);
const target = hits?.find(h => h.name === SYMBOL_NAME) ?? hits?.[0];
if (!target) return `_No symbol named \`${SYMBOL_NAME}\` in workspace — adjust the constant to a symbol that exists._`;

const uri = target.location.uri;
const pos = target.location.range.start;
await vscode.workspace.openTextDocument(uri);

const results = await vscode.commands.executeCommand(
  "vscode.executeDefinitionProvider",
  uri,
  pos,
);

if (!results?.length) return `_No definition found for \`${SYMBOL_NAME}\`._`;

const lines = results.map(r => {
  const u = r.targetUri ?? r.uri;
  const range = r.targetSelectionRange ?? r.targetRange ?? r.range;
  const rel = vscode.workspace.asRelativePath(u);
  const line = range.start.line + 1;
  return `- [${rel}:${line}](vscode://file${u.path}?${line})`;
});

return `## Definition of \`${SYMBOL_NAME}\` (${results.length})\n\n${lines.join("\n")}`;
