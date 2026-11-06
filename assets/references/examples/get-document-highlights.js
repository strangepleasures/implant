// Same-symbol occurrences within the file containing the workspace symbol named `greet`, grouped by kind (Read/Write/Text) as Markdown.

// Cheaper than `find-references.js` when you don't need cross-file results.
// Filter on `kind === DocumentHighlightKind.Write` for mutations only.
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

const hits2 = await vscode.commands.executeCommand(
  "vscode.executeDocumentHighlights",
  uri,
  pos,
);

if (!hits2?.length) return `_No highlights for \`${SYMBOL_NAME}\`._`;

const HK = vscode.DocumentHighlightKind;
const kindName = k => (k === HK.Read ? "Read" : k === HK.Write ? "Write" : "Text");

const grouped = new Map();
for (const h of hits2) {
  const g = kindName(h.kind);
  if (!grouped.has(g)) grouped.set(g, []);
  grouped.get(g).push(h);
}

const rel = vscode.workspace.asRelativePath(uri);
const sections = [...grouped.entries()].map(([kind, hs]) => {
  const items = hs.map(h => {
    const line = h.range.start.line + 1;
    return `- [${rel}:${line}](vscode://file${uri.path}?${line})`;
  });
  return `### ${kind} (${hs.length})\n\n${items.join("\n")}`;
});

return `## Highlights of \`${SYMBOL_NAME}\`\n\n${sections.join("\n\n")}`;
