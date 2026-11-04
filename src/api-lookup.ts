// Public lookup API over registered API declarations, used by the chat tools.
import { apiSourceIds, getApiSource } from './api-sources';
import { getDeclarations } from './declaration-index';

/** Message returned when `apiId` isn't a registered API. */
export { apiSourceIds } from './api-sources';

/** Lists distinct declaration names of one API. */
export function listApiDeclarations(apiId: string): string[] {
	const source = getApiSource(apiId);
	if (!source) return [unknownApi(apiId)];

	const declarations = getDeclarations(source);
	return [...new Set(declarations.map(declaration => declaration.name))];
}

/** Returns the original `.d.ts` source of all declarations with the given name. */
export function getApiDeclaration(apiId: string, requestedName: string): string {
	const source = getApiSource(apiId);
	if (!source) return unknownApi(apiId);

	const declarations = getDeclarations(source);
	const matches = declarations.filter(declaration => declaration.name === requestedName);
	if (!matches.length) return `No declaration named '${requestedName}' in API '${apiId}'. Use list_api_declarations to find a valid name.`;

	return matches.map(declaration => declaration.source).join('\n\n');
}

/** Message returned when `apiId` isn't a registered API. */
function unknownApi(apiId: string): string {
	return `Unknown API '${apiId}'. Available APIs: ${apiSourceIds().join(', ')}.`;
}
