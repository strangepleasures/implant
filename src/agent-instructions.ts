import * as fs from 'fs';
import * as path from 'path';

// Skill assets used by the @implant chat participant and language-model tool.
const skillDir = path.join(__dirname, '..', 'assets', 'skills', 'implant');
const referencesDir = path.join(skillDir, 'references');

const SKILL_TEMPLATE = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8').trimEnd();

/**
 * A file that ships under `references/`. Path is stored *relative* to the
 * references root and without the `.md` extension — that's the identifier
 * the chat-participant tool accepts and the SKILL.md's index uses.
 */
export interface SkillReference {
	/** e.g. `topics/ast-grep`, `examples/find-references.js`. */
	path: string;
	/** File contents. */
	contents: string;
}

function walkReferences(): SkillReference[] {
	const out: SkillReference[] = [];
	const walk = (rel: string) => {
		const abs = path.join(referencesDir, rel);
		for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
			const childRel = rel ? `${rel}/${entry.name}` : entry.name;
			if (entry.isDirectory()) walk(childRel);
			else if (entry.isFile() && /\.(md|js)$/.test(entry.name)) {
				// `.md` files identify by basename (`examples/foo`); `.js` files keep
				// their extension (`examples/foo.js`) so it's obvious they're runnable
				// snippets, not prose. Both are served verbatim through
				// `load_implant_reference`.
				const stripped = entry.name.endsWith('.md')
					? childRel.replace(/\.md$/, '')
					: childRel;
				out.push({
					path: stripped,
					contents: fs.readFileSync(path.join(referencesDir, childRel), 'utf8'),
				});
			}
		}
	};
	walk('');
	out.sort((a, b) => a.path.localeCompare(b.path));
	return out;
}

const REFERENCES = walkReferences();
const REFERENCE_BY_PATH = new Map(REFERENCES.map(r => [r.path, r]));

/**
 * SKILL.md content with the frontmatter version substituted for the current
 * extension version.
 */
export function skillMarkdown(version: string): string {
	return SKILL_TEMPLATE.replace('{{VERSION}}', version) + '\n';
}

/**
 * Look up a reference by its identifier (path relative to `references/`, without
 * the `.md` extension). Returns `undefined` if the path doesn't correspond to a
 * shipped file. Used by the chat participant's `load_implant_reference` tool.
 */
export function skillReference(refPath: string): string | undefined {
	return REFERENCE_BY_PATH.get(refPath)?.contents;
}

export const SKILL_REFERENCES: readonly SkillReference[] = REFERENCES;
