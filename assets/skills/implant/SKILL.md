---
name: implant
version: {{VERSION}}
description: Query and edit code using VS Code's language services and structural search powered by ast-grep — find references, definitions, call hierarchies, workspace symbols, diagnostics; rename symbols; apply built-in and custom refactorings; run any VS Code command or third-party extension command from the extension host. Use whenever the user asks about symbol usage, cross-file refactors, "where is X called from", call graphs, semantic renames, dead-code checks, or anything that needs the language server's authoritative answer rather than a text/regex guess — works uniformly across any languages covered by the installed extensions.
---

# Implant

Implant runs a short JavaScript snippet inside the running VS Code extension host and
returns the value. `vscode` is in scope; everything the editor and its extensions can do
is reachable through the `vscode.*` API.

**Reach for it when** the authoritative answer belongs to whatever language services
the installed extensions contribute (real references, definitions, semantic renames — in
*any* language they cover, including several at once in a mixed-language repo), or to a
third-party extension, or to VS Code itself (live diagnostics, tab state, palette-command
output). **Don't** reach for it for reading files, running `git`, or filesystem walks —
the shell is faster and doesn't prompt for approval.

## Invocation

Invoke **`@implant`** in Copilot Chat, or use the contributed **Implant** language-model
tool from a VS Code agent.
Both execute JavaScript inside this extension host. The native tool accepts `code` and
an optional `timeoutMs`; VS Code asks for confirmation before execution unless
`implant.requireConfirmation` is disabled.

## Runtime

Your code is executed as the body of an `async` function — write statements at top level
and use `return` to send a value back. Do not wrap it in an `async function name() { … }`
declaration; that just defines a function without calling it.

### The interesting globals

- **`vscode`** — the same `vscode` module a VS Code extension imports at the top of its
  code. Namespaces: `window` (editors, tabs, notifications, quick-picks), `workspace`
  (workspace folders, open documents, file system, config, edits), `languages`
  (diagnostics, language-provider commands, feature registration), `commands`
  (`executeCommand`, `getCommands`), `extensions` (installed extension metadata + activation),
  `env` (clipboard, machine info, opening external URIs), `debug`, `tasks`, `authentication`,
  `notebooks`, `scm`, `tests`. Plus VS Code's data classes (`Uri`, `Range`, `Position`,
  `Location`, `Selection`, `WorkspaceEdit`, …) and enums (`SymbolKind`, `DiagnosticSeverity`,
  `CodeActionKind`, …). Every semantic query, every edit, every editor-state read goes
  through here. See `vscode-api-types` for the full type-declaration file, or
  `vscode-docs-commands` for the built-in commands list.
- **`astGrep`** — the bundled `@ast-grep/napi` module (structural search + rewrite).
  Built-in languages: `Html`, `JavaScript`, `Tsx`, `Css`, `TypeScript`. Additional
  languages registered on activation: `Python`, `Go`, `Rust`, `Java`, `C`, `Cpp`. See
  `topics/ast-grep`.
- **`activateLanguage(langId, timeoutMs?)`** — activate every extension registered
  for `langId` (via `onLanguage:${langId}`) and wait until the document-symbol
  provider actually responds. Returns `true` when providers are up, `false` on
  timeout (default 30 000 ms). VS Code doesn't expose language servers as
  first-class handles, so this only kicks activation events and probes a provider
  — but that's enough to avoid the "first `executeXxxProvider` call returns
  `undefined`" trap on a freshly-opened window. In a warm workspace it's a fast
  no-op; skip it if you know the language services are already responsive.

### The rest

Standard Node / Web globals, all in scope: `console`, `require`, `Buffer`, `setTimeout`,
`clearTimeout`, `setImmediate`, `clearImmediate`, `URL`, `URLSearchParams`. All
JavaScript language built-ins (`Array`, `Math`, `Object`, `JSON`, `Promise`, `Map`, `Set`,
`Date`, `RegExp`, typed arrays, …) are automatically available. Anything else is a
`require('node:…')` away.

