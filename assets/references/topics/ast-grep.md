# ast-grep

`@ast-grep/napi` is bundled with Implant and injected into every snippet as the global
`astGrep`. No `require` needed.

Reach for it when the question is *structural* in a way whatever language servers are
installed in this workspace can't answer directly and regex can't answer safely:

- **Find every place matching a code shape** — `throw new Error($MSG)`, `if ($C) { $$$ }`,
  `console.log($$$A)`, arrow callbacks with no parameters, etc. Patterns match AST nodes,
  not text, so string literals and comments containing the same characters don't cause
  false hits.
- **Extract sub-parts of a match** via meta-variables (`$NAME` matches one node, `$$$ARGS`
  matches any run of siblings). Regex captures can't span balanced parens/braces; ast-grep
  captures can.
- **Apply the same rewrite pattern across many files** without breaking scope or formatting.

## Reach for the language services FIRST

ast-grep works at the *syntactic* level and doesn't know about types, scope, or imports.
For anything semantic — references, definitions, rename, hover, diagnostics — call the
VS Code language-service commands first (see `examples/`). ast-grep is the right tool
when the question is "find every syntactic occurrence of shape X" or "rewrite shape X
to shape Y", and it works uniformly across every language it supports.

## Basic API

```js
const { parse, Lang } = astGrep;
const root = parse(Lang.TypeScript, source).root();

// Find matches for a pattern with meta-variables.
for (const node of root.findAll("throw new Error($MSG)")) {
  const { start } = node.range();          // { line, column, index } — 0-indexed
  const msg = node.getMatch("MSG")?.text(); // captured argument as source
  const src = node.text();                 // the full matched source
  // ...
}
```

## Supported languages

The `@ast-grep/napi` binding has a fixed set of **built-in languages**: `Lang.Html`,
`Lang.JavaScript`, `Lang.Tsx`, `Lang.Css`, `Lang.TypeScript`. Anything else needs a
dynamic-language registration (`registerDynamicLanguage`) plus a matching prebuilt
parser.

Implant bundles six additional languages and registers them at extension activation
so they Just Work from any snippet:

- **`"Python"`** — `parse("Python", src)`
- **`"Go"`** — `parse("Go", src)`
- **`"Rust"`** — `parse("Rust", src)`
- **`"Java"`** — `parse("Java", src)`
- **`"C"`** — `parse("C", src)` — use for `.c`/`.h` files.
- **`"Cpp"`** — `parse("Cpp", src)` — use for `.cpp`/`.cc`/`.hpp` files. C++ is close
  enough to C to *usually* parse C, but they're separate grammars with distinct
  keyword sets and declaration semantics — for accurate `.c` file queries, use `"C"`.

Note: on Linux musl (Alpine) and Windows arm64, the extra-language prebuilds aren't
shipped by the upstream `@ast-grep/lang-*` packages. On those platforms `parse("Python", …)`
et al. will throw "unsupported language" — only the five built-ins work.

For other languages, users would normally install `@ast-grep/lang-<name>` into their
workspace and register via `astGrep.registerDynamicLanguage({...})` in a snippet — but
that call only succeeds once per process, and Implant already used it at activation, so
this path is not currently reachable from a snippet.

**Known limitation, not intended behavior** — adding a workspace-driven registration
hook (e.g., a setting listing extra languages to register at activation before user
snippets run) is a reasonable feature request. Ask the extension maintainer to add the
language if it's important.

## Full API reference

Use `list_api_declarations` with `api: "ast-grep"` to discover exported declarations,
then `get_api_declaration` with the exact declaration name to retrieve its original
`.d.ts` source. The upstream guide is at <https://ast-grep.github.io/guide/api-usage/js-api>.
