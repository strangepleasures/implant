# Contributing to Implant

This document is for developers hacking on the extension itself. If you just
want to use Implant, see [README.md](./README.md).

## Layout

```
src/
  extension.ts          chat and language-model tool registration, execution
                        approval, cancellation, timeout, and slow-script watch.
  executor.ts           vm.Script sandbox with vscode/astGrep/activateLanguage/
                        console/require injected, AbortSignal cancellation,
                        optional hard timeout. Registers dynamic ast-grep
                        languages (Python/Go/Rust/Java/C/C++) at module load.
  sandbox-helpers.ts    activateLanguage(langId, timeoutMs?) — kicks
                        onLanguage:<id> activation events and polls
                        executeDocumentSymbolProvider until it responds. Exposed
                        as a sandbox global.
  serialize.ts          walker that turns vscode.* types (Uri, Range, Position,
                        Location, Selection) into plain JSON, with cycle/depth/
                        array/string caps.
  agent-instructions.ts loads the SKILL.md + references/ subtree from
                        assets/skills/implant/ at module load for chat prompts.
  chat-participant.ts   @implant Copilot Chat participant. Feeds SKILL.md as the
                        system prompt, loads references on demand, and executes
                        the returned snippet through the shared executor.

assets/
  skills/implant/       prompt and reference payload for @implant; references/
                        holds runnable snippets and topical API guidance loaded
                        on demand via load_implant_reference.
  icon.png              extension icon.

scripts/
  package.mjs           builds one universal .vsix that carries every
                        @ast-grep/napi platform binary. `npm run package`.
  refresh-types.mjs     copies registered API declaration sources into references/
                        from the shared api-sources.json registry.

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
npm test                  # compile smoke check
# F5 in VS Code to launch an Extension Development Host
```

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

1. `chat-participant.ts` handles `@implant` requests, asks the selected model for
  a JavaScript snippet, and loads skill references on demand. It executes the
  snippet by invoking the registered language-model tool with the request's chat
  token, so native confirmation and output stay in the same conversation.
2. `extension.ts` registers `implant_run_vscode_script` with
  `vscode.lm.registerTool`. Its `prepareInvocation` displays VS Code's native
  confirmation with the requested code. `invoke` calls the same `runScript`
  pipeline, forwarding the language-model tool cancellation token and optional
  timeout.
3. `runScript` invokes `executor.ts::execute`, which compiles the snippet with
  `vm.Script`, injects `vscode` / `console` / `require` and other globals, and
  applies cancellation and the configured hard timeout. `serialize.ts`
  normalizes the returned value. Slow scripts get a cancellable progress
  notification after ten seconds.

## Agent prompt and references

The prompt and reference payload live under `assets/skills/implant/`. `SKILL.md`
is loaded as the `@implant` system prompt; `references/` contains runnable
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
