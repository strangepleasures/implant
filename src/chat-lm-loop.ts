// Drives the language model through its tool-call loop until it emits the final script.
import * as vscode from 'vscode';
import { LM_TOOLS } from './chat-tools';
import { handleToolCall } from './chat-tool-handler';

/**
 * Streams the model's response each round; if it emits `LanguageModelToolCallPart`s we run
 * them locally, feed the results back, and re-issue. When only text arrives, that text is
 * the final snippet. Returns the accumulated text, or undefined on failure/cancellation.
 */
export async function runLmWithTools(
	model: vscode.LanguageModelChat,
	initialMessages: vscode.LanguageModelChatMessage[],
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
): Promise<string | undefined> {
	const messages = [...initialMessages];
	const loaded = new Set<string>();
	let finalText = '';

	for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
		let text = '';
		const toolCalls: vscode.LanguageModelToolCallPart[] = [];
		try {
			const resp = await model.sendRequest(messages, { tools: LM_TOOLS }, token);
			for await (const part of resp.stream) {
				if (part instanceof vscode.LanguageModelTextPart) text += part.value;
				else if (part instanceof vscode.LanguageModelToolCallPart) toolCalls.push(part);
			}
		} catch (err) {
			stream.markdown('\n\n_Language model request failed: ' + (err as Error).message + '_');
			return undefined;
		}
		if (token.isCancellationRequested) return undefined;

		finalText += text;
		if (toolCalls.length === 0) return finalText;

		// Assistant turn carries the calls; a User turn carries matching results.
		const assistantParts: Array<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart> = [];
		if (text) assistantParts.push(new vscode.LanguageModelTextPart(text));
		assistantParts.push(...toolCalls);
		messages.push(vscode.LanguageModelChatMessage.Assistant(assistantParts));

		// Copilot's backend translates a User-with-tool-result into a `tool`-role message
		// and rejects the request if the *last* message is a tool result, so follow it
		// with a plain-text User message that becomes the genuine last user turn.
		const resultParts = toolCalls.map(call => new vscode.LanguageModelToolResultPart(
			call.callId,
			[new vscode.LanguageModelTextPart(handleToolCall(call, loaded, stream))],
		));
		messages.push(vscode.LanguageModelChatMessage.User(resultParts));
		messages.push(vscode.LanguageModelChatMessage.User(
			'Reference loaded above. Now write the JavaScript snippet that answers the original request — raw JS only, starting with a `//` comment, no code fence.',
		));
	}

	stream.markdown(`\n\n_Tool-call loop exceeded ${MAX_TOOL_ROUNDS} rounds — using whatever text arrived._\n\n`);
	return finalText || undefined;
}

// Cap on tool-call rounds per user turn. Typical flow needs 0–1 rounds; more usually
// means the model is looping.
const MAX_TOOL_ROUNDS = 4;