### Return value serialization

VS Code types (`Uri`, `Range`, `Position`, `Location`, `Selection`) are unwrapped to plain
objects; arrays cap at 500 entries; strings cap at 20 000 characters. If a result would
exceed those caps, filter and aggregate *inside* the snippet and return only what's
needed.

### Logging

`console.log/warn/error` output is captured and returned to the calling agent alongside
the value — use it for debug notes or intermediate context you want the agent to see,
without contaminating the return.

## The API is vast and the docs are scarce — explore

The `vscode.*` surface is huge and its documentation is famously incomplete. This skill
covers what we've written about; the official Microsoft docs cover a bit more; nothing
covers everything. **Trial-and-error is the expected workflow, not a fallback.** Cheap
things to try before assuming a call doesn't work:

- **Log or return unknown values.** Implant's serializer unwraps `Uri`, `Range`,
  `Position`, `Location`, `Selection` to plain JSON — a bare `return someValue` shows
  you the shape. Wrap in `JSON.stringify(x, null, 2)` if you want it as a printable
  string.
- **Enumerate what's actually registered.** `await vscode.commands.getCommands(true)`
  returns every command in this window right now (built-in + contributed). Filter by
  prefix (`.filter(c => c.startsWith("editor."))`) to discover what's there.
- **Inspect extensions.** `vscode.extensions.getExtension(<id>)?.packageJSON` reveals
  the manifest: `contributes.commands`, `contributes.configuration`,
  `activationEvents`, etc. `vscode.extensions.all` lists everything installed.
- **Probe live state.** `vscode.window.tabGroups.all`, `visibleTextEditors`,
  `workspace.workspaceFolders`, `workspace.textDocuments` — cheap reads that reveal
  what you have to work with.
- **Iterate in small snippets.** A one-line probe (`return typeof vscode.workspace.fs`)
  is cheaper than a wrong one-shot. If a call throws, catch it, return `err.message` +
  `err.stack`, then adjust.

Reference for the built-in commands (Microsoft's own documentation, redistributed
verbatim under CC BY 3.0 US): `vscode-docs-commands`. It's not exhaustive but it's the
best single index of `vscode.*` commands that exists — pull it via
`load_implant_reference` when you need to look up an argument name or return type not
covered by our per-command files under `examples/`.

## Critical rules (always apply)

- **Start every snippet with a one-line `//` comment** stating what it does. The user
  approves each call and that comment is the first thing they read. If the script does
  more than one thing, add short `//` comments per step.
- **Prefer small focused calls over one large batch.** Each call surfaces its one-line
  description in chat, so a small snippet reviews faster than a 100-line omnibus.
  Approval frequency is under the user's control (`implant.requireConfirmation`);
  `@implant` offers a Run follow-up and native tool calls use VS Code confirmation.
  Don't compress five concerns into one script just to reduce
  prompts, that's optimising for the wrong thing.
- **Never write sync busy loops** — no `while (true) {}`, no deep sync recursion, no
  big synchronous computation. The extension host is single-threaded; sync work freezes
  VS Code with no cancel path. Everything expensive must be `async`; long-running async
  is fine (the user gets a Cancel notification after 10s). Cancellation rejects the
  caller-side promise with "User terminated the script" but does **not** kill the
  in-flight snippet — a pending `applyEdit` still commits, later iterations of a loop
  still run. Design multi-step edits so a partial run is safe (single `WorkspaceEdit`
  with everything is atomic; a sequence of separate `applyEdit` calls is not).
