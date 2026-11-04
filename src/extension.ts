import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { startServer, StartedServer, UnauthorizedAttempt } from './mcp-http-server';
import { askApproval } from './approval';
import { execute, ExecResult } from './executor';
import { registerChatParticipant } from './chat-participant';
import { skillMarkdown, clipboardSnippet, cursorRule, agentsSection, SKILL_REFERENCES } from './agent-instructions';

const SLOW_SCRIPT_MS = 10_000;
const UNAUTHORIZED_TOAST_THROTTLE_MS = 30_000;
const IMPLANT_DIR_REL = '.vscode/implant';
const SESSION_REL = `${IMPLANT_DIR_REL}/session.yml`;
const GITIGNORE_BLOCK_HEADER = '# Implant (per-session secret — do not commit)';
const GITIGNORE_LINES = [SESSION_REL];
const SUPPRESS_PROMPT_KEY = 'implant.suppressInstallPromptFor';

let started: StartedServer | undefined;
let sessionAlwaysAllow = false;
let extensionUri: vscode.Uri | undefined;
let lastUnauthorizedToast = 0;
// Tracks the AbortController for every script currently in flight, so the
// `terminate_scripts` MCP tool can abort them all in one call. Controllers
// remove themselves when their script settles.
const liveControllers = new Set<AbortController>();

export async function activate(context: vscode.ExtensionContext) {
	const output = vscode.window.createOutputChannel('Implant');
	context.subscriptions.push(output);
	output.appendLine(`Implant activating on VS Code ${vscode.version}…`);

	extensionUri = context.extensionUri;

	context.subscriptions.push(
		vscode.commands.registerCommand('implant.installIntoWorkspace', () => installIntoWorkspace(context)),
		vscode.commands.registerCommand('implant.copyAgentInstructions', async () => {
			await vscode.env.clipboard.writeText(clipboardSnippet());
			vscode.window.showInformationMessage(
				'Implant: agent instructions copied. Paste into your agent\'s system prompt, AGENTS.md, or project rules.',
			);
		}),
	);

	const cfg = () => vscode.workspace.getConfiguration('implant');
	registerChatParticipant(context, output, (code, options) => runScript(code, output, cfg, options));
	const port = cfg().get<number>('port', 0);
	const secret = crypto.randomBytes(32).toString('hex');

	try {
		started = await startServer({
			port,
			secret,
			serverVersion: (context.extension.packageJSON as { version: string }).version,
			runScript: (code, timeoutOverrideMs) => runScript(code, output, cfg, { timeoutOverrideMs }),
			terminateAll: () => {
				const count = liveControllers.size;
				for (const c of liveControllers) c.abort();
				if (count) output.appendLine(`terminate_scripts: aborted ${count} in-flight script(s)`);
				return count;
			},
			onUnauthorized: attempt => reportUnauthorized(attempt, output),
		});
	} catch (err) {
		vscode.window.showErrorMessage(`Implant: failed to start MCP server: ${(err as Error).message}`);
		output.appendLine(`startServer failed: ${(err as Error).stack ?? err}`);
		return;
	}

	output.appendLine(`MCP endpoint: ${started.url}`);
	writeSessionFiles(started.port, secret, output);

	// Rewrite session files and prompt for install whenever workspace folders change.
	context.subscriptions.push(
		vscode.workspace.onDidChangeWorkspaceFolders(e => {
			writeSessionFiles(started!.port, secret, output);
			for (const f of e.added) void maybePromptToInstall(context, f);
		}),
	);

	// Prompt for all currently open folders (covers fresh install + normal window open).
	for (const f of vscode.workspace.workspaceFolders ?? []) {
		void maybePromptToInstall(context, f);
	}

	context.subscriptions.push({
		dispose: () => {
			started?.dispose();
			removeSessionFiles();
		},
	});

	registerMcpProvider(context, started.url, output);
}

export function deactivate() {
	started?.dispose();
	started = undefined;
	removeSessionFiles();
}

