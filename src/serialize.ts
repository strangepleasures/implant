// Converts arbitrary script results into bounded, JSON-safe values.
import * as vscode from 'vscode';

/** Returns a JSON-safe copy of `value`: cycles, depth, sizes limited; VS Code types tagged with `__type`. */
export function serialize(value: unknown): unknown {
	return walk(value, 0, new WeakSet());
}

/** Maximum nesting depth before values are replaced by a placeholder. */
const MAX_DEPTH = 8;
/** Maximum array/Map/Set entries kept. */
const MAX_ARRAY = 500;
/** Maximum string length kept. */
const MAX_STRING = 20_000;

/** Recursive worker for `serialize`; `seen` detects cycles. */
function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
	if (value === null || value === undefined) return value;
	const t = typeof value;
	if (t === 'string') {
		return (value as string).length > MAX_STRING
			? (value as string).slice(0, MAX_STRING) + `…[+${(value as string).length - MAX_STRING} chars]`
			: value;
	}
	if (t === 'number' || t === 'boolean') return value;
	if (t === 'bigint') return `${value}n`;
	if (t === 'function' || t === 'symbol') return `[${t}]`;
	if (depth >= MAX_DEPTH) return '[max-depth]';

	const obj = value as object;
	if (seen.has(obj)) return '[cycle]';
	seen.add(obj);

	const vscodeShape = tryVscode(obj);
	if (vscodeShape) return vscodeShape;

	if (obj instanceof Error) {
		return { __type: 'Error', name: obj.name, message: obj.message, stack: obj.stack };
	}
	if (obj instanceof Map) {
		return {
			__type: 'Map',
			entries: [...obj.entries()].slice(0, MAX_ARRAY).map(([k, v]) => [walk(k, depth + 1, seen), walk(v, depth + 1, seen)]),
		};
	}
	if (obj instanceof Set) {
		return { __type: 'Set', values: [...obj.values()].slice(0, MAX_ARRAY).map(v => walk(v, depth + 1, seen)) };
	}
	if (obj instanceof Date) return { __type: 'Date', iso: obj.toISOString() };
	if (obj instanceof RegExp) return { __type: 'RegExp', source: obj.source, flags: obj.flags };
	if (obj instanceof Uint8Array) return { __type: 'Uint8Array', base64: Buffer.from(obj).toString('base64') };

	if (Array.isArray(obj)) {
		const arr = obj.slice(0, MAX_ARRAY).map(v => walk(v, depth + 1, seen));
		if (obj.length > MAX_ARRAY) arr.push(`…[+${obj.length - MAX_ARRAY} more]`);
		return arr;
	}

	if (typeof (obj as any).then === 'function') return '[Promise]';

	const out: Record<string, unknown> = {};
	for (const key of Object.keys(obj)) {
		try {
			out[key] = walk((obj as any)[key], depth + 1, seen);
		} catch (e) {
			out[key] = `[getter threw: ${(e as Error).message}]`;
		}
	}
	return out;
}

/** Serializes Uri/Position/Range/Selection/Location, or returns undefined for other objects. */
function tryVscode(v: object): unknown {
	if (v instanceof vscode.Uri) return { __type: 'Uri', scheme: v.scheme, path: v.path, fsPath: v.fsPath, toString: v.toString() };
	if (v instanceof vscode.Position) return { __type: 'Position', line: v.line, character: v.character };
	if (v instanceof vscode.Range) return { __type: 'Range', start: { line: v.start.line, character: v.start.character }, end: { line: v.end.line, character: v.end.character } };
	if (v instanceof vscode.Selection) return { __type: 'Selection', anchor: { line: v.anchor.line, character: v.anchor.character }, active: { line: v.active.line, character: v.active.character } };
	if (v instanceof vscode.Location) return { __type: 'Location', uri: tryVscode(v.uri), range: tryVscode(v.range) };
	return undefined;
}
