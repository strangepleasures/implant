// Fuzzy workspace symbol search using SYMBOL_NAME as the query, formatted as a clickable Markdown list.

// Returns SymbolInformation[] (flat), each with `.name`, `.kind`,
// `.containerName`, `.location`. Feed `.location.range.start` into
// `find-references.js` / `rename-symbol.js` to compose cross-file lookups.
// Empty `""` query returns nothing on most providers — always pass a prefix
// or fuzzy fragment.
//
// SYMBOL_NAME is a name, not a position — the language server locates it,
// so the script is robust across file/symbol reorderings.

const SYMBOL_NAME = "greet"; // adjust to a symbol that exists in your workspace

let results;
for (let attempt = 0; attempt < 40; attempt++) {
  results = await vscode.commands.executeCommand("vscode.executeWorkspaceSymbolProvider", SYMBOL_NAME);
  if (results?.length) break;
  await new Promise(r => setTimeout(r, 500));
}

if (!results?.length) return `_No symbols matched \`${SYMBOL_NAME}\`._`;

const kindName = k => vscode.SymbolKind[k] ?? String(k);
const lines = results.map(s => {
  const rel = vscode.workspace.asRelativePath(s.location.uri);
  const line = s.location.range.start.line + 1;
  const container = s.containerName ? ` in \`${s.containerName}\`` : "";
  return `- **${s.name}** (${kindName(s.kind)})${container} — [${rel}:${line}](vscode://file${s.location.uri.path}?${line})`;
});

return `## Symbols matching \`${SYMBOL_NAME}\` (${results.length})\n\n${lines.join("\n")}`;
