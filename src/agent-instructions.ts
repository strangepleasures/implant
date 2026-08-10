import * as fs from 'fs';
import * as path from 'path';

const proseDir = path.join(__dirname, '..', 'assets', 'prose');
const read = (name: string) => fs.readFileSync(path.join(proseDir, name), 'utf8').trimEnd();

const OVERVIEW = read('overview.md');
const RUNTIME_ENV = read('runtime-env.md');
const HOW_TO_CALL = read('how-to-call.md');
const EXAMPLES = read('examples.md');
const WARMUP = read('warmup.md');
const CAVEATS = read('caveats.md');

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
## Implant — running JavaScript in the VS Code extension host

${join(OVERVIEW, HOW_TO_CALL, RUNTIME_ENV, EXAMPLES, WARMUP, CAVEATS)}
${COPILOT_MARK_END}
`;
}

export function clipboardSnippet(): string {
	return join(OVERVIEW, HOW_TO_CALL, RUNTIME_ENV, EXAMPLES, WARMUP, CAVEATS) + '\n';
}

function join(...sections: string[]): string {
	return sections.join('\n\n');
}
