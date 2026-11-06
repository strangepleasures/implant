// Simulate format-on-type: what would the formatter do at the end of the first non-blank line of the first source file, when the user types "\n". Reports as Markdown.

// Rarely useful in agent workflows — reach for `format-document.js` or
// `format-range.js` instead unless you specifically want to inspect the
// auto-indent / bracket-alignment behavior. Only certain trigger characters
// fire providers (typically ";", "}", "\n", "\r"); other chars return [].
//
// Self-sufficient: discovers the target file by scanning the workspace
// (skipping obvious build/dependency dirs) and taking the first file
// alphabetically. Language extensions are activated before scripts run, but this does not guarantee provider readiness.

const CHAR = "\n";

const SKIP_DIRS = "**/{node_modules,__pycache__,.venv,venv,.git,.vscode,.github,.idea,dist,build,out,target}/**";

const paths = (await vscode.workspace.findFiles("**/*", SKIP_DIRS))
  .filter(u => !u.path.split("/").pop().startsWith("."))
  .sort((a, b) => a.fsPath.localeCompare(b.fsPath));
if (!paths.length) return "_No files in workspace._";

const uri = paths[0];
const doc = await vscode.workspace.openTextDocument(uri);

// End of the last non-blank line — blank lines and comment-only lines don't
// usually fire indent providers, and the end of the last statement gives the
// formatter a real code context to react to.
let position = new vscode.Position(0, 0);
for (let i = doc.lineCount - 1; i >= 0; i--) {
  if (!doc.lineAt(i).isEmptyOrWhitespace) {
    position = doc.lineAt(i).range.end;
    break;
  }
}

const rel = vscode.workspace.asRelativePath(uri);
const shown = CHAR === "\n" ? "\\n" : CHAR;

const edits = await vscode.commands.executeCommand(
  "vscode.executeFormatOnTypeProvider",
  uri,
  position,
  CHAR,
  { tabSize: 2, insertSpaces: true },
);

if (!edits?.length) return `**No format-on-type response** for \`${shown}\` at ${position.line + 1}:${position.character + 1} of \`${rel}\` — provider may not register a trigger for this character.`;

return `**${edits.length} edit${edits.length === 1 ? "" : "s"}** would follow typing \`${shown}\` at ${position.line + 1}:${position.character + 1} of \`${rel}\`.`;
