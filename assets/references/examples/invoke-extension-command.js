// Ensure a third-party extension is active, then invoke one of its commands (edit EXTENSION_ID and COMMAND_ID). Reports invocation status as Markdown.

// Extensions activate lazily on specific events. Until they activate, the
// commands they register aren't in `vscode.commands` and executing them
// throws "command not found". `getExtension(id)?.activate()` blocks until
// the extension is fully activated. To discover what commands an extension
// registers, filter `getCommands(true)` by the extension's prefix.

const EXTENSION_ID = "eamodio.gitlens";
const COMMAND_ID = "gitlens.showQuickCommitDetails";

const ext = vscode.extensions.getExtension(EXTENSION_ID);
if (!ext) return `**Extension \`${EXTENSION_ID}\` is not installed.**`;

const wasActive = ext.isActive;
if (!ext.isActive) await ext.activate();

try {
  const result = await vscode.commands.executeCommand(COMMAND_ID);
  const activation = wasActive ? "already active" : "activated";
  const returned = result === undefined
    ? "returned `undefined` (side-effect only)"
    : "returned a value (see logs)";
  console.log(result);
  return `**Invoked \`${COMMAND_ID}\`** — ${activation}, ${returned}.`;
} catch (err) {
  return `**\`${COMMAND_ID}\` failed:** ${err.message}`;
}
