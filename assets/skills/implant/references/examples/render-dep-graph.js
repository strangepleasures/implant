// Mermaid dependency graph of Python modules in the workspace — modules as nodes, `import` / `from X import Y` statements as edges.

// Two subtle traps this handles: (1) the glob skips virtualenvs and caches;
// (2) `import` specifiers don't include the file extension, so each dotted
// name is tried as both `X.py` and `X/__init__.py`. See `topics/mermaid` for
// the Mermaid emission pattern.
//
// Self-sufficient: globs the whole workspace for `.py` files.

const path = require("path");

const files = await vscode.workspace.findFiles(
  "**/*.py",
  "**/{node_modules,__pycache__,.venv,venv,.git,dist,build}/**",
);
if (!files.length) return "_No Python files in workspace._";

const folders = vscode.workspace.workspaceFolders;
const roots = (folders ?? []).map(f => f.uri.fsPath);
const paths = new Set(files.map(f => f.fsPath));

// Resolve a dotted module name to a file under one of the workspace roots.
function resolveModule(name) {
  const parts = name.split(".");
  for (const root of roots) {
    const base = path.join(root, ...parts);
    if (paths.has(base + ".py")) return base + ".py";
    if (paths.has(path.join(base, "__init__.py"))) return path.join(base, "__init__.py");
  }
  return null;
}

const edges = [];
const seen = new Set();
for (const f of files) {
  const text = (await vscode.workspace.openTextDocument(f)).getText();
  // `from X import ...`
  for (const m of text.matchAll(/^\s*from\s+([\w.]+)\s+import\b/gm)) {
    const target = resolveModule(m[1]);
    if (target && target !== f.fsPath) edges.push([f.fsPath, target]);
  }
  // `import X` / `import X as Y` / `import X, Y`
  for (const m of text.matchAll(/^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/gm)) {
    for (const raw of m[1].split(",")) {
      const name = raw.trim().split(/\s+as\s+/)[0];
      const target = resolveModule(name);
      if (target && target !== f.fsPath) edges.push([f.fsPath, target]);
    }
  }
}

if (!edges.length) return "_No intra-workspace Python imports found._";

const label = p => path.basename(p).replace(/\W/g, "_");
const lines = ["```mermaid", "flowchart LR"];
for (const [from, to] of edges) {
  const key = from + "->" + to;
  if (seen.has(key)) continue;
  seen.add(key);
  lines.push(`  ${label(from)} --> ${label(to)}`);
}
lines.push("```");
return lines.join("\n");
