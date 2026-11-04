// Outline of the first source file in the workspace, as a nested Markdown bullet list with symbol kinds.

// Return type depends on the provider: `DocumentSymbol[]` (nested via
// `.children`) or `SymbolInformation[]` (flat). Each symbol has `name`, `kind`
// (SymbolKind enum), `range` (full extent), and `selectionRange` (identifier
// only — the position to feed into other providers).
//
// Self-sufficient: discovers the target file by scanning the workspace
// (skipping obvious build/dependency dirs) and taking the first file
// alphabetically. `activateLanguage` warms the language provider first.

const SKIP_DIRS = "**/{node_modules,__pycache__,.venv,venv,.git,.vscode,.github,.idea,dist,build,out,target}/**";

const paths = (await vscode.workspace.findFiles("**/*", SKIP_DIRS))
  .filter(u => !u.path.split("/").pop().startsWith("."))
  .sort((a, b) => a.fsPath.localeCompare(b.fsPath));
if (!paths.length) return "_No files in workspace._";

const uri = paths[0];
const doc = await vscode.workspace.openTextDocument(uri);
await activateLanguage(doc.languageId);

const symbols = await vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", uri);
if (!symbols?.length) return "_No symbols returned — no document-symbol provider for this language, or the file is empty._";

const kindName = k => vscode.SymbolKind[k] ?? String(k);

// DocumentSymbol[] nests via `.children`; SymbolInformation[] is flat (uses
// `.containerName` instead). The renderer below handles both.
function render(node, depth) {
  const indent = "  ".repeat(depth);
  const line = (node.selectionRange ?? node.location.range).start.line + 1;
  const path = node.location?.uri.path ?? uri.path;
  const lines = [`${indent}- **${node.name}** (${kindName(node.kind)}) — [${line}](vscode://file${path}?${line})`];
  for (const child of node.children ?? []) lines.push(render(child, depth + 1));
  return lines.join("\n");
}

const rel = vscode.workspace.asRelativePath(uri);
return `## Symbols in ${rel}\n\n${symbols.map(s => render(s, 0)).join("\n")}`;
