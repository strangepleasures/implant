// Executes the model's tool calls (reference loading and API declaration lookup) locally.
import type * as vscode from 'vscode';
import { listReferenceIds, readReference } from './prompt-assets';
import { getApiDeclaration, listApiDeclarations } from './api-lookup';

/** Runs one tool call and returns the text sent back to the model as its result. */
export function handleToolCall(
	call: vscode.LanguageModelToolCallPart,
	loaded: Set<string>,
	stream: vscode.ChatResponseStream,
): string {
	const handler = TOOL_HANDLERS[call.name];
	return handler
		? handler(call.input as Record<string, unknown>, { loaded, stream })
		: `Error: unknown tool '${call.name}'.`;
}

interface ToolContext {
	loaded: Set<string>;
	stream: vscode.ChatResponseStream;
}

type ToolHandler = (input: Record<string, unknown>, context: ToolContext) => string;

const TOOL_HANDLERS: Record<string, ToolHandler> = {
	list_implant_references: () => listReferenceIds().join('\n'),
	list_api_declarations: listDeclarations,
	get_api_declaration: getDeclaration,
	load_implant_reference: loadReference,
};

function listDeclarations(input: Record<string, unknown>): string {
	const error = requireString(input, 'api');
	if (error) return error;
	return listApiDeclarations(input.api as string).join('\n');
}

function getDeclaration(input: Record<string, unknown>): string {
	const error = requireString(input, 'api') ?? requireString(input, 'declaration');
	if (error) return error;
	return getApiDeclaration(input.api as string, input.declaration as string);
}

function loadReference(input: Record<string, unknown>, { loaded, stream }: ToolContext): string {
	const pathError = requireString(input, 'path');
	if (pathError) return pathError;
	const refPath = input.path as string;
	if (loaded.has(refPath)) {
		return `Already loaded '${refPath}' in this response — reuse the content from the previous tool result.`;
	}
	const ref = readReference(refPath);
	if (!ref) return `Error: unknown reference ID '${refPath}'. Use list_implant_references to discover valid IDs.`;
	loaded.add(refPath);
	stream.markdown(`_↓ loaded reference: \`${refPath}\`_\n\n`);
	return ref;
}

function requireString(input: Record<string, unknown>, key: string): string | undefined {
	return typeof input[key] === 'string' ? undefined : `Error: \`${key}\` argument missing or not a string.`;
}
