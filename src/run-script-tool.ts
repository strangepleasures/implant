// Registers the agent-facing "Run VS Code Script" language-model tool.
import * as vscode from 'vscode';
import type { ExecResult } from './exec-result';
import { runScript } from './script-runner';

/** Name of the language-model tool that runs Implant scripts. */
export const RUN_SCRIPT_TOOL = 'implant_run_vscode_script';

/** Registers the tool, requiring approval and showing the script before execution. */
export function registerRunScriptTool(context: vscode.ExtensionContext) {
	const cfg = () => vscode.workspace.getConfiguration('implant');
	context.subscriptions.push(vscode.lm.registerTool<RunScriptInput>(RUN_SCRIPT_TOOL, {
		prepareInvocation: ({ input }) => {
			const message = new vscode.MarkdownString(
				'Implant will execute this JavaScript in the VS Code extension host with access to the VS Code API.',
			).appendCodeblock(input.code, 'javascript');
			return {
				invocationMessage: new vscode.MarkdownString('Running Implant script…')
					.appendCodeblock(input.code, 'javascript'),
				confirmationMessages: { title: 'Run Implant script?', message },
			};
		},
		invoke: async ({ input }, token) => {
			const controller = new AbortController();
			const cancellation = token.onCancellationRequested(() => controller.abort());
			try {
				const result = await runScript(input.code, cfg, {
					signal: controller.signal,
					timeoutOverrideMs: input.timeoutMs,
				});
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart(renderToolResult(result)),
				]);
			} finally {
				cancellation.dispose();
			}
		},
	}));
}

function renderToolResult(result: ExecResult): string {
	const parts: string[] = [];
	if (result.logs.length) {
		parts.push(`**Logs:**\n${result.logs.map(log => `- [${log.level}] ${log.message}`).join('\n')}`);
	}
	if (!result.ok) {
		const error = result.error ?? { name: 'Error', message: 'Unknown failure.' };
		parts.push(`**${error.name}:** ${error.message}`);
	} else if (result.value === undefined) {
		parts.push('_(no value returned)_');
	} else if (typeof result.value === 'string') {
		parts.push(result.value);
	} else {
		parts.push(`\`\`\`json\n${JSON.stringify(result.value, null, 2)}\n\`\`\``);
	}
	parts.push(`_Completed in ${result.durationMs} ms._`);
	return parts.join('\n\n');
}

interface RunScriptInput {
	code: string;
	timeoutMs?: number;
}