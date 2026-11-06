import * as vscode from 'vscode';

const MAX_INDEX_WAIT_MS = 10_000;
const POLL_INTERVAL_MS = 500;

interface IndexProbe {
	uri: vscode.Uri;
	name: string;
}

/** Uses a sample document symbol as positive evidence that its workspace index is ready. */
export async function waitForWorkspaceIndexes(documents: vscode.TextDocument[]): Promise<void> {
	const byLanguage = new Map<string, vscode.TextDocument[]>();
	for (const document of documents) {
		const group = byLanguage.get(document.languageId) ?? [];
		group.push(document);
		byLanguage.set(document.languageId, group);
	}

	const probes: IndexProbe[] = [];
	await Promise.all([...byLanguage.values()].map(async group => {
		for (const document of group) {
			try {
				const symbols = await vscode.commands.executeCommand<
					(vscode.DocumentSymbol | vscode.SymbolInformation)[]
				>('vscode.executeDocumentSymbolProvider', document.uri);
				const name = symbols?.find(symbol => symbol.name)?.name;
				if (name) {
					probes.push({ uri: document.uri, name });
					return;
				}
			} catch (err) {
				console.warn('Implant: document-symbol readiness probe failed:', (err as Error).message);
			}
		}
	}));

	const pending = new Set(probes);
	const deadline = Date.now() + MAX_INDEX_WAIT_MS;
	while (pending.size && Date.now() < deadline) {
		await Promise.all([...pending].map(async probe => {
			try {
				const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
					'vscode.executeWorkspaceSymbolProvider',
					probe.name,
				);
				if (symbols === undefined || symbols.some(symbol =>
					symbol.name === probe.name && symbol.location.uri.toString() === probe.uri.toString())) {
					pending.delete(probe);
				}
			} catch (err) {
				console.warn('Implant: workspace-symbol readiness probe failed:', (err as Error).message);
				pending.delete(probe);
			}
		}));
		if (pending.size) {
			await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
		}
	}
	if (pending.size) {
		console.warn('Implant: workspace-symbol indexes are still warming up for:',
			[...pending].map(probe => probe.name).join(', '));
	}
}
