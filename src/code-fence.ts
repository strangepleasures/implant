// Cleans model output so it can be executed as plain JavaScript.

/**
 * Belt-and-suspenders: the preamble tells the model not to wrap its reply in a code
 * fence, but Copilot's underlying model has strong priors toward fenced code and ignores
 * the instruction often enough to matter. Strip a leading ```lang line and a trailing
 * ``` if present. Idempotent — plain JS passes through unchanged.
 */
export function stripCodeFence(text: string): string {
	let out = text.trim();
	const opening = /^```[a-zA-Z0-9_+-]*\r?\n/;
	const closing = /\r?\n```\s*$/;
	if (opening.test(out)) out = out.replace(opening, '');
	if (closing.test(out)) out = out.replace(closing, '');
	return out.trim();
}
