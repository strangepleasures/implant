import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export type Approval = 'run' | 'trust' | 'deny';

export function askApproval(code: string, extensionUri: vscode.Uri): Promise<Approval> {
	return new Promise(resolve => {
		const assetsRoot = vscode.Uri.joinPath(extensionUri, 'assets');
		const panel = vscode.window.createWebviewPanel(
			'implantApproval',
			'Implant: agent script',
			{ viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
			{ enableScripts: true, retainContextWhenHidden: false, localResourceRoots: [assetsRoot] },
		);

		let settled = false;
		const settle = (v: Approval) => {
			if (settled) return;
			settled = true;
			panel.dispose();
			resolve(v);
		};
		panel.onDidDispose(() => settle('deny'));
		panel.webview.onDidReceiveMessage(msg => {
			if (msg?.action === 'run' || msg?.action === 'trust' || msg?.action === 'deny') settle(msg.action);
		});

		const template = fs.readFileSync(path.join(extensionUri.fsPath, 'assets', 'approval.html'), 'utf8');
		const hljsJs = panel.webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, 'highlight', 'highlight.min.js'));
		const hljsCss = panel.webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, 'highlight', 'vscode-theme.css'));
		const csp = `default-src 'none'; script-src ${panel.webview.cspSource} 'unsafe-inline'; style-src ${panel.webview.cspSource} 'unsafe-inline'`;

		panel.webview.html = template
			.replaceAll('{{csp}}', csp)
			.replaceAll('{{hljsJs}}', hljsJs.toString())
			.replaceAll('{{hljsCss}}', hljsCss.toString())
			.replaceAll('{{code}}', escapeHtml(code));
	});
}

function escapeHtml(s: string): string {
	return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
}
