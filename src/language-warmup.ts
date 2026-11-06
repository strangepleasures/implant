// Activates workspace languages and checks that sample workspace symbols are indexed before scripts run.
import * as path from 'path';
import * as vscode from 'vscode';
import { waitForWorkspaceIndexes } from './language-readiness';
import { activateLanguage } from './sandbox-helpers';

const EXCLUDE = '{**/node_modules/**,**/.git/**,**/out/**,**/dist/**,**/build/**}';

export interface LanguageWarmup {
	release(): void;
}

/** Picks one representative file per file extension. */
function pickSamples(files: vscode.Uri[]): vscode.Uri[] {
	const byExt = new Map<string, vscode.Uri>();
	for (const file of files) {
		const ext = path.extname(file.path).toLowerCase();
		if (ext && !byExt.has(ext)) {
			byExt.set(ext, file);
		}
	}
	return [...byExt.values()];
}

/**
 * Opens one sample document per extension and activates the matching language extensions.
 * Documents that were already open are left alone; `release` drops the ones opened here.
 */
export async function warmUpLanguages(): Promise<LanguageWarmup> {
	const held: vscode.TextDocument[] = [];
	try {
		const files = await vscode.workspace.findFiles('**/*', EXCLUDE);
		const alreadyOpen = new Set(vscode.workspace.textDocuments.map(d => d.uri.toString()));
		const languages = new Set<string>();
		const documents: vscode.TextDocument[] = [];
		await Promise.all(pickSamples(files).map(async uri => {
			try {
				const wasOpen = alreadyOpen.has(uri.toString());
				const doc = await vscode.workspace.openTextDocument(uri);
				documents.push(doc);
				languages.add(doc.languageId);
				if (!wasOpen) {
					held.push(doc);
				}
			} catch {
				// Binary or unreadable files cannot be opened as text; skip them.
			}
		}));
		await Promise.all([...languages].map(l => activateLanguage(l).catch(() => undefined)));
		await waitForWorkspaceIndexes(documents);
	} catch (err) {
		console.warn('Implant: language warm-up failed:', (err as Error).message);
	}
	return { release: () => { held.length = 0; } };
}
