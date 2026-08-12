// Foldable regions in the first source file of the workspace (imports / comments / regions) as a Markdown table.

// Providers may cap results via a default `rangeLimit` (several thousand);
// pass a higher limit for huge files.
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

const ranges = await vscode.commands.executeCommand(
  "vscode.executeFoldingRangeProvider",
  uri,
);

const rel = vscode.workspace.asRelativePath(uri);
if (!ranges?.length) return `_No folding ranges in ${rel}._`;

const K = vscode.FoldingRangeKind;
const kindName = k => k === K.Comment ? "Comment" : k === K.Imports ? "Imports" : k === K.Region ? "Region" : "-";

const rows = ranges.map(r => {
  const startLine = r.start + 1;
  return `| [${startLine}](vscode://file${uri.path}?${startLine}) | ${r.end + 1} | ${kindName(r.kind)} |`;
});

return `## Folding ranges in ${rel} (${ranges.length})\n\n| Start | End | Kind |\n|---|---|---|\n${rows.join("\n")}`;
