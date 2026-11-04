// Two-hop incoming call tree rooted at the workspace symbol named `greet`, as a nested Markdown list with clickable links.

// The call-hierarchy API is three composed commands:
//   vscode.prepareCallHierarchy(uri, position)  -> CallHierarchyItem[]  (anchor)
//   vscode.provideIncomingCalls(item)           -> IncomingCall[]       (callers)
//   vscode.provideOutgoingCalls(item)           -> OutgoingCall[]       (callees)
//
// IncomingCall has `.from` (caller symbol) and `.fromRanges` (call sites
// inside the caller). Support is uneven — TS / Rust / Go / Pylance implement
// it; smaller languages may not.
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
const pos = target.location.range.start;
await vscode.workspace.openTextDocument(uri);

const roots = await vscode.commands.executeCommand(
  "vscode.prepareCallHierarchy",
  uri,
  pos,
);
const root = roots?.[0];
if (!root) return `_No call-hierarchy anchor at \`${SYMBOL_NAME}\` (provider may not implement call hierarchy)._`;

async function walk(item, depth) {
  if (depth === 0) return "";
  const calls = await vscode.commands.executeCommand("vscode.provideIncomingCalls", item);
  if (!calls?.length) return "";
  const indent = "  ".repeat(2 - depth);
  const lines = await Promise.all(calls.map(async c => {
    const line = c.from.selectionRange.start.line + 1;
    const rel = vscode.workspace.asRelativePath(c.from.uri);
    const head = `${indent}- **${c.from.name}** — [${rel}:${line}](vscode://file${c.from.uri.path}?${line})`;
    const children = await walk(c.from, depth - 1);
    return children ? `${head}\n${children}` : head;
  }));
  return lines.join("\n");
}

const rootLine = root.selectionRange.start.line + 1;
const rootLink = `[${vscode.workspace.asRelativePath(root.uri)}:${rootLine}](vscode://file${root.uri.path}?${rootLine})`;
const tree = await walk(root, 2);

return `## Incoming calls to \`${root.name}\`\n\nAnchor: ${rootLink}\n\n${tree || "_No callers._"}`;
