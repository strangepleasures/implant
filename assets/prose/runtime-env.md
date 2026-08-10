The snippet is executed as the body of an `async` function inside the extension host.
The following are in scope: `vscode`, `console`, `require`, `Buffer`, `process`, `setTimeout`,
`clearTimeout`, `setInterval`, `clearInterval`, `queueMicrotask`, `URL`, `URLSearchParams`,
`TextEncoder`, `TextDecoder`.

Use `return` to send a value back. The value is serialized as JSON with these tweaks:
VS Code types (`Uri`, `Range`, `Position`, `Location`, `Selection`) are unwrapped into
plain objects; arrays are capped at 500 entries; strings at 20 000 characters. If you
expect a large result, do the filtering / aggregation *inside* the snippet and return only
what you actually need.

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
