import * as fs from 'fs';
import * as path from 'path';

const proseDir = path.join(__dirname, '..', 'assets', 'prose');
const read = (name: string) => fs.readFileSync(path.join(proseDir, name), 'utf8').trimEnd();

export const OVERVIEW = read('overview.md');
export const RUNTIME_ENV = read('runtime-env.md');
export const HOW_TO_CALL = read('how-to-call.md');
export const EXAMPLES = read('examples.md');
export const WARMUP = read('warmup.md');
export const CAVEATS = read('caveats.md');

/**
 * Description for the `run_vscode_script` MCP tool. Consumed by MCP clients
 * that are already connected to the server, so the "how to reach the server"
 * section (`.mcp.json` / `call.js`) is omitted.
 */
export function mcpToolDescription(): string {
	return join(OVERVIEW, RUNTIME_ENV, EXAMPLES, WARMUP, CAVEATS);
}

export function skillMarkdown(): string {
	return `---
description: Execute JavaScript inside the running VS Code extension host to invoke language-server commands (Find References, Rename, Hover, executeXxxProvider), read live diagnostics, run any VS Code palette command, or call third-party extension commands. Trigger when the user asks for cross-file references, real language-server info, live workspace state, or invoking editor / extension functionality — instead of shelling out to grep, find, or ad-hoc regex.
---

<!--
  Managed by the Implant VS Code extension.
  Regenerate via the "Implant: Install into Workspace" palette command.
-->

${join(OVERVIEW, HOW_TO_CALL, RUNTIME_ENV, EXAMPLES, WARMUP, CAVEATS)}
`;
}

export function cursorRules(): string {
	return `---
description: Use the Implant helper to call vscode.* APIs (Find References, executeXxxProvider, palette commands, diagnostics) instead of shelling out to grep for language-server questions.
alwaysApply: false
---

<!--
  Managed by the Implant VS Code extension.
  Regenerate via the "Implant: Install into Workspace" palette command.
-->

${join(OVERVIEW, HOW_TO_CALL, RUNTIME_ENV, EXAMPLES, WARMUP, CAVEATS)}
`;
}

/**
 * Section inserted into `.github/copilot-instructions.md` — Copilot Chat's
 * per-repo custom-instructions file. Wrapped in fenced markers so subsequent
 * runs of "Install into Workspace" can replace the section without touching
 * anything else the user has in the file.
 */
export const COPILOT_MARK_START = '<!-- BEGIN Implant -->';
export const COPILOT_MARK_END = '<!-- END Implant -->';

export function copilotInstructions(): string {
	return `${COPILOT_MARK_START}
## Implant

This workspace has the **Implant** VS Code extension installed. Implant exposes a chat
participant, \`@implant\`, that runs a JavaScript snippet inside the VS Code extension host
and streams the result back into chat. Through it the user gets access to:

- Language-server commands: Find References, Go-to-Definition, Rename, Hover, Code Actions —
  via \`vscode.executeXxxProvider\` calls, cross-file and semantics-aware.
- Live workspace diagnostics, symbol outlines, editor and tab state.
- Any command a third-party extension registers.
- Both queries **and modifications** (structural rename, quick-fixes, \`WorkspaceEdit\`
  file operations, formatter output) — going through the language server, not sed/awk on
  files, so scope and imports are respected.

**You cannot invoke \`@implant\` on the user's behalf** — it's a peer chat participant, not
a tool you can call from GitHub Copilot Chat. When the user asks a question best answered
by running code inside VS Code, **suggest they try \`@implant <their question>\`** and give
them the exact prompt.

Reach for it especially when the user wants:

- Cross-cutting queries that would take multiple manual clicks (aggregate diagnostics per
  file, top-N most-referenced symbols, dead-code candidates via zero-reference exports).
- Answers formatted in a custom way (Markdown table, ASCII chart, GitHub-ready bug report).
- Refactor dry-runs before applying (rename preview, code-action list).
- Anything that combines multiple \`vscode.*\` APIs into a single answer.

Example prompts to suggest:

- \`@implant which exported symbols in src/ have zero references?\`
- \`@implant sort my open tabs by diagnostic count so I know which file to fix first.\`
- \`@implant list every TODO / FIXME / HACK comment grouped by tag, with clickable file:line links.\`
- \`@implant draw an ASCII bar chart of source files by line count.\`
- \`@implant give me a bug-report snapshot as GitHub-ready Markdown.\`

Deeper documentation and the full \`vscode.*\` API surface: the user can run
**Implant: Copy Agent Instructions** from the command palette.
${COPILOT_MARK_END}
`;
}

export function clipboardSnippet(): string {
	return join(OVERVIEW, HOW_TO_CALL, RUNTIME_ENV, EXAMPLES, WARMUP, CAVEATS) + '\n';
}

function join(...sections: string[]): string {
	return sections.join('\n\n');
}