function workspaceRoots(): string[] {
	return (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
}

function writeSessionFiles(port: number, secret: string, output: vscode.OutputChannel) {
	const body = `port: ${port}\nsecret: ${secret}\n`;
	for (const root of workspaceRoots()) {
		const target = path.join(root, SESSION_REL);
		try {
			fs.mkdirSync(path.dirname(target), { recursive: true });
			fs.writeFileSync(target, body, { mode: 0o600 });
			ensureGitignore(root, output);
			output.appendLine(`Wrote session file to ${target}`);
		} catch (err) {
			output.appendLine(`Could not write ${target}: ${(err as Error).message}`);
		}
	}
}

function removeSessionFiles() {
	for (const root of workspaceRoots()) {
		try { fs.unlinkSync(path.join(root, SESSION_REL)); } catch { /* ignore */ }
	}
}

function reportUnauthorized(attempt: UnauthorizedAttempt, output: vscode.OutputChannel) {
	const detail = `${attempt.method} ${attempt.url} from ${attempt.remoteAddress ?? '?'}` +
		(attempt.userAgent ? ` — User-Agent: ${attempt.userAgent}` : '') +
		` — ${attempt.reason} auth header`;
	output.appendLine(`Rejected unauthorized request: ${detail}`);
	const now = Date.now();
	if (now - lastUnauthorizedToast < UNAUTHORIZED_TOAST_THROTTLE_MS) return;
	lastUnauthorizedToast = now;
	vscode.window.showWarningMessage(
		`Implant rejected an unauthorized request${attempt.userAgent ? ` from ${attempt.userAgent}` : ''}. See the Implant output channel for details.`,
		'Open Output',
	).then(pick => { if (pick === 'Open Output') output.show(); });
}

function ensureGitignore(root: string, output: vscode.OutputChannel) {
	const gitignorePath = path.join(root, '.gitignore');
	let existing = '';
	try { existing = fs.readFileSync(gitignorePath, 'utf8'); } catch { /* missing is fine */ }
	const lines = new Set(existing.split(/\r?\n/).map(l => l.trim()));
	const missing = GITIGNORE_LINES.filter(l => !lines.has(l));
	if (missing.length === 0) return;
	const prefix = existing && !existing.endsWith('\n') ? existing + '\n' : existing;
	const block = (existing ? '\n' : '') + `${GITIGNORE_BLOCK_HEADER}\n${missing.join('\n')}\n`;
	try {
		fs.writeFileSync(gitignorePath, prefix + block);
		output.appendLine(`Added ${missing.join(', ')} to ${gitignorePath}`);
	} catch (err) {
		output.appendLine(`Could not update ${gitignorePath}: ${(err as Error).message}`);
	}
}

async function installIntoWorkspace(context: vscode.ExtensionContext) {
	const folders = vscode.workspace.workspaceFolders ?? [];
	if (folders.length === 0) {
		vscode.window.showErrorMessage('Implant: open a workspace folder first.');
		return;
	}
	const folder = folders.length === 1
		? folders[0]
		: await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Install Implant agent files into which workspace folder?' });
	if (!folder) return;
	await installIntoFolder(folder, context);
}

const SKILL_DIR_REL = '.agents/skills/implant';
const SKILL_REL = `${SKILL_DIR_REL}/SKILL.md`;
const CLAUDE_SKILL_DIR_REL = '.claude/skills/implant';
const CURSOR_RULE_REL = '.cursor/rules/implant.mdc';
const AGENTS_MD_REL = 'AGENTS.md';

async function installIntoFolder(folder: vscode.WorkspaceFolder, context: vscode.ExtensionContext) {
	const root = folder.uri.fsPath;
	const version = (context.extension.packageJSON as { version: string }).version;
	const dispatcher = fs.readFileSync(path.join(context.extensionPath, 'bin', 'call.js'), 'utf8');
	const skillBody = skillMarkdown(version);
	// `.agents/skills/implant/` is the canonical source of truth (single SKILL.md +
	// a `references/` tree; progressive-disclosure format). Since coding assistants
	// disagree on where they discover skills, mirror the tree into per-assistant
	// locations too:
	//   .claude/skills/implant/  — Claude Code reads project-level skills from here
	//   .cursor/rules/implant.mdc — Cursor rule wrapping the skill body
	//   AGENTS.md                 — pointer for tools that read the root file (Codex,
	//                                Copilot chat, Gemini CLI, others)
	// Copies (not symlinks) for cross-platform compat; the update prompt at version
	// bumps refreshes every copy. Plus the stdio↔HTTP proxy launched by non-in-editor
	// MCP clients via `.mcp.json`.
	const wholeFileTargets: Array<{ rel: string; contents: string }> = [
		{ rel: '.vscode/implant/call.js', contents: dispatcher },
		{ rel: SKILL_REL, contents: skillBody },
		...SKILL_REFERENCES.map(r => ({
			rel: `${SKILL_DIR_REL}/references/${r.path}.md`,
			contents: r.contents,
		})),
		{ rel: `${CLAUDE_SKILL_DIR_REL}/SKILL.md`, contents: skillBody },
		...SKILL_REFERENCES.map(r => ({
			rel: `${CLAUDE_SKILL_DIR_REL}/references/${r.path}.md`,
			contents: r.contents,
		})),
		{ rel: CURSOR_RULE_REL, contents: cursorRule(version) },
	];

	// Classify every target before writing anything. Files whose current content
	// matches what we'd write are `unchanged` (silent no-op); files that don't
	// exist are `new`; files with differing content are `differs` and trigger one
	// consolidated overwrite prompt below.
	type Classified = { target: typeof wholeFileTargets[number]; abs: string; kind: 'new' | 'unchanged' | 'differs' };
	const classified: Classified[] = wholeFileTargets.map(t => {
		const abs = path.join(root, t.rel);
		if (!fs.existsSync(abs)) return { target: t, abs, kind: 'new' };
		try {
			const existing = fs.readFileSync(abs, 'utf8');
			return { target: t, abs, kind: existing === t.contents ? 'unchanged' : 'differs' };
		} catch {
			return { target: t, abs, kind: 'differs' };
		}
	});

	const differing = classified.filter(c => c.kind === 'differs');
	let overwriteApproved = differing.length === 0;
	if (differing.length > 0) {
		const preview = differing.slice(0, 8).map(c => `  • ${c.target.rel}`).join('\n');
		const more = differing.length > 8 ? `\n  … and ${differing.length - 8} more` : '';
		const pick = await vscode.window.showWarningMessage(
			`Implant will overwrite ${differing.length} existing file${differing.length === 1 ? '' : 's'} in ${folder.name}:\n${preview}${more}`,
			{ modal: true },
			'Overwrite all',
		);
		overwriteApproved = pick === 'Overwrite all';
	}

	// Only mention files that actually changed. Files whose contents already
	// match what we'd write are silent no-ops — surfacing them just adds noise
	// to what should be a "here's what I did" summary.
	const results: string[] = [];
	for (const { target: t, abs, kind } of classified) {
		if (kind === 'unchanged') continue;
		if (kind === 'differs' && !overwriteApproved) { results.push(`skipped ${t.rel}`); continue; }
		try {
			fs.mkdirSync(path.dirname(abs), { recursive: true });
			fs.writeFileSync(abs, t.contents);
			if (t.rel === '.vscode/implant/call.js' && process.platform !== 'win32') fs.chmodSync(abs, 0o755);
			results.push(`wrote ${t.rel}`);
		} catch (err) {
			results.push(`failed ${t.rel}: ${(err as Error).message}`);
		}
	}

	try {
		const action = upsertMarkedBlock(path.join(root, AGENTS_MD_REL), 'implant', agentsSection());
		if (action !== 'unchanged') results.push(`${action} ${AGENTS_MD_REL} (implant section)`);
	} catch (err) {
		results.push(`failed ${AGENTS_MD_REL}: ${(err as Error).message}`);
	}

	const mcpEntry = { command: 'node', args: ['.vscode/implant/call.js'] };
	for (const rel of ['.mcp.json', '.cursor/mcp.json']) {
		try {
			// Cursor requires `type: "stdio"` explicitly; Claude Code accepts it either way.
			const entry = rel.startsWith('.cursor/') ? { type: 'stdio', ...mcpEntry } : mcpEntry;
			const action = upsertMcpServer(path.join(root, rel), 'implant', entry);
			if (action !== 'unchanged') results.push(`${action} ${rel} (implant)`);
		} catch (err) {
			results.push(`failed ${rel}: ${(err as Error).message}`);
		}
	}

	const summary = results.length ? results.join('\n') : 'Everything already up-to-date.';
	const pick = await vscode.window.showInformationMessage(
		`Implant installed into ${folder.name}:\n${summary}\n\nRestart any running coding agents (Claude Code, Cursor, Copilot chat, etc.) so they pick up the new skill — most discover skills only at startup.\n\nAll files are portable — commit them so teammates get the same setup. The session file at ${SESSION_REL} is auto-written and gitignored. In Claude Code, allowlist \`mcp__implant__run_vscode_script\` once and it stops prompting per-call.`,
		'Open skill',
	);
	if (pick === 'Open skill') {
		const doc = await vscode.workspace.openTextDocument(path.join(root, SKILL_REL));
		await vscode.window.showTextDocument(doc);
	}
}

/**
 * Reads the installed skill's frontmatter and returns its `version:` field. Returns
 * `undefined` when the skill file is missing OR when the frontmatter lacks a version
 * (skill files written by v0.2.1 and earlier don't include the version field).
 */
function readInstalledSkillVersion(root: string): string | undefined {
	let text: string;
	try { text = fs.readFileSync(path.join(root, SKILL_REL), 'utf8'); }
	catch { return undefined; }
	const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!fm) return undefined;
	const line = fm[1].split(/\r?\n/).find(l => /^version\s*:/.test(l));
	return line ? line.replace(/^version\s*:\s*/, '').trim() || undefined : undefined;
}

