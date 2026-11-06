// Parameter hints inside the first call-site of the workspace symbol named `greet` — active signature label, active parameter index — as Markdown.

// Signature help fires *inside* the parens of a call expression, not the
// declaration parens. This script looks SYMBOL_NAME up via the workspace-symbol
// provider, then walks its references and picks the first one whose next
// character is `(` — a call site. Some providers require a trigger character
// ("(" or ",") as the 4th arg — add it if you get undefined.
//
// SYMBOL_NAME is a name, not a position — the language server locates it via
// executeWorkspaceSymbolProvider, so the script is robust across file/symbol
// reorderings. Implant checks workspace-symbol indexes during warm-up before scripts run.

const SYMBOL_NAME = "greet"; // adjust to a symbol that exists in your workspace

const hits = await vscode.commands.executeCommand("vscode.executeWorkspaceSymbolProvider", SYMBOL_NAME);
const target = hits?.find(h => h.name === SYMBOL_NAME) ?? hits?.[0];
if (!target) return `_No symbol named \`${SYMBOL_NAME}\` in workspace — adjust the constant to a symbol that exists._`;

const refs = await vscode.commands.executeCommand(
  "vscode.executeReferenceProvider",
  target.location.uri,
  target.location.range.start,
) ?? [];

let call;
for (const ref of refs) {
  const doc = await vscode.workspace.openTextDocument(ref.uri);
  const line = doc.lineAt(ref.range.end.line).text;
  if (line[ref.range.end.character] === "(") {
    call = { uri: ref.uri, position: new vscode.Position(ref.range.end.line, ref.range.end.character + 1) };
    break;
  }
}
if (!call) return `_No call site found for \`${SYMBOL_NAME}\` — signature help needs a position inside the parens of a call expression._`;

const help = await vscode.commands.executeCommand(
  "vscode.executeSignatureHelpProvider",
  call.uri,
  call.position,
);

if (!help?.signatures?.length) return "_No signature help — position may not be inside a call expression._";

const active = help.signatures[help.activeSignature];
const overloads = help.signatures.length > 1
  ? `\n\n### All overloads\n\n${help.signatures.map((s, i) => `${i === help.activeSignature ? "\u2192" : " "} \`${s.label}\``).join("\n")}`
  : "";

return `## Signature\n\n\`${active.label}\`\n\nActive parameter: **${help.activeParameter}**${overloads}`;
