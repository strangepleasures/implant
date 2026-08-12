import * as vm from 'vm';
import * as vscode from 'vscode';
import * as astGrep from '@ast-grep/napi';
import * as astGrepPython from '@ast-grep/lang-python';
import * as astGrepGo from '@ast-grep/lang-go';
import * as astGrepRust from '@ast-grep/lang-rust';
import * as astGrepJava from '@ast-grep/lang-java';
import * as astGrepC from '@ast-grep/lang-c';
import * as astGrepCpp from '@ast-grep/lang-cpp';
import { serialize } from './serialize';
import { activateLanguage } from './sandbox-helpers';

// The `@ast-grep/napi` binding ships only 5 built-in languages (Html, JavaScript, Tsx,
// Css, TypeScript). We augment that at module load with the dynamic-language packages
// we bundle so `astGrep.parse("Python", src)` etc. work from any snippet.
// `registerDynamicLanguage` may only be called once per process, so this MUST happen
// exactly here — before any snippet gets a chance to call it itself.
//
// Wrapped in try/catch: the tree-sitter grammar packages don't ship prebuilds for every
// platform ast-grep itself supports (in particular, they lack Linux musl and Windows
// arm64 binaries). On those platforms `libraryPath` throws when loaded; skipping the
// extra languages there is preferable to failing extension activation.
try {
	astGrep.registerDynamicLanguage({
		Python: astGrepPython,
		Go: astGrepGo,
		Rust: astGrepRust,
		Java: astGrepJava,
		C: astGrepC,
		Cpp: astGrepCpp,
	});
} catch (err) {
	console.warn('Implant: dynamic language registration failed — Python/Go/Rust/Java/C/C++ ast-grep support unavailable on this platform:', (err as Error).message);
}

export interface ExecResult {
	ok: boolean;
	value?: unknown;
	error?: { name: string; message: string; stack?: string };
	logs: LogEntry[];
	durationMs: number;
}

interface LogEntry {
	level: 'log' | 'info' | 'warn' | 'error' | 'debug';
	message: string;
}

export async function execute(code: string, timeoutMs: number, signal?: AbortSignal): Promise<ExecResult> {
	const logs: LogEntry[] = [];
	const capture = (level: LogEntry['level']) => (...args: unknown[]) => {
		logs.push({ level, message: args.map(formatArg).join(' ') });
	};
	const sandboxConsole = {
		log: capture('log'),
		info: capture('info'),
		warn: capture('warn'),
		error: capture('error'),
		debug: capture('debug'),
	};

	const context = vm.createContext({
		vscode,
		astGrep,
		activateLanguage,
		console: sandboxConsole,
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

function withTimeoutAndAbort<T>(p: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
	if ((!ms || ms <= 0) && !signal) return p;
	return new Promise<T>((resolve, reject) => {
		const timer = ms > 0 ? setTimeout(() => finish(() => reject(new Error(`Script exceeded ${ms}ms timeout`))), ms) : null;
		const onAbort = () => finish(() => reject(new Error('User terminated the script')));
		let done = false;
		const finish = (act: () => void) => {
			if (done) return;
			done = true;
			if (timer) clearTimeout(timer);
			signal?.removeEventListener('abort', onAbort);
			act();
		};
		signal?.addEventListener('abort', onAbort);
		if (signal?.aborted) return finish(() => reject(new Error('User terminated the script')));
		p.then(v => finish(() => resolve(v)), e => finish(() => reject(e)));
	});
}

function formatArg(a: unknown): string {
	if (typeof a === 'string') return a;
	try { return JSON.stringify(serialize(a)); } catch { return String(a); }
}
