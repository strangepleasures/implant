// Promise helper that bounds an async script by a timeout and/or an abort signal.

/**
 * Settles with `p`, unless `ms` elapses (when positive) or `signal` aborts first,
 * in which case the returned promise rejects. Listeners and timers are always cleaned up.
 */
export function withTimeoutAndAbort<T>(p: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
	if ((!ms || ms <= 0) && !signal) return p;
	return new Promise<T>((resolve, reject) => {
		const timer = ms > 0 ? setTimeout(() => finish(() => reject(new Error(`Script exceeded ${ms}ms timeout`))), ms) : null;
		const onAbort = () => finish(() => reject(new Error('User terminated the script')));
		let done = false;
		const finish = (act: () => void) => {
			if (done) return;
			done = true;
			if (timer) clearTimeout(timer);
			signal?.removeEventListener('abort', onAbort);
			act();
		};
		signal?.addEventListener('abort', onAbort);
		if (signal?.aborted) return finish(() => reject(new Error('User terminated the script')));
		p.then(v => finish(() => resolve(v)), e => finish(() => reject(e)));
	});
}
