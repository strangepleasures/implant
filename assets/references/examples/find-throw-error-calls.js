// Structural search for `raise $CLS($MSG)` sites in Python files via ast-grep, formatted as a Markdown list.

// Regex can't do this safely — a naïve pattern false-matches string literals
// like "raise ValueError(...)" inside code samples. ast-grep matches AST
// nodes, so comments and strings can't confuse it. `$CLS`/`$MSG` are
// meta-variables captured via `node.getMatch("CLS")` / `node.getMatch("MSG")`.
// The same shape works in other bundled languages — swap "Python" for
// Lang.TypeScript / "Go" / "Rust" and adjust the pattern (e.g. `throw new
// $CLS($MSG)` for TS). Note: the built-in five languages (Html/JavaScript/
// Tsx/Css/TypeScript) go via `Lang.*`; the dynamically-registered ones
// (Python/Go/Rust/Java/C/Cpp) go via string names.
//
// Self-sufficient: globs the whole workspace for `.py` files.

const { parse } = astGrep;

const files = await vscode.workspace.findFiles(
  "**/*.py",
  "**/{node_modules,__pycache__,.venv,venv,.git,dist,build}/**",
);
const hits = [];

for (const uri of files) {
  const doc = await vscode.workspace.openTextDocument(uri);
  const root = parse("Python", doc.getText()).root();
  for (const node of root.findAll("raise $CLS($MSG)")) {
    const { start } = node.range();
    const rel = vscode.workspace.asRelativePath(uri);
    const cls = node.getMatch("CLS")?.text() ?? "";
    const msg = node.getMatch("MSG")?.text() ?? "";
    hits.push(`- [${rel}:${start.line + 1}](vscode://file${uri.path}?${start.line + 1}) — \`${cls}(${msg})\``);
  }
}

return `## \`raise ...\` sites (${hits.length})\n\n${hits.join("\n") || "_none_"}`;
