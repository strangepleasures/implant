#!/usr/bin/env node
// Copy API declaration sources into the extension's reference assets.

import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** Root folder receiving the copied declarations. */
const REFERENCES_ROOT = 'assets/references';
/** Registry listing each API's npm package and declaration files. */
const REGISTRY_PATH = 'assets/references/api-sources.json';
const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));

/** Recursively copies `.d.ts` files from `sourceDirectory` to `destinationDirectory`. */
function copyDeclarations(sourceDirectory, destinationDirectory) {
	mkdirSync(destinationDirectory, { recursive: true });
	for (const entry of readdirSync(sourceDirectory, { withFileTypes: true })) {
		const source = join(sourceDirectory, entry.name);
		const destination = join(destinationDirectory, entry.name);
		if (entry.isDirectory()) copyDeclarations(source, destination);
		else if (entry.isFile() && entry.name.endsWith('.d.ts')) copyFileSync(source, destination);
	}
}

for (const api of registry.apis) {
	const sourceRoot = join('node_modules', api.package);
	const destinationRoot = join(REFERENCES_ROOT, api.directory);
	rmSync(destinationRoot, { recursive: true, force: true });
	mkdirSync(destinationRoot, { recursive: true });
	copyFileSync(join(sourceRoot, api.entryFile), join(destinationRoot, api.entryFile));
	for (const directory of api.declarationDirectories ?? []) {
		copyDeclarations(join(sourceRoot, directory), join(destinationRoot, directory));
	}
	console.log(`Copied ${api.id} declarations to ${destinationRoot}`);
}

rmSync(join(REFERENCES_ROOT, 'vscode-api-types.md'), { force: true });
rmSync(join(REFERENCES_ROOT, 'ast-grep-api-types.md'), { force: true });