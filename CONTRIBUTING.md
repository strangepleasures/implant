# Contributing to Implant

This document is for developers hacking on the extension itself. If you just
want to use Implant, see [README.md](./README.md).

## Layout

```
src/
  extension.ts          entry point; wires up the participant and the tool.
  run-script-tool.ts    registers the "Run VS Code Script" language-model tool
                        and its confirmation prompt.
  script-runner.ts      applies timeout config and cancellation to a run.
  slow-script-watch.ts  cancellable notification for long-running scripts.
  executor.ts           vm.Script sandbox with vscode/astGrep/console/require
                        injected.
  dynamic-languages.ts  registers Python/Go/Rust/Java/C/C++ ast-grep languages.
  sandbox-console.ts    console object that captures logs for the result.
  sandbox-helpers.ts    language activation helper used during warm-up.
  script-timeout.ts     timeout/abort wrapper for async scripts.
  exec-result.ts        ExecResult type.
  log-entry.ts          LogEntry type.
  serialize.ts          turns vscode.* types into capped plain JSON.
  code-fence.ts         strips markdown fences from model output.
  model-picker.ts       chooses the language model for a request.
  prompt-assets.ts      loads PROMPT.md + references from assets/references/.
  api-source.ts         ApiSource type.
  api-declaration.ts    ApiDeclaration type.
  api-sources.ts        registry of API sources (api-sources.json).
  declaration-parser.ts extracts exported declarations from .d.ts ASTs.
  declaration-index.ts  builds and caches declarations per API source.
  api-lookup.ts         list/get lookup used by the chat tools.
  chat-participant.ts   @implant participant: prompt -> script -> run -> render.
  chat-prompts.ts       system prompt and few-shot example.
  chat-tools.ts         tool definitions offered to the model.
  chat-tool-handler.ts  executes the model's tool calls.
  chat-lm-loop.ts       tool-call loop until the final script arrives.
  chat-history.ts       builds the message list from chat history.
  chat-render.ts        runs a script via the tool and renders the outcome.
  chat-retry.ts         one regeneration attempt after a failed script.

assets/
  references/           PROMPT.md plus runnable snippets, topical guidance, and
                        bundled API declarations; references load on demand via
                        load_implant_reference.
  icon.png              extension icon.

scripts/
  package.mjs           builds one universal .vsix that carries every
                        @ast-grep/napi platform binary. `npm run package`.
  refresh-types.mjs     copies registered API declaration sources into assets/
                        references/ using api-sources.json.

docs/
  images/
    screenshot.png      marketplace / repo hero image, referenced by README's
                        absolute URL. Excluded from the .vsix via .vscodeignore.

LICENSE                 MIT.
```

## Build

```bash
npm install
npm run compile           # tsc -> out/
npm test                  # compile and run unit tests
# F5 in VS Code to launch an Extension Development Host
```

### Example integration tests

`npm run test:examples` runs each example with a matching file in
`test/expected/` in its own VS Code extension host and a fresh copy of the
Python fixture. It compares Markdown exactly (apart from surrounding whitespace)
and JSON structurally, replacing the temporary fixture path with `{{PROJECT}}`.
Examples without expected output are reported as skipped. Run a subset with
`npm run test:examples -- get-hover`.

The suite requires the `code` command, a graphical display, and VS Code's
Python, Pylance, and Black Formatter extensions. The checked-in expectations
were verified with VS Code 1.142.0, Python 2026.10.0, Pylance 2026.4.1,
and Black Formatter 2026.6.0 (bundled Black 26.1.0).
It uses the installed extension directory by default. Set `VSCODE_BIN` to
another VS Code executable or `IMPLANT_TEST_EXTENSIONS_DIR` to an isolated extension directory. Provider
versions and configuration affect results; test failures include the actual
and expected values. The test never rewrites expected files. The dependency
graph example emits edges in workspace search order, so its exact-output test
may fail when the same edges are returned in a different order.

