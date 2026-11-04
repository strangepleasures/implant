// Type describing the outcome of running one script.
import type { LogEntry } from './log-entry';

/** Outcome of running one script: its value or error, captured logs, and wall time. */
export interface ExecResult {
	ok: boolean;
	value?: unknown;
	error?: { name: string; message: string; stack?: string };
	logs: LogEntry[];
	durationMs: number;
}
