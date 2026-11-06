const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const vscode = { commands: { executeCommand: async () => undefined } };
const originalLoad = Module._load;
Module._load = function (request, ...args) {
	return request === 'vscode' ? vscode : originalLoad.call(this, request, ...args);
};
const { waitForWorkspaceIndexes } = require('../out/language-readiness');
Module._load = originalLoad;

test('waits until a sample document symbol appears in workspace symbols', async () => {
	const uri = { toString: () => 'file:///sample.ts' };
	const document = { languageId: 'typescript', uri };
	let workspaceQueries = 0;
	vscode.commands.executeCommand = async (command, arg) => {
		if (command === 'vscode.executeDocumentSymbolProvider') return [{ name: 'Sample' }];
		assert.equal(command, 'vscode.executeWorkspaceSymbolProvider');
		assert.equal(arg, 'Sample');
		workspaceQueries++;
		return workspaceQueries === 1 ? [] : [{ name: 'Sample', location: { uri } }];
	};

	await waitForWorkspaceIndexes([document]);

	assert.equal(workspaceQueries, 2);
});

test('skips workspace-index polling when no document symbols are available', async () => {
	let calls = 0;
	vscode.commands.executeCommand = async () => {
		calls++;
		return undefined;
	};

	await waitForWorkspaceIndexes([{ languageId: 'plaintext', uri: {} }]);

	assert.equal(calls, 1);
});
