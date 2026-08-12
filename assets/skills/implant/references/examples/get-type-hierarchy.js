// Ancestors + descendants of the workspace symbol named `Adder`, as a Markdown report.

// Three composed commands:
//   vscode.prepareTypeHierarchy(uri, position) -> TypeHierarchyItem[]  (anchor)
//   vscode.provideSupertypes(item)             -> TypeHierarchyItem[]  (extends / implements targets)
//   vscode.provideSubtypes(item)               -> TypeHierarchyItem[]  (subclasses / implementers)
//
// Support is uneven across language providers — probe with a small test on
// the target language before assuming full coverage.
//
// SYMBOL_NAME is a name, not a position — the language server locates it via
// executeWorkspaceSymbolProvider, so the script is robust across file/symbol
// reorderings. Polls up to ~20 s while providers warm up — bump the loop count or call `activateLanguage(langId)` first on a cold workspace.

const SYMBOL_NAME = "Adder"; // adjust to a symbol that exists in your workspace

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

const roots = await vscode.commands.executeCommand(
  "vscode.prepareTypeHierarchy",
  uri,
  pos,
);
const root = roots?.[0];
if (!root) return `_No type-hierarchy anchor at \`${SYMBOL_NAME}\` (provider may not implement type hierarchy)._`;

const [supers, subs] = await Promise.all([
  vscode.commands.executeCommand("vscode.provideSupertypes", root),
  vscode.commands.executeCommand("vscode.provideSubtypes", root),
]);

const link = t => {
  // Symbols outside the workspace (e.g. `object` from a typeshed stub bundled
  // inside a language extension) have env-specific absolute paths that would
  // make a captured output brittle. Report the name and mark the source, but
  // drop the path.
  if (!vscode.workspace.getWorkspaceFolder(t.uri)) return `- **${t.name}** _(external)_`;
  const line = t.selectionRange.start.line + 1;
  return `- **${t.name}** — [${vscode.workspace.asRelativePath(t.uri)}:${line}](vscode://file${t.uri.path}?${line})`;
};

const section = (title, items) =>
  `### ${title} (${items?.length ?? 0})\n\n${items?.length ? items.map(link).join("\n") : "_none_"}`;

return `## Type hierarchy — \`${root.name}\`\n\n${section("Supertypes", supers)}\n\n${section("Subtypes", subs)}`;
