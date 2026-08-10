## Caveats

- There is no default execution timeout — the user can wait as long as they want. If a
  script runs longer than 10 seconds a cancellable notification appears; the user hits
  Cancel to abort. This only helps for *async* scripts. Sync busy loops freeze the
  extension host and are unrecoverable — do not write them (see the reviewability rules).
- Every call requires user approval unless they clicked "Run + trust session". Don't spam the tool.
- **Applying edits does NOT save to disk.** `vscode.workspace.applyEdit()`, rename providers,
  code actions, formatting — they all write to *open* documents in memory. Affected files
  become dirty tabs. If the point is to persist the change, explicitly save at the end of
  the same snippet: `await vscode.workspace.saveAll(false)` (the `false` skips
  save-participants like format-on-save; pass `true` to include them). Don't rely on
  autosave — the user may have it off, and other tools reading files from disk won't see
  your changes until they're saved.
