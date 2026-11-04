// Inlay hints (inferred types / parameter names) across the first source file of the workspace, as a Markdown table with clickable line links.

// `label` may be a string OR an InlayHintLabelPart[]; flatten the latter via
// `.map(p => p.value).join("")`. The provider responds regardless of the
// user's inlay-hint setting.
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

const range = new vscode.Range(0, 0, doc.lineCount, 0);

const hints = await vscode.commands.executeCommand(
  "vscode.executeInlayHintProvider",
  uri,
  range,
);

const rel = vscode.workspace.asRelativePath(uri);
if (!hints?.length) return `_No inlay hints in ${rel} (provider may not implement them, or none apply)._`;

const K = vscode.InlayHintKind;
const kindName = k => (k === K.Type ? "Type" : k === K.Parameter ? "Parameter" : "-");

const rows = hints.slice(0, 200).map(h => {
  const line = h.position.line + 1;
  const label = typeof h.label === "string" ? h.label : h.label.map(p => p.value).join("");
  return `| [${line}:${h.position.character + 1}](vscode://file${uri.path}?${line}) | ${kindName(h.kind)} | \`${label.replaceAll("|", "\\|")}\` |`;
});

const overflow = hints.length > 200 ? `\n\n_+${hints.length - 200} more..._` : "";

return `## Inlay hints in ${rel} (${hints.length})\n\n| Position | Kind | Label |\n|---|---|---|\n${rows.join("\n")}${overflow}`;
