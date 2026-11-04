// Access to the bundled prompt and its prose/example references.
import * as fs from 'fs';
import * as path from 'path';

/** Prompt body loaded once at module initialization. */
export const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, '..', 'assets', 'references', 'PROMPT.md'), 'utf8').trimEnd();

/**
 * A file that ships under `references/`. Paths are relative to the references
 * root; Markdown IDs omit `.md`, while runnable and declaration files keep
 * their extensions.
 */
export interface ReferenceAsset {
	/** e.g. `topics/ast-grep`, `examples/find-references.js`. */
	path: string;
	absolutePath: string;
}

/** Returns IDs of the shipped references for the reference-list tool. */
export function listReferenceIds(): string[] {
	return REFERENCES.map(reference => reference.path);
}

/**
 * Look up a reference by its identifier (path relative to `references/`, without
 * the `.md` extension). Returns `undefined` if the path doesn't correspond to a
 * shipped file. Used by the chat participant's `load_implant_reference` tool.
 */
export function readReference(refPath: string): string | undefined {
	const reference = REFERENCE_BY_PATH.get(refPath);
	return reference ? fs.readFileSync(reference.absolutePath, 'utf8') : undefined;
}

/** Root folder of the bundled prompt and references. */
const referencesDir = path.join(__dirname, '..', 'assets', 'references');

/** Scans `references/` for `.md` and `.js` files and returns them sorted by ID. */
function walkReferences(): ReferenceAsset[] {
	const out: ReferenceAsset[] = [];
	const walk = (rel: string) => {
		const abs = path.join(referencesDir, rel);
		for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
			const childRel = rel ? `${rel}/${entry.name}` : entry.name;
			if (entry.isDirectory()) walk(childRel);
			else if (entry.isFile() && childRel !== 'PROMPT.md' && /\.(md|js)$/.test(entry.name)) {
				// Markdown IDs omit `.md`; runnable snippets keep `.js`. API
				// declarations are handled by the dedicated list/get tools.
				const stripped = entry.name.endsWith('.md')
					? childRel.replace(/\.md$/, '')
					: childRel;
				out.push({
					path: stripped,
					absolutePath: path.join(referencesDir, childRel),
				});
			}
		}
	};
	walk('');
	out.sort((a, b) => a.path.localeCompare(b.path));
	return out;
}

/** All shipped references, discovered once at load. */
const REFERENCES = walkReferences();
/** Reference lookup by ID. */
const REFERENCE_BY_PATH = new Map(REFERENCES.map(r => [r.path, r]));
