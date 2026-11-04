import * as vscode from 'vscode';
import type { ExecResult } from './executor';
import { SKILL_REFERENCES, skillMarkdown, skillReference } from './agent-instructions';

// Chat-specific format rules. The model produces raw JavaScript that we execute
// verbatim, so no fences, no prose. Runtime primer + reference list follow.
const CHAT_PREAMBLE = `You are Implant, an assistant that answers requests by running a
JavaScript snippet inside the VS Code extension host and streaming the result to the user
in Copilot Chat.

# OUTPUT FORMAT

Your final response is passed verbatim to \`new Function()\` and executed. Every character
you emit must be valid JavaScript source. Your reply MUST begin with a \`//\` comment
describing intent — that is the only valid first token. No preamble, no explanation, no
code fence, no language tag, nothing before the first \`//\`. See the demonstration turn
that follows for the exact shape.

# WHAT TO RETURN FROM THE SNIPPET

The user reads the returned value directly in chat, so **return a Markdown string**: use
headings, bullet lists, code fences for source samples, and inline links for file
references (e.g. \`[src/foo.ts:42](vscode://file//abs/path/src/foo.ts?42)\`). Only return
raw JSON if the user explicitly asks for machine-readable output.

If the request truly can't be answered via a vscode.* call, still reply with plain JS
that returns an explanatory Markdown string, e.g. \`return "Sorry — this needs a shell
command, not a vscode.* call.";\`.`;

// The SKILL.md body (loaded once at module load) IS the primer + reference index. Same
// content agents everywhere else in the ecosystem read; no separate chat-only rendering
// so the two can't drift. `{{VERSION}}` isn't relevant to the LM, so we strip the
// frontmatter entirely for the system prompt.
const SKILL_BODY = skillMarkdown('n/a').replace(/^---[\s\S]*?---\s*/, '').trimEnd();

const SYSTEM_PROMPT = [CHAT_PREAMBLE, SKILL_BODY].join('\n\n');

// Few-shot demonstration turn. Injected at the top of every message list. Concrete examples
// of correctly-shaped replies are far more effective at enforcing format than any amount of
// prose — the model imitates what it sees.
const FEWSHOT_USER = 'count the .ts files under src/';
const FEWSHOT_ASSISTANT =
	`// Count TS files under src/, excluding node_modules.
const files = await vscode.workspace.findFiles('src/**/*.ts', '**/node_modules/**');
return files.length;`;

const REFERENCE_PATHS = SKILL_REFERENCES.map(r => r.path).sort();

const LM_TOOLS: vscode.LanguageModelChatTool[] = [{
	name: 'load_implant_reference',
	description:
		'Load one of the Implant skill references for deeper guidance. The `path` is ' +
		'relative to the skill\'s `references/` root. Prose docs (`.md`) are addressed ' +
		'by basename without the extension (e.g. `topics/ast-grep`, ' +
		'`vscode-docs-commands`). Runnable snippets under `examples/` keep their `.js` ' +
		'extension and are named by action (e.g. `examples/find-references.js`, ' +
		'`examples/rename-symbol.js`, `examples/render-dep-graph.js`). See the ' +
		'"References" section of the SKILL.md above for the catalog. Load only when ' +
		'the current task needs that specific detail; do not preload; do not request ' +
		'the same path twice.',
	inputSchema: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				enum: REFERENCE_PATHS,
				description: 'Path of the reference to load, relative to references/, without `.md`.',
			},
		},
		required: ['path'],
	},
}];
// Cap on tool-call rounds per user turn. Typical flow needs 0–1 rounds; more usually
// means the model is looping.
const MAX_TOOL_ROUNDS = 4;

type RunFn = (
	code: string,
	options?: { skipApproval?: boolean; signal?: AbortSignal },
) => Promise<ExecResult>;

interface PendingMeta {
	pendingCode: string;
	originalPrompt: string;
	retryCount: number;
}

