// Smart-select expansion chain anchored at the workspace symbol named `greet` — identifier → expression → statement → block → function → …

// The provider returns a linked list: `.range` plus optional `.parent` (the
// next-larger enclosing range). Walk the parent chain to compute the smallest
// enclosing range of a given kind.
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
  "vscode.executeSelectionRangeProvider",
  uri,
  [pos],
);

const head = results?.[0];
if (!head) return `_No selection ranges at \`${SYMBOL_NAME}\`._`;

const lines = [];
let step = 0;
for (let r = head; r; r = r.parent, step++) {
  const { start, end } = r.range;
  const oneLine = start.line === end.line;
  const span = oneLine
    ? `line ${start.line + 1}, cols ${start.character + 1}\u2013${end.character + 1}`
    : `lines ${start.line + 1}\u2013${end.line + 1}`;
  lines.push(`${step}. ${span}`);
}

const rel = vscode.workspace.asRelativePath(uri);
return `## Smart-select chain — ${rel} @ \`${SYMBOL_NAME}\`\n\n${lines.join("\n")}`;
