// Inline debug values a provider would show for the file containing the workspace symbol named `greet`, as Markdown.

// InlineValue is one of InlineValueText, InlineValueVariableLookup, or
// InlineValueEvaluatableExpression — all have a `.range` and a discriminated
// payload (`.text`, `.variableName`, or `.expression`). Only meaningful during
// an active debug session with a real `frameId` and `stoppedLocation` —
// outside a debug context most providers return [].
//
// SYMBOL_NAME is a name, not a position — the language server locates it via
// executeWorkspaceSymbolProvider, so the script is robust across file/symbol
// reorderings. Implant checks workspace-symbol indexes during warm-up before scripts run.

const SYMBOL_NAME = "greet"; // adjust to a symbol that exists in your workspace

const hits = await vscode.commands.executeCommand("vscode.executeWorkspaceSymbolProvider", SYMBOL_NAME);
const target = hits?.find(h => h.name === SYMBOL_NAME) ?? hits?.[0];
if (!target) return `_No symbol named \`${SYMBOL_NAME}\` in workspace — adjust the constant to a symbol that exists._`;

const uri = target.location.uri;
const doc = await vscode.workspace.openTextDocument(uri);

const range = new vscode.Range(0, 0, doc.lineCount, 0);

// A real stopped session would supply these from the DebugAdapter — this stub
// exercises the provider even outside a debug session (expect []).
const stopStart = target.location.range.start;
const context = {
  frameId: 0,
  stoppedLocation: new vscode.Range(stopStart, stopStart),
};

const values = await vscode.commands.executeCommand(
  "vscode.executeInlineValueProvider",
  uri,
  range,
  context,
);

if (!values?.length) return "_No inline values — likely no active debug session._";

const lines = values.map(v => {
  const line = v.range.start.line + 1;
  const payload = v.text ?? v.variableName ?? v.expression ?? "?";
  return `- [${line}](vscode://file${uri.path}?${line}) -> \`${payload}\``;
});

return `## Inline values (${values.length})\n\n${lines.join("\n")}`;