export function registerChatParticipant(
	context: vscode.ExtensionContext,
	output: vscode.OutputChannel,
	run: RunFn,
) {
	const chat = (vscode as any).chat;
	const lm = (vscode as any).lm;
	if (typeof chat?.createChatParticipant !== 'function') {
		output.appendLine('Chat participant unavailable — vscode.chat API not present.');
		return;
	}

	const participant = chat.createChatParticipant(
		'implant.assistant',
		async (
			request: vscode.ChatRequest,
			chatCtx: vscode.ChatContext,
			stream: vscode.ChatResponseStream,
			token: vscode.CancellationToken,
		): Promise<vscode.ChatResult | void> => {
			// Fast-path: user clicked the "Run" followup (or typed just "run") on a turn that
			// left a pending snippet.
			if (request.prompt.trim().toLowerCase() === 'run') {
				const pending = findPendingMeta(chatCtx.history);
				if (!pending) {
					stream.markdown('_No pending snippet to run. Ask me something first._');
					return;
				}
				const result = await runAndRender(pending.pendingCode, stream, token, run);
				if (!result || result.ok || token.isCancellationRequested) return;
				if (pending.retryCount >= 1) {
					stream.markdown('\n\n_Retry limit reached — refine your request or ask a new question._');
					return;
				}
				return regenerateOnFailure(pending, result, request, stream, token, lm, run);
			}

			// Normal path: generate a snippet from the user's prompt, running the tool-call
			// loop so the model can pull references on demand.
			const model = await pickModel(request, lm);
			if (!model) {
				stream.markdown('_No language model available. Install GitHub Copilot to use `@implant`._');
				return;
			}
			const messages = buildMessages(request, chatCtx);
			const text = await runLmWithTools(model, messages, stream, token);
			if (text === undefined) return;

			const code = stripCodeFence(text);
			if (!code) {
				stream.markdown('_Empty response from the language model._');
				return;
			}
			stream.markdown('```js\n' + code + '\n```');
			return presentSnippet(code, request.prompt, /* retryCount */ 0, stream, token, run);
		},
	);

	participant.followupProvider = {
		provideFollowups(result: vscode.ChatResult): vscode.ChatFollowup[] {
			const meta = result?.metadata as PendingMeta | undefined;
			if (!meta?.pendingCode) return [];
			return [{ label: '▶ Run this snippet', prompt: 'run' }];
		},
	};

	participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'assets', 'icon.png');
	context.subscriptions.push(participant);
	output.appendLine('Registered @implant chat participant.');
}

async function pickModel(request: vscode.ChatRequest, lm: any): Promise<vscode.LanguageModelChat | undefined> {
	if (request.model) return request.model;
	if (typeof lm?.selectChatModels !== 'function') return undefined;
	const models = await lm.selectChatModels({ vendor: 'copilot' });
	return models?.[0];
}

/**
 * Drives the LM through the tool-call loop. On each round we stream the response; if the
 * model emits `LanguageModelToolCallPart`s we invoke the referenced skill files locally,
 * feed the results back as a follow-up user turn, and re-issue. When only text arrives,
 * that text is the final snippet. Returns the accumulated text across all rounds.
 */
async function runLmWithTools(
	model: vscode.LanguageModelChat,
	initialMessages: vscode.LanguageModelChatMessage[],
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
): Promise<string | undefined> {
	const messages = [...initialMessages];
	const loaded = new Set<string>();
	let finalText = '';

	for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
		let resp: vscode.LanguageModelChatResponse;
		try {
			resp = await model.sendRequest(messages, { tools: LM_TOOLS }, token);
		} catch (err) {
			stream.markdown('\n\n_Language model request failed: ' + (err as Error).message + '_');
			return undefined;
		}

		let text = '';
		const toolCalls: vscode.LanguageModelToolCallPart[] = [];
		try {
			for await (const part of resp.stream) {
				if (part instanceof vscode.LanguageModelTextPart) text += part.value;
				else if (part instanceof vscode.LanguageModelToolCallPart) toolCalls.push(part);
			}
		} catch (err) {
			stream.markdown('\n\n_Language model stream failed: ' + (err as Error).message + '_');
			return undefined;
		}
		if (token.isCancellationRequested) return undefined;

		finalText += text;

		if (toolCalls.length === 0) return finalText;

		// Feed the tool calls and their results back for the next round. Assistant turn
		// carries the calls; a User turn carries matching results.
		const assistantParts: Array<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart> = [];
		if (text) assistantParts.push(new vscode.LanguageModelTextPart(text));
		for (const c of toolCalls) assistantParts.push(c);
		messages.push(vscode.LanguageModelChatMessage.Assistant(assistantParts));

		// Feed tool results back on their own User message. Copilot's backend
		// translates a User-with-tool-result into a `tool`-role message under the
		// hood and rejects the request if the *last* message is a tool result
		// ("the last message must be a User message without a tool result"), so
		// follow it with a plain-text User message that becomes the genuine last
		// user turn.
		const resultParts: vscode.LanguageModelToolResultPart[] = [];
		for (const call of toolCalls) {
			const content = handleToolCall(call, loaded, stream);
			resultParts.push(new vscode.LanguageModelToolResultPart(
				call.callId,
				[new vscode.LanguageModelTextPart(content)],
			));
		}
		messages.push(vscode.LanguageModelChatMessage.User(resultParts));
		messages.push(vscode.LanguageModelChatMessage.User(
			'Reference loaded above. Now write the JavaScript snippet that answers the original request — raw JS only, starting with a `//` comment, no code fence.',
		));
	}

	stream.markdown(`\n\n_Tool-call loop exceeded ${MAX_TOOL_ROUNDS} rounds — using whatever text arrived._\n\n`);
	return finalText || undefined;
}