## Package a .vsix

For local install (uses whatever `@ast-grep/napi` binary `npm install` fetched for your
current OS/arch):

```bash
npx @vscode/vsce package
code --install-extension implant-<version>.vsix --force
```

### Publishing to the marketplace

`@ast-grep/napi` ships one ~7 MB native binary per platform. A plain `vsce package`
from the working tree only picks up the host platform's binary, so the resulting vsix
wouldn't run for anyone else. To ship one universal vsix that works everywhere:

```bash
npm run package
```

`scripts/package.mjs` compiles once, force-installs every `@ast-grep/napi-<platform>`
sub-package via `npm install --no-save --os=X --cpu=Y --libc=Z`, packages a single
`implant-<version>.vsix`, then restores the host-native `@ast-grep` install so the
working tree is ready for local dev again. The universal vsix is ~15–20 MB — bigger
than a per-platform build, but publishing is a single command:

```bash
npx @vscode/vsce publish --packagePath implant-<version>.vsix
```

Platforms bundled: `darwin-arm64`, `darwin-x64`, `linux-{arm64,x64}-{gnu,musl}`,
`win32-{arm64,x64}-msvc`. 32-bit Windows is intentionally excluded — VS Code dropped
`ia32` support in 1.35 (2019).

## How the pieces fit together

**Agent request → VS Code language-model tool or `@implant` participant → approval → executor → result.**

1. `chat-participant.ts` (with the `chat-*.ts` modules) handles `@implant` requests, asks the selected model for
  a JavaScript snippet, and loads skill references on demand. It executes the
  snippet by invoking the registered language-model tool with the request's chat
  token, so native confirmation and output stay in the same conversation.
2. `extension.ts` registers `implant_run_vscode_script` with
  `vscode.lm.registerTool`. Its `prepareInvocation` displays VS Code's native
  confirmation with the requested code. `invoke` calls the same `runScript`
  pipeline, forwarding the language-model tool cancellation token and optional
  timeout.
3. `script-runner.ts::runScript` invokes `executor.ts::execute`, which compiles the snippet with
  `vm.Script`, injects `vscode` / `console` / `require` and other globals, and
  applies cancellation and the configured hard timeout. `serialize.ts`
  normalizes the returned value. Slow scripts get a cancellable progress
  notification after ten seconds.

## Agent prompt and references

The prompt and reference payload live under `assets/references/`. `PROMPT.md`
is loaded as the `@implant` system prompt; the same directory contains runnable
examples, topical guidance, and bundled API declarations loaded on demand via
`load_implant_reference`. Rebuild the extension to ship updated assets in the
VSIX.

## Things worth knowing before changing behavior

- **The `vscode` module resolver is per-extension.** `require('vscode')` from
  files outside the extension's own directory tree may not resolve. If you need
  to load code from a workspace path, use `vm.runInThisContext` with a wrapper
  that injects `vscode` as a parameter (see the git history for the removed
  startup-scripts feature).
- **The TypeScript / JavaScript language server lazy-loads files.**
  `executeDocumentSymbolProvider` on an unopened file may hang.
  `executeWorkspaceSymbolProvider('')` returns nothing on many providers.
  Prefer opening the doc first, or pass a non-empty query.
- **Sync busy loops freeze the extension host, unrecoverably by default.**
  `implant.timeoutMs` defaults to `0` — no `vm.Script` timeout is set — so a
  snippet like `while (true) {}` blocks the event loop forever. The 10-second
  slow-script notification can't fire either (event loop is blocked). Users who
  care about a hard cap set `implant.timeoutMs` to a positive number; V8's
  watchdog thread will kill the script after that many ms. Review code in the
  chat confirmation before running it.

## Filing changes

Small changes: PR with a clear description of user-visible behavior change.
Larger changes: sketch the design in an issue first so we can align on the
tradeoffs before you spend time on it.
