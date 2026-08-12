// Inline debug values a provider would show for the file containing the workspace symbol named `greet`, as Markdown.

// InlineValue is one of InlineValueText, InlineValueVariableLookup, or
// InlineValueEvaluatableExpression — all have a `.range` and a discriminated
// payload (`.text`, `.variableName`, or `.expression`). Only meaningful during
// an active debug session with a real `frameId` and `stoppedLocation` —
// outside a debug context most providers return [].
//
// SYMBOL_NAME is a name, not a position — the language server locates it via
// executeWorkspaceSymbolProvider, so the script is robust across file/symbol
// reorderings. Polls up to ~20 s while providers warm up — bump the loop count or call `activateLanguage(langId)` first on a cold workspace.

const SYMBOL_NAME = "greet"; // adjust to a symbol that exists in your workspace

let hits;
for (let attempt = 0; attempt < 40; attempt++) {
  hits = await vscode.commands.executeCommand("vscode.executeWorkspaceSymbolProvider", SYMBOL_NAME);
  if (hits?.length) break;
  await new Promise(r => setTimeout(r, 500));
}
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
