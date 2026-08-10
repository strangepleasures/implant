import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { startServer, StartedServer, UnauthorizedAttempt } from './mcp-http-server';
import { askApproval } from './approval';
import { execute, ExecResult } from './executor';
import {
	skillMarkdown,
	cursorRules,
	clipboardSnippet,
	copilotInstructions,
	COPILOT_MARK_START,
	COPILOT_MARK_END,
} from './agent-instructions';

const SLOW_SCRIPT_MS = 10_000;
const UNAUTHORIZED_TOAST_THROTTLE_MS = 30_000;
const IMPLANT_DIR_REL = '.vscode/implant';
const SESSION_REL = `${IMPLANT_DIR_REL}/session.yml`;
const LEGACY_PORT_REL = '.vscode/implant.port';
const LEGACY_PORT_REL_V2 = `${IMPLANT_DIR_REL}/port`;
const GITIGNORE_BLOCK_HEADER = '# Implant (per-session secret — do not commit)';
const GITIGNORE_LINES = [SESSION_REL];
const SUPPRESS_PROMPT_KEY = 'implant.suppressInstallPromptFor';

let started: StartedServer | undefined;
let sessionAlwaysAllow = false;
let extensionUri: vscode.Uri | undefined;
let lastUnauthorizedToast = 0;

