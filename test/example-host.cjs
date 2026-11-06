const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function checkExample() {
	const root = path.resolve(__dirname, '..');
	const name = process.env.IMPLANT_EXAMPLE_NAME;
	const project = process.env.IMPLANT_EXAMPLE_PROJECT;
	const expectedFile = process.env.IMPLANT_EXAMPLE_EXPECTED;
	if (!name || !project || !expectedFile) {
		throw new Error('Example test environment is incomplete');
	}

	const code = await fs.readFile(path.join(root, 'assets/references/examples', `${name}.js`), 'utf8');
	const expected = await fs.readFile(expectedFile, 'utf8');
	const { execute } = require(path.join(root, 'out/executor.js'));
	const result = await execute(code, 60_000);
	if (!result.ok) {
		throw new Error(`${name}: ${result.error.name}: ${result.error.message}\n${result.error.stack ?? ''}`);
	}

	const replaceProject = (key, value) =>
		typeof value === 'string' ? value.split(project).join('{{PROJECT}}') : value;
	if (expectedFile.endsWith('.json')) {
		const actual = JSON.parse(JSON.stringify(result.value, replaceProject));
		assert.deepStrictEqual(actual, JSON.parse(expected), `${name}: JSON output differs`);
	} else {
		assert.equal(typeof result.value, 'string', `${name}: expected Markdown output`);
		assert.strictEqual(replaceProject('', result.value).trim(), expected.trim(), `${name}: Markdown output differs`);
	}
	console.log(`PASS ${name}`);
}

async function run() {
	const resultFile = process.env.IMPLANT_EXAMPLE_RESULT;
	if (!resultFile) throw new Error('Example test result path is missing');
	try {
		await checkExample();
		await fs.writeFile(resultFile, JSON.stringify({ ok: true }));
	} catch (error) {
		await fs.writeFile(resultFile, JSON.stringify({ ok: false, error: error.stack || String(error) }));
		throw error;
	}
}

module.exports = { run };
