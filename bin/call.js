#!/usr/bin/env node
"use strict";

/*
 * Implant MCP stdio ↔ HTTP proxy.
 * Committed to the workspace via "Implant: Install into Workspace" and referenced
 * from .mcp.json. Claude Code (or any other MCP client that speaks stdio) launches
 * this process, and it forwards JSON-RPC messages to the local HTTP MCP server.
 *
 * The proxy exists because .mcp.json can't interpolate the per-session port and
 * secret. This file reads .vscode/implant/session.yml at launch — and again on
 * 401 — so window reloads that rotate the session are picked up automatically.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const readline = require("readline");

const SESSION_FILE = path.join(__dirname, "session.yml");

function loadSession() {
	let text;
	try {
		text = fs.readFileSync(SESSION_FILE, "utf8");
	} catch {
		return null;
	}
	const port = /^port:\s*(\d+)/m.exec(text);
	const secret = /^secret:\s*(\S+)/m.exec(text);
	if (!port || !secret) return null;
	return { port: Number(port[1]), secret: secret[1] };
}

let session = loadSession();
let sessionId;

function post(msg) {
	return new Promise((resolve, reject) => {
		if (!session) {
			resolve({ status: 0, body: `Cannot read ${SESSION_FILE}. Is the Implant VS Code extension running in this window?` });
			return;
		}
		const body = JSON.stringify(msg);
		const headers = {
			"Content-Type": "application/json",
			Authorization: `Bearer ${session.secret}`,
			"Content-Length": Buffer.byteLength(body),
		};
		if (sessionId) headers["Mcp-Session-Id"] = sessionId;
		const req = http.request(
			{ hostname: "127.0.0.1", port: session.port, path: "/mcp", method: "POST", headers },
			res => {
				const sid = res.headers["mcp-session-id"];
				if (typeof sid === "string") sessionId = sid;
				const chunks = [];
				res.on("data", c => chunks.push(c));
				res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
			},
		);
		req.on("error", err => resolve({ status: 0, body: err.message }));
		req.write(body);
		req.end();
	});
}

function errorReply(id, code, message) {
	return JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

async function handleLine(line) {
	if (!line.trim()) return;
	let msg;
	try { msg = JSON.parse(line); }
	catch (e) { process.stdout.write(errorReply(null, -32700, `Parse error: ${e.message}`) + "\n"); return; }

	let res = await post(msg);
	// Session rotation on VS Code reload changes both the port and the secret.
	// Reload session.yml and retry once on either 401 (wrong secret) or transport failure
	// (server not at the old port anymore).
	if (res.status === 401 || res.status === 0) {
		session = loadSession();
		sessionId = undefined;
		res = await post(msg);
	}
	if (res.status === 0) {
		if (msg.id !== undefined) process.stdout.write(errorReply(msg.id, -32000, `Transport error: ${res.body}`) + "\n");
		return;
	}
	if (res.status === 202) return; // notification ack, no response body
	if (res.status !== 200) {
		if (msg.id !== undefined) process.stdout.write(errorReply(msg.id, -32000, `HTTP ${res.status}: ${res.body}`) + "\n");
		return;
	}
	process.stdout.write(res.body + "\n");
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", line => { handleLine(line).catch(err => process.stderr.write(`implant proxy: ${err.stack || err.message}\n`)); });
rl.on("close", () => process.exit(0));
