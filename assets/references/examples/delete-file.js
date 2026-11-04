// Round-trip demo of WorkspaceEdit file ops — creates a scratch file, deletes it, reports both steps as Markdown. Both operations are undo-able through VS Code's undo stack.

// `edit.createFile` / `edit.deleteFile` are undo-able; `fs.writeFile` /
// `fs.unlink` aren't. Options that matter:
//   ignoreIfExists / ignoreIfNotExists — silence conflicts
//   overwrite: true                    — replace an existing file
//   recursive: true                    — descend into directories on delete
//
// Self-sufficient: uses the workspace root and a fixed scratch filename.

const folders = vscode.workspace.workspaceFolders;
if (!folders?.length) return "**No workspace open.**";
const uri = vscode.Uri.joinPath(folders[0].uri, ".implant-scratch.txt");
const rel = vscode.workspace.asRelativePath(uri);

// 1) Create the scratch file. `createFile` with `contents` writes to disk on
//    applyEdit — no save step needed.
const createEdit = new vscode.WorkspaceEdit();
createEdit.createFile(uri, { overwrite: true, contents: Buffer.from("scratch — safe to delete\n") });
const created = await vscode.workspace.applyEdit(createEdit);

// 2) Delete it. Same story — the deletion hits disk directly.
const deleteEdit = new vscode.WorkspaceEdit();
deleteEdit.deleteFile(uri, { ignoreIfNotExists: true });
const deleted = await vscode.workspace.applyEdit(deleteEdit);

return [
  `## Round-trip on \`${rel}\``,
  "",
  `- create: ${created ? "**ok**" : "**refused**"}`,
  `- delete: ${deleted ? "**ok**" : "**refused**"} (undo restores it)`,
].join("\n");
