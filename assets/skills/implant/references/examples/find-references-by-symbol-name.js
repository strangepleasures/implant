// Find every reference to a workspace-symbol looked up by NAME (composing workspace-symbol -> reference providers), formatted as a clickable Markdown list.

// Composes: executeWorkspaceSymbolProvider(SYMBOL_NAME) -> take first hit ->
// executeReferenceProvider on that location.
//
// `location.range.start` is the crucial detail — the whole symbol's start
// often falls on the `def`/`function`/`class` keyword and misses the
// identifier; the workspace-symbol provider returns a location whose start
// lands on the identifier itself.
//
// SYMBOL_NAME is a name, not a position — the language server locates it,
// so the script is robust across file/symbol reorderings.

const SYMBOL_NAME = "greet"; // adjust to a symbol that exists in your workspace

let wsHits;
for (let attempt = 0; attempt < 40; attempt++) {
  wsHits = await vscode.commands.executeCommand("vscode.executeWorkspaceSymbolProvider", SYMBOL_NAME);
  if (wsHits?.length) break;
  await new Promise(r => setTimeout(r, 500));
}
if (!wsHits?.length) return `_No workspace symbols matched \`${SYMBOL_NAME}\`._`;

const hit = wsHits.find(h => h.name === SYMBOL_NAME) ?? wsHits[0];
await vscode.workspace.openTextDocument(hit.location.uri);

const refs = await vscode.commands.executeCommand(
  "vscode.executeReferenceProvider",
  hit.location.uri,
  hit.location.range.start,
);

if (!refs?.length) return `_No references to \`${SYMBOL_NAME}\`._`;

const lines = refs.map(r => {
  const rel = vscode.workspace.asRelativePath(r.uri);
  const line = r.range.start.line + 1;
  return `- [${rel}:${line}](vscode://file${r.uri.path}?${line})`;
});

return `## References to \`${SYMBOL_NAME}\` (${refs.length})\n\n${lines.join("\n")}`;