function handleToolCall(
	call: vscode.LanguageModelToolCallPart,
	loaded: Set<string>,
	stream: vscode.ChatResponseStream,
): string {
	if (call.name !== 'load_implant_reference') {
		return `Error: unknown tool '${call.name}'.`;
	}
	const refPath = (call.input as { path?: unknown }).path;
	if (typeof refPath !== 'string') {
		return 'Error: `path` argument missing or not a string.';
	}
	if (loaded.has(refPath)) {
		return `Already loaded '${refPath}' in this response — reuse the content from the previous tool result.`;
	}
	const ref = skillReference(refPath);
	if (!ref) {
		return `Error: unknown reference '${refPath}'. Valid paths: ${REFERENCE_PATHS.join(', ')}.`;
	}
	loaded.add(refPath);
	stream.markdown(`_↓ loaded reference: \`${refPath}\`_\n\n`);
	return ref;
}

async function presentSnippet(
	code: string,
	originalPrompt: string,
	retryCount: number,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
	run: RunFn,
): Promise<vscode.ChatResult | void> {
	const requireConfirmation = vscode.workspace.getConfiguration('implant').get<boolean>('requireConfirmation', true);
	if (!requireConfirmation) {
		stream.markdown('\n\n---\n\n');
		const result = await runAndRender(code, stream, token, run);
		if (!result || result.ok || token.isCancellationRequested) return;
		if (retryCount >= 1) return;
		return regenerateOnFailure(
			{ pendingCode: code, originalPrompt, retryCount },
			result,
			{ prompt: originalPrompt, model: undefined } as any,
			stream,
			token,
			(vscode as any).lm,
			run,
		);
	}
	stream.markdown('\n\n_Click **▶ Run this snippet** below to execute, or type another question._');
	return { metadata: { pendingCode: code, originalPrompt, retryCount } satisfies PendingMeta };
}

async function regenerateOnFailure(
	pending: PendingMeta,
	failed: ExecResult,
	request: vscode.ChatRequest,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
	lm: any,
	run: RunFn,
): Promise<vscode.ChatResult | void> {
	const model = await pickModel(request, lm);
	if (!model) return;

	stream.markdown('\n\n---\n\n_Trying a different approach…_\n\n');
	const err = failed.error ?? { name: 'Error', message: 'unknown failure' };
	const messages: vscode.LanguageModelChatMessage[] = [
		vscode.LanguageModelChatMessage.User(SYSTEM_PROMPT),
		vscode.LanguageModelChatMessage.User(FEWSHOT_USER),
		vscode.LanguageModelChatMessage.Assistant(FEWSHOT_ASSISTANT),
		vscode.LanguageModelChatMessage.User(pending.originalPrompt),
		vscode.LanguageModelChatMessage.Assistant(pending.pendingCode),
		vscode.LanguageModelChatMessage.User(
			`That snippet failed with: ${err.name}: ${err.message}\n\n` +
			`Try again with a different approach. Reply with raw JavaScript only, no fences. ` +
			`If the failure suggests you're missing context, use load_implant_reference to pull ` +
			`a relevant reference before retrying.`,
		),
	];
	const text = await runLmWithTools(model, messages, stream, token);
	if (text === undefined) return;

	const newCode = stripCodeFence(text);
	if (!newCode) return;
	stream.markdown('```js\n' + newCode + '\n```');
	return presentSnippet(newCode, pending.originalPrompt, pending.retryCount + 1, stream, token, run);
}

/**
 * Belt-and-suspenders: the preamble tells the model not to wrap its reply in a code
 * fence, but Copilot's underlying model has strong priors toward fenced code and ignores
 * the instruction often enough to matter. Strip a leading ```lang line and a trailing
 * ``` if present. Idempotent — plain JS passes through unchanged.
 */