/** Legacy install detector — recognizes pre-0.2.2 layouts so upgrading users see an
 * "Update" prompt instead of a redundant "Install" prompt. Just knowing the workspace
 * has *some* prior Implant setup is enough; we don't try to parse the legacy version. */
function hasLegacyImplantInstall(root: string): boolean {
	if (fs.existsSync(path.join(root, '.claude/skills/implant/SKILL.md'))) return true;
	if (fs.existsSync(path.join(root, '.cursor/rules/implant.mdc'))) return true;
	if (fs.existsSync(path.join(root, '.vscode/implant/call.js'))) return true;
	for (const rel of ['.mcp.json', '.cursor/mcp.json']) {
		try {
			const mcp = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
			if (mcp?.mcpServers?.implant) return true;
		} catch { /* file may not exist */ }
	}
	return false;
}

/** Semver-ish comparison; enough for x.y.z-style extension versions. */
function compareVersions(a: string, b: string): number {
	const parse = (v: string) => v.split(/[.\-+]/).map(p => parseInt(p, 10) || 0);
	const aa = parse(a), bb = parse(b);
	for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
		const d = (aa[i] ?? 0) - (bb[i] ?? 0);
		if (d !== 0) return d;
	}
	return 0;
}

async function maybePromptToInstall(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder) {
	const root = folder.uri.fsPath;
	const suppressed = context.globalState.get<string[]>(SUPPRESS_PROMPT_KEY, []);
	if (suppressed.includes(root)) return;

	const currentVersion = (context.extension.packageJSON as { version: string }).version;
	const installedVersion = readInstalledSkillVersion(root);

	let action: 'install' | 'update';
	let message: string;
	if (installedVersion === undefined) {
		if (hasLegacyImplantInstall(root)) {
			action = 'update';
			message = `Implant is installed in '${folder.name}' using a pre-v0.2.2 layout. Migrate to the current skill format?`;
		} else {
			action = 'install';
			message = `Implant isn't set up for '${folder.name}'. Add the skill so agents in this workspace know about it?`;
		}
	} else if (compareVersions(installedVersion, currentVersion) < 0) {
		action = 'update';
		message = `The Implant skill in '${folder.name}' is v${installedVersion} but the extension is v${currentVersion}. Update?`;
	} else {
		return; // up to date
	}

	const primaryLabel = action === 'install' ? 'Install' : 'Update';
	const pick = await vscode.window.showInformationMessage(
		message,
		primaryLabel,
		'Not now',
		"Don't ask for this folder",
	);
	if (pick === primaryLabel) {
		await installIntoFolder(folder, context);
	} else if (pick === "Don't ask for this folder") {
		await context.globalState.update(SUPPRESS_PROMPT_KEY, [...suppressed, root]);
	}
}

