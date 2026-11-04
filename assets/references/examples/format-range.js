// Preview format-on-range edits for the whole range of the workspace symbol named `greet` — reports as Markdown, does NOT apply.

// Some formatters (prettier, black) don't support range formatting and return
// [] instead of formatting only the range. Others require the range to align
// to statement boundaries. Swap the return for the applyEdit block from
// `format-document.js` to persist.
//
// SYMBOL_NAME is a name, not a position — the language server locates it via
// executeWorkspaceSymbolProvider, so the script is robust across file/symbol
// reorderings. Polls up to ~20 s while providers warm up — bump the loop count or call `activateLanguage(langId)` first on a cold workspace.

const SYMBOL_NAME = "entry"; // adjust to a symbol that exists in your workspace (and whose language has a range formatter — Black doesn't, autopep8 does)

let hits;
for (let attempt = 0; attempt < 40; attempt++) {
  hits = await vscode.commands.executeCommand("vscode.executeWorkspaceSymbolProvider", SYMBOL_NAME);
  if (hits?.length) break;
  await new Promise(r => setTimeout(r, 500));
}
const target = hits?.find(h => h.name === SYMBOL_NAME) ?? hits?.[0];
if (!target) return `_No symbol named \`${SYMBOL_NAME}\` in workspace — adjust the constant to a symbol that exists._`;

const uri = target.location.uri;
const range = target.location.range;
await vscode.workspace.openTextDocument(uri);

const rel = vscode.workspace.asRelativePath(uri);

// Same cold-start polling as format-document.js — the range formatter comes
// from an extension whose LSP may still be booting.
let edits;
for (let attempt = 0; attempt < 40; attempt++) {
  edits = await vscode.commands.executeCommand(
    "vscode.executeFormatRangeProvider",
    uri,
    range,
    { tabSize: 2, insertSpaces: true },
  );
  if (edits !== undefined) break;
  await new Promise(r => setTimeout(r, 500));
}

if (!edits?.length) return `**No range-format changes** for lines ${range.start.line + 1}\u2013${range.end.line + 1} of \`${rel}\` — formatter may not support range formatting on this language.`;

return `**Would apply ${edits.length} edit${edits.length === 1 ? "" : "s"}** to lines ${range.start.line + 1}\u2013${range.end.line + 1} of \`${rel}\` (anchored on \`${SYMBOL_NAME}\`, preview only — no changes written).`;
