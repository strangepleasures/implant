// Builds the message list sent to the model, including prior chat history.
import * as vscode from 'vscode';
import { FEWSHOT_ASSISTANT, FEWSHOT_USER, SYSTEM_PROMPT } from './chat-prompts';

/** The system prompt plus the few-shot example, which open every conversation. */
export function baseMessages(): vscode.LanguageModelChatMessage[] {
	return [
		vscode.LanguageModelChatMessage.User(SYSTEM_PROMPT),
		vscode.LanguageModelChatMessage.User(FEWSHOT_USER),
		vscode.LanguageModelChatMessage.Assistant(FEWSHOT_ASSISTANT),
	];
}

/**
 * Replays the entire chat history — including turns addressed to other participants
 * (@workspace, plain Copilot, etc.) — so the model can follow references to earlier
 * Turns are prefixed with `[@<participant>]` to retain participant identity.
 */
export function buildMessages(request: vscode.ChatRequest, chatCtx: vscode.ChatContext): vscode.LanguageModelChatMessage[] {
	const messages = baseMessages();
	for (const turn of chatCtx.history) {
		const prefix = `[@${turn.participant}] `;
		if ('prompt' in turn) {
			messages.push(vscode.LanguageModelChatMessage.User(truncate(prefix + turn.prompt)));
		} else if ('response' in turn) {
			const flat = turn.response.map(part =>
				part instanceof vscode.ChatResponseMarkdownPart ? part.value.value : '',
			).join('');
			if (!flat.trim()) continue;
			messages.push(vscode.LanguageModelChatMessage.Assistant(truncate(prefix + flat)));
		}
	}
	messages.push(vscode.LanguageModelChatMessage.User(request.prompt));
	return messages;
}

// Cap per-turn text size when replaying history. Non-implant participants
// (notably `@workspace`) can produce huge responses; letting them into the
// history verbatim balloons the context window.
const HISTORY_TURN_CAP = 4000;

/** Shortens `text` to HISTORY_TURN_CAP characters. */
function truncate(text: string): string {
	if (text.length <= HISTORY_TURN_CAP) return text;
	return `${text.slice(0, HISTORY_TURN_CAP)}\n…truncated…`;
}
