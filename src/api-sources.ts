// Loads the registry of API sources whose declarations can be listed and retrieved.
import * as fs from 'fs';
import * as path from 'path';

/** One entry of `api-sources.json`: where an API's `.d.ts` files live. */
export interface ApiSource {
	id: string;
	directory: string;
	entryFile: string;
	ambientModule?: string;
	declarationDirectories?: string[];
}

/** Root folder holding the bundled reference `.d.ts` files. */
export const REFERENCES_ROOT = path.join(__dirname, '..', 'assets', 'references');

/** IDs of all registered API sources. */
export function apiSourceIds(): string[] {
	return API_SOURCES.map(source => source.id);
}

/** Finds a registered API source by ID. */
export function getApiSource(apiId: string): ApiSource | undefined {
	return API_SOURCES.find(source => source.id === apiId);
}

const REGISTRY_PATH = path.join(__dirname, '..', 'assets', 'references', 'api-sources.json');
const API_SOURCES = (JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8')) as { apis: ApiSource[] }).apis;