function stripCodeFence(text: string): string {
	let out = text.trim();
	const opening = /^```[a-zA-Z0-9_+-]*\r?\n/;
	const closing = /\r?\n```\s*$/;
	if (opening.test(out)) out = out.replace(opening, '');
	if (closing.test(out)) out = out.replace(closing, '');
	return out.trim();
}

// Cap per-turn text size when replaying history. Non-implant participants
// (notably `@workspace`) can produce huge responses; letting them into the
// history verbatim balloons the context window.
const HISTORY_TURN_CAP = 4000;

function truncate(text: string): string {
	if (text.length <= HISTORY_TURN_CAP) return text;
	return `${text.slice(0, HISTORY_TURN_CAP)}\n…truncated…`;
}

function buildMessages(request: vscode.ChatRequest, chatCtx: vscode.ChatContext): vscode.LanguageModelChatMessage[] {
	const messages: vscode.LanguageModelChatMessage[] = [
		vscode.LanguageModelChatMessage.User(SYSTEM_PROMPT),
		vscode.LanguageModelChatMessage.User(FEWSHOT_USER),
		vscode.LanguageModelChatMessage.Assistant(FEWSHOT_ASSISTANT),
	];
	// Replay the entire chat history — including turns addressed to other
	// participants (@workspace, plain Copilot, etc.) — so the model can
	// follow references to earlier context. Non-implant turns are prefixed
	// with `[@<participant>]` so the model knows who was originally involved.
	for (const turn of chatCtx.history) {
		if ('prompt' in turn) {
			const t = turn as vscode.ChatRequestTurn;
			const prefix = t.participant === 'implant.assistant' ? '' : `[@${t.participant}] `;
			messages.push(vscode.LanguageModelChatMessage.User(truncate(prefix + t.prompt)));
		} else if ('response' in turn) {
			const t = turn as vscode.ChatResponseTurn;
			const flat = t.response.map(part =>
				part instanceof vscode.ChatResponseMarkdownPart ? part.value.value : '',
			).join('');
			if (!flat.trim()) continue;
			const prefix = t.participant === 'implant.assistant' ? '' : `[@${t.participant}] `;
			messages.push(vscode.LanguageModelChatMessage.Assistant(truncate(prefix + flat)));
		}
	}
	messages.push(vscode.LanguageModelChatMessage.User(request.prompt));
	return messages;
}

async function runAndRender(
	code: string,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
	run: RunFn,
): Promise<ExecResult | undefined> {
	const controller = new AbortController();
	if (token.isCancellationRequested) controller.abort();
	const cancelSub = token.onCancellationRequested(() => controller.abort());

	let result: ExecResult;
	try {
		result = await run(code, { skipApproval: true, signal: controller.signal });
	} finally {
		cancelSub.dispose();
	}
	if (token.isCancellationRequested) return result;

	if (result.logs?.length) {
		stream.markdown('**Logs:**\n');
		for (const l of result.logs) stream.markdown(`- \`[${l.level}]\` ${l.message}\n`);
		stream.markdown('\n');
	}
	if (result.ok) {
		stream.markdown(`**Result** (${result.durationMs} ms):\n\n`);
		renderValue(stream, result.value);
	} else {
		const e = result.error ?? { name: 'Error', message: 'unknown failure' };
		stream.markdown(`**${e.name}:** ${e.message}`);
	}
	return result;
}

function findPendingMeta(
	history: readonly (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[],
): PendingMeta | undefined {
	for (let i = history.length - 1; i >= 0; i--) {
		const turn = history[i];
		if ('response' in turn) {
			const meta = (turn as vscode.ChatResponseTurn).result?.metadata as PendingMeta | undefined;
			if (meta?.pendingCode) return meta;
			return undefined;
		}
	}
	return undefined;
}

function renderValue(stream: vscode.ChatResponseStream, value: unknown) {
	if (value === undefined) {
		stream.markdown('_(no value returned)_');
		return;
	}
	if (typeof value === 'string') {
		stream.markdown(value);
		return;
	}
	const json = JSON.stringify(value, null, 2);
	if (json.length > 8000) {
		stream.markdown('```json\n' + json.slice(0, 8000) + '\n…truncated…\n```');
	} else {
		stream.markdown('```json\n' + json + '\n```');
	}
}
