// Shows a cancellable notification when a script runs longer than expected.
import * as vscode from 'vscode';
import type { ExecResult } from './exec-result';

/** After SLOW_SCRIPT_MS, notifies the user and lets them abort via `controller`. */
export function watchForSlowScript(runPromise: Promise<ExecResult>, controller: AbortController, code: string) {
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

/** How long a script may run before the "still running" notification appears. */
const SLOW_SCRIPT_MS = 10_000;

/**
 * Pulls the first `//` comment line off the top of a snippet — the convention
 * documented in PROMPT.md is that every script starts with a one-line comment
 * describing what it does. Used to identify which script the notification is about.
 */
function topCommentLine(code: string): string | null {
	for (const raw of code.split('\n')) {
		const line = raw.trim();
		if (!line) continue;
		const m = /^\/\/\s*(.+?)\s*$/.exec(line);
		return m ? m[1] : null;
	}
	return null;
}
