// Completion items available at the end of the last non-blank line of the first source file, as a Markdown table with label + kind.

// `label` may be a string OR a CompletionItemLabel object — normalize before
// consuming. Providers can return thousands of items in library-heavy
// positions; the table below caps at 100. `itemResolveCount` (last arg)
// forces resolution of `.documentation`, `.detail`, and
// `.additionalTextEdits` for the first N items; leave at 0 for a fast
// shape-only query.
//
// Self-sufficient: discovers the target file by scanning the workspace
// (skipping obvious build/dependency dirs) and taking the first file
// alphabetically. `activateLanguage` warms the language provider first.

const RESOLVE_COUNT = 50;
const SHOW = 100;

const SKIP_DIRS = "**/{node_modules,__pycache__,.venv,venv,.git,.vscode,.github,.idea,dist,build,out,target}/**";

const paths = (await vscode.workspace.findFiles("**/*", SKIP_DIRS))
  .filter(u => !u.path.split("/").pop().startsWith("."))
  .sort((a, b) => a.fsPath.localeCompare(b.fsPath));
if (!paths.length) return "_No files in workspace._";

const uri = paths[0];
const doc = await vscode.workspace.openTextDocument(uri);
await activateLanguage(doc.languageId);

// End of the last non-blank line — a well-scoped position where language
// servers can offer module-level completions. Completions at end of a
// docstring or blank line often return nothing.
let position = new vscode.Position(0, 0);
for (let i = doc.lineCount - 1; i >= 0; i--) {
  if (!doc.lineAt(i).isEmptyOrWhitespace) { position = doc.lineAt(i).range.end; break; }
}

const list = await vscode.commands.executeCommand(
  "vscode.executeCompletionItemProvider",
  uri,
  position,
  undefined,
  RESOLVE_COUNT,
);

if (!list?.items?.length) return "_No completions at this position._";

const rows = list.items.slice(0, SHOW).map(i => {
  const label = typeof i.label === "string" ? i.label : i.label.label;
  const kind = vscode.CompletionItemKind[i.kind] ?? String(i.kind);
  return `| \`${label.replaceAll("|", "\\|")}\` | ${kind} |`;
});

const overflow = list.items.length > SHOW ? `\n\n_+${list.items.length - SHOW} more..._` : "";
const incomplete = list.isIncomplete ? "\n\n_Provider reports the list is incomplete — refine the position to narrow._" : "";

return `## Completions (${list.items.length})\n\n| Label | Kind |\n|---|---|\n${rows.join("\n")}${overflow}${incomplete}`;
