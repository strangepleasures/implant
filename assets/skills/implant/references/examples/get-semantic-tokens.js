// Read the first source file's semantic tokens and decode them against the provider's legend — returns JSON for programmatic classification queries ("all read-only bindings", "all identifiers of type X", ...).

// One of the few examples that returns JSON rather than Markdown (see the
// "Output shape" section of SKILL.md). Semantic tokens are inherently
// structured data — Markdown formatting would obscure the classification.
//
// Semantic tokens carry richer classification than the tree-sitter grammar
// the editor uses by default — types vs. variables vs. namespaces, mutable
// vs. read-only, etc. Both a legend AND token data are needed to interpret;
// the token stream is delta-encoded [deltaLine, deltaStart, length,
// tokenType, tokenModifiers] per token. Two other command names exist for
// range-scoped reads: `vscode.provideDocumentRangeSemanticTokensLegend` and
// `vscode.provideDocumentRangeSemanticTokens` (take an extra Range arg).
// Not every language provider implements semantic tokens.
//
// Self-sufficient: discovers the target file by scanning the workspace
// (skipping obvious build/dependency dirs) and taking the first file
// alphabetically. `activateLanguage` warms the language provider first.

const SKIP_DIRS = "**/{node_modules,__pycache__,.venv,venv,.git,.vscode,.github,.idea,dist,build,out,target}/**";

const paths = (await vscode.workspace.findFiles("**/*", SKIP_DIRS))
  .filter(u => !u.path.split("/").pop().startsWith("."))
  .sort((a, b) => a.fsPath.localeCompare(b.fsPath));
if (!paths.length) return { error: "no files in workspace" };

const uri = paths[0];
const doc = await vscode.workspace.openTextDocument(uri);
await activateLanguage(doc.languageId);

const legend = await vscode.commands.executeCommand(
  "vscode.provideDocumentSemanticTokensLegend",
  uri,
);
if (!legend) return { error: "no semantic-tokens provider registered for this language", file: vscode.workspace.asRelativePath(uri) };

const tokens = await vscode.commands.executeCommand(
  "vscode.provideDocumentSemanticTokens",
  uri,
);
if (!tokens) return { error: "provider returned no token data", file: vscode.workspace.asRelativePath(uri) };

// Decode the packed Uint32Array into readable rows.
const decoded = [];
let line = 0, char = 0;
const data = tokens.data;
for (let i = 0; i + 4 < data.length; i += 5) {
  const deltaLine = data[i], deltaStart = data[i + 1], length = data[i + 2];
  const typeIdx = data[i + 3], modBits = data[i + 4];
  if (deltaLine === 0) char += deltaStart; else { line += deltaLine; char = deltaStart; }
  const modifiers = legend.tokenModifiers.filter((_, bit) => (modBits >> bit) & 1);
  decoded.push({ line: line + 1, char, length, type: legend.tokenTypes[typeIdx], modifiers });
  if (decoded.length >= 200) break; // cap for readability; remove for full output
}

return { file: vscode.workspace.asRelativePath(uri), legend, tokens: decoded };
