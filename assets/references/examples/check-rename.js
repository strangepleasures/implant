// Check whether the workspace symbol named `greet` is renamable, and report the placeholder that would prefill a rename prompt.

// Returns `{ range, placeholder }` or `undefined` if the provider refuses
// (position not on a renamable symbol, invalid identifier, etc.). Call this
// *before* `rename-symbol.js` when you want to validate without committing.
//
// SYMBOL_NAME is a name, not a position — the language server locates it via
// executeWorkspaceSymbolProvider, so the script is robust across file/symbol
// reorderings. On a truly cold workspace the LS hasn't built its symbol index
// yet, so we first open every discovered file and activate each language
// before polling — otherwise executeWorkspaceSymbolProvider returns [] forever.

const SYMBOL_NAME = "greet"; // adjust to a symbol that exists in your workspace
const SKIP_DIRS = "**/{node_modules,__pycache__,.venv,venv,.git,.vscode,.github,.idea,dist,build,out,target}/**";

const paths = await vscode.workspace.findFiles("**/*", SKIP_DIRS);
const langs = new Set();
for (const uri of paths) {
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    langs.add(doc.languageId);
  } catch { /* not a text file — skip */ }
}
await Promise.all([...langs].map(id => activateLanguage(id).catch(() => false)));

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

const info = await vscode.commands.executeCommand(
  "vscode.prepareRename",
  uri,
  pos,
);

if (!info) return `**Not renamable** at \`${SYMBOL_NAME}\`. Position may not be on an identifier the provider can rename.`;

const line = info.range.start.line + 1;
const startCol = info.range.start.character + 1;
const endCol = info.range.end.character + 1;
return `**Renamable** — placeholder \`${info.placeholder}\` (${line}:${startCol}\u2013${endCol}).`;
