// Color literals detected in the first CSS-family file of the workspace as JSON — for palette audits, format conversion, or piping into `get-color-presentations.js`.

// One of the few examples that returns JSON rather than Markdown (see the
// "Output shape" section of SKILL.md). The raw `{ red, green, blue, alpha }`
// (0.0–1.0) is what downstream tooling actually wants; a human-readable form
// would lose precision.
//
// Only CSS-family languages and certain templating extensions register
// providers; other files return [].
//
// Self-sufficient: discovers target file via workspace inspection.

const files = (await vscode.workspace.findFiles(
  "**/*.{css,scss,less}",
  "**/{node_modules,.git,dist,build,out}/**",
)).sort((a, b) => a.fsPath.localeCompare(b.fsPath));
if (!files.length) return { error: "no CSS-family files in workspace" };
const uri = files[0];
await vscode.workspace.openTextDocument(uri);

// VS Code's CSS language service streams results — on a cold open it returns
// a partial set (with slightly different ranges) for ~1-2 s before named
// colors like `white` come in. We poll and keep the largest result seen, then
// stop after several consecutive readings agree.
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

return {
  file: vscode.workspace.asRelativePath(uri),
  colors: (colors ?? []).map(c => ({
    line: c.range.start.line + 1,
    startChar: c.range.start.character,
    endChar: c.range.end.character,
    r: c.color.red,
    g: c.color.green,
    b: c.color.blue,
    a: c.color.alpha,
  })),
};
