// MODIFIES THE WORKSPACE. Renames the workspace symbol named `greet` (new name = "greet_renamed"); reports files touched as Markdown.

// Inspect `edit.entries()` first (skip the applyEdit) for a dry-run before
// running this destructively.
//
// Language-server-driven: respects scope, imports, and cross-file
// relationships — safer than text find-and-replace. Provider returns a
// WorkspaceEdit that `workspace.applyEdit` applies to the in-memory buffers;
// touched files show as dirty tabs until autosave (or Cmd+S) persists them.
//
// SYMBOL_NAME is a name, not a position — the language server locates it via
// executeWorkspaceSymbolProvider, so the script is robust across file/symbol
// reorderings. Implant checks workspace-symbol indexes during warm-up before scripts run.

const SYMBOL_NAME = "greet"; // adjust to a symbol that exists in your workspace
const NEW_NAME = SYMBOL_NAME + "_renamed";

const hits = await vscode.commands.executeCommand("vscode.executeWorkspaceSymbolProvider", SYMBOL_NAME);
const target = hits?.find(h => h.name === SYMBOL_NAME) ?? hits?.[0];
if (!target) return `_No symbol named \`${SYMBOL_NAME}\` in workspace — adjust the constant to a symbol that exists._`;

const uri = target.location.uri;
const pos = target.location.range.start;
await vscode.workspace.openTextDocument(uri);

const edit = await vscode.commands.executeCommand(
  "vscode.executeDocumentRenameProvider",
  uri,
  pos,
  NEW_NAME,
);

if (!edit) return `**Rename refused** for \`${SYMBOL_NAME}\`. Position may not be on a renamable symbol, or the new name is invalid.`;

const entries = edit.entries();
const applied = await vscode.workspace.applyEdit(edit);
if (!applied) return "**`applyEdit` rejected the edit.**";

const changes = entries.reduce((n, [, edits]) => n + edits.length, 0);
const fileList = entries.map(([u]) => `- [${vscode.workspace.asRelativePath(u)}](vscode://file${u.path})`);

return `## Renamed \`${SYMBOL_NAME}\` -> \`${NEW_NAME}\`\n\n${changes} change${changes === 1 ? "" : "s"} across ${entries.length} file${entries.length === 1 ? "" : "s"} — buffers dirty until autosave or Cmd+S:\n\n${fileList.join("\n")}`;
