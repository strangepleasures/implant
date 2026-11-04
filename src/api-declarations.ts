import * as fs from 'fs';
import * as path from 'path';
import * as astGrep from '@ast-grep/napi';

interface ApiSource {
	id: string;
	label: string;
	directory: string;
	entryFile: string;
	ambientModule?: string;
	declarationDirectories?: string[];
}

interface ApiDeclaration {
	name: string;
	qualifiedName: string;
	kind: string;
	sourceFile: string;
	source: string;
}

interface AstNode {
	kind(): string;
	text(): string;
	children(): AstNode[];
}

const REFERENCES_ROOT = path.join(__dirname, '..', 'assets', 'skills', 'implant', 'references');
const REGISTRY_PATH = path.join(__dirname, '..', 'assets', 'skills', 'implant', 'api-sources.json');
const API_SOURCES = (JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8')) as { apis: ApiSource[] }).apis;
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
const DECLARATION_CACHE = new Map<string, ApiDeclaration[]>();

export function apiSourceIds(): string[] {
	return API_SOURCES.map(source => source.id);
}

export function listApiDeclarations(apiId: string, prefix?: string): string {
	const source = getApiSource(apiId);
	if (!source) return `Unknown API '${apiId}'. Available APIs: ${apiSourceIds().join(', ')}.`;

	const declarations = getDeclarations(source).filter(declaration =>
		!prefix || declaration.qualifiedName.toLowerCase().startsWith(prefix.toLowerCase()),
	);
	if (!declarations.length) {
		return prefix
			? `No ${source.label} declarations start with '${prefix}'.`
			: `No declarations found for ${source.label}.`;
	}

	const entries = new Map<string, string>();
	for (const declaration of declarations) {
		if (!entries.has(declaration.qualifiedName)) {
			entries.set(declaration.qualifiedName, declaration.kind);
		}
	}
	return `${source.label} declarations (${entries.size}):\n` +
		[...entries].sort(([a], [b]) => a.localeCompare(b))
			.map(([name, kind]) => `- ${name} (${kind})`)
			.join('\n');
}

export function getApiDeclaration(apiId: string, requestedName: string): string {
	const source = getApiSource(apiId);
	if (!source) return `Unknown API '${apiId}'. Available APIs: ${apiSourceIds().join(', ')}.`;

	const declarations = getDeclarations(source);
	let matches = declarations.filter(declaration => declaration.qualifiedName === requestedName);
	if (!matches.length && !requestedName.includes('.')) {
		matches = declarations.filter(declaration => declaration.name === requestedName);
		const qualifiedNames = [...new Set(matches.map(declaration => declaration.qualifiedName))];
		if (qualifiedNames.length > 1) {
			return `More than one declaration is named '${requestedName}'. Use one of: ${qualifiedNames.join(', ')}.`;
		}
	}
	if (!matches.length) return `No ${source.label} declaration named '${requestedName}'. Use list_api_declarations to find a valid name.`;

	return matches.map(declaration =>
		`// ${source.id}.${declaration.qualifiedName} (${declaration.kind}; ${declaration.sourceFile})\n${declaration.source}`,
	).join('\n\n');
}

function getApiSource(apiId: string): ApiSource | undefined {
	return API_SOURCES.find(source => source.id === apiId);
}

function getDeclarations(source: ApiSource): ApiDeclaration[] {
	const cached = DECLARATION_CACHE.get(source.id);
	if (cached) return cached;

	const rootDirectory = path.join(REFERENCES_ROOT, source.directory);
	const files = [
		path.join(rootDirectory, source.entryFile),
		...(source.declarationDirectories ?? []).flatMap(directory => listDeclarationFiles(path.join(rootDirectory, directory))),
	];
	const declarations: ApiDeclaration[] = [];
	for (const file of files) {
		const sourceText = fs.readFileSync(file, 'utf8');
		const root = astGrep.parse(astGrep.Lang.TypeScript, sourceText).root() as unknown as AstNode;
		const declarationRoot = source.ambientModule
			? findAmbientModule(root, source.ambientModule)
			: root;
		if (!declarationRoot) continue;
		collectDeclarations(
			declarationRoot.kind() === 'statement_block' ? declarationRoot.children() : declarationRoot.children(),
			[],
			path.relative(REFERENCES_ROOT, file).split(path.sep).join('/'),
			declarations,
		);
	}

	const unique = new Map<string, ApiDeclaration>();
	for (const declaration of declarations) {
		const key = `${declaration.qualifiedName}\n${declaration.source}`;
		if (!unique.has(key)) unique.set(key, declaration);
	}
	const result = [...unique.values()];
	DECLARATION_CACHE.set(source.id, result);
	return result;
}

function listDeclarationFiles(directory: string): string[] {
	const files: string[] = [];
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const child = path.join(directory, entry.name);
		if (entry.isDirectory()) files.push(...listDeclarationFiles(child));
		else if (entry.isFile() && entry.name.endsWith('.d.ts')) files.push(child);
	}
	return files.sort();
}

function findAmbientModule(root: AstNode, moduleName: string): AstNode | undefined {
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

function declarationFrom(node: AstNode): AstNode | undefined {
	if (DECLARATION_KINDS.has(node.kind())) return node;
	for (const child of node.children()) {
		const declaration = declarationFrom(child);
		if (declaration) return declaration;
	}
	return undefined;
}

function declarationName(node: AstNode): string | undefined {
	const stack = [...node.children()];
	while (stack.length) {
		const current = stack.shift()!;
		if (['identifier', 'type_identifier', 'property_identifier'].includes(current.kind())) return current.text();
		stack.unshift(...current.children());
	}
	return undefined;
}

function declarationKind(node: AstNode): string {
	return node.kind().replace(/_(declaration|signature)$/, '').replaceAll('_', ' ');
}

function collectDeclarations(
	nodes: AstNode[],
	scope: string[],
	sourceFile: string,
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
			const qualifiedName = [...scope, name].join('.');
			output.push({
				name,
				qualifiedName,
				kind: declarationKind(declaration),
				sourceFile,
				source: [...comments, node.text()].join('\n'),
			});

			if (['module', 'internal_module'].includes(declaration.kind())) {
				const body = declaration.children().find(child => child.kind() === 'statement_block');
				if (body) collectDeclarations(body.children(), [...scope, name], sourceFile, output);
			}
		}
		comments = [];
	}
}