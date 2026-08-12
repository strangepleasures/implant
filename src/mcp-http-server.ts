import * as http from 'http';
import { randomUUID, timingSafeEqual } from 'crypto';
import { ExecResult } from './executor';
import { mcpToolDescription } from './agent-instructions';

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_NAME = 'implant';

const TOOLS = [
	{
		name: 'run_vscode_script',
		description: mcpToolDescription(),
		inputSchema: {
			type: 'object',
			properties: {
				code: {
					type: 'string',
					description: 'JavaScript source, executed as the body of an async function. Example: `const ed = vscode.window.activeTextEditor; return await vscode.commands.executeCommand("vscode.executeReferenceProvider", ed.document.uri, ed.selection.active);`',
				},
				timeoutMs: {
					type: 'number',
					description: 'Per-call hard timeout in milliseconds. Overrides the `implant.timeoutMs` setting for this call only. 0 disables the timeout. Handy when a call is expected to be slow (e.g. warming a language server) or when you want to abort a hang without relying on the setting.',
				},
			},
			required: ['code'],
		},
	},
	{
		name: 'terminate_scripts',
		description: 'Abort every currently-running Implant script in this window. Use when a previous run_vscode_script call is hanging (e.g. blocked on a save handler) and you need to unstick the extension host before firing another call. Returns the count of scripts that were signalled.',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
	},
];

export interface StartedServer {
	port: number;
	url: string;
	dispose(): void;
}

export interface ServerOptions {
	port: number;
	secret: string;
	serverVersion: string;
	runScript: (code: string, timeoutMs?: number) => Promise<ExecResult>;
	terminateAll: () => number;
	onUnauthorized?: (attempt: UnauthorizedAttempt) => void;
}

export interface UnauthorizedAttempt {
	method: string;
	url: string;
	remoteAddress?: string;
	userAgent?: string;
	reason: 'missing' | 'malformed' | 'mismatch';
}

export async function startServer(opts: ServerOptions): Promise<StartedServer> {
	const sessions = new Set<string>();

	const server = http.createServer(async (req, res) => {
		try {
			if (req.url !== '/mcp') {
				res.writeHead(404).end();
				return;
			}

			const authResult = checkAuth(req, opts.secret);
			if (authResult !== 'ok') {
				opts.onUnauthorized?.({
					method: req.method ?? '?',
					url: req.url ?? '?',
					remoteAddress: req.socket.remoteAddress,
					userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
					reason: authResult,
				});
				res.writeHead(401, { 'WWW-Authenticate': 'Bearer', 'Content-Type': 'application/json' })
					.end(JSON.stringify({ error: 'unauthorized' }));
				return;
			}

			if (req.method === 'GET') {
				res.writeHead(405, { Allow: 'POST, DELETE' }).end();
				return;
			}
			if (req.method === 'DELETE') {
				const sid = req.headers['mcp-session-id'];
				if (typeof sid === 'string') sessions.delete(sid);
				res.writeHead(204).end();
				return;
			}
			if (req.method !== 'POST') {
				res.writeHead(405, { Allow: 'POST, DELETE' }).end();
				return;
			}

			const body = await readBody(req);
			let msg: any;
			try {
				msg = JSON.parse(body);
			} catch {
				res.writeHead(400).end('invalid JSON');
				return;
			}

			// Notifications have no id -> ack with 202.
			if (msg.id === undefined) {
				res.writeHead(202).end();
				return;
			}

			const reply = await handle(msg, { sessions, opts });
			const headers: Record<string, string> = { 'Content-Type': 'application/json' };
			if (msg.method === 'initialize') {
				const sid = randomUUID();
				sessions.add(sid);
				headers['Mcp-Session-Id'] = sid;
			}
			res.writeHead(200, headers).end(JSON.stringify(reply));
		} catch (err) {
			try {
				res.writeHead(500, { 'Content-Type': 'application/json' })
					.end(JSON.stringify({ error: String((err as Error).message ?? err) }));
			} catch { /* ignore */ }
		}
	});

	const tryListen = (port: number) => new Promise<StartedServer>((resolve, reject) => {
		const onError = (err: NodeJS.ErrnoException) => { server.off('listening', onListen); reject(err); };
		const onListen = () => {
			server.off('error', onError);
			const addr = server.address();
			if (!addr || typeof addr === 'string') { reject(new Error('failed to bind')); return; }
			resolve({
				port: addr.port,
				url: `http://127.0.0.1:${addr.port}/mcp`,
				dispose: () => server.close(),
			});
		};
		server.once('error', onError);
		server.once('listening', onListen);
		server.listen(port, '127.0.0.1');
	});

	try {
		return await tryListen(opts.port);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE' && opts.port !== 0) {
			return await tryListen(0);
		}
		throw err;
	}
}

async function handle(
	msg: any,
	ctx: { sessions: Set<string>; opts: ServerOptions },
): Promise<any> {
	const reply = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id, result });
	const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: msg.id, error: { code, message } });

	switch (msg.method) {
		case 'initialize':
			return reply({
				protocolVersion: PROTOCOL_VERSION,
				capabilities: { tools: {} },
				serverInfo: { name: SERVER_NAME, version: ctx.opts.serverVersion },
			});

		case 'tools/list':
			return reply({ tools: TOOLS });

		case 'tools/call': {
			const name = msg.params?.name;
			const args = msg.params?.arguments ?? {};
			if (name === 'terminate_scripts') {
				const count = ctx.opts.terminateAll();
				return reply({
					isError: false,
					content: [{ type: 'text', text: JSON.stringify({ aborted: count }) }],
				});
			}
			if (name !== 'run_vscode_script') return fail(-32601, `Unknown tool: ${name}`);
			const code = typeof args.code === 'string' ? args.code : '';
			if (!code) return reply(toolError('Missing "code" argument.'));
			const timeoutMs = typeof args.timeoutMs === 'number' && args.timeoutMs >= 0 ? args.timeoutMs : undefined;

			const result = await ctx.opts.runScript(code, timeoutMs);
			return reply(toToolContent(result));
		}

		case 'ping':
			return reply({});

		default:
			return fail(-32601, `Method not found: ${msg.method}`);
	}
}

function checkAuth(req: http.IncomingMessage, expected: string): 'ok' | 'missing' | 'malformed' | 'mismatch' {
	const header = req.headers['authorization'];
	if (!header || typeof header !== 'string') return 'missing';
	const m = /^Bearer\s+(\S+)$/i.exec(header);
	if (!m) return 'malformed';
	const provided = Buffer.from(m[1], 'utf8');
	const wanted = Buffer.from(expected, 'utf8');
	if (provided.length !== wanted.length) return 'mismatch';
	return timingSafeEqual(provided, wanted) ? 'ok' : 'mismatch';
}

function toolError(message: string) {
	return { isError: true, content: [{ type: 'text', text: message }] };
}

function toToolContent(r: ExecResult) {
	const payload = {
		ok: r.ok,
		durationMs: r.durationMs,
		value: r.value,
		error: r.error,
		logs: r.logs,
	};
	return {
		isError: !r.ok,
		content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
	};
}

function readBody(req: http.IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on('data', c => chunks.push(c));
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		req.on('error', reject);
	});
}
