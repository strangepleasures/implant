// Hover contributions on the workspace symbol named `greet` — types, docs, signatures, third-party hovers — concatenated as Markdown.

// Returns Hover[] — one per provider that answered. `Hover.contents` is an
// array of `MarkdownString | { language, value }`. MarkdownString values need
// `.value` to become plain text; language-fenced contributions arrive as
// `{ language, value }` objects and should be wrapped in a code fence.
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

const hovers = await vscode.commands.executeCommand(
  "vscode.executeHoverProvider",
  uri,
  pos,
);

if (!hovers?.length) return `_No hover info at \`${SYMBOL_NAME}\`._`;

const sections = hovers.flatMap(h => h.contents.map(c => {
  if (typeof c === "string") return c;
  if (c.language) return "```" + c.language + "\n" + c.value + "\n```";
  return c.value;
}));

return `## Hover on \`${SYMBOL_NAME}\`\n\n${sections.join("\n\n---\n\n")}`;
