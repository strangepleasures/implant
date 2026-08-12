#!/usr/bin/env node
// Test harness. For each example script under
// assets/skills/implant/references/examples/ that has a matching expected
// file in test/expected/, this:
//   1. copies the fixture directory into a fresh temp dir
//   2. spawns a new VS Code window on that dir
//   3. runs the script via the Implant MCP endpoint
//   4. compares the output against test/expected/<name>.{md,json}
//   5. closes the window + removes the temp dir
//
// One window per test — trivially isolated, no snapshot / restore / dirty-buffer
// dance. Slow (each window pays a cold-Pylance tax), but the state model is
// impossible to get wrong.
//
// A script is skipped when no expected file exists for it. Expected files are
// hand-authored — write `test/expected/<name>.md` (markdown output) or
// `test/expected/<name>.json` (structured output); the harness matches by name.
// The mismatch report prints a line diff, so iterate: run, copy the "+ got"
// lines into the expected file, run again.
//
// Placeholder in expected files:
//   {{PROJECT}} — substituted with the per-test temp fixture path.
// Scripts must only emit paths that live inside PROJECT; any external URI
// must be reported by name only (see get-type-hierarchy.js for the pattern).
//
// Usage: node test/out/run-examples.js [--filter <substring>]

import { spawn, spawnSync } from "node:child_process";
import { readFile, readdir, cp, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const HERE          = path.dirname(fileURLToPath(import.meta.url));
// This file compiles to test/out/run-examples.js, so the repo root is two
// levels up (test/out → test → repo).
const REPO_ROOT     = path.resolve(HERE, "..", "..");
const FIXTURE_DIR   = path.join(REPO_ROOT, "test/fixtures/test-projects/python");
const EXAMPLES_DIR  = path.join(REPO_ROOT, "assets/skills/implant/references/examples");
const EXPECTED_DIR  = path.join(REPO_ROOT, "test/expected");
// Checked-in template. `security.workspace.trust.enabled` is application-scoped
// in VS Code, so it can't be set from the fixture's workspace settings.json.
const HARNESS_USERDATA_TEMPLATE = path.join(REPO_ROOT, "test/harness-user-data");

// Dedicated VS Code user-data dir for the harness, isolated from the user's
// real editor. Trust prompts are disabled here so a per-test temp fixture dir
// doesn't ask "Do you trust the authors…" every time. Extensions still come
// from the user's real installation via --extensions-dir.
const HARNESS_USERDATA = path.join(os.tmpdir(), "implant-test-userdata");
const USER_EXTENSIONS  = path.join(os.homedir(), ".vscode/extensions");

// AI-assistant extensions add background traffic (chat sidebars, inline
// completions, extra diagnostics) that slows the fixture window and can prompt
// mid-test. Disable them per-window so tests stay reproducible.
const DISABLED_EXTENSIONS = [
	"GitHub.copilot",
	"GitHub.copilot-chat",
	"Anthropic.claude-code",
];

const SCRIPT_TIMEOUT_MS = 60_000;

const args = process.argv.slice(2);
const FILTER_IDX = args.indexOf("--filter");
const FILTER: string | null =
	FILTER_IDX >= 0 && args[FILTER_IDX + 1] && !args[FILTER_IDX + 1].startsWith("--")
		? args[FILTER_IDX + 1]
		: null;

function log(...m: unknown[]): void { console.log("[test]", ...m); }

// ---------- MCP client types ----------

interface Session { port: number; secret: string; }

interface ExecOk<T = unknown> { ok: true; value: T; durationMs: number; logs?: unknown[]; }
interface ExecErr { ok: false; error: { name: string; message: string; stack?: string }; durationMs: number; logs?: unknown[]; }
type ExecResult<T = unknown> = ExecOk<T> | ExecErr;

interface McpClient {
	initialize(): Promise<unknown>;
	runScript<T = unknown>(code: string, timeoutMs?: number): Promise<ExecResult<T>>;
	terminateScripts(): Promise<number>;
}

// ---------- expected-output types ----------

type ExpectedSpec =
	| { kind: "md"; raw: string }
	| { kind: "json"; raw: string; parsed: unknown };

interface CompareOutcome {
	pass: boolean;
	reason?: string;
	// String form of the expected / actual value — trimmed markdown for `.md`
	// specs, sorted-key pretty JSON for `.json` specs. Kept as strings so the
	// mismatch report can print them verbatim.
	want?: string;
	got?: string;
}

// ---------- test-result types ----------

type Result =
	| { name: string; status: "pass"; durationMs: number }
	| { name: string; status: "fail"; durationMs: number; outcome: CompareOutcome }
	| { name: string; status: "error"; detail: string }
	| { name: string; status: "skipped"; detail: string };

// ---------- fixture: copy into a fresh temp dir ----------

async function copyFixtureToTemp(): Promise<string> {
	const tempDir = path.join(os.tmpdir(), `implant-fixture-${randomBytes(6).toString("hex")}`);
	await cp(FIXTURE_DIR, tempDir, { recursive: true });
	return tempDir;
}

// ---------- VS Code window lifecycle ----------

async function ensureHarnessUserData(): Promise<void> {
	// Nuke + copy from the checked-in template so a stale config from a prior
	// run can't leak in.
	await rm(HARNESS_USERDATA, { recursive: true, force: true });
	await cp(HARNESS_USERDATA_TEMPLATE, HARNESS_USERDATA, { recursive: true });
}

// On a cold start, `code --new-window <dir>` sometimes leaves a default empty
// window behind alongside the fixture window. That empty window has no
// workspace folder, so Implant never writes a session.yml for it and
// closeWindow can't reach it over MCP. At end of the suite, kill every Code
// process whose command line references our specific HARNESS_USERDATA tmp
// path — that scopes the kill to harness-owned processes and can't touch the
// user's real editor.
function killHarnessCodeProcesses(): void {
	// SIGKILL — the main Electron process ignores SIGTERM here (only helpers
	// die), so a graceful signal would leave a zombie main window behind.
	spawnSync("pkill", ["-9", "-f", HARNESS_USERDATA], { stdio: "ignore" });
}

function openWindow(dir: string): void {
	const codeArgs = [
		"--new-window",
		"--user-data-dir", HARNESS_USERDATA,
		"--extensions-dir", USER_EXTENSIONS,
	];
	for (const id of DISABLED_EXTENSIONS) codeArgs.push(`--disable-extension=${id}`);
	codeArgs.push(dir);
	const child = spawn("code", codeArgs, { detached: true, stdio: "ignore" });
	child.unref();
}

async function waitForSession(dir: string, timeoutMs = 60_000): Promise<Session> {
	const sessionFile = path.join(dir, ".vscode/implant/session.yml");
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (existsSync(sessionFile)) {
			const raw = await readFile(sessionFile, "utf8");
			const port   = /^port:\s*(\d+)/m.exec(raw)?.[1];
			const secret = /^secret:\s*(\S+)/m.exec(raw)?.[1];
			if (port && secret) return { port: Number(port), secret };
		}
		await sleep(500);
	}
	throw new Error(`session file did not appear within ${timeoutMs}ms at ${sessionFile}`);
}

