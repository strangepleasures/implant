// Quick-fixes, refactors, and source actions available on the whole range of the workspace symbol named `greet`, as a Markdown list.

// Modern providers return CodeAction (has `.kind`, `.edit?`, `.command?`,
// `.diagnostics?`); legacy ones return raw Command (just `.title`, `.command`,
// `.arguments?`). Pass a kind as the 4th arg (e.g. "source.organizeImports")
// to filter. To apply an action:
//
//   if (action.edit)    await vscode.workspace.applyEdit(action.edit);
//   if (action.command) await vscode.commands.executeCommand(
//                          action.command.command,
//                          ...(action.command.arguments ?? [])
//                        );
//
// applyEdit updates the in-memory buffer; user/autosave persists to disk.
//
// SYMBOL_NAME is a name, not a position — the language server locates it via
// executeWorkspaceSymbolProvider, so the script is robust across file/symbol
// reorderings. Implant checks workspace-symbol indexes during warm-up before scripts run.

const SYMBOL_NAME = "greet"; // adjust to a symbol that exists in your workspace

const hits = await vscode.commands.executeCommand("vscode.executeWorkspaceSymbolProvider", SYMBOL_NAME);
const target = hits?.find(h => h.name === SYMBOL_NAME) ?? hits?.[0];
if (!target) return `_No symbol named \`${SYMBOL_NAME}\` in workspace — adjust the constant to a symbol that exists._`;

const uri = target.location.uri;
const range = target.location.range;
await vscode.workspace.openTextDocument(uri);

const actions = await vscode.commands.executeCommand(
  "vscode.executeCodeActionProvider",
  uri,
  range,
);

if (!actions?.length) return `_No code actions on \`${SYMBOL_NAME}\`._`;

const lines = actions.map(a => {
  const kind = a.kind?.value ?? "_(legacy Command)_";
  const bits = [];
  if (a.edit) bits.push("edit");
  if (a.command) bits.push("command");
  return `- **${a.title}** — \`${kind}\`${bits.length ? ` — ${bits.join(" + ")}` : ""}`;
});

return `## Code actions on \`${SYMBOL_NAME}\` (${actions.length})\n\n${lines.join("\n")}`;
