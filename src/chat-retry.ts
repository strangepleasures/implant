// Repeatedly asks the model for a corrected script after a failed run, until one succeeds.
import * as vscode from 'vscode';
import type { ExecResult } from './exec-result';
import { baseMessages } from './chat-history';
import { pickModel } from './model-picker';
import { stripCodeFence } from './code-fence';
import { runLmWithTools } from './chat-lm-loop';
import { runAndRender } from './chat-render';

/**
 * Feeds each failure back to the model and runs its revised script, keeping the full
 * attempt history so it doesn't repeat itself. Stops on success, cancellation by the
 * user, or when the model can't produce a script (request failure or empty reply).
 */
export async function regenerateOnFailure(
	originalCode: string,
	originalPrompt: string,
	failed: ExecResult,
	request: vscode.ChatRequest,
	stream: vscode.ChatResponseStream,
	token: vscode.CancellationToken,
	lm: any,
): Promise<void> {
	const model = await pickModel(request, lm);
	if (!model) return;

	const messages = [
		...baseMessages(),
		vscode.LanguageModelChatMessage.User(originalPrompt),
		vscode.LanguageModelChatMessage.Assistant(originalCode),
	];
	let lastFailure = failed;

	for (let attempt = 1; !token.isCancellationRequested; attempt++) {
		stream.markdown(`\n\n---\n\n_Attempt ${attempt + 1}: trying a different approach…_\n\n`);
		messages.push(vscode.LanguageModelChatMessage.User(failureMessage(lastFailure)));

		const text = await runLmWithTools(model, messages, stream, token);
		if (text === undefined) return;
		const code = stripCodeFence(text);
		if (!code) {
			stream.markdown('\n\n_Empty response from the language model; stopping retries._');
			return;
		}
		messages.push(vscode.LanguageModelChatMessage.Assistant(code));

		const result = await runAndRender(code, stream, token);
		if (!result || result.ok) return;
		lastFailure = result;
	}
}

/** Builds the follow-up prompt that reports a failure back to the model. */
function failureMessage(failed: ExecResult): string {
	const err = failed.error ?? { name: 'Error', message: 'unknown failure' };
	return `That snippet failed with: ${err.name}: ${err.message}\n\n` +
		`Try again with a different approach. Reply with raw JavaScript only, no fences. ` +
		`If the failure suggests you're missing context, use load_implant_reference to pull ` +
		`a relevant reference before retrying.`;
}
