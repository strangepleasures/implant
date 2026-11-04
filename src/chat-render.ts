// Runs a generated script through the run-script tool and renders the outcome in chat.
import * as vscode from 'vscode';
import type { ExecResult } from './exec-result';
import { runScript } from './script-runner';

export const SCRIPT_APPROVAL_COMMAND = 'implant.resolveScriptApproval';

export function resolveScriptApproval(id: number, approved: boolean): void {
	pendingApprovals.get(id)?.(approved);
}

/** Previews and runs `code`, then streams its logs, value, or error into the chat. */
export async function runAndRender(
	code: string,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
): Promise<ExecResult | undefined> {
	if (token.isCancellationRequested) return undefined;
	const approved = await requestScriptApproval(code, stream, token);
	if (!approved) {
		stream.markdown('\n\n_Script cancelled; nothing was executed._');
		return undefined;
	}

	const config = vscode.workspace.getConfiguration('implant');
	const controller = new AbortController();
	const cancellation = token.onCancellationRequested(() => controller.abort());
	let result: ExecResult;
	try {
		result = await runScript(code, () => config, { signal: controller.signal });
	} finally {
		cancellation.dispose();
	}

	if (result.logs?.length) {
		stream.markdown('**Logs:**\n');
		for (const l of result.logs) stream.markdown(`- \`[${l.level}]\` ${l.message}\n`);
		stream.markdown('\n');
	}
	if (result.ok) {
		stream.markdown(`**Result** (${result.durationMs} ms):\n\n`);
		renderValue(stream, result.value);
	} else {
		const e = result.error ?? { name: 'Error', message: 'unknown failure' };
		stream.markdown(`**${e.name}:** ${e.message}`);
	}
	return result;
}

const pendingApprovals = new Map<number, (approved: boolean) => void>();
let nextApprovalId = 0;

function requestScriptApproval(
	code: string,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
): Promise<boolean> {
	return new Promise(resolve => {
		const id = ++nextApprovalId;
		let cancellation: vscode.Disposable | undefined;
		let settled = false;
		const finish = (approved: boolean) => {
			if (settled) return;
			settled = true;
			pendingApprovals.delete(id);
			cancellation?.dispose();
			resolve(approved);
		};
		pendingApprovals.set(id, finish);
		cancellation = token.onCancellationRequested(() => finish(false));
		stream.markdown(new vscode.MarkdownString().appendCodeblock(code, 'javascript'));
		stream.button({ command: SCRIPT_APPROVAL_COMMAND, title: 'Run Script', arguments: [id, true] });
		stream.button({ command: SCRIPT_APPROVAL_COMMAND, title: 'Cancel', arguments: [id, false] });
		if (token.isCancellationRequested) finish(false);
	});
}

/** Cap on rendered JSON length. */
const MAX_RENDERED_JSON = 8000;

/** Writes a script's return value: strings as Markdown, everything else as JSON. */
function renderValue(stream: vscode.ChatResponseStream, value: unknown) {
	if (value === undefined) {
		stream.markdown('_(no value returned)_');
		return;
	}
	if (typeof value === 'string') {
		stream.markdown(value);
		return;
	}
	const json = JSON.stringify(value, null, 2);
	stream.markdown(json.length > MAX_RENDERED_JSON
		? '```json\n' + json.slice(0, MAX_RENDERED_JSON) + '\n…truncated…\n```'
		: '```json\n' + json + '\n```');
}

