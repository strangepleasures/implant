// Extracts exported declarations (with doc comments) from parsed TypeScript declaration files.
import type { SgNode } from '@ast-grep/napi';
import type { ApiDeclaration } from './api-declaration';

/** Finds the body of `declare module '<moduleName>'` anywhere under `root`. */
export function findAmbientModule(root: SgNode, moduleName: string): SgNode | undefined {
	const stack = [root];
	while (stack.length) {
		const node = stack.pop()!;
		if (node.kind() === 'module' && node.children().some(child =>
			child.kind() === 'string' && child.text().replace(/^['"]|['"]$/g, '') === moduleName)) {
			return node.children().find(child => child.kind() === 'statement_block');
		}
		stack.push(...node.children());
	}
	return undefined;
}
/**
 * Appends every exported declaration among `nodes` to `output`, recursing into namespaces.
 * Comments immediately preceding an export are kept as part of its source.
 */
export function collectDeclarations(
	nodes: SgNode[],
	output: ApiDeclaration[],
): void {
	let comments: string[] = [];
	for (const node of nodes) {
		if (node.kind() === 'comment') {
			comments.push(node.text());
			continue;
		}
		if (node.kind() !== 'export_statement') {
			if (node.kind() !== '{' && node.kind() !== '}') comments = [];
			continue;
		}

		const declaration = declarationFrom(node);
		const name = declaration && declarationName(declaration);
		if (declaration && name) {
			output.push({
				name,
				source: [...comments, node.text()].join('\n'),
			});

			if (['module', 'internal_module'].includes(String(declaration.kind()))) {
				const body = declaration.children().find(child => child.kind() === 'statement_block');
				if (body) collectDeclarations(body.children(), output);
			}
		}
		comments = [];
	}
}

/** AST node kinds that count as an API declaration. */
const DECLARATION_KINDS = new Set([
	'abstract_class_declaration',
	'class_declaration',
	'enum_declaration',
	'function_declaration',
	'function_signature',
	'interface_declaration',
	'internal_module',
	'lexical_declaration',
	'module',
	'type_alias_declaration',
]);

/** Returns the first declaration node at or below `node`. */
function declarationFrom(node: SgNode): SgNode | undefined {
	if (DECLARATION_KINDS.has(String(node.kind()))) return node;
	for (const child of node.children()) {
		const declaration = declarationFrom(child);
		if (declaration) return declaration;
	}
	return undefined;
}

/** Returns the first identifier text under `node` (breadth-first), i.e. the declared name. */
function declarationName(node: SgNode): string | undefined {
	const stack = [...node.children()];
	while (stack.length) {
		const current = stack.shift()!;
		if (['identifier', 'type_identifier', 'property_identifier'].includes(String(current.kind()))) return current.text();
		stack.unshift(...current.children());
	}
	return undefined;
}
