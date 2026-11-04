// System prompt and few-shot example that teach the model to reply with raw JavaScript.
export { SYSTEM_PROMPT } from './prompt-assets';

// Few-shot demonstration turn. Injected at the top of every message list. Concrete examples
// of correctly-shaped replies are far more effective at enforcing format than any amount of
// prose — the model imitates what it sees.
/** User half of the few-shot demonstration. */
export const FEWSHOT_USER = 'count the .ts files under src/';
/** Assistant half of the few-shot demonstration: correctly shaped raw JS. */
export const FEWSHOT_ASSISTANT =
	`// Count TS files under src/, excluding node_modules.
const files = await vscode.workspace.findFiles('src/**/*.ts', '**/node_modules/**');
return files.length;`;
