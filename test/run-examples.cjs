const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const expectedDir = path.join(__dirname, 'expected');
const examplesDir = path.join(root, 'assets/references/examples');
const fixture = path.join(__dirname, 'fixtures/test-projects/python');
const userData = path.join(__dirname, 'harness-user-data');

async function runExample(name, expectedFile) {
	const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'implant-example-'));
	const project = path.join(temporary, 'project');
	const profile = path.join(temporary, 'user-data');
	const resultFile = path.join(temporary, 'result.json');
	try {
		await fs.cp(fixture, project, { recursive: true });
		await fs.cp(userData, profile, { recursive: true });
		const args = [
			'--new-window', '--wait', '--skip-welcome',
			'--disable-extension=GitHub.copilot',
			'--disable-extension=GitHub.copilot-chat',
			'--disable-extension=Anthropic.claude-code',
			`--user-data-dir=${profile}`,
			`--extensionDevelopmentPath=${root}`,
			`--extensionTestsPath=${path.join(__dirname, 'example-host.cjs')}`,
			project,
		];
		if (process.env.IMPLANT_TEST_EXTENSIONS_DIR) {
			args.push(`--extensions-dir=${path.resolve(process.env.IMPLANT_TEST_EXTENSIONS_DIR)}`);
		}
		const env = { ...process.env, IMPLANT_EXAMPLE_NAME: name, IMPLANT_EXAMPLE_PROJECT: project,
			IMPLANT_EXAMPLE_EXPECTED: expectedFile, IMPLANT_EXAMPLE_RESULT: resultFile };
		const child = spawn(process.env.VSCODE_BIN || 'code', args, { env, stdio: 'inherit' });
		const status = await new Promise((resolve, reject) => {
			let timedOut = false;
			let killTimer;
			const timer = setTimeout(() => {
				timedOut = true;
				child.kill('SIGTERM');
				killTimer = setTimeout(() => child.kill('SIGKILL'), 5_000);
			}, 120_000);
			child.once('error', err => { clearTimeout(timer); reject(err); });
			child.once('exit', (code, signal) => {
				clearTimeout(timer);
				clearTimeout(killTimer);
				if (timedOut) return reject(new Error(`${name}: VS Code test host exceeded 120 seconds`));
				resolve(code === 0 && !signal);
			});
		});
		let result;
		try {
			result = JSON.parse(await fs.readFile(resultFile, 'utf8'));
		} catch (error) {
			throw new Error(`${name}: VS Code exited without a test result: ${error.message}`);
		}
		if (!result.ok) console.error(result.error);
		return status && result.ok === true;
	} finally {
		await fs.rm(temporary, { recursive: true, force: true });
	}
}

async function main() {
	const filter = process.argv[2] || '';
	const examples = (await fs.readdir(examplesDir)).filter(file => file.endsWith('.js')).sort();
	const expected = (await fs.readdir(expectedDir)).filter(file => /\.(md|json)$/.test(file));
	const byName = new Map(expected.map(file => [file.replace(/\.(md|json)$/, ''), file]));
	for (const name of byName.keys()) {
		if (!examples.includes(`${name}.js`)) throw new Error(`Missing example for expected output: ${name}`);
	}
	const selected = examples.filter(file => file.includes(filter));
	if (!selected.length) throw new Error(`No example matches: ${filter}`);
	let failed = 0;
	let tested = 0;
	for (const file of selected) {
		const name = path.basename(file, '.js');
		const expectedFile = byName.get(name);
		if (!expectedFile) {
			console.log(`SKIP ${name}: no expected output`);
			continue;
		}
		tested++;
		console.log(`Testing ${name}...`);
		try {
			if (await runExample(name, path.join(expectedDir, expectedFile))) console.log(`PASS ${name}`);
			else { console.error(`FAIL ${name}`); failed++; }
		} catch (error) {
			console.error(`ERROR ${name}: ${error.message}`);
			failed++;
		}
	}
	if (!tested) throw new Error(`No expected outputs match: ${filter}`);
	if (failed) throw new Error(`${failed} of ${tested} example tests failed`);
	console.log(`${tested} example tests passed`);
}

main().catch(err => { console.error(err); process.exitCode = 1; });
