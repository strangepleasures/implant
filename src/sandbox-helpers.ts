import * as vscode from 'vscode';

/**
 * Activate every extension registered for `langId` (via `onLanguage:${langId}`
 * activation event) and wait until the document-symbol provider actually
 * responds for that language.
 *
 * VS Code doesn't expose language servers as first-class handles — this helper
 * only kicks the activation events the LSP-hosting extensions have declared
 * and probes a provider until it stops returning `undefined` (the signal that
 * nothing is registered yet). In a warm workspace it's a fast no-op; on a
 * fresh window it lets scripts avoid the "first call to
 * `executeReferenceProvider` returns undefined" trap.
 *
 * Returns `true` once a provider has answered, `false` if `timeoutMs` elapses
 * first.
 */
export async function activateLanguage(langId: string, timeoutMs: number = 30_000): Promise<boolean> {
	// 1. Fire every extension whose declared activation events include this
	//    language. Failures don't stop the rest — a broken extension shouldn't
	//    prevent the healthy ones from coming up.
	const activationEvent = `onLanguage:${langId}`;
	await Promise.all(
		vscode.extensions.all
			.filter(e => !e.isActive)
			.filter(e => {
				const events = e.packageJSON?.activationEvents;
				return Array.isArray(events) && events.includes(activationEvent);
			})
			.map(e => e.activate().then(() => undefined, () => undefined)),
	);

	// 2. Find a probe URI. Prefer an open doc with matching language; fall
	//    back to a zero-length untitled doc, which exists in
	//    `workspace.textDocuments` but doesn't open an editor tab.
	let probe: vscode.Uri | undefined = vscode.workspace.textDocuments
		.find(d => d.languageId === langId)?.uri;
	if (!probe) {
		const doc = await vscode.workspace.openTextDocument({ language: langId, content: '' });
		probe = doc.uri;
	}

	// 3. Poll until the document-symbol provider returns a defined value
	//    (including `[]` — that means the provider ran; it just found nothing).
	//    Providers legitimately return `undefined` when none are registered
	//    yet, which is the state we're waiting past.
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const result = await vscode.commands.executeCommand<unknown>(
			'vscode.executeDocumentSymbolProvider',
			probe,
		);
		if (result !== undefined) return true;
		await new Promise(r => setTimeout(r, 500));
	}
	return false;
}
