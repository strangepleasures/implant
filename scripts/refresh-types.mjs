#!/usr/bin/env node
// Regenerate the bundled type-declaration references from the currently installed
// `@types/vscode` and `@ast-grep/napi` packages. Each reference is a wrapped copy of
// the upstream .d.ts material with an attribution comment on top and a fenced
// `typescript` block around the payload, so the .md walker in agent-instructions.ts
// picks it up as a reference and the LM sees it as a code block.
//
// Chained into `npm run compile` so both references stay in sync with their deps.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const VSCODE_TYPES_SRC = 'node_modules/@types/vscode/index.d.ts';
const VSCODE_TYPES_DEST = 'assets/skills/implant/references/vscode-api-types.md';

const AST_GREP_ROOT = 'node_modules/@ast-grep/napi';
const AST_GREP_DEST = 'assets/skills/implant/references/ast-grep-api-types.md';

function bundle(dest, header, sections) {
	const body = sections
		.map(s => (s.title ? `// ─── ${s.title} ───\n\n${s.contents.trimEnd()}` : s.contents.trimEnd()))
		.join('\n\n');
	writeFileSync(dest, header + '\n```typescript\n' + body + '\n```\n');
	console.log(`Wrote ${dest} (${(body.length / 1024).toFixed(1)} KB)`);
}

// --- @types/vscode ---
bundle(
	VSCODE_TYPES_DEST,
	`<!--
  The body below is the type-declaration file \`index.d.ts\` from \`@types/vscode\`,
  bundled at build time by \`scripts/refresh-types.mjs\`. It is the authoritative
  TypeScript definition of the \`vscode.*\` API surface and is significantly larger than
  any other reference (~725 KB / ~20 000 lines). Load it only when you need to look up
  a specific type / method / property signature that isn't covered by our per-command
  examples or the vscode-docs-commands reference.

  Copyright (c) Microsoft Corporation. Licensed under the MIT License.
  Original: https://www.npmjs.com/package/@types/vscode

  This attribution notice is NOT part of the upstream document.
-->
`,
	[{ contents: readFileSync(VSCODE_TYPES_SRC, 'utf8') }],
);

// --- @ast-grep/napi ---
// The `lang/*.d.ts` files are excluded on purpose — they contain per-language
// tree-sitter node-kind enumerations (~310 KB total, thousands of grammar-specific
// names) that agents don't need for pattern matching. Pattern strings are parsed as
// example code; if a rule genuinely needs `.kind("if_statement")`, the small handful
// of names involved can be looked up in the ast-grep playground.
// `index.d.ts` is skipped — it's just re-exports from `types/*.d.ts`, which we
// include in full below. Bundling it too would just add noise.
const astGrepSections = readdirSync(join(AST_GREP_ROOT, 'types'))
	.filter(f => f.endsWith('.d.ts'))
	.sort()
	.map(f => ({
		title: `types/${f}`,
		contents: readFileSync(join(AST_GREP_ROOT, 'types', f), 'utf8'),
	}));

bundle(
	AST_GREP_DEST,
	`<!--
  The body below concatenates every \`types/*.d.ts\` file from \`@ast-grep/napi\` — the
  library bundled into Implant as the \`astGrep\` global. Each file is preceded by a
  \`// ─── types/name.d.ts ───\` divider so you can navigate. \`index.d.ts\` is skipped
  because it just re-exports from the files below.

  Per-language tree-sitter node-kind enumerations (\`lang/*.d.ts\`) are also excluded —
  they're ~310 KB of grammar-specific names agents don't typically need for pattern
  matching. Look them up in the ast-grep playground if a rule requires a specific node
  kind.

  Load this reference when you need the exact signature or shape of an ast-grep type or
  method (\`SgNode\`, \`SgRoot\`, \`Rule\`, \`NapiConfig\`, \`Edit\`, \`Pos\`, \`Range\`, …)
  that isn't spelled out in \`topics/ast-grep\` or the ast-grep-related examples.

  Copyright (c) 2020 N-API for Rust. Licensed under the MIT License.
  Original: https://www.npmjs.com/package/@ast-grep/napi

  This attribution notice is NOT part of the upstream document.
-->
`,
	astGrepSections,
);
