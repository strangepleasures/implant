// Builds the `console` object exposed to sandboxed scripts, capturing output into a log list.
import { serialize } from './serialize';
import type { LogEntry } from './log-entry';

/** Creates a console whose methods append to `logs` instead of writing to the host's stdout. */
export function createSandboxConsole(logs: LogEntry[]) {
	const capture = (level: LogEntry['level']) => (...args: unknown[]) => {
		logs.push({ level, message: args.map(formatArg).join(' ') });
	};
	return {
		log: capture('log'),
		info: capture('info'),
		warn: capture('warn'),
		error: capture('error'),
		debug: capture('debug'),
	};
}

/** Renders a console argument as text: strings verbatim, everything else as serialized JSON. */
function formatArg(a: unknown): string {
	if (typeof a === 'string') return a;
	try { return JSON.stringify(serialize(a)); } catch { return String(a); }
}
