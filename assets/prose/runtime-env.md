The snippet is executed inside the VS Code extension host, wrapped like this:

```js
(async function __implant__() {
  <YOUR CODE HERE>
})()
```

Write ONLY the body. Use `return` to send the answer back.

❌ Wrong — defines a function that never runs, returns nothing:

```js
async function findRefs() {
  const ed = vscode.window.activeTextEditor;
  return await vscode.commands.executeCommand("vscode.executeReferenceProvider", ed.document.uri, ed.selection.active);
}
```

✅ Right — statements at top level, uses `return`:

```js
// Find all references to the symbol under the cursor.
const ed = vscode.window.activeTextEditor;
return await vscode.commands.executeCommand("vscode.executeReferenceProvider", ed.document.uri, ed.selection.active);
```

The following are in scope: `vscode`, `console`, `require`, `Buffer`, `process`, `setTimeout`,
`clearTimeout`, `setInterval`, `clearInterval`, `queueMicrotask`, `URL`, `URLSearchParams`,
`TextEncoder`, `TextDecoder`.

Use `return` to send a value back. The value is serialized as JSON with these tweaks:
VS Code types (`Uri`, `Range`, `Position`, `Location`, `Selection`) are unwrapped into
plain objects; arrays are capped at 500 entries; strings at 20 000 characters. If you
expect a large result, do the filtering / aggregation *inside* the snippet and return only
what you actually need.

**Output shape — Markdown by default, JSON only when a program will parse it.**

- If the result will be shown to a human (user asked in chat, or you as the agent will
  paste it into a reply): return a **Markdown string**. Use headings, bullet lists, code
  fences for code, and `[label](vscode://file//abs/path?line)` links for clickable file
  references. VS Code and most chat surfaces render this beautifully.
- If the result will be consumed by another program (another agent, a follow-up snippet):
  return **plain JSON** — object / array / number / string. The MCP envelope preserves the
  shape; the caller can `JSON.parse` cleanly.
- When in doubt, prefer Markdown — it reads well raw and renders when displayed.
- Ask the caller explicitly what form they want if it matters.
- **For diagrams — dependency graphs, call graphs, class hierarchies, flowcharts,
  sequence diagrams, state machines, git-style branch graphs — return a Mermaid
  fenced block** (```` ```mermaid ... ``` ````). VS Code's Markdown preview, Copilot
  Chat, and GitHub-flavored Markdown all render Mermaid natively; no image
  generation, no attachments, no extra dependency. Do the graph-building (nodes,
  edges, layout hints) inside the snippet and emit the final Mermaid source.

`console.log/warn/error` output is captured and returned alongside the value, so it's safe
to use for debug output without contaminating the return value.

Every call opens an approval webview in the user's VS Code — they see the exact script and
click Run / Trust / Deny before it executes. Optimize the snippet for that human review:

- **Always begin the snippet with a one-line `//` comment describing intent** — what the
  script is going to do and, if not obvious, why. Users approve based on that comment as
  much as by reading the code.
- If the snippet does more than one thing, add a short `//` comment above each step.
- Keep it as short as it can be while still doing the job. If a script is getting long,
  split it into multiple calls so each approval is a small, self-contained ask.
- Prefer named intermediate variables over deeply nested one-liners; a reviewer scans
  faster.
- **Do all shaping, filtering, formatting and aggregation inside the snippet — not in a
  follow-up shell command.** The extension host is a full JS runtime; you already have
  `map`/`filter`/`Object.groupBy`/`JSON.stringify`/template strings. Returning raw
  `vscode.*` objects and then reshaping them with `jq`, `python`, or `awk` adds an
  extra language, an extra parse step, and an extra chance for the pipeline to break —
  and hides the real logic from the reviewer. Return the final shape you want to consume.
- **Never write long-running blocking (synchronous) work.** The VS Code extension host is
  single-threaded — a sync `while` loop, a big synchronous computation, or a deep sync
  recursion freezes VS Code entirely for the user with no way to cancel. Everything
  expensive must be async: use real `await`s on `vscode.*` calls, and if you must iterate
  over many items yourself, break the work up with `await new Promise(r => setImmediate(r))`
  between chunks. Long-running *async* scripts are fine — the user gets a Cancel
  notification after 10 seconds.

Example of a snippet the user can approve at a glance:

```js
// Find all references to the symbol under the active cursor.
const ed = vscode.window.activeTextEditor;
return await vscode.commands.executeCommand(
  "vscode.executeReferenceProvider",
  ed.document.uri,
  ed.selection.active,
);
```
