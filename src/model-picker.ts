// Selects the language model used to draft scripts.
import type * as vscode from 'vscode';

/** Picks the model the user selected, falling back to the first Copilot model. */
export async function pickModel(request: vscode.ChatRequest, lm: any): Promise<vscode.LanguageModelChat | undefined> {
	if (request.model) return request.model;
	if (typeof lm?.selectChatModels !== 'function') return undefined;
	const models = await lm.selectChatModels({ vendor: 'copilot' });
	return models?.[0];
}
