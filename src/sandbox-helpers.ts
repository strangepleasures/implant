// Helper functions exposed to sandboxed scripts as globals.
import * as vscode from 'vscode';

/** Activate inactive extensions that declare an activation event for `langId`. */
export async function activateLanguage(langId: string): Promise<void> {
	const activationEvent = `onLanguage:${langId}`;
	await Promise.all(
		vscode.extensions.all
			.filter(e => !e.isActive)
			.filter(e => {
				const events = e.packageJSON?.activationEvents;
				return Array.isArray(events) && events.includes(activationEvent);
			})
			.map(e => e.activate()),
	);
}