- **Apply edits, don't force save.** Apply changes via `WorkspaceEdit` and stop there —
  the user decides when to persist (VS Code's autosave typically handles it). Calling
  `workspace.saveAll()` or `doc.save()` can deadlock indefinitely on other extensions'
  `onWillSaveTextDocument` handlers, and semantically overrides the user's own
  preference about when writes actually hit disk. Leaving a buffer dirty is normal and
  correct.
- **`openTextDocument(uri)` needs no cleanup.** Loading documents is safe: VS Code
  garbage-collects docs once your snippet returns and nothing references them, and
  language servers stop tracking them via the same lifecycle. Iterate across many files
  freely — there's no `closeTextDocument` and none is needed.
- **Do all shaping, filtering, aggregating inside the snippet.** You already have
  `map`/`filter`/`Object.groupBy`/`JSON.stringify`. Don't return raw `vscode.*` objects
  intending to reshape them with `jq`, `python`, or `awk` — adds an extra language, an
  extra parse step, and hides the real logic from the reviewer. Returning raw provider
  output also risks silent truncation: the serializer caps arrays at 500 entries and
  strings at 20 000 chars and appends an `…[+N more]` marker. Aggregate before
  returning so the cap never bites you.
### Warming up lazy providers

VS Code and its extensions load lazily. If a snippet fails with "command not found" or
hangs on an `executeXxxProvider` call, the responsible piece isn't loaded yet. Warm it
up before reporting failure.

**Language services — the easy path.** Use the `activateLanguage(langId, timeoutMs?)`
global. It kicks the `onLanguage:<id>` activation event on every extension that
registers for the language and polls `executeDocumentSymbolProvider` until it returns
something other than `undefined`. On a cold workspace this can take tens of seconds
(notably for `typescript-language-features` and `rust-analyzer`); on a warm one it's a
no-op:

```js
if (!(await activateLanguage("python"))) {
  return { error: "no Python language provider became ready in time" };
}
```

1. **Open a document.** Opening can trigger language extensions. For explicit control,
   open the target document first:

   ```js
   const uri = vscode.Uri.file("/abs/path/to/file");
   const doc = await vscode.workspace.openTextDocument(uri);
   ```

2. **Wait for the extension to activate.** If you know which extension owns the
   language, await its `activate()` — this *does* block until activation completes:

    ```js
   const ext = vscode.extensions.getExtension("vscode.typescript-language-features");
   if (ext && !ext.isActive) await ext.activate();
   ```

3. **Poll the semantic query.** After activation, the language server still needs time
   to build its symbol index. Retry until the provider stops returning `undefined`:

   ```js
   let symbols;
   for (let attempt = 0; attempt < 40; attempt++) {
     symbols = await vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", doc.uri);
     if (symbols !== undefined) break; // undefined = not warm; [] is a valid answer for empty files
     await new Promise(r => setTimeout(r, 500));
   }
   if (symbols === undefined) return { error: "no document-symbol provider registered for this language" };
   return symbols;
   ```

For a **batch** of semantic queries across many files, warm up once against the first
file — subsequent calls hit a warm provider and return in milliseconds.

**Third-party extension commands.** Extensions activate on specific events (opening a
file of a certain language, running one of their commands, etc.). Until then, the
commands they register aren't in `vscode.commands`:

```js
// Ensure an extension is active, then invoke one of its commands.
const ext = vscode.extensions.getExtension("eamodio.gitlens");
if (!ext) return { error: "gitlens is not installed" };
if (!ext.isActive) await ext.activate();
return await vscode.commands.executeCommand("gitlens.showQuickCommitDetails");
```

**Workspace symbol search.** `executeWorkspaceSymbolProvider("")` returns nothing on
many providers — pass a non-empty prefix.

**Rule of thumb.** Warm up → retry with backoff → if it still fails, no extension
registered a provider for that capability, or one that did is genuinely broken. Report
the failure and stop.

### Editing documents

`vscode.WorkspaceEdit` is the primary building block for multi-file, multi-change edits.
It gives you undo-as-one, cross-file atomicity, and safe file operations (create /
delete / rename) alongside text edits.

**Text edits in a single document:**

```js
const uri = vscode.Uri.file("/abs/path/file.ts");
const edit = new vscode.WorkspaceEdit();
edit.replace(uri, new vscode.Range(10, 0, 10, 20), "newText");
edit.insert(uri, new vscode.Position(0, 0), "// header comment\n");
const ok = await vscode.workspace.applyEdit(edit);
return { ok };
```

**Text edits across many documents:** add `edit.replace(uri, ...)` calls for as many
URIs as you like — a single `applyEdit` applies them all atomically (all or nothing) and
one undo step reverts everything.

**File operations:**

```js
const edit = new vscode.WorkspaceEdit();
edit.createFile(vscode.Uri.file("/abs/path/new.ts"), { overwrite: false, ignoreIfExists: true });
edit.deleteFile(vscode.Uri.file("/abs/path/old.ts"), { recursive: false, ignoreIfNotExists: true });
edit.renameFile(vscode.Uri.file("/abs/path/from.ts"), vscode.Uri.file("/abs/path/to.ts"), { overwrite: false, ignoreIfExists: true });
await vscode.workspace.applyEdit(edit);
```

Options: `overwrite: true` (allow replacing an existing file), `ignoreIfExists: true`
(no-op instead of failing when the target already exists), `ignoreIfNotExists: true`
(no-op instead of failing when the source is missing), `recursive: true` (delete only —
descend into directories). `createFile` and `deleteFile` write to disk directly on
`applyEdit` and go through the same undo stack — no save step needed.

**Text edits leave buffers dirty; that's fine.** `applyEdit` writes to open documents in
memory, so touched files show as dirty tabs until VS Code's autosave (or the user's
Cmd+S) persists them. Do not call `saveAll()` or `doc.save()` to force the write — save
handlers registered by other extensions can deadlock the call indefinitely, and forcing
a save overrides the user's own preference about when writes hit disk. Return your
Markdown summary and let the user's autosave settings do the rest.

