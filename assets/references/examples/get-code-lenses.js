// Code lenses in the first source file of the workspace as a Markdown list — "N references", "Run test", etc.

// The `.command` field on each lens is lazily populated. Pass a second arg
// (`itemResolveCount`) to `executeCodeLensProvider` to eagerly resolve the
// first N — omit it (as here) to let VS Code decide, and gracefully render
// `_(unresolved)_` when a lens's command hasn't been loaded yet. Many files
// have no code lenses at all — providers register selectively.
//
// Self-sufficient: discovers the target file by scanning the workspace
// (skipping obvious build/dependency dirs) and taking the first file
// alphabetically. Language extensions are activated before scripts run, but this does not guarantee provider readiness.

const SKIP_DIRS = "**/{node_modules,__pycache__,.venv,venv,.git,.vscode,.github,.idea,dist,build,out,target}/**";

const paths = (await vscode.workspace.findFiles("**/*", SKIP_DIRS))
  .filter(u => !u.path.split("/").pop().startsWith("."))
  .sort((a, b) => a.fsPath.localeCompare(b.fsPath));
if (!paths.length) return "_No files in workspace._";

const uri = paths[0];
const doc = await vscode.workspace.openTextDocument(uri);

const lenses = await vscode.commands.executeCommand(
  "vscode.executeCodeLensProvider",
  uri,
);

const rel = vscode.workspace.asRelativePath(uri);
if (!lenses?.length) return `_No code lenses in ${rel}._`;

const lines = lenses.map(l => {
  const line = l.range.start.line + 1;
  const label = l.command?.title ?? "_(unresolved)_";
  const cmd = l.command?.command ? ` — \`${l.command.command}\`` : "";
  return `- [${rel}:${line}](vscode://file${uri.path}?${line}) — ${label}${cmd}`;
});

return `## Code lenses in ${rel} (${lenses.length})\n\n${lines.join("\n")}`;
