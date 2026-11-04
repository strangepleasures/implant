// Extension entry point: wires up @implant and its agent-facing script tool.
import * as vscode from 'vscode';
import { registerChatParticipant } from './chat-participant';
import { registerRunScriptTool, RUN_SCRIPT_TOOL } from './run-script-tool';
import { resolveScriptApproval, SCRIPT_APPROVAL_COMMAND } from './chat-render';

/** Called by VS Code when the extension activates. */
export function activate(context: vscode.ExtensionContext) {
	const output = vscode.window.createOutputChannel('Implant');
	context.subscriptions.push(output);
	output.appendLine(`Implant activating on VS Code ${vscode.version}…`);

	context.subscriptions.push(vscode.commands.registerCommand(SCRIPT_APPROVAL_COMMAND, resolveScriptApproval));
	registerChatParticipant(context, output);
	registerRunScriptTool(context);
	output.appendLine(`Registered language model tool: ${RUN_SCRIPT_TOOL}`);
}
