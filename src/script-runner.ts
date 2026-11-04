// Runs a script with the configured timeout, cancellation, and slow-run notification.
import * as vscode from 'vscode';
import { execute } from './executor';
import type { ExecResult } from './exec-result';
import { watchForSlowScript } from './slow-script-watch';

/** Executes `code`; a per-call timeout override wins over the `implant.timeoutMs` setting. */
export async function runScript(
	code: string,
	cfg: () => vscode.WorkspaceConfiguration,
	options: { signal?: AbortSignal; timeoutOverrideMs?: number } = {},
): Promise<ExecResult> {
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
