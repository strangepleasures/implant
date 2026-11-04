// Builds and caches the de-duplicated declaration list for each API source.
import * as fs from 'fs';
import * as path from 'path';
import * as astGrep from '@ast-grep/napi';
import type { ApiDeclaration } from './api-declaration';
import { REFERENCES_ROOT, type ApiSource } from './api-sources';
import { collectDeclarations, findAmbientModule } from './declaration-parser';

/** Returns all declarations of `source`, parsing its files on first use. */
export function getDeclarations(source: ApiSource): ApiDeclaration[] {
	const cached = DECLARATION_CACHE.get(source.id);
	if (cached) return cached;

	const rootDirectory = path.join(REFERENCES_ROOT, source.directory);
	const files = [
		path.join(rootDirectory, source.entryFile),
		...(source.declarationDirectories ?? []).flatMap(directory => listDeclarationFiles(path.join(rootDirectory, directory))),
	];
	const declarations: ApiDeclaration[] = [];
	for (const file of files) parseFile(file, source, declarations);

	const unique = new Map<string, ApiDeclaration>();
	for (const declaration of declarations) {
		const key = `${declaration.name}\n${declaration.source}`;
		if (!unique.has(key)) unique.set(key, declaration);
	}
	const result = [...unique.values()];
	DECLARATION_CACHE.set(source.id, result);
	return result;
}

const DECLARATION_CACHE = new Map<string, ApiDeclaration[]>();

/** Recursively lists `.d.ts` files under `directory`, sorted for deterministic output. */
function listDeclarationFiles(directory: string): string[] {
	const files: string[] = [];
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const child = path.join(directory, entry.name);
		if (entry.isDirectory()) files.push(...listDeclarationFiles(child));
		else if (entry.isFile() && entry.name.endsWith('.d.ts')) files.push(child);
	}
	return files.sort();
}

/** Parses one `.d.ts` file and appends its exported declarations to `out`. */
function parseFile(file: string, source: ApiSource, out: ApiDeclaration[]): void {
	const root = astGrep.parse(astGrep.Lang.TypeScript, fs.readFileSync(file, 'utf8')).root();
	const declarationRoot = source.ambientModule ? findAmbientModule(root, source.ambientModule) : root;
	if (!declarationRoot) return;
	collectDeclarations(declarationRoot.children(), out);
}
