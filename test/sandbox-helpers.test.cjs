const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const vscode = { extensions: { all: [] } };
const originalLoad = Module._load;
Module._load = function (request, ...args) {
	return request === 'vscode' ? vscode : originalLoad.call(this, request, ...args);
};
const { activateLanguage } = require('../out/sandbox-helpers');
Module._load = originalLoad;

test('activates and awaits only inactive extensions matching the language', async () => {
	const calls = [];
	let finish;
	const pending = new Promise(resolve => { finish = resolve; });
	vscode.extensions.all = [
		{ isActive: false, packageJSON: { activationEvents: ['onLanguage:test'] }, activate: () => { calls.push('match'); return pending; } },
		{ isActive: true, packageJSON: { activationEvents: ['onLanguage:test'] }, activate: () => calls.push('active') },
		{ isActive: false, packageJSON: { activationEvents: ['onLanguage:other'] }, activate: () => calls.push('other') },
		{ isActive: false, packageJSON: {}, activate: () => calls.push('missing') },
	];
	let completed = false;
	const activation = activateLanguage('test').then(() => { completed = true; });
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(calls, ['match']);
	assert.equal(completed, false);
	finish();
	await activation;
	assert.equal(completed, true);
});

test('returns without waiting when no extension matches', async () => {
	vscode.extensions.all = [];
	assert.equal(await activateLanguage('unsupported'), undefined);
});

test('surfaces extension activation failures', async () => {
	vscode.extensions.all = [{
		isActive: false,
		packageJSON: { activationEvents: ['onLanguage:test'] },
		activate: async () => { throw new Error('activation failed'); },
	}];
	await assert.rejects(activateLanguage('test'), /activation failed/);
});
