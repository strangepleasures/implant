// Jump to the *type* of the workspace symbol named `greet` — not the value's own definition.

// Returns Location[] | LocationLink[]. Only meaningful in typed languages —
// untyped-language providers usually return [].
//
// SYMBOL_NAME is a name, not a position — the language server locates it via
// executeWorkspaceSymbolProvider, so the script is robust across file/symbol
// reorderings. Polls up to ~20 s while providers warm up — bump the loop count or call `activateLanguage(langId)` first on a cold workspace.

const SYMBOL_NAME = "greet"; // adjust to a symbol that exists in your workspace

let hits;
for (let attempt = 0; attempt < 40; attempt++) {
  hits = await vscode.commands.executeCommand("vscode.executeWorkspaceSymbolProvider", SYMBOL_NAME);
  if (hits?.length) break;
  await new Promise(r => setTimeout(r, 500));
}
const target = hits?.find(h => h.name === SYMBOL_NAME) ?? hits?.[0];
if (!target) return `_No symbol named \`${SYMBOL_NAME}\` in workspace — adjust the constant to a symbol that exists._`;

const uri = target.location.uri;
const pos = target.location.range.start;
await vscode.workspace.openTextDocument(uri);

const results = await vscode.commands.executeCommand(
  "vscode.executeTypeDefinitionProvider",
  uri,
  pos,
);

if (!results?.length) return `_No type definition for \`${SYMBOL_NAME}\` (untyped language, or provider doesn't implement this)._`;

const lines = results.map(r => {
  const u = r.targetUri ?? r.uri;
  const range = r.targetSelectionRange ?? r.targetRange ?? r.range;
  const rel = vscode.workspace.asRelativePath(u);
  const line = range.start.line + 1;
  return `- [${rel}:${line}](vscode://file${u.path}?${line})`;
});

return `## Type definition of \`${SYMBOL_NAME}\` (${results.length})\n\n${lines.join("\n")}`;