export async function activate(context: vscode.ExtensionContext) {
	const output = vscode.window.createOutputChannel('Implant');
	context.subscriptions.push(output);
	output.appendLine(`Implant activating on VS Code ${vscode.version}…`);

	extensionUri = context.extensionUri;

	context.subscriptions.push(
		vscode.commands.registerCommand('implant.installIntoWorkspace', () => installIntoWorkspace(context.extensionPath)),
		vscode.commands.registerCommand('implant.copyAgentInstructions', async () => {
			await vscode.env.clipboard.writeText(clipboardSnippet());
			vscode.window.showInformationMessage(
				'Implant: agent instructions copied. Paste into your agent\'s system prompt, AGENTS.md, or project rules.',
			);
		}),
	);

	const cfg = () => vscode.workspace.getConfiguration('implant');
	const port = cfg().get<number>('port', 0);
	const secret = crypto.randomBytes(32).toString('hex');

	try {
		started = await startServer({
			port,
			secret,
			serverVersion: (context.extension.packageJSON as { version: string }).version,
			runScript: code => runScript(code, output, cfg),
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
		// Clean up legacy paths from earlier versions.
		try { fs.unlinkSync(path.join(root, LEGACY_PORT_REL)); } catch { /* ignore */ }
		try { fs.unlinkSync(path.join(root, LEGACY_PORT_REL_V2)); } catch { /* ignore */ }
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

async function installIntoWorkspace(extensionPath: string) {
	const folders = vscode.workspace.workspaceFolders ?? [];
	if (folders.length === 0) {
		vscode.window.showErrorMessage('Implant: open a workspace folder first.');
		return;
	}
	const folder = folders.length === 1
		? folders[0]
		: await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Install Implant agent files into which workspace folder?' });
	if (!folder) return;
	await installIntoFolder(folder, extensionPath);
}

async function installIntoFolder(folder: vscode.WorkspaceFolder, extensionPath: string) {
	const root = folder.uri.fsPath;
	const dispatcher = fs.readFileSync(path.join(extensionPath, 'bin', 'call.js'), 'utf8');
	const wholeFileTargets: Array<{ rel: string; contents: string }> = [
		{ rel: '.vscode/implant/call.js', contents: dispatcher },
		{ rel: '.claude/skills/implant/SKILL.md', contents: skillMarkdown() },
		{ rel: '.cursor/rules/implant.mdc', contents: cursorRules() },
	];

	const results: string[] = [];
	for (const t of wholeFileTargets) {
		const abs = path.join(root, t.rel);
		try {
			if (fs.existsSync(abs)) {
				const pick = await vscode.window.showWarningMessage(
					`${t.rel} already exists. Overwrite?`,
					{ modal: true },
					'Overwrite',
				);
				if (pick !== 'Overwrite') { results.push(`skipped ${t.rel}`); continue; }
			}
			fs.mkdirSync(path.dirname(abs), { recursive: true });
			fs.writeFileSync(abs, t.contents);
			if (t.rel === '.vscode/implant/call.js' && process.platform !== 'win32') fs.chmodSync(abs, 0o755);
			results.push(`wrote ${t.rel}`);
		} catch (err) {
			results.push(`failed ${t.rel}: ${(err as Error).message}`);
		}
	}

	try {
		const action = upsertFencedBlock(
			path.join(root, '.github/copilot-instructions.md'),
			copilotInstructions(),
			COPILOT_MARK_START,
			COPILOT_MARK_END,
		);
		results.push(`${action} .github/copilot-instructions.md`);
	} catch (err) {
		results.push(`failed .github/copilot-instructions.md: ${(err as Error).message}`);
	}

	const mcpEntry = { command: 'node', args: ['.vscode/implant/call.js'] };
	for (const rel of ['.mcp.json', '.cursor/mcp.json']) {
		try {
			// Cursor requires `type: "stdio"` explicitly; Claude Code accepts it either way.
			const entry = rel.startsWith('.cursor/') ? { type: 'stdio', ...mcpEntry } : mcpEntry;
			const action = upsertMcpServer(path.join(root, rel), 'implant', entry);
			results.push(`${action} ${rel} (implant)`);
		} catch (err) {
			results.push(`failed ${rel}: ${(err as Error).message}`);
		}
	}

	const pick = await vscode.window.showInformationMessage(
		`Implant installed into ${folder.name}:\n${results.join('\n')}\n\nAll files are portable — commit them so teammates get the same setup. The session file at ${SESSION_REL} is auto-written and gitignored. In Claude Code, allowlist \`mcp__implant__run_vscode_script\` once and it stops prompting per-call.`,
		'Open skill',
	);
	if (pick === 'Open skill') {
		const doc = await vscode.workspace.openTextDocument(path.join(root, '.claude/skills/implant/SKILL.md'));
		await vscode.window.showTextDocument(doc);
	}
}

function folderSupportsImplant(root: string): boolean {
	if (fs.existsSync(path.join(root, '.vscode/implant/call.js'))) return true;
	if (fs.existsSync(path.join(root, '.claude/skills/implant/SKILL.md'))) return true;
	if (fs.existsSync(path.join(root, '.cursor/rules/implant.mdc'))) return true;
	for (const rel of ['.mcp.json', '.cursor/mcp.json']) {
		try {
			const mcp = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
			if (mcp?.mcpServers?.implant) return true;
		} catch { /* file may not exist */ }
	}
	try {
		const copilot = fs.readFileSync(path.join(root, '.github/copilot-instructions.md'), 'utf8');
		if (copilot.includes(COPILOT_MARK_START)) return true;
	} catch { /* file may not exist */ }
	return false;
}

async function maybePromptToInstall(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder) {
	const root = folder.uri.fsPath;
	if (folderSupportsImplant(root)) return;
	const suppressed = context.globalState.get<string[]>(SUPPRESS_PROMPT_KEY, []);
	if (suppressed.includes(root)) return;

	const pick = await vscode.window.showInformationMessage(
		`Implant isn't set up for '${folder.name}'. Add skill/rules files so agents in this workspace know about it?`,
		'Install',
		'Not now',
		"Don't ask for this folder",
	);
	if (pick === 'Install') {
		await installIntoFolder(folder, context.extensionPath);
	} else if (pick === "Don't ask for this folder") {
		await context.globalState.update(SUPPRESS_PROMPT_KEY, [...suppressed, root]);
	}
}

function upsertMcpServer(target: string, name: string, entry: Record<string, unknown>): 'wrote' | 'updated' {
	let json: any = {};
	let existed = false;
	try {
		json = JSON.parse(fs.readFileSync(target, 'utf8'));
		existed = true;
	} catch { /* missing or unparseable — start fresh */ }
	if (!json || typeof json !== 'object') json = {};
	if (!json.mcpServers || typeof json.mcpServers !== 'object') json.mcpServers = {};
	json.mcpServers[name] = entry;
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, JSON.stringify(json, null, 2) + '\n');
	return existed ? 'updated' : 'wrote';
}

function upsertFencedBlock(target: string, block: string, start: string, end: string): 'wrote' | 'updated' {
	let existing = '';
	let existed = false;
	try { existing = fs.readFileSync(target, 'utf8'); existed = true; } catch { /* missing is fine */ }

	const trimmedBlock = block.trim() + '\n';
	const startIdx = existing.indexOf(start);
	const endIdx = existing.indexOf(end);

	let updated: string;
	if (startIdx >= 0 && endIdx > startIdx) {
		updated = existing.slice(0, startIdx) + trimmedBlock + existing.slice(endIdx + end.length).replace(/^\n+/, '\n');
	} else {
		const prefix = existing && !existing.endsWith('\n') ? existing + '\n' : existing;
		const separator = existing ? '\n' : '';
		updated = prefix + separator + trimmedBlock;
	}

	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, updated);
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
): Promise<ExecResult> {
	const started = Date.now();
	const approved = await confirmExecution(code, output);
	if (!approved) {
		return {
			ok: false,
			error: { name: 'Error', message: 'User declined to run the script.' },
			logs: [],
			durationMs: Date.now() - started,
		};
	}
	const timeoutMs = cfg().get<number>('timeoutMs', 0);
	const controller = new AbortController();
	const runPromise = execute(code, timeoutMs, controller.signal);
	watchForSlowScript(runPromise, controller);
	return runPromise;
}

function watchForSlowScript(runPromise: Promise<ExecResult>, controller: AbortController) {
	let settled = false;
	runPromise.finally(() => { settled = true; });
	const timer = setTimeout(() => {
		if (settled) return;
		vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'Implant script is still running',
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
