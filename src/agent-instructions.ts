import * as fs from 'fs';
import * as path from 'path';

// Skill assets shipped in the vsix. Structure matches what gets written to
// `.agents/skills/implant/` on install — a lean SKILL.md plus a `references/`
// subtree (commands/, examples/, topics/, plus how-to-call.md at the top) per
// agentskills.io. The chat participant also serves references from here on
// demand via the language-model `load_implant_reference` tool.
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
 * extension version. Written to `.agents/skills/implant/SKILL.md` (canonical)
 * plus `.claude/skills/implant/SKILL.md` (Claude Code discovery) on install,
 * and used at activation to compare against installed skills.
 */
export function skillMarkdown(version: string): string {
	return SKILL_TEMPLATE.replace('{{VERSION}}', version) + '\n';
}

/**
 * Cursor rule (`.cursor/rules/implant.mdc`). Cursor auto-attaches rules whose
 * `description` matches the current task, so we reuse the SKILL frontmatter's
 * description verbatim and inline the SKILL body.
 */
export function cursorRule(version: string): string {
	const body = skillMarkdown(version);
	const fm = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
	const description = fm?.[1].split(/\r?\n/).find(l => /^description\s*:/.test(l))
		?.replace(/^description\s*:\s*/, '').trim() ?? '';
	const skillBody = fm ? body.slice(fm[0].length) : body;
	return `---\ndescription: ${description}\nalwaysApply: false\n---\n\n${skillBody.trimStart()}`;
}

/**
 * AGENTS.md section body (without the marker comments — those are added by the
 * upsert helper). Short pointer, not the full skill body: agents that read
 * AGENTS.md at the root should find the canonical file via this pointer, not
 * duplicate its content here.
 */
export function agentsSection(): string {
	return [
		'## Implant (VS Code MCP)',
		'',
		'Semantic code queries (references, definitions, diagnostics, renames, code actions) and structural edits, executed inside the running VS Code extension host.',
		'',
		'Invoke via the MCP tool `run_vscode_script` (server: `implant`). Full skill definition and progressive-disclosure references at `.agents/skills/implant/`.',
	].join('\n');
}

/**
 * Look up a reference by its identifier (path relative to `references/`, without
 * the `.md` extension). Returns `undefined` if the path doesn't correspond to a
 * shipped file. Used by the chat participant's `load_implant_reference` tool.
 */
export function skillReference(refPath: string): string | undefined {
	return REFERENCE_BY_PATH.get(refPath)?.contents;
}

/**
 * The full set of shipped references — used by `installIntoFolder` to mirror the
 * tree into `.agents/skills/implant/references/` on install.
 */
export const SKILL_REFERENCES: readonly SkillReference[] = REFERENCES;

/**
 * Description for the `run_vscode_script` MCP tool. Consumed by MCP clients that
 * are already connected to the server, so how-to-call is omitted.
 */
export function mcpToolDescription(): string {
	return concatReferences(r => r.path !== 'how-to-call');
}

/**
 * Full-body snippet for "Copy Agent Instructions" — for setups that can't read
 * the SKILL.md format (older CLI rigs). Includes every reference so the receiver
 * has the full material without follow-up loads.
 */
export function clipboardSnippet(): string {
	return concatReferences(() => true) + '\n';
}

function concatReferences(filter: (r: SkillReference) => boolean): string {
	return REFERENCES.filter(filter).map(r => r.contents.trimEnd()).join('\n\n');
}
