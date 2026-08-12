#!/usr/bin/env node
// Build ONE universal .vsix that works on every VS Code platform.
//
// `@ast-grep/napi` uses optionalDependencies to ship one native binary per platform, so
// a plain `npm install` fetches only the host platform. We force-install every other
// platform's binary here with matching --os/--cpu/--libc flags before packaging.
//
// `@ast-grep/lang-{python,go,rust}` are simpler — each package ships prebuilt tree-sitter
// parsers for every platform in a single tarball, so `npm install` already leaves the
// node_modules universal for them. Nothing extra to do.
//
// Run: `npm run package` from the repo root. Pass `--publish` (or run `npm run publish`)
// to also `vsce publish` the resulting vsix — requires `VSCE_PAT` in the environment.

import { execSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const shouldPublish = process.argv.includes('--publish');

// VS Code dropped 32-bit Windows in 1.35 (2019), so `win32-ia32-msvc` is skipped.
const platforms = [
	{ name: 'darwin-arm64',      os: 'darwin', cpu: 'arm64' },
	{ name: 'darwin-x64',        os: 'darwin', cpu: 'x64' },
	{ name: 'linux-arm64-gnu',   os: 'linux',  cpu: 'arm64', libc: 'glibc' },
	{ name: 'linux-arm64-musl',  os: 'linux',  cpu: 'arm64', libc: 'musl' },
	{ name: 'linux-x64-gnu',     os: 'linux',  cpu: 'x64',   libc: 'glibc' },
	{ name: 'linux-x64-musl',    os: 'linux',  cpu: 'x64',   libc: 'musl' },
	{ name: 'win32-arm64-msvc',  os: 'win32',  cpu: 'arm64' },
	{ name: 'win32-x64-msvc',    os: 'win32',  cpu: 'x64' },
];

const run = cmd => {
	console.log(`\n$ ${cmd}`);
	execSync(cmd, { stdio: 'inherit' });
};

// Ensure declared deps (including @ast-grep/lang-*) are present in node_modules.
run('npm install');
run('npm run compile');

// Force-install every non-host `@ast-grep/napi-<platform>` binary. --no-save keeps
// package.json clean; --force + explicit --os/--cpu/--libc override npm's default
// "skip optional deps that don't match the host platform" behavior.
for (const p of platforms) {
	const flags = [`--os=${p.os}`, `--cpu=${p.cpu}`, p.libc && `--libc=${p.libc}`]
		.filter(Boolean).join(' ');
	run(`npm install --force --no-save ${flags} @ast-grep/napi-${p.name}`);
}

run(`npx --yes @vscode/vsce package -o implant-${version}.vsix`);

// Publish before restoring the host install — we want to upload the exact multi-platform
// vsix that was just built, not something repackaged from a host-only node_modules.
if (shouldPublish) {
	run(`npx --yes @vscode/vsce publish --packagePath implant-${version}.vsix`);
}

// Restore the host-native @ast-grep install so subsequent local dev is unaffected.
console.log('\n=== Restoring host @ast-grep install ===');
rmSync('node_modules/@ast-grep', { recursive: true, force: true });
run('npm install');

console.log(`\n${shouldPublish ? 'Published' : 'Built'}: implant-${version}.vsix`);
