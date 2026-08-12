// Every workspace diagnostic, grouped by file, as a Markdown report with clickable line links.

// Diagnostics reflect what VS Code currently thinks — a file the language server
// hasn't seen yet reports none. So: enumerate every workspace file (skipping
// obvious build/dependency dirs — the exclude glob is the "black list"),
// open each so its language server gets notified, then activate every
// language we find so their LSPs get a chance to publish before we read.

const SKIP_DIRS = "**/{node_modules,__pycache__,.venv,venv,.git,.vscode,.github,.idea,dist,build,out,target}/**";
const ICON = ["🛑", "⚠️", "ℹ️", "💡"];

const paths = await vscode.workspace.findFiles("**/*", SKIP_DIRS);
const langs = new Set();
for (const uri of paths) {
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    langs.add(doc.languageId);
  } catch { /* not a text file — skip */ }
}

// Warm every language provider in parallel. Languages with no registered
// provider just return false; harmless.
await Promise.all([...langs].map(id => activateLanguage(id).catch(() => false)));

const groups = vscode.languages.getDiagnostics().filter(([, ds]) => ds.length);
if (!groups.length) return "**No diagnostics** in the workspace. ✨";

// Sort by (errors, then warnings) descending so the noisiest files surface first.
groups.sort(([, a], [, b]) => {
  const ea = a.filter(d => d.severity === 0).length;
  const eb = b.filter(d => d.severity === 0).length;
  if (ea !== eb) return eb - ea;
  const wa = a.filter(d => d.severity === 1).length;
  const wb = b.filter(d => d.severity === 1).length;
  return wb - wa;
});

const sections = groups.map(([uri, diags]) => {
  const rel = vscode.workspace.asRelativePath(uri);
  const items = diags.map(d => {
    const line = d.range.start.line + 1;
    const src = d.source ? ` \`${d.source}\`` : "";
    return `- ${ICON[d.severity] ?? "•"} [${line}](vscode://file${uri.path}?${line})${src} — ${d.message}`;
  });
  return `### ${rel} (${diags.length})\n\n${items.join("\n")}`;
});

return `## Workspace diagnostics (${groups.reduce((n, [, d]) => n + d.length, 0)})\n\n${sections.join("\n\n")}`;