**Combining with language-server output.** `executeDocumentRenameProvider` and
`executeCodeActionProvider` return `WorkspaceEdit` values you can hand straight to
`applyEdit`. See `examples/rename-symbol.js` and `examples/get-code-actions.js`.

**Preview before applying.** For a dry-run — "what would this rename touch, without
changing anything" — run the provider that produces the edit, then read `edit.entries()`
(returns `[Uri, TextEdit[]][]`) to inspect files and per-file text changes without
calling `applyEdit`.

## Output shape

**Return a Markdown string** when a human reads it (chat surface, agent reply). Use
headings, bullet lists, code fences, and clickable file:line links
(`[src/foo.ts:42](vscode://file//abs/path/src/foo.ts?42)`).

**Return plain JSON** (object / array / number / string) only when another program will
parse the result.

**Return a Mermaid fenced block** (`` ```mermaid ... ``` ``) for dependency graphs,
call graphs, class hierarchies, flowcharts, sequence diagrams, state machines, git-style
branch graphs. Chat surfaces and Markdown previewers render Mermaid natively.

## References

Load references on demand via the `load_implant_reference` tool. Path is relative to
`references/`. Prose docs (`.md`) are addressed by basename with the extension
stripped — `topics/ast-grep`, `vscode-docs-commands`. Runnable snippets under
`examples/` keep their `.js` extension and are named for the action they perform,
not the underlying VS Code command — `examples/find-references.js`,
`examples/get-document-symbols.js`, `examples/rename-symbol.js`,
`examples/render-dep-graph.js`. Do not preload; do not request the same path twice.

### `topics/` — cross-cutting concerns

- `topics/ast-grep` — structural search and rewrite with the bundled `@ast-grep/napi`.
- `topics/mermaid` — returning diagrams in chat surfaces.