/**
 * Insert or replace a block delimited by `<!-- ${marker}:start -->` / `<!-- ${marker}:end -->`
 * inside a markdown file. When the file doesn't exist, creates it. Idempotent — repeated
 * calls with identical block content report `unchanged`.
 */
function upsertMarkedBlock(target: string, marker: string, block: string): 'wrote' | 'updated' | 'unchanged' {
	const startTag = `<!-- ${marker}:start -->`;
	const endTag = `<!-- ${marker}:end -->`;
	const wrapped = `${startTag}\n${block.trim()}\n${endTag}`;
	let existing = '';
	let existed = false;
	try { existing = fs.readFileSync(target, 'utf8'); existed = true; } catch { /* missing is fine */ }

	const startIdx = existing.indexOf(startTag);
	const endIdx = existing.indexOf(endTag);
	let next: string;
	if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
		next = existing.slice(0, startIdx) + wrapped + existing.slice(endIdx + endTag.length);
	} else {
		const prefix = existing && !existing.endsWith('\n') ? existing + '\n' : existing;
		const separator = existing ? '\n' : '';
		next = prefix + separator + wrapped + '\n';
	}
	if (next === existing) return 'unchanged';
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, next);
	return existed ? 'updated' : 'wrote';
}

function upsertMcpServer(target: string, name: string, entry: Record<string, unknown>): 'wrote' | 'updated' | 'unchanged' {
	let json: any = {};
	let existed = false;
	let previousBody: string | undefined;
	try {
		previousBody = fs.readFileSync(target, 'utf8');
		json = JSON.parse(previousBody);
		existed = true;
	} catch { /* missing or unparseable — start fresh */ }
	if (!json || typeof json !== 'object') json = {};
	if (!json.mcpServers || typeof json.mcpServers !== 'object') json.mcpServers = {};
	json.mcpServers[name] = entry;
	const nextBody = JSON.stringify(json, null, 2) + '\n';
	if (existed && previousBody === nextBody) return 'unchanged';
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, nextBody);
	return existed ? 'updated' : 'wrote';
}

