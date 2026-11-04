import * as vscode from 'vscode';
import { execute, ExecResult } from './executor';
import { registerChatParticipant } from './chat-participant';

const SLOW_SCRIPT_MS = 10_000;
const RUN_SCRIPT_TOOL = 'implant_run_vscode_script';

interface RunScriptInput {
	code: string;
	timeoutMs?: number;
}

export function activate(context: vscode.ExtensionContext) {
	const output = vscode.window.createOutputChannel('Implant');
	context.subscriptions.push(output);
	output.appendLine(`Implant activating on VS Code ${vscode.version}…`);

	const cfg = () => vscode.workspace.getConfiguration('implant');
	registerChatParticipant(context, output, (code, options) => runScript(code, cfg, options));
	context.subscriptions.push(vscode.lm.registerTool<RunScriptInput>(RUN_SCRIPT_TOOL, {
		prepareInvocation: ({ input }) => {
			const needsConfirmation = cfg().get<boolean>('requireConfirmation', true);
			const message = new vscode.MarkdownString(
				'Implant will execute this JavaScript in the VS Code extension host with access to the VS Code API.',
			).appendCodeblock(input.code, 'javascript');
			return {
				invocationMessage: 'Running Implant script…',
				confirmationMessages: needsConfirmation
					? { title: 'Run Implant script?', message }
					: undefined,
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
					new vscode.LanguageModelTextPart(JSON.stringify(result)),
				]);
			} finally {
				cancellation.dispose();
			}
		},
	}));
	output.appendLine(`Registered language model tool: ${RUN_SCRIPT_TOOL}`);
}

async function runScript(
	code: string,
	cfg: () => vscode.WorkspaceConfiguration,
	options: { signal?: AbortSignal; timeoutOverrideMs?: number } = {},
): Promise<ExecResult> {
	// Per-call `timeoutMs` argument wins over the workspace `implant.timeoutMs` setting.
	const timeoutMs = options.timeoutOverrideMs !== undefined
		? options.timeoutOverrideMs
		: cfg().get<number>('timeoutMs', 0);
	const controller = new AbortController();
	// Forward an externally-supplied signal (e.g. the chat request's cancellation token)
	// so the caller can abort the running snippet.
	if (options.signal) {
		if (options.signal.aborted) controller.abort();
		else options.signal.addEventListener('abort', () => controller.abort(), { once: true });
	}
	const runPromise = execute(code, timeoutMs, controller.signal);
	watchForSlowScript(runPromise, controller, code);
	return runPromise;
}

// Pulls the first `//` comment line off the top of a snippet — the convention
// documented in SKILL.md is that every script starts with a one-line comment
// describing what it does. Used to identify which script the slow-run
// notification is talking about when several are queued.
function topCommentLine(code: string): string | null {
	for (const raw of code.split('\n')) {
		const line = raw.trim();
		if (!line) continue;
		const m = /^\/\/\s*(.+?)\s*$/.exec(line);
		return m ? m[1] : null;
	}
	return null;
}

function watchForSlowScript(runPromise: Promise<ExecResult>, controller: AbortController, code: string) {
	let settled = false;
	runPromise.finally(() => { settled = true; });
	const timer = setTimeout(() => {
		if (settled) return;
		const hint = topCommentLine(code);
		const title = hint
			? `Implant script is still running — ${hint.length > 80 ? hint.slice(0, 79) + '…' : hint}`
			: 'Implant script is still running';
		vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title,
				cancellable: true,
			},
			async (_progress, token) => {
				const cancelSub = token.onCancellationRequested(() => controller.abort());
				try {
					await runPromise;
				} catch { /* result is reported to the requesting chat agent */ }
				cancelSub.dispose();
			},
		);
	}, SLOW_SCRIPT_MS);
	runPromise.finally(() => clearTimeout(timer));
}
