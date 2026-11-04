// Type of one captured `console.*` call from a script.

/** A single captured `console.*` call from a script. */
export interface LogEntry {
	level: 'log' | 'info' | 'warn' | 'error' | 'debug';
	message: string;
}
