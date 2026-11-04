// Tool definitions the model may call while drafting a script.
import type * as vscode from 'vscode';
import { apiSourceIds } from './api-lookup';

/** Tools offered to the model: reference loading and API declaration lookup. */
export const LM_TOOLS: vscode.LanguageModelChatTool[] = [{
	name: 'list_implant_references',
	description:
		'List available IDs for bundled prose guides, runnable examples, and command references. ' +
		'Use an ID with `load_implant_reference` to retrieve its contents.',
	inputSchema: {
		type: 'object',
		properties: {},
		required: [],
	},
}, {
	name: 'load_implant_reference',
	description:
		'Retrieve a bundled prose guide, runnable example, or command reference by exact ID ' +
		'from `list_implant_references`. Use API declaration lookup tools for `.d.ts` declarations. ' +
		'Load only references needed for the current task; do not request the same ID twice.',
	inputSchema: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Exact reference ID returned by list_implant_references.',
			},
		},
		required: ['path'],
	},
}, {
	name: 'list_api_declarations',
	description:
		'List exported declaration names in one registered API source. API IDs: ' + apiSourceIds().join(', ') + '.',
	inputSchema: {
		type: 'object',
		properties: {
			api: { type: 'string', enum: apiSourceIds(), description: 'Registered API source ID.' },
		},
		required: ['api'],
	},
}, {
	name: 'get_api_declaration',
	description:
		'Retrieve the original .d.ts source of a declaration listed by `list_api_declarations`. ' +
		'Pass its declaration name exactly; overloads are returned together.',
	inputSchema: {
		type: 'object',
		properties: {
			api: { type: 'string', enum: apiSourceIds(), description: 'Registered API source ID.' },
			declaration: { type: 'string', description: 'Declaration name returned by list_api_declarations.' },
		},
		required: ['api', 'declaration'],
	},
}];
