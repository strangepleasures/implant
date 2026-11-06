// Run the registered formatter over the first source file of the workspace, apply the resulting edits, report as Markdown.

// Returns [] or undefined if no formatter is registered for this language.
// Set `APPLY_CHANGES` to false in the code for a dry-run. `FormattingOptions`
// is optional — omit to use the file's language config.
//
// Self-sufficient: discovers the target file by scanning the workspace
// (skipping obvious build/dependency dirs) and taking the first file
// alphabetically. Language extensions are activated before scripts run, though
// the formatter may still need time to become ready.

const APPLY_CHANGES = true;

const SKIP_DIRS = "**/{node_modules,__pycache__,.venv,venv,.git,.vscode,.github,.idea,dist,build,out,target}/**";

const paths = (await vscode.workspace.findFiles("**/*", SKIP_DIRS))
  .filter(u => !u.path.split("/").pop().startsWith("."))
  .sort((a, b) => a.fsPath.localeCompare(b.fsPath));
if (!paths.length) return "_No files in workspace._";

const uri = paths[0];
const doc = await vscode.workspace.openTextDocument(uri);

const rel = vscode.workspace.asRelativePath(uri);
const edits = await vscode.commands.executeCommand(
  "vscode.executeFormatDocumentProvider",
  uri,
  { tabSize: 2, insertSpaces: true },
);

if (!edits?.length) return `**No formatting changes** for \`${rel}\` — already formatted, or no formatter registered.`;

if (!APPLY_CHANGES) return `**Dry-run:** formatter would apply ${edits.length} change${edits.length === 1 ? "" : "s"} to \`${rel}\`.`;

const edit = new vscode.WorkspaceEdit();
for (const e of edits) edit.replace(uri, e.range, e.newText);
await vscode.workspace.applyEdit(edit);

return `**Formatted** [\`${rel}\`](vscode://file${uri.path}) — ${edits.length} change${edits.length === 1 ? "" : "s"} applied. Buffer is dirty until autosave or Cmd+S persists it.`;
