// Runs a JavaScript snippet in a vm context that exposes the VS Code and ast-grep APIs.
import * as vm from 'vm';
import * as vscode from 'vscode';
import * as astGrep from '@ast-grep/napi';
import './dynamic-languages';
import { serialize } from './serialize';
import { activateLanguage } from './sandbox-helpers';
import { createSandboxConsole } from './sandbox-console';
import { withTimeoutAndAbort } from './script-timeout';
import type { ExecResult } from './exec-result';
import type { LogEntry } from './log-entry';

/**
 * Executes `code` as the body of an async function and returns its serialized value or error.
 * `timeoutMs <= 0` disables the timeout; `signal` lets the caller terminate the script.
 */
export async function execute(code: string, timeoutMs: number, signal?: AbortSignal): Promise<ExecResult> {
	const logs: LogEntry[] = [];
	const context = vm.createContext({
		vscode,
		astGrep,
		activateLanguage,
		console: createSandboxConsole(logs),
		require,
		Buffer,
		setTimeout,
		clearTimeout,
		setImmediate,
		clearImmediate,
		URL,
		URLSearchParams,
	});

	const wrapped = `(async function __implant__() {\n${code}\n})()`;
	const started = Date.now();

	try {
		const script = new vm.Script(wrapped, { filename: 'implant-script.js' });
		// Sync timeout guards busy loops (`while(true){}`) — VM aborts execution mid-instruction
		// if the sync portion exceeds it. The async race below guards hanging `await`s.
		const runOptions = timeoutMs > 0 ? { timeout: timeoutMs } : undefined;
		const promise = script.runInContext(context, runOptions) as Promise<unknown>;
		const value = await withTimeoutAndAbort(promise, timeoutMs, signal);
		return { ok: true, value: serialize(value), logs, durationMs: Date.now() - started };
	} catch (err) {
		const e = err as Error;
		return {
			ok: false,
			error: { name: e?.name ?? 'Error', message: e?.message ?? String(err), stack: e?.stack },
			logs,
			durationMs: Date.now() - started,
		};
	}
}