function registerMcpProvider(context: vscode.ExtensionContext, url: string, output: vscode.OutputChannel) {
	const lm: any = (vscode as any).lm;
	if (!lm?.registerMcpServerDefinitionProvider) {
		output.appendLine('vscode.lm.registerMcpServerDefinitionProvider not present — point your agent at the endpoint manually.');
		return;
	}

	const HttpDef = (vscode as any).McpHttpServerDefinition;
	if (!HttpDef) {
		output.appendLine('McpHttpServerDefinition not present — configure the MCP endpoint manually.');
		return;
	}

	const provider = {
		provideMcpServerDefinitions: () => [new HttpDef('Implant', vscode.Uri.parse(url))],
		resolveMcpServerDefinition: (def: unknown) => def,
	};

	try {
		context.subscriptions.push(lm.registerMcpServerDefinitionProvider('implant', provider));
		output.appendLine('Registered MCP server definition provider.');
	} catch (err) {
		output.appendLine(`MCP registration failed: ${(err as Error).message}`);
	}
}

async function runScript(
	code: string,
	output: vscode.OutputChannel,
	cfg: () => vscode.WorkspaceConfiguration,
	options: { skipApproval?: boolean; signal?: AbortSignal; timeoutOverrideMs?: number } = {},
): Promise<ExecResult> {
	const started = Date.now();
	if (!options.skipApproval) {
		const approved = await confirmExecution(code, output);
		if (!approved) {
			return {
				ok: false,
				error: { name: 'Error', message: 'User declined to run the script.' },
				logs: [],
				durationMs: Date.now() - started,
			};
		}
	}
	// Per-call `timeoutMs` argument wins over the workspace `implant.timeoutMs` setting.
	const timeoutMs = options.timeoutOverrideMs !== undefined
		? options.timeoutOverrideMs
		: cfg().get<number>('timeoutMs', 0);
	const controller = new AbortController();
	// Forward an externally-supplied signal (e.g. the chat request's cancellation token)
	// so the caller can abort the running snippet.
	if (options.signal) {
		if (options.signal.aborted) controller.abort();
		else options.signal.addEventListener('abort', () => controller.abort(), { once: true });
	}
	liveControllers.add(controller);
	const runPromise = execute(code, timeoutMs, controller.signal);
	runPromise.finally(() => liveControllers.delete(controller));
	watchForSlowScript(runPromise, controller, code);
	return runPromise;
}

// Pulls the first `//` comment line off the top of a snippet — the convention
// documented in SKILL.md is that every script starts with a one-line comment
// describing what it does. Used to identify which script the slow-run
// notification is talking about when several are queued.
function topCommentLine(code: string): string | null {
	for (const raw of code.split('\n')) {
		const line = raw.trim();
		if (!line) continue;
		const m = /^\/\/\s*(.+?)\s*$/.exec(line);
		return m ? m[1] : null;
	}
	return null;
}

function watchForSlowScript(runPromise: Promise<ExecResult>, controller: AbortController, code: string) {
	let settled = false;
	runPromise.finally(() => { settled = true; });
	const timer = setTimeout(() => {
		if (settled) return;
		const hint = topCommentLine(code);
		const title = hint
			? `Implant script is still running — ${hint.length > 80 ? hint.slice(0, 79) + '…' : hint}`
			: 'Implant script is still running';
		vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title,
				cancellable: true,
			},
			async (_progress, token) => {
				const cancelSub = token.onCancellationRequested(() => controller.abort());
				try {
					await runPromise;
				} catch { /* swallow — result is reported through the MCP reply */ }
				cancelSub.dispose();
			},
		);
	}, SLOW_SCRIPT_MS);
	runPromise.finally(() => clearTimeout(timer));
}

async function confirmExecution(code: string, output: vscode.OutputChannel): Promise<boolean> {
	const cfg = vscode.workspace.getConfiguration('implant');
	if (!cfg.get<boolean>('requireConfirmation', true)) return true;
	if (sessionAlwaysAllow) return true;

	output.appendLine('--- incoming script ---');
	output.appendLine(code);
	output.appendLine('-----------------------');

	const choice = await askApproval(code, extensionUri!);
	if (choice === 'trust') {
		sessionAlwaysAllow = true;
		return true;
	}
	return choice === 'run';
}
