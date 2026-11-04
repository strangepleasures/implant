// Registers the @implant chat participant: prompt -> script -> approval -> run -> render.
import * as vscode from 'vscode';
import { buildMessages } from './chat-history';
import { pickModel } from './model-picker';
import { stripCodeFence } from './code-fence';
import { runLmWithTools } from './chat-lm-loop';
import { runAndRender } from './chat-render';
import { regenerateOnFailure } from './chat-retry';

/** Registers the participant if the host exposes the chat API; otherwise logs and does nothing. */
export function registerChatParticipant(
	context: vscode.ExtensionContext,
	output: vscode.OutputChannel,
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
			const model = await pickModel(request, lm);
			if (!model) {
				stream.markdown('_No language model available. Install GitHub Copilot to use `@implant`._');
				return;
			}
			const text = await runLmWithTools(model, buildMessages(request, chatCtx), stream, token);
			if (text === undefined) return;

			const code = stripCodeFence(text);
			if (!code) {
				stream.markdown('_Empty response from the language model._');
				return;
			}
			const result = await runAndRender(code, stream, token);
			if (!result || result.ok || token.isCancellationRequested) return;
			return regenerateOnFailure(code, request.prompt, result, request, stream, token, lm);
		},
	);

	participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'assets', 'icon.png');
	context.subscriptions.push(participant);
	output.appendLine('Registered @implant chat participant.');
}