function makeClient({ port, secret }: Session): McpClient {
	const url = `http://127.0.0.1:${port}/mcp`;
	let sessionId: string | null = null;
	let nextId = 1;

	async function post(method: string, params: unknown, timeoutMs?: number): Promise<any> {
		const body = JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params });
		const headers: Record<string, string> = { "Content-Type": "application/json", "Authorization": `Bearer ${secret}` };
		if (sessionId) headers["Mcp-Session-Id"] = sessionId;
		const ctrl = timeoutMs ? new AbortController() : null;
		const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
		try {
			const res = await fetch(url, { method: "POST", headers, body, signal: ctrl?.signal });
			if (method === "initialize") sessionId = res.headers.get("Mcp-Session-Id");
			const text = await res.text();
			if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
			return JSON.parse(text);
		} finally {
			if (timer) clearTimeout(timer);
		}
	}

	return {
		initialize: () => post("initialize", {
			protocolVersion: "2025-06-18",
			capabilities: {},
			clientInfo: { name: "implant-example-tester", version: "0" },
		}),
		runScript: async <T = unknown,>(code: string, timeoutMs: number = SCRIPT_TIMEOUT_MS): Promise<ExecResult<T>> => {
			const reply = await post("tools/call", { name: "run_vscode_script", arguments: { code, timeoutMs } }, timeoutMs + 5000);
			const text: string | undefined = reply.result?.content?.[0]?.text;
			if (!text) throw new Error(`unexpected reply shape: ${JSON.stringify(reply)}`);
			return JSON.parse(text) as ExecResult<T>;
		},
		terminateScripts: async (): Promise<number> => {
			try {
				const reply = await post("tools/call", { name: "terminate_scripts", arguments: {} }, 5000);
				const payload = JSON.parse(reply.result?.content?.[0]?.text ?? "{}") as { aborted?: number };
				return payload.aborted ?? 0;
			} catch { return 0; }
		},
	};
}