(Warmup and document-editing patterns are covered directly under **Critical rules**
above — they're too load-bearing to hide behind a `load_implant_reference` call.)

### `vscode-docs-commands` — Microsoft's own commands reference

Redistributed verbatim under CC BY 3.0 US. Broader in scope than what we cover under
`examples/` (includes editor commands, notebook commands, workbench commands) but with
terser per-command detail. Load when you need to look up something not covered by our
per-command examples.

### `ast-grep-api-types` — full `@ast-grep/napi` declarations

Every `.d.ts` file from `@ast-grep/napi` concatenated with section dividers — the
authoritative type reference for the `astGrep` global. ~20 KB / ~600 lines,
redistributed under MIT. Load when you need the exact shape of an ast-grep type or
method (`SgNode`, `SgRoot`, `Rule`, `NapiConfig`, per-language `Lang.*` shortcuts, …)
beyond what `topics/ast-grep` covers.

### `vscode-api-types` — full `@types/vscode` declarations *(725 KB — load with care)*

The complete TypeScript declaration file for the `vscode.*` API (`index.d.ts` from
`@types/vscode`, redistributed under MIT). Authoritative: every type, every method,
every property, with JSDoc. **Very large — around 150K tokens.** Load only when you
need to look up a specific signature or type shape that neither our per-command
examples nor `vscode-docs-commands` cover. Prefer probing (`return typeof x` /
`return Object.keys(x)`) for cheap questions.

### `examples/` — runnable JS snippets

Every file under `examples/` is a **valid, runnable JS snippet** you can hand
directly to the language-model tool (or adapt for an `@implant` request after editing
the handful of `const` placeholders at the top). Each starts with a one-line
comment stating what it does — that's the same summary the user sees in the
approval prompt. Files are **named for the action they perform**, not the
underlying VS Code command they call — `find-references.js`,
`get-document-symbols.js`, `rename-symbol.js` — so the model can pick a snippet
from the intent alone. The `.js` extension is part of the reference identifier:
load `examples/find-references.js`, not `examples/find-references`.

**Output shape.** Almost every example returns a **Markdown string** with
headings, bullets, and `vscode://file/…?<line>` links (see **Output shape** above
— Markdown is the default because a human is usually reading). Three exceptions
return JSON because their output is genuinely structured data another program is
expected to consume — `count-diagnostics.js` (per-file severity counts),
`get-document-colors.js` (raw RGBA), and `get-semantic-tokens.js` (decoded token
stream + legend). When adapting an example for a data-only caller, switch its
return to plain values — the shape is easy to swap.

Load one only when its shape matches the current task; don't preload the whole
catalog. The directory covers:

- **Navigation:** `find-references.js`, `go-to-definition.js`,
  `go-to-declaration.js`, `go-to-type-definition.js`, `find-implementations.js`.
- **Inspection at a position:** `get-hover.js`, `get-signature-help.js`,
  `get-completions.js`, `get-inlay-hints.js`, `get-inline-values.js`,
  `get-selection-ranges.js`, `check-rename.js`.
- **Symbol enumeration:** `get-document-symbols.js`,
  `find-workspace-symbols.js`, `find-references-by-symbol-name.js`,
  `get-document-highlights.js`.
- **Editing:** `rename-symbol.js`, `format-document.js`, `format-range.js`,
  `simulate-format-on-type.js`, `get-code-actions.js`, `delete-file.js`.
- **Diagnostics:** `list-workspace-diagnostics.js` (Markdown),
  `count-diagnostics.js` (JSON aggregate).
- **Structural / visualization:** `find-throw-error-calls.js` (ast-grep),
  `render-dep-graph.js` (Mermaid), `get-incoming-calls.js`,
  `get-type-hierarchy.js`, `get-semantic-tokens.js`, `get-document-colors.js`,
  `get-color-presentations.js`.
- **Document surface reads:** `get-code-lenses.js`, `get-folding-ranges.js`,
  `get-document-links.js`.
- **Extensibility:** `invoke-extension-command.js`.

Full VS Code API reference: <https://code.visualstudio.com/api/references/vscode-api>.
