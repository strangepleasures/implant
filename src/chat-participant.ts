import * as vscode from 'vscode';
import type { ExecResult } from './executor';
import { OVERVIEW, RUNTIME_ENV, EXAMPLES, WARMUP, CAVEATS } from './agent-instructions';

// Chat-specific preamble only — everything else (runtime environment, examples, warmup,
// caveats) is the shared prose in assets/prose/, reused via agent-instructions.ts.
const CHAT_PREAMBLE = `You are Implant, an assistant that answers requests by running a
JavaScript snippet inside the VS Code extension host and streaming the result to the user
in Copilot Chat.

**Reply with raw JavaScript only — no fenced code blocks, no prose, no explanations
before or after.** Your entire response is parsed as JavaScript source and executed.
The chat surface wraps your output in a code block for display; there's no place for
prose to go.

If the request truly can't be answered via a vscode.* call, still return valid JavaScript
that returns an explanatory Markdown string, e.g. \`return "Sorry — this needs a shell
command, not a vscode.* call.";\`.

The user reads the returned value directly in the chat, so **return a Markdown string**:
use headings, bullet lists, code fences for source samples, and inline links for file
references (e.g. \`[src/foo.ts:42](vscode://file//abs/path/src/foo.ts?42)\` — VS Code
renders these as clickable jumps). Only return raw JSON if the user explicitly asks for
machine-readable output.`;

const SYSTEM_PROMPT = [CHAT_PREAMBLE, OVERVIEW, RUNTIME_ENV, EXAMPLES, WARMUP, CAVEATS].join('\n\n');

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
	if (typeof chat?.createChatParticipant !== 'function' || typeof lm?.selectChatModels !== 'function') {
		output.appendLine('Chat participant unavailable — vscode.chat / vscode.lm APIs not present.');
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
			// left a pending snippet. Execute it — and, on failure, ask the LM to try again
			// (once) with the error fed back.
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

			// Normal path: generate a new snippet from the user's prompt.
			const model = await pickModel(request, lm);
			if (!model) {
				stream.markdown('_No language model available. Install GitHub Copilot to use `@implant`._');
				return;
			}

			const messages = buildMessages(request, chatCtx);
			const text = await streamLmResponse(model, messages, stream, token);
			if (text === undefined) return;

			const code = text.trim();
			if (!code) {
				stream.markdown('\n\n_Empty response from the language model._');
				return;
			}

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
	const models = await lm.selectChatModels({ vendor: 'copilot' });
	return models?.[0];
}

async function streamLmResponse(
	model: vscode.LanguageModelChat,
	messages: vscode.LanguageModelChatMessage[],
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
): Promise<string | undefined> {
	let text = '';
	// Wrap the streamed raw-JS output in a fenced block so the chat renders it with
	// syntax highlighting. The model is instructed to emit no fences of its own.
	stream.markdown('```js\n');
	try {
		const resp = await model.sendRequest(messages, {}, token);
		for await (const chunk of resp.text) {
			text += chunk;
			stream.markdown(chunk);
		}
	} catch (err) {
		stream.markdown('\n```\n\n_Language model request failed: ' + (err as Error).message + '_');
		return undefined;
	}
	stream.markdown('\n```');
	if (token.isCancellationRequested) return undefined;
	return text;
}

async function presentSnippet(
	code: string,
	originalPrompt: string,
	retryCount: number,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
	run: RunFn,
): Promise<vscode.ChatResult | void> {
	// If confirmations are off, run inline. Otherwise leave the snippet as pending and
	// let the followup provider surface a "Run" button.
	const requireConfirmation = vscode.workspace.getConfiguration('implant').get<boolean>('requireConfirmation', true);
	if (!requireConfirmation) {
		stream.markdown('\n\n---\n\n');
		const result = await runAndRender(code, stream, token, run);
		if (!result || result.ok || token.isCancellationRequested) return;
		if (retryCount >= 1) return;
		return regenerateOnFailure(
			{ pendingCode: code, originalPrompt, retryCount },
			result,
			// Minimal fake ChatRequest — used only for model selection in the retry.
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
		vscode.LanguageModelChatMessage.User(pending.originalPrompt),
		vscode.LanguageModelChatMessage.Assistant(pending.pendingCode),
		vscode.LanguageModelChatMessage.User(
			`That snippet failed with: ${err.name}: ${err.message}\n\n` +
			`Try again with a different approach. Reply with raw JavaScript only, no fences.`,
		),
	];
	const text = await streamLmResponse(model, messages, stream, token);
	if (text === undefined) return;

	const newCode = text.trim();
	if (!newCode) return;
	return presentSnippet(newCode, pending.originalPrompt, pending.retryCount + 1, stream, token, run);
}

function buildMessages(request: vscode.ChatRequest, chatCtx: vscode.ChatContext): vscode.LanguageModelChatMessage[] {
	const messages: vscode.LanguageModelChatMessage[] = [
		vscode.LanguageModelChatMessage.User(SYSTEM_PROMPT),
	];
	// Fold the prior turns of THIS participant into the request so multi-turn context works.
	for (const turn of chatCtx.history) {
		if ('prompt' in turn && (turn as vscode.ChatRequestTurn).participant === 'implant.assistant') {
			messages.push(vscode.LanguageModelChatMessage.User((turn as vscode.ChatRequestTurn).prompt));
		} else if ('response' in turn && (turn as vscode.ChatResponseTurn).participant === 'implant.assistant') {
			const t = turn as vscode.ChatResponseTurn;
			const flat = t.response.map(part =>
				part instanceof vscode.ChatResponseMarkdownPart ? part.value.value : '',
			).join('');
			if (flat.trim()) messages.push(vscode.LanguageModelChatMessage.Assistant(flat));
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
	// Bridge the chat request's cancellation token to the runner via an AbortSignal, so
	// cancelling the chat response also aborts the executing snippet.
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
	// Look at the MOST RECENT response turn only — if the user asked us something else
	// in between, whatever snippet was pending is stale.
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