// Best-effort close. terminate scripts, then revert every dirty buffer so
// closeWindow doesn't prompt "Do you want to save…". Reverting requires the
// doc to have an active editor — `workbench.action.files.revert` with a URI
// argument is a no-op for docs that were only `openTextDocument`'d (no tab).
// `showTextDocument` first, then revert, covers both cases.
//
// After firing the close command we wait for the extension's session.yml to
// disappear — the extension's dispose handler removes it, which is the
// authoritative signal that the extension host has torn down and released the
// user-data-dir singleton lock. Without this wait, the next test's `code
// --user-data-dir <shared>` call can race an in-flight shutdown and never get
// a fresh session file written.
async function closeWindow(client: McpClient, dir: string): Promise<void> {
	try {
		await client.terminateScripts();
		await client.runScript(`
for (const doc of vscode.workspace.textDocuments) {
	if (doc.isDirty) {
		try {
			await vscode.window.showTextDocument(doc, { preview: false });
			await vscode.commands.executeCommand("workbench.action.files.revert");
		} catch {}
	}
}
vscode.commands.executeCommand("workbench.action.closeWindow");
return "closing";
`, 10_000).catch(() => {});
		const sessionFile = path.join(dir, ".vscode/implant/session.yml");
		const deadline = Date.now() + 20_000;
		while (Date.now() < deadline && existsSync(sessionFile)) {
			await sleep(200);
		}
	} catch { /* best-effort */ }
}

// ---------- expected-output loading & comparison ----------

function makeToPlaceholderSpace(tempDir: string): (v: unknown) => unknown {
	function toPlaceholderSpace(value: unknown): unknown {
		if (typeof value === "string") return value.split(tempDir).join("{{PROJECT}}");
		if (Array.isArray(value)) return value.map(toPlaceholderSpace);
		if (value && typeof value === "object") {
			const out: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(value)) out[k] = toPlaceholderSpace(v);
			return out;
		}
		return value;
	}
	return toPlaceholderSpace;
}

// Canonical JSON with sorted keys — same input shape always produces the same
// string, so `canonJson(a) === canonJson(b)` is a correct structural equality
// check and the string form is what we already want to print on mismatch.
function canonJson(v: unknown): string {
	return JSON.stringify(v, (_k, val) => {
		if (val && typeof val === "object" && !Array.isArray(val)) {
			return Object.fromEntries(Object.keys(val).sort().map(k => [k, (val as Record<string, unknown>)[k]]));
		}
		return val;
	}, 2);
}

// Line-level LCS diff. Prints `want` and `got` interleaved with `-` / `+` /
// context markers, like a stripped-down unified diff. No dependency.
function lineDiff(want: string, got: string): string {
	const a = want.split("\n");
	const b = got.split("\n");
	const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
		}
	}
	const lines: string[] = [];
	let i = a.length, j = b.length;
	while (i > 0 || j > 0) {
		if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) { lines.push(`  ${a[i - 1]}`); i--; j--; }
		else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) { lines.push(`+ ${b[j - 1]}`); j--; }
		else { lines.push(`- ${a[i - 1]}`); i--; }
	}
	return lines.reverse().join("\n");
}

async function loadExpectedFiles(): Promise<Map<string, ExpectedSpec>> {
	const files = await readdir(EXPECTED_DIR).catch(() => [] as string[]);
	const map = new Map<string, ExpectedSpec>();
	for (const f of files) {
		if (!f.endsWith(".md") && !f.endsWith(".json")) continue;
		const name = f.replace(/\.(md|json)$/, "");
		const raw = await readFile(path.join(EXPECTED_DIR, f), "utf8");
		if (f.endsWith(".md")) {
			map.set(name, { kind: "md", raw });
		} else {
			map.set(name, { kind: "json", raw, parsed: JSON.parse(raw) });
		}
	}
	return map;
}

