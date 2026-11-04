// String presentations a provider would offer for the first color literal in the first CSS-family file — the options the color-picker UI shows — as a Markdown list.

// Each ColorPresentation has `label` (the string form: "#ff0080" / "rgba(...)"
// / "hsl(...)" / named color) and optional `textEdit` / `additionalTextEdits`.
// Requires a URI + range in the context — the range is where the presentation
// would be inserted.
//
// Self-sufficient: discovers file + color via workspace inspection + the
// document-color provider.

const files = (await vscode.workspace.findFiles(
  "**/*.{css,scss,less}",
  "**/{node_modules,.git,dist,build,out}/**",
)).sort((a, b) => a.fsPath.localeCompare(b.fsPath));
if (!files.length) return "_No CSS-family files in workspace._";
const uri = files[0];
await vscode.workspace.openTextDocument(uri);

// Poll the color provider until it stabilises — CSS language server streams
// results on a cold open, initially returning a partial set with slightly
// different ranges (see get-document-colors.js for the same dance).
let colors = [];
let sameCount = 0, prevLen = -1;
for (let attempt = 0; attempt < 40; attempt++) {
  const cur = await vscode.commands.executeCommand("vscode.executeDocumentColorProvider", uri) ?? [];
  if (cur.length > colors.length) colors = cur;
  if (cur.length === prevLen && cur.length === colors.length) {
    if (++sameCount >= 5) break;
  } else {
    sameCount = 0;
  }
  prevLen = cur.length;
  await new Promise(r => setTimeout(r, 300));
}
if (!colors.length) return `_No color literals detected in ${vscode.workspace.asRelativePath(uri)}._`;

const first = colors[0];
const color = new vscode.Color(first.color.red, first.color.green, first.color.blue, first.color.alpha);

const presentations = await vscode.commands.executeCommand(
  "vscode.executeColorPresentationProvider",
  color,
  { uri, range: first.range },
);

if (!presentations?.length) return "_Provider returned no presentations for this color at this range._";

const line = first.range.start.line + 1;
const rel = vscode.workspace.asRelativePath(uri);
return `## Color presentations — ${rel}:${line}\n\n${presentations.map(p => `- \`${p.label}\``).join("\n")}`;
