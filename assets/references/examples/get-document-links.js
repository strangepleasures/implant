// Document links (file:// / http:// / mailto: / custom) in the first source file of the workspace, as a Markdown list.

// The `.target` field on each link is lazily populated. Pass a second arg
// (`linkResolveCount`) to `executeLinkProvider` to eagerly resolve the first
// N — omit it (as here) to let VS Code decide, and gracefully render
// `_(unresolved)_` when a link's target hasn't been loaded yet.
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

const links = await vscode.commands.executeCommand(
  "vscode.executeLinkProvider",
  uri,
);

const rel = vscode.workspace.asRelativePath(uri);
if (!links?.length) return `_No document links in ${rel}._`;

const lines = links.map(l => {
  const startLine = l.range.start.line + 1;
  const src = `[${startLine}](vscode://file${uri.path}?${startLine})`;
  const target = l.target ? l.target.toString() : "_(unresolved)_";
  return `- ${src} -> ${target}`;
});

return `## Links in ${rel} (${links.length})\n\n${lines.join("\n")}`;