function compare(actual: unknown, spec: ExpectedSpec, toPh: (v: unknown) => unknown): CompareOutcome {
	if (spec.kind === "md") {
		if (typeof actual !== "string") {
			return { pass: false, reason: `expected string (.md), got ${typeof actual}`, got: canonJson(actual) };
		}
		const want = spec.raw.trim();
		const got  = (toPh(actual) as string).trim();
		if (want === got) return { pass: true };
		return { pass: false, reason: "string mismatch", want, got };
	}
	if (typeof actual === "string") {
		return { pass: false, reason: "expected object/array (.json), got string", got: actual };
	}
	const want = canonJson(spec.parsed);
	const got  = canonJson(toPh(actual));
	if (want === got) return { pass: true };
	return { pass: false, reason: "json mismatch", want, got };
}

// ---------- per-test flow ----------

async function runOne(name: string, code: string, spec: ExpectedSpec): Promise<Result> {
	const tempDir = await copyFixtureToTemp();
	try {
		openWindow(tempDir);
		const session = await waitForSession(tempDir);
		const client = makeClient(session);
		await client.initialize();
		let execResult: ExecResult;
		try {
			execResult = await client.runScript(code);
		} catch (err) {
			await closeWindow(client, tempDir);
			return { name, status: "error", detail: `HTTP: ${(err as Error).message}` };
		}
		if (!execResult.ok) {
			await closeWindow(client, tempDir);
			return { name, status: "error", detail: `${execResult.error.name}: ${execResult.error.message}` };
		}
		const outcome = compare(execResult.value, spec, makeToPlaceholderSpace(tempDir));
		await closeWindow(client, tempDir);
		if (outcome.pass) return { name, status: "pass", durationMs: execResult.durationMs };
		return { name, status: "fail", durationMs: execResult.durationMs, outcome };
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
}

async function main(): Promise<void> {
	await ensureHarnessUserData();
	const expected = await loadExpectedFiles();
	const scriptFiles = (await readdir(EXAMPLES_DIR)).filter(f => f.endsWith(".js")).sort();
	const filtered = FILTER ? scriptFiles.filter(f => f.includes(FILTER)) : scriptFiles;
	log(`${scriptFiles.length} example scripts found${FILTER ? ` — filter "${FILTER}" narrows to ${filtered.length}` : ""}`);

	const results: Result[] = [];
	for (const file of filtered) {
		const name = file.replace(/\.js$/, "");
		const spec = expected.get(name);
		if (!spec) {
			results.push({ name, status: "skipped", detail: "no expected file" });
			console.log(`[test] ${name}… - skipped (no expected file)`);
			continue;
		}
		const code = await readFile(path.join(EXAMPLES_DIR, file), "utf8");
		process.stdout.write(`[test] ${name}… `);
		const r = await runOne(name, code, spec);
		results.push(r);
		console.log(
			r.status === "pass"  ? `PASS (${r.durationMs}ms)`
			: r.status === "fail"  ? `FAIL — ${r.outcome.reason}`
			: r.status === "error" ? `ERROR — ${r.detail}`
			: r.status
		);
	}

	console.log();
	console.log("=".repeat(80));
	const pass    = results.filter(r => r.status === "pass").length;
	const failed  = results.filter(r => r.status === "fail").length;
	const err     = results.filter(r => r.status === "error").length;
	const skipped = results.filter(r => r.status === "skipped").length;
	console.log(`Results: ${pass} pass  ·  ${failed} fail  ·  ${err} error  ·  ${skipped} skipped (of ${results.length})`);
	console.log("=".repeat(80));

	for (const r of results) {
		const glyph =
			r.status === "pass"  ? "\u2713"
			: r.status === "fail"  ? "\u2717"
			: r.status === "error" ? "!"
			: "-";
		const dur = "durationMs" in r ? ` (${r.durationMs}ms)` : "";
		const detail = "detail" in r ? `  — ${r.detail}` : "";
		console.log(`  ${glyph} ${r.name}${dur}${detail}`);
		if (r.status === "fail") {
			console.log(`      reason: ${r.outcome.reason}`);
			if (r.outcome.want !== undefined && r.outcome.got !== undefined) {
				console.log(`      diff (- want, + got):\n${indent(lineDiff(r.outcome.want, r.outcome.got), "        ")}`);
			} else if (r.outcome.got !== undefined) {
				console.log(`      got:\n${indent(r.outcome.got, "        ")}`);
			}
		}
	}

	killHarnessCodeProcesses();
	process.exit(failed + err > 0 ? 1 : 0);
}

function indent(text: string, prefix: string): string {
	return text.split("\n").map(l => prefix + l).join("\n");
}

main().catch(err => {
	console.error("[test] FATAL:", err instanceof Error ? err.stack ?? err.message : err);
	killHarnessCodeProcesses();
	process.exit(2);
});
