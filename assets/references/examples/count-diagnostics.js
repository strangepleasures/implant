// Aggregate severity counts per file — returns JSON for programmatic consumption (feed into another script, dashboard, badge).

// One of the few examples that returns JSON rather than Markdown. The rule of
// thumb (see the "Output shape" section of PROMPT.md): Markdown for humans,
// JSON when another program parses the result. For a human-readable dump,
// see `list-workspace-diagnostics.js`.
//
// Each Diagnostic has `message`, `severity` (0=Error, 1=Warning,
// 2=Information, 3=Hint), `range`, `source?`, `code?`. Diagnostics reflect
// what VS Code currently thinks — a file the language server hasn't seen
// yet has no diagnostics. We enumerate every workspace file (skipping
// obvious build/dependency dirs) and open each so its LS gets notified.

const SKIP_DIRS = "**/{node_modules,__pycache__,.venv,venv,.git,.vscode,.github,.idea,dist,build,out,target}/**";

const paths = await vscode.workspace.findFiles("**/*", SKIP_DIRS);
for (const uri of paths) {
  try {
    await vscode.workspace.openTextDocument(uri);
  } catch { /* not a text file — skip */ }
}

// Diagnostic publishing is asynchronous. Poll up to ~15 s for anything to arrive; if a
// workspace legitimately has none we still fall through and return [].
for (let i = 0; i < 30; i++) {
  const any = vscode.languages.getDiagnostics().some(([, ds]) => ds.length);
  if (any) break;
  await new Promise(r => setTimeout(r, 500));
}

return vscode.languages.getDiagnostics()
  .map(([uri, diags]) => ({
    uri: vscode.workspace.asRelativePath(uri),
    errors: diags.filter(d => d.severity === 0).length,
    warnings: diags.filter(d => d.severity === 1).length,
    info: diags.filter(d => d.severity === 2).length,
    hints: diags.filter(d => d.severity === 3).length,
  }))
  .filter(x => x.errors || x.warnings || x.info || x.hints);
